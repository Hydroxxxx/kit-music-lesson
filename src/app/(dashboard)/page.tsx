"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Users,
  GraduationCap,
  Music,
  DoorOpen,
  Calendar,
  Clock,
  GitPullRequest,
  Bell,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { useCurrentUser } from "@/components/layout/AppShell";
import {
  broadcastRealtimeSync,
  getCachedApiData,
  setCachedApiData,
  useRealtimeSubscription,
} from "@/lib/realtime";
import { isSuperAdminEmail } from "@/lib/teacher-colors";
import {
  formatJakartaDate,
  formatJakartaTimeRange,
  toJakartaTimeString,
} from "@/lib/timezone";
import type { NotificationItem, ScheduleWithDetails } from "@/types/database";

interface DashboardPendingRequest {
  id: string;
  schedule_id: string;
  requested_by: string;
  proposed_start_at: string;
  proposed_end_at: string;
  reason: string | null;
  status: string;
  created_at: string;
  requester?: { id: string; full_name: string; email: string | null } | null;
}

interface DashboardData {
  role: "admin" | "teacher";
  stats: {
    activeTeachers: number;
    activeStudents: number;
    activeInstruments: number;
    activeRooms: number;
    todayLessonsCount: number;
    teacherWeeklyLessonsCount: number;
    totalWeekLessonsCount: number;
    pendingRequestsCount: number;
  };
  todayLessons: ScheduleWithDetails[];
  upcomingLessons: ScheduleWithDetails[];
  nextUpcomingLesson: ScheduleWithDetails | null;
  pendingRequests: DashboardPendingRequest[];
  recentNotifications: NotificationItem[];
}

export default function DashboardPage() {
  const { profile, refreshNotifications } = useCurrentUser();
  const [data, setData] = useState<DashboardData | null>(
    () => getCachedApiData<DashboardData>("/api/dashboard") ?? null
  );
  const [loading, setLoading] = useState(
    () => !getCachedApiData<DashboardData>("/api/dashboard")
  );
  const [processingReqId, setProcessingReqId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setCachedApiData("/api/dashboard", json);
      setData(json);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useRealtimeSubscription(() => {
    loadDashboard();
  }, "dashboard-view");

  const handleReviewRequest = async (
    requestId: string,
    status: "approved" | "rejected"
  ) => {
    setProcessingReqId(requestId);
    setActionError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) {
        setActionError(json.error || "Failed to review request");
        return;
      }
      await loadDashboard();
      await refreshNotifications();
      await broadcastRealtimeSync("request_changed", { requestId, status });
    } finally {
      setProcessingReqId(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  const isAdmin = profile.role === "admin";
  const stats = data?.stats;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white rounded-xl border border-zinc-200/80 p-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-zinc-900">
              Welcome back, {profile.full_name}
            </h2>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                isSuperAdminEmail(profile.email)
                  ? "bg-amber-100 text-amber-900 border border-amber-300/80"
                  : "bg-zinc-100 text-zinc-700"
              }`}
            >
              {isSuperAdminEmail(profile.email) ? "Super Admin" : profile.role}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {isAdmin
              ? "Monitor KitMusicLesson classes, room capacity, and teacher schedule requests."
              : "Check your weekly lesson calendar, upcoming students, and request status."}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/schedule"
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 transition-colors"
          >
            <Calendar className="h-3.5 w-3.5" />
            Open Weekly Calendar
          </Link>
          <Link
            href="/requests"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            <GitPullRequest className="h-3.5 w-3.5 text-zinc-400" />
            Requests
            {(stats?.pendingRequestsCount ?? 0) > 0 && (
              <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.2 text-[10px] font-semibold text-amber-800">
                {stats?.pendingRequestsCount}
              </span>
            )}
          </Link>
        </div>
      </div>

      {actionError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {actionError}
        </div>
      )}

      {/* Key Metrics Row */}
      {isAdmin ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-zinc-200/80 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">
                Active Teachers
              </span>
              <Users className="h-4 w-4 text-zinc-400" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
              {stats?.activeTeachers ?? 0}
            </p>
            <Link
              href="/teachers"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900"
            >
              Manage teachers <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="bg-white rounded-xl border border-zinc-200/80 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">
                Active Students
              </span>
              <GraduationCap className="h-4 w-4 text-zinc-400" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
              {stats?.activeStudents ?? 0}
            </p>
            <Link
              href="/students"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900"
            >
              View students <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="bg-white rounded-xl border border-zinc-200/80 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">
                Instruments
              </span>
              <Music className="h-4 w-4 text-zinc-400" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
              {stats?.activeInstruments ?? 0}
            </p>
            <Link
              href="/instruments"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900"
            >
              Configure instruments <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="bg-white rounded-xl border border-zinc-200/80 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">
                Practice Rooms
              </span>
              <DoorOpen className="h-4 w-4 text-zinc-400" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
              {stats?.activeRooms ?? 0}
            </p>
            <Link
              href="/rooms"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900"
            >
              Manage rooms <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-zinc-200/80 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">
                Today&apos;s Lessons
              </span>
              <Clock className="h-4 w-4 text-zinc-400" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
              {stats?.todayLessonsCount ?? 0}
            </p>
            <p className="mt-1 text-[11px] text-zinc-400">
              Scheduled for today (WIB)
            </p>
          </div>

          <div className="bg-white rounded-xl border border-zinc-200/80 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">
                Weekly Lesson Count
              </span>
              <Calendar className="h-4 w-4 text-zinc-400" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
              {stats?.teacherWeeklyLessonsCount ?? 0}
            </p>
            <p className="mt-1 text-[11px] text-zinc-400">
              Assigned to you this week
            </p>
          </div>

          <div className="bg-white rounded-xl border border-zinc-200/80 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">
                Pending Change Requests
              </span>
              <GitPullRequest className="h-4 w-4 text-zinc-400" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
              {stats?.pendingRequestsCount ?? 0}
            </p>
            <Link
              href="/requests"
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900"
            >
              Track requests <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}

      {/* Teacher Next Upcoming Lesson Spotlight */}
      {!isAdmin && data?.nextUpcomingLesson && (
        <div className="bg-white rounded-xl border border-zinc-200/80 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
              Next Upcoming Lesson
            </span>
            <h3 className="text-sm font-semibold text-zinc-900">
              {data.nextUpcomingLesson.instrument?.name} with{" "}
              {data.nextUpcomingLesson.student?.full_name}
            </h3>
            <p className="text-xs text-zinc-500">
              {formatJakartaDate(data.nextUpcomingLesson.start_at)} ·{" "}
              {formatJakartaTimeRange(
                data.nextUpcomingLesson.start_at,
                data.nextUpcomingLesson.end_at
              )}{" "}
              · {data.nextUpcomingLesson.room?.name}
            </p>
          </div>
          <Link
            href="/schedule"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 self-start sm:self-center"
          >
            View on Calendar <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* Main Two-Column Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Today's & Upcoming Lessons */}
        <div className="lg:col-span-2 space-y-6">
          {/* Today's Lessons */}
          <div className="bg-white rounded-xl border border-zinc-200/80 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">
                  Today&apos;s Lessons
                </h3>
                <p className="text-xs text-zinc-500">
                  {formatJakartaDate(new Date())}
                </p>
              </div>
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700">
                {data?.todayLessons.length ?? 0} scheduled
              </span>
            </div>

            {!data?.todayLessons || data.todayLessons.length === 0 ? (
              <div className="py-10 px-4 text-center">
                <p className="text-xs text-zinc-400">
                  No lessons scheduled for today.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {data.todayLessons.map((lesson) => (
                  <div
                    key={lesson.id}
                    className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-zinc-50/60 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-900">
                          {lesson.instrument?.name}
                        </span>
                        <span className="text-zinc-300">·</span>
                        <span className="text-xs text-zinc-700 truncate">
                          Student: {lesson.student?.full_name}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-500 truncate">
                        Teacher: {lesson.teacher?.profile.full_name} ·{" "}
                        {lesson.room?.name}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium text-zinc-900">
                        {formatJakartaTimeRange(lesson.start_at, lesson.end_at)}
                      </p>
                      <span
                        className={`inline-block mt-0.5 rounded px-1.5 py-0.2 text-[10px] font-medium uppercase ${
                          lesson.status === "confirmed"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {lesson.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming Lessons */}
          <div className="bg-white rounded-xl border border-zinc-200/80 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">
                  Upcoming Lessons
                </h3>
                <p className="text-xs text-zinc-500">
                  Next scheduled classes across the program
                </p>
              </div>
              <Link
                href="/schedule"
                className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
              >
                Full calendar →
              </Link>
            </div>

            {!data?.upcomingLessons || data.upcomingLessons.length === 0 ? (
              <div className="py-10 px-4 text-center">
                <p className="text-xs text-zinc-400">
                  No upcoming lessons found.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {data.upcomingLessons.map((lesson) => (
                  <div
                    key={lesson.id}
                    className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-zinc-50/60 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-900">
                          {lesson.instrument?.name}
                        </span>
                        <span className="text-zinc-300">·</span>
                        <span className="text-xs text-zinc-700 truncate">
                          {lesson.student?.full_name}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-500 truncate">
                        {lesson.teacher?.profile.full_name} ·{" "}
                        {lesson.room?.name}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium text-zinc-900">
                        {formatJakartaDate(lesson.start_at, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        {formatJakartaTimeRange(lesson.start_at, lesson.end_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Pending Requests & Recent Notifications */}
        <div className="space-y-6">
          {/* Pending Schedule Change Requests */}
          <div className="bg-white rounded-xl border border-zinc-200/80 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-900">
                  Pending Requests
                </h3>
                {(data?.pendingRequests.length ?? 0) > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                    {data?.pendingRequests.length}
                  </span>
                )}
              </div>
              <Link
                href="/requests"
                className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
              >
                View all
              </Link>
            </div>

            {!data?.pendingRequests || data.pendingRequests.length === 0 ? (
              <div className="py-8 px-4 text-center">
                <p className="text-xs text-zinc-400">
                  No pending schedule change requests.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {data.pendingRequests.map((req) => (
                  <div key={req.id} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-zinc-900">
                          {req.requester?.full_name || "Teacher"}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          Proposed:{" "}
                          {formatJakartaDate(req.proposed_start_at, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}{" "}
                          (
                          {formatJakartaTimeRange(
                            req.proposed_start_at,
                            req.proposed_end_at
                          )}
                          )
                        </p>
                      </div>
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                        Pending
                      </span>
                    </div>

                    {req.reason && (
                      <p className="text-xs text-zinc-600 bg-zinc-50 rounded-lg px-2.5 py-1.5 border border-zinc-100">
                        &ldquo;{req.reason}&rdquo;
                      </p>
                    )}

                    {isAdmin && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={processingReqId === req.id}
                          onClick={() =>
                            handleReviewRequest(req.id, "approved")
                          }
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={processingReqId === req.id}
                          onClick={() =>
                            handleReviewRequest(req.id, "rejected")
                          }
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer"
                        >
                          <XCircle className="h-3.5 w-3.5 text-zinc-400" />
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Notifications */}
          <div className="bg-white rounded-xl border border-zinc-200/80 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-zinc-400" />
                <h3 className="text-sm font-semibold text-zinc-900">
                  Recent Notifications
                </h3>
              </div>
              <Link
                href="/notifications"
                className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
              >
                History
              </Link>
            </div>

            {!data?.recentNotifications ||
            data.recentNotifications.length === 0 ? (
              <div className="py-8 px-4 text-center">
                <p className="text-xs text-zinc-400">No recent notifications.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {data.recentNotifications.map((notif) => (
                  <div key={notif.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-zinc-900">
                        {notif.title}
                      </p>
                      {!notif.is_read && (
                        <span className="h-2 w-2 rounded-full bg-blue-600 shrink-0 mt-1" />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500 line-clamp-2">
                      {notif.message}
                    </p>
                    <p className="mt-1.5 text-[10px] text-zinc-400">
                      {formatJakartaDate(notif.created_at)} ·{" "}
                      {toJakartaTimeString(notif.created_at)} WIB
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

