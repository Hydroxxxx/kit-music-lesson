import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  createNotification,
  logAuditEvent,
  requireAdmin,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkScheduleConflicts,
  normalizeScheduleRow,
  SCHEDULE_DETAIL_SELECT,
  translateDbConstraintError,
  validateTeacherQualification,
} from "@/lib/scheduling";
import {
  buildJakartaTimestamptz,
  formatJakartaDate,
  formatJakartaTimeRange,
} from "@/lib/timezone";

const updateScheduleSchema = z.object({
  teacher_id: z.string().uuid().optional(),
  student_id: z.string().uuid().optional(),
  instrument_id: z.string().uuid().optional(),
  room_id: z.string().uuid().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  start_at: z.string().optional(),
  end_at: z.string().optional(),
  status: z.enum(["pending", "confirmed", "cancelled"]).optional(),
  notes: z.string().nullable().optional(),
  detach_from_series: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const adminProfile = await requireAdmin();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateScheduleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid update payload" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: existing, error: fetchErr } = await admin
      .from("schedules")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json(
        { error: "Schedule not found" },
        { status: 404 }
      );
    }

    const input = parsed.data;
    const nextTeacherId = input.teacher_id ?? existing.teacher_id;
    const nextStudentId = input.student_id ?? existing.student_id;
    const nextInstrumentId = input.instrument_id ?? existing.instrument_id;
    const nextRoomId = input.room_id ?? existing.room_id;
    const nextStatus = input.status ?? existing.status;

    let nextStartAt = existing.start_at as string;
    let nextEndAt = existing.end_at as string;

    if (input.date && input.start_time && input.end_time) {
      if (input.end_time <= input.start_time) {
        return NextResponse.json(
          { error: "End time must be after start time." },
          { status: 400 }
        );
      }
      nextStartAt = buildJakartaTimestamptz(input.date, input.start_time);
      nextEndAt = buildJakartaTimestamptz(input.date, input.end_time);
    } else if (input.start_at && input.end_at) {
      if (new Date(input.end_at) <= new Date(input.start_at)) {
        return NextResponse.json(
          { error: "End time must be after start time." },
          { status: 400 }
        );
      }
      nextStartAt = input.start_at;
      nextEndAt = input.end_at;
    }

    // Validate qualification if teacher or instrument changed
    if (
      nextTeacherId !== existing.teacher_id ||
      nextInstrumentId !== existing.instrument_id
    ) {
      const qual = await validateTeacherQualification(
        nextTeacherId,
        nextInstrumentId
      );
      if (!qual.valid) {
        return NextResponse.json({ error: qual.message }, { status: 400 });
      }
    }

    // Check double booking if schedule is/will be confirmed
    if (nextStatus === "confirmed") {
      const conflict = await checkScheduleConflicts({
        teacherId: nextTeacherId,
        studentId: nextStudentId,
        roomId: nextRoomId,
        startAt: nextStartAt,
        endAt: nextEndAt,
        excludeScheduleId: id,
      });

      if (conflict.hasConflict) {
        return NextResponse.json({ error: conflict.message }, { status: 409 });
      }
    }

    const updatePayload: Record<string, unknown> = {
      teacher_id: nextTeacherId,
      student_id: nextStudentId,
      instrument_id: nextInstrumentId,
      room_id: nextRoomId,
      start_at: nextStartAt,
      end_at: nextEndAt,
      status: nextStatus,
      updated_by: adminProfile.id,
      updated_at: new Date().toISOString(),
    };

    if (input.notes !== undefined) {
      updatePayload.notes = input.notes;
    }
    if (input.detach_from_series) {
      updatePayload.series_id = null;
    }

    const { data: updatedRow, error: updateErr } = await admin
      .from("schedules")
      .update(updatePayload)
      .eq("id", id)
      .select(SCHEDULE_DETAIL_SELECT)
      .single();

    if (updateErr) {
      return NextResponse.json(
        { error: translateDbConstraintError(updateErr) },
        { status: 409 }
      );
    }

    const schedule = normalizeScheduleRow(
      updatedRow as Record<string, unknown>
    ) as Record<string, unknown>;

    const instName =
      (schedule.instrument as { name?: string } | null)?.name || "Music";
    const stuName =
      (schedule.student as { full_name?: string } | null)?.full_name ||
      "Student";
    const roomName =
      (schedule.room as { name?: string } | null)?.name || "Room";

    const isCancelled =
      existing.status !== "cancelled" && nextStatus === "cancelled";

    await createNotification({
      userId: nextTeacherId,
      title: isCancelled
        ? `${instName} Lesson Cancelled`
        : `${instName} Schedule Updated`,
      message: isCancelled
        ? `Your ${instName} lesson with ${stuName} on ${formatJakartaDate(
            nextStartAt
          )} (${formatJakartaTimeRange(nextStartAt, nextEndAt)}) has been cancelled.`
        : `Your ${instName} lesson with ${stuName} in ${roomName} is now scheduled for ${formatJakartaDate(
            nextStartAt
          )} (${formatJakartaTimeRange(nextStartAt, nextEndAt)}) [${nextStatus.toUpperCase()}].`,
    });

    await logAuditEvent({
      userId: adminProfile.id,
      action: isCancelled ? "CANCEL_SCHEDULE" : "UPDATE_SCHEDULE",
      tableName: "schedules",
      recordId: id,
      oldData: existing,
      newData: updatePayload,
    });

    return NextResponse.json({ schedule });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to update schedule",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const adminProfile = await requireAdmin();
    const { id } = await context.params;
    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("schedules")
      .select("*")
      .eq("id", id)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: "Schedule not found" },
        { status: 404 }
      );
    }

    // Soft-cancel or delete if no requests reference it
    const { error: delErr } = await admin
      .from("schedules")
      .update({
        status: "cancelled",
        updated_by: adminProfile.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    await createNotification({
      userId: existing.teacher_id,
      title: "Lesson Cancelled",
      message: `A scheduled lesson on ${formatJakartaDate(
        existing.start_at
      )} (${formatJakartaTimeRange(
        existing.start_at,
        existing.end_at
      )}) was cancelled by an administrator.`,
    });

    await logAuditEvent({
      userId: adminProfile.id,
      action: "CANCEL_SCHEDULE",
      tableName: "schedules",
      recordId: id,
      oldData: existing,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to cancel schedule" },
      { status: 500 }
    );
  }
}

