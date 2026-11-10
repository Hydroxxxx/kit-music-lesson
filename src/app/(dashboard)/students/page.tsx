"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Edit3,
  History,
  CheckCircle2,
  XCircle,
  Calendar,
  X,
  Loader2,
  AlertCircle,
  Power,
} from "lucide-react";
import { useCurrentUser } from "@/components/layout/AppShell";
import {
  broadcastRealtimeSync,
  getCachedApiData,
  setCachedApiData,
  useRealtimeSubscription,
} from "@/lib/realtime";
import {
  APP_TIMEZONE,
  formatJakartaDate,
  formatJakartaTimeRange,
  toJakartaDateString,
} from "@/lib/timezone";
import type {
  AttendanceStatus,
  ScheduleWithDetails,
  Student,
} from "@/types/database";

interface EnrichedStudent extends Student {
  enrolled_instruments: Array<{ id: string; name: string }>;
  assigned_teachers: Array<{ id: string; full_name: string }>;
  upcoming_lessons_count: number;
  total_lessons_count: number;
  present_count?: number;
  absent_count?: number;
  schedules: ScheduleWithDetails[];
}

function getJakartaMonthKey(isoString: string): string {
  const dateStr = toJakartaDateString(isoString); // YYYY-MM-DD
  return dateStr.slice(0, 7); // YYYY-MM
}

function formatMonthKeyLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, 15, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    month: "long",
    year: "numeric",
  }).format(dt);
}

export default function StudentsPage() {
  const { profile } = useCurrentUser();
  const isAdmin = profile.role === "admin";

  const [students, setStudents] = useState<EnrichedStudent[]>(
    () => getCachedApiData<EnrichedStudent[]>("/api/students") ?? []
  );
  const [loading, setLoading] = useState(
    () => !getCachedApiData<EnrichedStudent[]>("/api/students")
  );

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Create / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<EnrichedStudent | null>(
    null
  );
  const [fullName, setFullName] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Student Report & Attendance History Modal
  const [historyStudentId, setHistoryStudentId] = useState<string | null>(null);
  const [reportMonthFilter, setReportMonthFilter] = useState<string>("all");
  const [reportAttendanceFilter, setReportAttendanceFilter] = useState<
    "all" | "present" | "absent" | "unmarked"
  >("all");
  const [markingScheduleId, setMarkingScheduleId] = useState<string | null>(
    null
  );

  const historyStudent = useMemo(
    () => students.find((s) => s.id === historyStudentId) ?? null,
    [students, historyStudentId]
  );

  const [toast, setToast] = useState<string | null>(null);

  const loadStudents = useCallback(async () => {
    try {
      const res = await fetch("/api/students", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setCachedApiData("/api/students", data.students || []);
      setStudents(data.students || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStudents();
  }, [loadStudents]);

  useRealtimeSubscription(() => {
    loadStudents();
  }, "students-page");

  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const q = search.trim().toLowerCase();
      if (q) {
        const matchName = s.full_name.toLowerCase().includes(q);
        const matchEmail = s.email?.toLowerCase().includes(q);
        const matchInst = s.enrolled_instruments?.some((i) =>
          i.name.toLowerCase().includes(q)
        );
        const matchTeacher = s.assigned_teachers?.some((t) =>
          t.full_name.toLowerCase().includes(q)
        );
        if (!matchName && !matchEmail && !matchInst && !matchTeacher)
          return false;
      }
      if (statusFilter === "active" && !s.is_active) return false;
      if (statusFilter === "inactive" && s.is_active) return false;
      return true;
    });
  }, [students, search, statusFilter]);

  const openAddModal = () => {
    setEditingStudent(null);
    setFullName("");
    setNotes("");
    setIsActive(true);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (s: EnrichedStudent) => {
    setEditingStudent(s);
    setFullName(s.full_name);
    setNotes(s.notes || "");
    setIsActive(s.is_active);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      const url = editingStudent
        ? `/api/students/${editingStudent.id}`
        : "/api/students";
      const method = editingStudent ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          notes: notes || null,
          is_active: isActive,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error || "Failed to save student");
        return;
      }

      setModalOpen(false);
      setToast(
        editingStudent ? "Student record updated." : "New student enrolled."
      );
      await loadStudents();
      await broadcastRealtimeSync("data_changed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (s: EnrichedStudent) => {
    if (!isAdmin) return;
    const res = await fetch(`/api/students/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !s.is_active }),
    });
    if (res.ok) {
      setToast(
        `${s.full_name} marked as ${!s.is_active ? "Active" : "Inactive"}.`
      );
      await loadStudents();
      await broadcastRealtimeSync("data_changed");
    }
  };

  const handleMarkAttendanceFromReport = async (
    sch: ScheduleWithDetails,
    clickedStatus: "present" | "absent"
  ) => {
    if (markingScheduleId) return;
    const nextStatus: AttendanceStatus =
      sch.attendance_status === clickedStatus ? null : clickedStatus;

    setMarkingScheduleId(sch.id);
    try {
      const res = await fetch(`/api/schedules/${sch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendance_status: nextStatus }),
      });
      if (res.ok) {
        setToast(
          nextStatus === "present"
            ? "Attendance marked as Present."
            : nextStatus === "absent"
            ? "Attendance marked as Absent."
            : "Attendance status cleared."
        );
        await loadStudents();
        await broadcastRealtimeSync("schedule_changed");
      }
    } finally {
      setMarkingScheduleId(null);
    }
  };

  // Monthly grouped report data for selected student
  const studentReportData = useMemo(() => {
    if (!historyStudent) return null;
    const activeSchedules = (historyStudent.schedules || []).filter(
      (sch) => sch.status !== "cancelled"
    );

    const presentTotal = activeSchedules.filter(
      (sch) => sch.attendance_status === "present"
    ).length;
    const absentTotal = activeSchedules.filter(
      (sch) => sch.attendance_status === "absent"
    ).length;
    const unmarkedTotal = activeSchedules.filter(
      (sch) => !sch.attendance_status
    ).length;
    const markedTotal = presentTotal + absentTotal;
    const attendanceRate =
      markedTotal > 0 ? Math.round((presentTotal / markedTotal) * 100) : null;

    // Collect available months (YYYY-MM descending)
    const monthSet = new Set<string>();
    for (const sch of activeSchedules) {
      monthSet.add(getJakartaMonthKey(sch.start_at));
    }
    const availableMonths = Array.from(monthSet).sort((a, b) =>
      b.localeCompare(a)
    );

    // Filter schedules by selected month & attendance status
    const filtered = activeSchedules.filter((sch) => {
      if (
        reportMonthFilter !== "all" &&
        getJakartaMonthKey(sch.start_at) !== reportMonthFilter
      ) {
        return false;
      }
      if (
        reportAttendanceFilter === "present" &&
        sch.attendance_status !== "present"
      ) {
        return false;
      }
      if (
        reportAttendanceFilter === "absent" &&
        sch.attendance_status !== "absent"
      ) {
        return false;
      }
      if (reportAttendanceFilter === "unmarked" && sch.attendance_status) {
        return false;
      }
      return true;
    });

    // Group filtered schedules by month
    const groupsMap = new Map<string, ScheduleWithDetails[]>();
    for (const sch of filtered) {
      const mKey = getJakartaMonthKey(sch.start_at);
      const list = groupsMap.get(mKey) || [];
      list.push(sch);
      groupsMap.set(mKey, list);
    }

    const monthlyGroups = Array.from(groupsMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([monthKey, items]) => {
        // Also compute full-month totals from activeSchedules in that month
        const allInMonth = activeSchedules.filter(
          (s) => getJakartaMonthKey(s.start_at) === monthKey
        );
        const presentInMonth = allInMonth.filter(
          (s) => s.attendance_status === "present"
        );
        const absentInMonth = allInMonth.filter(
          (s) => s.attendance_status === "absent"
        );
        const attendedDates = presentInMonth
          .slice()
          .sort((a, b) => a.start_at.localeCompare(b.start_at))
          .map((s) =>
            formatJakartaDate(s.start_at, {
              month: "short",
              day: "numeric",
            })
          );

        return {
          monthKey,
          monthLabel: formatMonthKeyLabel(monthKey),
          items: items
            .slice()
            .sort((a, b) => b.start_at.localeCompare(a.start_at)),
          presentCount: presentInMonth.length,
          absentCount: absentInMonth.length,
          totalCount: allInMonth.length,
          attendedDates,
        };
      });

    return {
      presentTotal,
      absentTotal,
      unmarkedTotal,
      totalActive: activeSchedules.length,
      attendanceRate,
      availableMonths,
      monthlyGroups,
    };
  }, [historyStudent, reportMonthFilter, reportAttendanceFilter]);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-xs font-medium text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-2 text-zinc-400 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Top Search & Action Bar */}
      <div className="bg-white rounded-xl border border-zinc-200/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-xs">
            <Search className="h-3.5 w-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search student, instrument, teacher..."
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50/50 pl-8 pr-3 py-1.5 text-xs text-zinc-900 focus:bg-white focus:border-zinc-400 focus:outline-hidden"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-1.5 text-xs text-zinc-800"
          >
            <option value="all">All Students</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Student
          </button>
        )}
      </div>

      {/* Students Table */}
      <div className="bg-white rounded-xl border border-zinc-200/80 overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="py-14 text-center text-xs text-zinc-400">
            No student records found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/60 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  <th className="py-3 px-4">Student Name</th>
                  <th className="py-3 px-4">Enrolled Instruments</th>
                  <th className="py-3 px-4">Assigned Teacher(s)</th>
                  <th className="py-3 px-4">Attendance Record</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-xs">
                {filteredStudents.map((s) => {
                  const presentCount =
                    s.present_count ??
                    (s.schedules || []).filter(
                      (sch) =>
                        sch.status !== "cancelled" &&
                        sch.attendance_status === "present"
                    ).length;
                  const absentCount =
                    s.absent_count ??
                    (s.schedules || []).filter(
                      (sch) =>
                        sch.status !== "cancelled" &&
                        sch.attendance_status === "absent"
                    ).length;
                  const markedCount = presentCount + absentCount;
                  const rate =
                    markedCount > 0
                      ? Math.round((presentCount / markedCount) * 100)
                      : null;

                  return (
                    <tr
                      key={s.id}
                      className="hover:bg-zinc-50/50 transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <p className="font-semibold text-zinc-900">
                          {s.full_name}
                        </p>
                        {s.notes && (
                          <p className="text-[11px] text-zinc-500 line-clamp-1 max-w-xs mt-0.5">
                            {s.notes}
                          </p>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap gap-1">
                          {s.enrolled_instruments?.length > 0 ? (
                            s.enrolled_instruments.map((inst) => (
                              <span
                                key={inst.id}
                                className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700"
                              >
                                {inst.name}
                              </span>
                            ))
                          ) : (
                            <span className="text-zinc-400">
                              No active lessons
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        {s.assigned_teachers?.length > 0 ? (
                          <span className="text-zinc-700">
                            {s.assigned_teachers
                              .map((t) => t.full_name)
                              .join(", ")}
                          </span>
                        ) : (
                          <span className="text-zinc-400">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            {presentCount} Present
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                            <XCircle className="h-3 w-3" />
                            {absentCount} Absent
                          </span>
                          {rate !== null && (
                            <span className="text-[11px] font-medium text-zinc-500">
                              ({rate}%)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            s.is_active
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {s.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setHistoryStudentId(s.id);
                              setReportMonthFilter("all");
                              setReportAttendanceFilter("all");
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer shadow-2xs"
                          >
                            <History className="h-3.5 w-3.5 text-zinc-500" />
                            Student Report ({s.total_lessons_count})
                          </button>

                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(s)}
                                className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                              >
                                <Edit3 className="h-3 w-3 text-zinc-400" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleActive(s)}
                                className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 cursor-pointer"
                                title={
                                  s.is_active
                                    ? "Deactivate student"
                                    : "Activate student"
                                }
                              >
                                <Power className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Student Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">
                {editingStudent ? "Edit Student" : "Add New Student"}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveStudent} className="p-5 space-y-3.5">
              {formError && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                  <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Student Full Name
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter student name..."
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Learning Goals / Notes (Optional)
                </label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                <span>Active Enrollment</span>
              </label>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                >
                  {submitting && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {editingStudent ? "Save Changes" : "Add Student"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Student Attendance Report & Monthly Lesson History Modal */}
      {historyStudent && studentReportData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Report Header */}
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">
                  Student Attendance Report — {historyStudent.full_name}
                </h3>
                <p className="text-xs text-zinc-500">
                  Monthly attendance breakdown, lesson dates, and historical
                  report
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryStudentId(null)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Summary KPI Cards */}
            <div className="px-5 pt-4 pb-3 bg-zinc-50/60 border-b border-zinc-100 space-y-3 shrink-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="rounded-xl bg-white border border-emerald-200/80 p-3">
                  <p className="text-[11px] font-medium text-emerald-700">
                    Present (Hadir)
                  </p>
                  <p className="mt-1 text-lg font-bold text-emerald-700">
                    {studentReportData.presentTotal}{" "}
                    <span className="text-xs font-normal text-emerald-600">
                      lessons
                    </span>
                  </p>
                </div>

                <div className="rounded-xl bg-white border border-red-200/80 p-3">
                  <p className="text-[11px] font-medium text-red-700">
                    Absent (Tidak Hadir)
                  </p>
                  <p className="mt-1 text-lg font-bold text-red-700">
                    {studentReportData.absentTotal}{" "}
                    <span className="text-xs font-normal text-red-600">
                      lessons
                    </span>
                  </p>
                </div>

                <div className="rounded-xl bg-white border border-zinc-200/80 p-3">
                  <p className="text-[11px] font-medium text-zinc-500">
                    Attendance Rate
                  </p>
                  <p className="mt-1 text-lg font-bold text-zinc-900">
                    {studentReportData.attendanceRate !== null
                      ? `${studentReportData.attendanceRate}%`
                      : "—"}
                  </p>
                </div>

                <div className="rounded-xl bg-white border border-zinc-200/80 p-3">
                  <p className="text-[11px] font-medium text-zinc-500">
                    Total Scheduled
                  </p>
                  <p className="mt-1 text-lg font-bold text-zinc-900">
                    {studentReportData.totalActive}{" "}
                    <span className="text-xs font-normal text-zinc-500">
                      sessions
                    </span>
                  </p>
                </div>
              </div>

              {/* Filter by Month & Attendance Status */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-zinc-400" />
                  <select
                    value={reportMonthFilter}
                    onChange={(e) => setReportMonthFilter(e.target.value)}
                    className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800"
                  >
                    <option value="all">All Months (Full History)</option>
                    {studentReportData.availableMonths.map((mKey) => (
                      <option key={mKey} value={mKey}>
                        {formatMonthKeyLabel(mKey)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {(
                    [
                      { key: "all", label: "All" },
                      { key: "present", label: "Present" },
                      { key: "absent", label: "Absent" },
                      { key: "unmarked", label: "Unmarked" },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setReportAttendanceFilter(tab.key)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                        reportAttendanceFilter === tab.key
                          ? "bg-zinc-900 text-white"
                          : "bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Monthly Grouped Attendance History */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {studentReportData.monthlyGroups.length === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-400">
                  No lesson records found for the selected filter.
                </div>
              ) : (
                studentReportData.monthlyGroups.map((group) => (
                  <div
                    key={group.monthKey}
                    className="rounded-xl border border-zinc-200/90 overflow-hidden bg-white"
                  >
                    {/* Month Summary Banner */}
                    <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200/80 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-xs font-bold text-zinc-900">
                          {group.monthLabel}
                        </h4>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100/80 px-2 py-0.5 font-semibold text-emerald-800">
                            Present: {group.presentCount}x
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md bg-red-100/80 px-2 py-0.5 font-semibold text-red-700">
                            Absent: {group.absentCount}x
                          </span>
                          <span className="rounded-md bg-zinc-200/70 px-2 py-0.5 font-medium text-zinc-700">
                            Total: {group.totalCount} lessons
                          </span>
                        </div>
                      </div>

                      {group.attendedDates.length > 0 && (
                        <p className="text-[11px] text-emerald-700 font-medium">
                          ✓ Attended dates ({group.attendedDates.length}x):{" "}
                          <span className="font-semibold">
                            {group.attendedDates.join(", ")}
                          </span>
                        </p>
                      )}
                    </div>

                    {/* Individual Lesson Rows for the Month */}
                    <div className="divide-y divide-zinc-100">
                      {group.items.map((sch) => {
                        const canMark =
                          isAdmin || sch.teacher_id === profile.id;
                        return (
                          <div
                            key={sch.id}
                            className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-zinc-50/50"
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-zinc-900">
                                  {formatJakartaDate(sch.start_at)}
                                </span>
                                <span className="text-[11px] text-zinc-500">
                                  {formatJakartaTimeRange(
                                    sch.start_at,
                                    sch.end_at
                                  )}{" "}
                                  WIB
                                </span>
                              </div>
                              <p className="text-zinc-600">
                                <span className="font-medium text-zinc-800">
                                  {sch.instrument?.name}
                                </span>{" "}
                                · Teacher: {sch.teacher?.profile?.full_name} ·{" "}
                                {sch.room?.name}
                              </p>
                              {sch.notes && (
                                <p className="text-[11px] text-zinc-500 italic">
                                  Note: &ldquo;{sch.notes}&rdquo;
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {canMark ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={markingScheduleId === sch.id}
                                    onClick={() =>
                                      handleMarkAttendanceFromReport(
                                        sch,
                                        "present"
                                      )
                                    }
                                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                                      sch.attendance_status === "present"
                                        ? "bg-emerald-600 text-white shadow-2xs"
                                        : "border border-emerald-200 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-100"
                                    }`}
                                  >
                                    <CheckCircle2 className="h-3 w-3" />
                                    Present
                                  </button>
                                  <button
                                    type="button"
                                    disabled={markingScheduleId === sch.id}
                                    onClick={() =>
                                      handleMarkAttendanceFromReport(
                                        sch,
                                        "absent"
                                      )
                                    }
                                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                                      sch.attendance_status === "absent"
                                        ? "bg-red-600 text-white shadow-2xs"
                                        : "border border-red-200 bg-red-50/50 text-red-700 hover:bg-red-100"
                                    }`}
                                  >
                                    <XCircle className="h-3 w-3" />
                                    Absent
                                  </button>
                                </>
                              ) : sch.attendance_status === "present" ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Present
                                </span>
                              ) : sch.attendance_status === "absent" ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                  <XCircle className="h-3 w-3" />
                                  Absent
                                </span>
                              ) : (
                                <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                                  Unmarked
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="px-5 py-3 bg-zinc-50 border-t border-zinc-100 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setHistoryStudentId(null)}
                className="rounded-lg border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 cursor-pointer"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

