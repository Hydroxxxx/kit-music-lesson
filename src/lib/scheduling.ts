import { createAdminClient } from "@/lib/supabase/admin";
import { formatJakartaDate, formatJakartaTimeRange } from "@/lib/timezone";
import type { AttendanceStatus } from "@/types/database";

const ATTENDANCE_TAG_REGEX =
  /^\[ATTENDANCE:(present|absent)(?:\|([^\]]+))?\](?:\n|$)/i;

export function parseScheduleAttendanceAndNotes(rawNotes: unknown): {
  attendance_status: AttendanceStatus;
  attendance_marked_at: string | null;
  notes: string | null;
} {
  if (typeof rawNotes !== "string" || !rawNotes) {
    return {
      attendance_status: null,
      attendance_marked_at: null,
      notes: null,
    };
  }

  const match = rawNotes.match(ATTENDANCE_TAG_REGEX);
  if (!match) {
    return {
      attendance_status: null,
      attendance_marked_at: null,
      notes: rawNotes,
    };
  }

  const status = match[1].toLowerCase() as "present" | "absent";
  const markedAt = match[2] || null;
  const remainder = rawNotes.slice(match[0].length).trim();

  return {
    attendance_status: status,
    attendance_marked_at: markedAt,
    notes: remainder.length > 0 ? remainder : null,
  };
}

export function encodeScheduleAttendanceAndNotes(
  attendanceStatus: AttendanceStatus,
  cleanNotes: string | null | undefined,
  markedAtIso?: string | null
): string | null {
  const trimmedNotes = cleanNotes?.trim() || "";
  if (!attendanceStatus) {
    return trimmedNotes.length > 0 ? trimmedNotes : null;
  }
  const timestamp = markedAtIso || new Date().toISOString();
  const prefix = `[ATTENDANCE:${attendanceStatus}|${timestamp}]`;
  return trimmedNotes.length > 0 ? `${prefix}\n${trimmedNotes}` : prefix;
}

export interface ConflictCheckParams {
  teacherId: string;
  studentId: string;
  roomId: string;
  startAt: string;
  endAt: string;
  excludeScheduleId?: string;
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  message?: string;
  conflictType?: "teacher" | "student" | "room";
}

/**
 * Checks if any confirmed schedule overlaps with [startAt, endAt)
 * for the given teacher, student, or room.
 * Overlap condition: existing.start_at < new.end_at AND existing.end_at > new.start_at
 */
export async function checkScheduleConflicts(
  params: ConflictCheckParams
): Promise<ConflictCheckResult> {
  const admin = createAdminClient();

  let query = admin
    .from("schedules")
    .select(
      `
      id,
      teacher_id,
      student_id,
      room_id,
      start_at,
      end_at,
      status,
      teacher:teachers(id, profile:profiles(full_name)),
      student:students(id, full_name),
      room:rooms(id, name),
      instrument:instruments(id, name)
    `
    )
    .eq("status", "confirmed")
    .lt("start_at", params.endAt)
    .gt("end_at", params.startAt);

  if (params.excludeScheduleId) {
    query = query.neq("id", params.excludeScheduleId);
  }

  const { data: overlapping, error } = await query;

  if (error) {
    throw new Error(`Failed to verify schedule availability: ${error.message}`);
  }

  if (!overlapping || overlapping.length === 0) {
    return { hasConflict: false };
  }

  for (const row of overlapping) {
    const dateLabel = formatJakartaDate(row.start_at);
    const timeLabel = formatJakartaTimeRange(row.start_at, row.end_at);

    if (row.teacher_id === params.teacherId) {
      const teacherObj = Array.isArray(row.teacher) ? row.teacher[0] : row.teacher;
      const profileObj = teacherObj?.profile
        ? Array.isArray(teacherObj.profile)
          ? teacherObj.profile[0]
          : teacherObj.profile
        : null;
      const teacherName = profileObj?.full_name || "Selected teacher";
      return {
        hasConflict: true,
        conflictType: "teacher",
        message: `Teacher conflict: ${teacherName} is already scheduled for a confirmed lesson on ${dateLabel} (${timeLabel}).`,
      };
    }

    if (row.student_id === params.studentId) {
      const studentObj = Array.isArray(row.student) ? row.student[0] : row.student;
      const studentName = studentObj?.full_name || "Selected student";
      return {
        hasConflict: true,
        conflictType: "student",
        message: `Student conflict: ${studentName} already has a confirmed lesson on ${dateLabel} (${timeLabel}).`,
      };
    }

    if (row.room_id === params.roomId) {
      const roomObj = Array.isArray(row.room) ? row.room[0] : row.room;
      const roomName = roomObj?.name || "Selected room";
      return {
        hasConflict: true,
        conflictType: "room",
        message: `Room conflict: ${roomName} is already occupied by another confirmed lesson on ${dateLabel} (${timeLabel}).`,
      };
    }
  }

  return { hasConflict: false };
}

/**
 * Validates that the teacher is active and qualified to teach the selected instrument.
 */
export async function validateTeacherQualification(
  teacherId: string,
  instrumentId: string
): Promise<{ valid: boolean; message?: string }> {
  const admin = createAdminClient();

  const { data: teacher } = await admin
    .from("teachers")
    .select("id, is_active, profile:profiles(full_name)")
    .eq("id", teacherId)
    .single();

  if (!teacher) {
    return { valid: false, message: "Selected teacher does not exist." };
  }

  if (!teacher.is_active) {
    return {
      valid: false,
      message: "Selected teacher account is currently inactive.",
    };
  }

  const { data: qualification } = await admin
    .from("teacher_instruments")
    .select("teacher_id, instrument_id")
    .eq("teacher_id", teacherId)
    .eq("instrument_id", instrumentId)
    .maybeSingle();

  if (!qualification) {
    const { data: inst } = await admin
      .from("instruments")
      .select("name")
      .eq("id", instrumentId)
      .single();
    const profileObj = Array.isArray(teacher.profile)
      ? teacher.profile[0]
      : teacher.profile;
    const teacherName = profileObj?.full_name || "This teacher";
    return {
      valid: false,
      message: `${teacherName} is not assigned/qualified to teach ${
        inst?.name || "the selected instrument"
      }. Please assign the instrument to the teacher first or choose a qualified teacher.`,
    };
  }

  return { valid: true };
}

/**
 * Translates PostgreSQL constraint errors (including GiST exclusion constraints) into friendly messages.
 */
export function translateDbConstraintError(error: {
  code?: string;
  message?: string;
  details?: string;
}): string {
  const msg = `${error.message || ""} ${error.details || ""}`;
  if (msg.includes("no_teacher_double_booking")) {
    return "Double booking prevented: The teacher already has a confirmed lesson during this time slot.";
  }
  if (msg.includes("no_student_double_booking")) {
    return "Double booking prevented: The student already has a confirmed lesson during this time slot.";
  }
  if (msg.includes("no_room_double_booking")) {
    return "Double booking prevented: The room is already booked for a confirmed lesson during this time slot.";
  }
  if (error.code === "23P01") {
    return "Double booking prevented by database constraint: Overlapping confirmed schedule detected.";
  }
  return error.message || "A database error occurred while saving the schedule.";
}

/**
 * Select query fragment for joining full schedule details
 */
export const SCHEDULE_DETAIL_SELECT = `
  id,
  teacher_id,
  student_id,
  instrument_id,
  room_id,
  series_id,
  start_at,
  end_at,
  status,
  notes,
  created_by,
  updated_by,
  created_at,
  updated_at,
  teacher:teachers(
    id,
    phone,
    is_active,
    profile:profiles(id, full_name, email, avatar_url)
  ),
  student:students(id, full_name, phone, email),
  instrument:instruments(id, name, description),
  room:rooms(id, name, description),
  series:schedule_series(id, recurrence_type, start_date, end_date)
`;

export function normalizeScheduleRow(row: Record<string, unknown>) {
  const teacherRaw = Array.isArray(row.teacher) ? row.teacher[0] : row.teacher;
  let teacher = null;
  if (teacherRaw && typeof teacherRaw === "object") {
    const tObj = teacherRaw as Record<string, unknown>;
    const profRaw = Array.isArray(tObj.profile) ? tObj.profile[0] : tObj.profile;
    teacher = {
      id: tObj.id as string,
      phone: (tObj.phone as string | null) ?? null,
      is_active: Boolean(tObj.is_active),
      profile: (profRaw as Record<string, unknown>) ?? {
        id: tObj.id,
        full_name: "Unknown Teacher",
        email: null,
        avatar_url: null,
      },
    };
  }

  const student = Array.isArray(row.student) ? row.student[0] : row.student;
  const instrument = Array.isArray(row.instrument)
    ? row.instrument[0]
    : row.instrument;
  const room = Array.isArray(row.room) ? row.room[0] : row.room;
  const series = Array.isArray(row.series) ? row.series[0] : row.series;
  const parsedNotes = parseScheduleAttendanceAndNotes(row.notes);

  return {
    ...row,
    notes: parsedNotes.notes,
    attendance_status: parsedNotes.attendance_status,
    attendance_marked_at: parsedNotes.attendance_marked_at,
    teacher,
    student: student ?? null,
    instrument: instrument ?? null,
    room: room ?? null,
    series: series ?? null,
  };
}

