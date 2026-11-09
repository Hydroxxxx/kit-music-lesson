import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeScheduleRow, SCHEDULE_DETAIL_SELECT } from "@/lib/scheduling";
import {
  getJakartaWeekBounds,
  JAKARTA_OFFSET,
  toJakartaDateString,
} from "@/lib/timezone";

export async function GET() {
  try {
    const profile = await requireAuth();
    const admin = createAdminClient();
    const now = new Date();
    const nowIso = now.toISOString();
    const todayStr = toJakartaDateString(now);
    const todayStartIso = `${todayStr}T00:00:00${JAKARTA_OFFSET}`;
    const todayEndIso = `${todayStr}T23:59:59.999${JAKARTA_OFFSET}`;
    const weekBounds = getJakartaWeekBounds(now);

    const [
      { count: activeTeachersCount },
      { count: activeStudentsCount },
      { count: activeInstrumentsCount },
      { count: activeRoomsCount },
      { data: todaySchedulesRaw },
      { data: upcomingSchedulesRaw },
      { data: weekSchedulesRaw },
      { data: pendingRequestsRaw },
      { data: recentNotifications },
    ] = await Promise.all([
      admin
        .from("teachers")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),
      admin
        .from("students")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),
      admin
        .from("instruments")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),
      admin
        .from("rooms")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),
      admin
        .from("schedules")
        .select(SCHEDULE_DETAIL_SELECT)
        .neq("status", "cancelled")
        .gte("start_at", todayStartIso)
        .lte("start_at", todayEndIso)
        .order("start_at", { ascending: true }),
      admin
        .from("schedules")
        .select(SCHEDULE_DETAIL_SELECT)
        .neq("status", "cancelled")
        .gte("start_at", nowIso)
        .order("start_at", { ascending: true })
        .limit(12),
      admin
        .from("schedules")
        .select("id, teacher_id, status, start_at")
        .neq("status", "cancelled")
        .gte("start_at", weekBounds.startIso)
        .lte("start_at", weekBounds.endIso),
      admin
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
          created_at,
          requester:profiles!schedule_requests_requested_by_fkey(id, full_name, email)
        `
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      admin
        .from("notifications")
        .select("*")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const allToday = (todaySchedulesRaw || []).map((r) =>
      normalizeScheduleRow(r as Record<string, unknown>)
    ) as Array<Record<string, unknown>>;

    const allUpcoming = (upcomingSchedulesRaw || []).map((r) =>
      normalizeScheduleRow(r as Record<string, unknown>)
    ) as Array<Record<string, unknown>>;

    const isTeacher = profile.role === "teacher";

    const todayLessons = isTeacher
      ? allToday.filter((s) => s.teacher_id === profile.id)
      : allToday;

    const upcomingLessons = isTeacher
      ? allUpcoming.filter((s) => s.teacher_id === profile.id)
      : allUpcoming;

    const teacherWeeklyCount = (weekSchedulesRaw || []).filter(
      (s) => s.teacher_id === profile.id
    ).length;

    const pendingRequests = (pendingRequestsRaw || [])
      .filter((r) => (isTeacher ? r.requested_by === profile.id : true))
      .map((r) => ({
        ...r,
        requester: Array.isArray(r.requester) ? r.requester[0] : r.requester,
      }));

    return NextResponse.json({
      role: profile.role,
      stats: {
        activeTeachers: activeTeachersCount ?? 0,
        activeStudents: activeStudentsCount ?? 0,
        activeInstruments: activeInstrumentsCount ?? 0,
        activeRooms: activeRoomsCount ?? 0,
        todayLessonsCount: todayLessons.length,
        teacherWeeklyLessonsCount: teacherWeeklyCount,
        totalWeekLessonsCount: (weekSchedulesRaw || []).length,
        pendingRequestsCount: pendingRequests.length,
      },
      todayLessons,
      upcomingLessons: upcomingLessons.slice(0, 6),
      nextUpcomingLesson: upcomingLessons[0] ?? null,
      pendingRequests: pendingRequests.slice(0, 5),
      recentNotifications: recentNotifications || [],
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to load dashboard data" },
      { status: 500 }
    );
  }
}

