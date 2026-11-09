import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  createNotification,
  logAuditEvent,
  requireAuth,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkScheduleConflicts,
  normalizeScheduleRow,
  SCHEDULE_DETAIL_SELECT,
  translateDbConstraintError,
} from "@/lib/scheduling";
import { formatJakartaDate, formatJakartaTimeRange } from "@/lib/timezone";

const reviewRequestSchema = z.object({
  status: z.enum(["approved", "rejected", "cancelled"]),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAuth();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = reviewRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request status action." },
        { status: 400 }
      );
    }

    const nextStatus = parsed.data.status;
    const admin = createAdminClient();

    const { data: reqRow, error: fetchErr } = await admin
      .from("schedule_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !reqRow) {
      return NextResponse.json(
        { error: "Schedule change request not found." },
        { status: 404 }
      );
    }

    if (reqRow.status !== "pending") {
      return NextResponse.json(
        {
          error: `This request has already been ${reqRow.status} and cannot be modified again.`,
        },
        { status: 409 }
      );
    }

    // Teachers can only cancel their own pending request; they can NEVER approve or reject!
    if (actor.role !== "admin") {
      if (nextStatus !== "cancelled" || reqRow.requested_by !== actor.id) {
        return NextResponse.json(
          {
            error:
              "Forbidden. Only administrators can approve or reject schedule change requests.",
          },
          { status: 403 }
        );
      }

      const { data: cancelledReq, error: cancelErr } = await admin
        .from("schedule_requests")
        .update({
          status: "cancelled",
          reviewed_by: actor.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "pending")
        .select("*")
        .single();

      if (cancelErr) {
        return NextResponse.json({ error: cancelErr.message }, { status: 400 });
      }

      return NextResponse.json({ request: cancelledReq });
    }

    // Fetch original schedule details
    const { data: schedRaw, error: schedErr } = await admin
      .from("schedules")
      .select(SCHEDULE_DETAIL_SELECT)
      .eq("id", reqRow.schedule_id)
      .single();

    if (schedErr || !schedRaw) {
      return NextResponse.json(
        { error: "Associated schedule not found." },
        { status: 404 }
      );
    }

    const schedule = normalizeScheduleRow(
      schedRaw as Record<string, unknown>
    ) as Record<string, unknown>;

    const instName =
      (schedule.instrument as { name?: string } | null)?.name || "Music";
    const stuName =
      (schedule.student as { full_name?: string } | null)?.full_name ||
      "Student";

    if (nextStatus === "approved") {
      // 1. Re-verify no conflicts at approval time to prevent concurrent approvals from colliding
      const conflict = await checkScheduleConflicts({
        teacherId: schedule.teacher_id as string,
        studentId: schedule.student_id as string,
        roomId: schedule.room_id as string,
        startAt: reqRow.proposed_start_at,
        endAt: reqRow.proposed_end_at,
        excludeScheduleId: reqRow.schedule_id,
      });

      if (conflict.hasConflict) {
        return NextResponse.json(
          {
            error: `Cannot approve request — ${conflict.message}`,
          },
          { status: 409 }
        );
      }

      // 2. Atomically claim the pending request first so two concurrent approvals cannot both succeed
      const { data: claimedRequest, error: claimErr } = await admin
        .from("schedule_requests")
        .update({
          status: "approved",
          reviewed_by: actor.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();

      if (claimErr || !claimedRequest) {
        return NextResponse.json(
          { error: "Request was already processed by another administrator." },
          { status: 409 }
        );
      }

      // 3. Update the original schedule safely
      const { error: schedUpdateErr } = await admin
        .from("schedules")
        .update({
          start_at: reqRow.proposed_start_at,
          end_at: reqRow.proposed_end_at,
          status: "confirmed",
          updated_by: actor.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reqRow.schedule_id);

      if (schedUpdateErr) {
        // Rollback request status to pending if DB constraint rejected the schedule update
        await admin
          .from("schedule_requests")
          .update({
            status: "pending",
            reviewed_by: null,
            reviewed_at: null,
          })
          .eq("id", id);

        return NextResponse.json(
          { error: translateDbConstraintError(schedUpdateErr) },
          { status: 409 }
        );
      }

      await createNotification({
        userId: reqRow.requested_by,
        title: "Schedule Change Request Approved",
        message: `Your request to move ${instName} lesson with ${stuName} to ${formatJakartaDate(
          reqRow.proposed_start_at
        )} (${formatJakartaTimeRange(
          reqRow.proposed_start_at,
          reqRow.proposed_end_at
        )}) has been approved.`,
      });

      await logAuditEvent({
        userId: actor.id,
        action: "APPROVE_SCHEDULE_REQUEST",
        tableName: "schedule_requests",
        recordId: id,
        oldData: {
          start_at: schedule.start_at,
          end_at: schedule.end_at,
        },
        newData: {
          proposed_start_at: reqRow.proposed_start_at,
          proposed_end_at: reqRow.proposed_end_at,
        },
      });

      return NextResponse.json({ request: claimedRequest });
    }

    // Rejected by Admin
    const { data: rejectedRequest, error: rejectErr } = await admin
      .from("schedule_requests")
      .update({
        status: "rejected",
        reviewed_by: actor.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("*")
      .single();

    if (rejectErr) {
      return NextResponse.json({ error: rejectErr.message }, { status: 400 });
    }

    await createNotification({
      userId: reqRow.requested_by,
      title: "Schedule Change Request Rejected",
      message: `Your request to reschedule the ${instName} lesson with ${stuName} to ${formatJakartaDate(
        reqRow.proposed_start_at
      )} (${formatJakartaTimeRange(
        reqRow.proposed_start_at,
        reqRow.proposed_end_at
      )}) was not approved. The original schedule remains unchanged.`,
    });

    await logAuditEvent({
      userId: actor.id,
      action: "REJECT_SCHEDULE_REQUEST",
      tableName: "schedule_requests",
      recordId: id,
      newData: rejectedRequest,
    });

    return NextResponse.json({ request: rejectedRequest });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to review schedule request" },
      { status: 500 }
    );
  }
}

