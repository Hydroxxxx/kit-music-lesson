import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  createNotification,
  logAuditEvent,
  requireAdmin,
  requireAuth,
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
  addDaysToDateString,
  buildJakartaTimestamptz,
  formatJakartaDate,
  formatJakartaTimeRange,
  getJakartaDayOfWeek,
} from "@/lib/timezone";

const createScheduleSchema = z.object({
  teacher_id: z.string().uuid("Please select a valid teacher"),
  student_id: z.string().uuid("Please select a valid student"),
  instrument_id: z.string().uuid("Please select a valid instrument"),
  room_id: z.string().uuid("Please select a valid room"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)"),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "Invalid start time (HH:mm)"),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, "Invalid end time (HH:mm)"),
  status: z.enum(["pending", "confirmed", "cancelled"]).default("confirmed"),
  notes: z.string().nullable().optional(),
  is_recurring: z.boolean().default(false),
  recurrence_end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  recurrence_weekdays: z.array(z.number().min(0).max(6)).optional(),
});

export async function GET(request: Request) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const teacherId = searchParams.get("teacher_id");
    const instrumentId = searchParams.get("instrument_id");
    const roomId = searchParams.get("room_id");
    const studentId = searchParams.get("student_id");
    const status = searchParams.get("status");
    const includeMeta = searchParams.get("include_meta") === "true";

    const admin = createAdminClient();
    let query = admin
      .from("schedules")
      .select(SCHEDULE_DETAIL_SELECT)
      .order("start_at", { ascending: true });

    if (start) {
      query = query.gte("end_at", start);
    }
    if (end) {
      query = query.lte("start_at", end);
    }
    if (teacherId && teacherId !== "all") {
      query = query.eq("teacher_id", teacherId);
    }
    if (instrumentId && instrumentId !== "all") {
      query = query.eq("instrument_id", instrumentId);
    }
    if (roomId && roomId !== "all") {
      query = query.eq("room_id", roomId);
    }
    if (studentId && studentId !== "all") {
      query = query.eq("student_id", studentId);
    }
    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const { data: rawSchedules, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const schedules = (rawSchedules || []).map((r) =>
      normalizeScheduleRow(r as Record<string, unknown>)
    );

    if (!includeMeta) {
      return NextResponse.json({ schedules });
    }

    const [
      { data: teachersRaw },
      { data: students },
      { data: instruments },
      { data: rooms },
      { data: teacherInstruments },
      { data: availability },
    ] = await Promise.all([
      admin
        .from("teachers")
        .select("id, phone, bio, is_active, created_at, profile:profiles(id, full_name, email, role, avatar_url)")
        .order("created_at", { ascending: true }),
      admin
        .from("students")
        .select("*")
        .order("full_name", { ascending: true }),
      admin
        .from("instruments")
        .select("*")
        .order("name", { ascending: true }),
      admin.from("rooms").select("*").order("name", { ascending: true }),
      admin.from("teacher_instruments").select("teacher_id, instrument_id"),
      admin.from("teacher_availability").select("*"),
    ]);

    const instMap = new Map((instruments || []).map((i) => [i.id, i]));
    const teachers = (teachersRaw || []).map((t) => {
      const prof = Array.isArray(t.profile) ? t.profile[0] : t.profile;
      const qualifiedInsts = (teacherInstruments || [])
        .filter((ti) => ti.teacher_id === t.id)
        .map((ti) => instMap.get(ti.instrument_id))
        .filter(Boolean);
      const teacherAvail = (availability || []).filter(
        (a) => a.teacher_id === t.id
      );
      return {
        ...t,
        profile: prof,
        instruments: qualifiedInsts,
        availability: teacherAvail,
      };
    });

    return NextResponse.json({
      schedules,
      meta: {
        teachers,
        students: students || [],
        instruments: instruments || [],
        rooms: rooms || [],
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to load schedules" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAuth();
    const body = await request.json();
    const parsed = createScheduleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid schedule data" },
        { status: 400 }
      );
    }

    const data = parsed.data;
    // Teachers can only create schedules assigned to themselves
    if (actor.role !== "admin" && data.teacher_id !== actor.id) {
      return NextResponse.json(
        { error: "Teachers can only create schedules for their own lessons." },
        { status: 403 }
      );
    }
    if (data.end_time <= data.start_time) {
      return NextResponse.json(
        { error: "End time must be after start time." },
        { status: 400 }
      );
    }

    // 1. Validate teacher qualification for the selected instrument
    const qual = await validateTeacherQualification(
      data.teacher_id,
      data.instrument_id
    );
    if (!qual.valid) {
      return NextResponse.json({ error: qual.message }, { status: 400 });
    }

    // 2. Build list of target dates (single occurrence vs weekly recurring series)
    const targetDates: string[] = [];

    if (data.is_recurring && data.recurrence_end_date) {
      if (data.recurrence_end_date < data.date) {
        return NextResponse.json(
          { error: "Recurring end date must be on or after the start date." },
          { status: 400 }
        );
      }

      const selectedDays =
        data.recurrence_weekdays && data.recurrence_weekdays.length > 0
          ? data.recurrence_weekdays
          : [getJakartaDayOfWeek(data.date)];

      let cursor = data.date;
      let safetyCount = 0;
      while (cursor <= data.recurrence_end_date && safetyCount < 366) {
        const dow = getJakartaDayOfWeek(cursor);
        if (selectedDays.includes(dow)) {
          targetDates.push(cursor);
        }
        cursor = addDaysToDateString(cursor, 1);
        safetyCount++;
      }

      if (targetDates.length === 0) {
        return NextResponse.json(
          {
            error:
              "No matching occurrences found between start date and end date for the selected weekdays.",
          },
          { status: 400 }
        );
      }
      if (targetDates.length > 150) {
        return NextResponse.json(
          {
            error:
              "A recurring schedule series can generate at most 150 occurrences at once.",
          },
          { status: 400 }
        );
      }
    } else {
      targetDates.push(data.date);
    }

    // 3. Pre-validate double-booking conflicts across all target occurrences if status is confirmed
    if (data.status === "confirmed") {
      for (const dateStr of targetDates) {
        const startAt = buildJakartaTimestamptz(dateStr, data.start_time);
        const endAt = buildJakartaTimestamptz(dateStr, data.end_time);

        const conflict = await checkScheduleConflicts({
          teacherId: data.teacher_id,
          studentId: data.student_id,
          roomId: data.room_id,
          startAt,
          endAt,
        });

        if (conflict.hasConflict) {
          return NextResponse.json({ error: conflict.message }, { status: 409 });
        }
      }
    }

    const admin = createAdminClient();
    let seriesId: string | null = null;

    if (data.is_recurring && targetDates.length > 1) {
      const { data: createdSeries, error: seriesErr } = await admin
        .from("schedule_series")
        .insert({
          recurrence_type: "weekly",
          start_date: data.date,
          end_date: data.recurrence_end_date ?? null,
        })
        .select()
        .single();

      if (seriesErr) {
        return NextResponse.json({ error: seriesErr.message }, { status: 400 });
      }
      seriesId = createdSeries.id;
    }

    const rowsToInsert = targetDates.map((dateStr) => ({
      teacher_id: data.teacher_id,
      student_id: data.student_id,
      instrument_id: data.instrument_id,
      room_id: data.room_id,
      series_id: seriesId,
      start_at: buildJakartaTimestamptz(dateStr, data.start_time),
      end_at: buildJakartaTimestamptz(dateStr, data.end_time),
      status: data.status,
      notes: data.notes ?? null,
      created_by: actor.id,
      updated_by: actor.id,
    }));

    const { data: insertedRows, error: insertErr } = await admin
      .from("schedules")
      .insert(rowsToInsert)
      .select(SCHEDULE_DETAIL_SELECT);

    if (insertErr) {
      const friendlyMsg = translateDbConstraintError(insertErr);
      return NextResponse.json({ error: friendlyMsg }, { status: 409 });
    }

    const normalized = (insertedRows || []).map((r) =>
      normalizeScheduleRow(r as Record<string, unknown>)
    );

    const firstSchedule = normalized[0] as Record<string, unknown> | undefined;
    const instName =
      (firstSchedule?.instrument as { name?: string } | null)?.name || "Music";
    const stuName =
      (firstSchedule?.student as { full_name?: string } | null)?.full_name ||
      "Student";
    const roomName =
      (firstSchedule?.room as { name?: string } | null)?.name || "Room";

    // Notify the assigned teacher
    await createNotification({
      userId: data.teacher_id,
      title:
        normalized.length > 1
          ? `New Recurring ${instName} Schedule Assigned (${normalized.length} lessons)`
          : `New ${instName} Lesson Assigned`,
      message: `${instName} lesson with ${stuName} in ${roomName} starting ${formatJakartaDate(
        rowsToInsert[0].start_at
      )} (${formatJakartaTimeRange(
        rowsToInsert[0].start_at,
        rowsToInsert[0].end_at
      )}).`,
    });

    await logAuditEvent({
      userId: actor.id,
      action:
        normalized.length > 1
          ? "CREATE_RECURRING_SCHEDULE"
          : "CREATE_SCHEDULE",
      tableName: "schedules",
      recordId: (firstSchedule?.id as string) ?? null,
      newData: {
        count: normalized.length,
        series_id: seriesId,
        first_occurrence: rowsToInsert[0],
      },
    });

    return NextResponse.json(
      {
        schedules: normalized,
        count: normalized.length,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to create schedule",
      },
      { status: 500 }
    );
  }
}

