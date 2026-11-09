import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  logAuditEvent,
  notifyAllAdmins,
  requireAuth,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkScheduleConflicts,
  normalizeScheduleRow,
  SCHEDULE_DETAIL_SELECT,
} from "@/lib/scheduling";
import {
  buildJakartaTimestamptz,
  formatJakartaDate,
  formatJakartaTimeRange,
} from "@/lib/timezone";

const createRequestSchema = z.object({
  schedule_id: z.string().uuid("Valid schedule ID is required"),
  proposed_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Valid date (YYYY-MM-DD) is required"),
  proposed_start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Valid start time (HH:mm) is required"),
  proposed_end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Valid end time (HH:mm) is required"),
  reason: z.string().min(3, "Please provide a reason for the schedule change"),
});

export async function GET() {
  try {
    const profile = await requireAuth();
    const admin = createAdminClient();

    let query = admin
      .from("schedule_requests")
      .select(
        `
        id,
        schedule_id,
        requested_by,
        proposed_start_at,
        proposed_end_at,
        reason,
        status,
        reviewed_by,
        reviewed_at,
        created_at,
        requester:profiles!schedule_requests_requested_by_fkey(id, full_name, email, role),
        reviewer:profiles!schedule_requests_reviewed_by_fkey(id, full_name, email)
      `
      )
      .order("created_at", { ascending: false });

    if (profile.role === "teacher") {
      query = query.eq("requested_by", profile.id);
    }

    const { data: requestsRaw, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const scheduleIds = Array.from(
      new Set((requestsRaw || []).map((r) => r.schedule_id))
    );

    const scheduleMap = new Map<string, Record<string, unknown>>();
    if (scheduleIds.length > 0) {
      const { data: schedulesRaw } = await admin
        .from("schedules")
        .select(SCHEDULE_DETAIL_SELECT)
        .in("id", scheduleIds);

      for (const s of schedulesRaw || []) {
        scheduleMap.set(
          s.id,
          normalizeScheduleRow(s as Record<string, unknown>)
        );
      }
    }

    const requests = (requestsRaw || []).map((req) => ({
      ...req,
      requester: Array.isArray(req.requester)
        ? req.requester[0]
        : req.requester,
      reviewer: Array.isArray(req.reviewer) ? req.reviewer[0] : req.reviewer,
      schedule: scheduleMap.get(req.schedule_id) ?? null,
    }));

    return NextResponse.json({ requests });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to load schedule requests" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const profile = await requireAuth();
    const body = await request.json();
    const parsed = createRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid request data" },
        { status: 400 }
      );
    }

    const data = parsed.data;
    if (data.proposed_end_time <= data.proposed_start_time) {
      return NextResponse.json(
        { error: "Proposed end time must be after proposed start time." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: scheduleRow, error: schedErr } = await admin
      .from("schedules")
      .select(SCHEDULE_DETAIL_SELECT)
      .eq("id", data.schedule_id)
      .single();

    if (schedErr || !scheduleRow) {
      return NextResponse.json(
        { error: "Original schedule not found." },
        { status: 404 }
      );
    }

    const schedule = normalizeScheduleRow(
      scheduleRow as Record<string, unknown>
    ) as Record<string, unknown>;

    // Teachers can only submit change requests for their own schedules
    if (profile.role === "teacher" && schedule.teacher_id !== profile.id) {
      return NextResponse.json(
        {
          error:
            "You can only submit schedule change requests for your own lessons.",
        },
        { status: 403 }
      );
    }

    if (schedule.status === "cancelled") {
      return NextResponse.json(
        { error: "Cannot request a change for a cancelled schedule." },
        { status: 400 }
      );
    }

    // Check if there is already a pending request for this schedule
    const { data: existingPending } = await admin
      .from("schedule_requests")
      .select("id")
      .eq("schedule_id", data.schedule_id)
      .eq("status", "pending")
      .maybeSingle();

    if (existingPending) {
      return NextResponse.json(
        {
          error:
            "There is already a pending schedule change request for this lesson.",
        },
        { status: 409 }
      );
    }

    const proposedStartAt = buildJakartaTimestamptz(
      data.proposed_date,
      data.proposed_start_time
    );
    const proposedEndAt = buildJakartaTimestamptz(
      data.proposed_date,
      data.proposed_end_time
    );

    // Validate that the proposed time does not conflict with existing confirmed schedules
    const conflict = await checkScheduleConflicts({
      teacherId: schedule.teacher_id as string,
      studentId: schedule.student_id as string,
      roomId: schedule.room_id as string,
      startAt: proposedStartAt,
      endAt: proposedEndAt,
      excludeScheduleId: data.schedule_id,
    });

    if (conflict.hasConflict) {
      return NextResponse.json(
        {
          error: `Proposed time slot is unavailable — ${conflict.message}`,
        },
        { status: 409 }
      );
    }

    const { data: createdRequest, error: insertErr } = await admin
      .from("schedule_requests")
      .insert({
        schedule_id: data.schedule_id,
        requested_by: profile.id,
        proposed_start_at: proposedStartAt,
        proposed_end_at: proposedEndAt,
        reason: data.reason.trim(),
        status: "pending",
      })
      .select("*")
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 400 });
    }

    const instName =
      (schedule.instrument as { name?: string } | null)?.name || "Music";
    const stuName =
      (schedule.student as { full_name?: string } | null)?.full_name ||
      "Student";

    await notifyAllAdmins({
      title: "New Schedule Change Request",
      message: `${profile.full_name} requested to move ${instName} lesson with ${stuName} to ${formatJakartaDate(
        proposedStartAt
      )} (${formatJakartaTimeRange(proposedStartAt, proposedEndAt)}).`,
    });

    await logAuditEvent({
      userId: profile.id,
      action: "CREATE_SCHEDULE_REQUEST",
      tableName: "schedule_requests",
      recordId: createdRequest.id,
      newData: createdRequest,
    });

    return NextResponse.json({ request: createdRequest }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to submit schedule change request" },
      { status: 500 }
    );
  }
}

