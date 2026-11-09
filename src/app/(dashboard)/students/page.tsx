"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Edit3,
  History,
  CheckCircle2,
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
import { formatJakartaDate, formatJakartaTimeRange } from "@/lib/timezone";
import type { ScheduleWithDetails, Student } from "@/types/database";

interface EnrichedStudent extends Student {
  enrolled_instruments: Array<{ id: string; name: string }>;
  assigned_teachers: Array<{ id: string; full_name: string }>;
  upcoming_lessons_count: number;
  total_lessons_count: number;
  schedules: ScheduleWithDetails[];
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

  // Lesson History Modal
  const [historyStudent, setHistoryStudent] = useState<EnrichedStudent | null>(
    null
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
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-xs">
                {filteredStudents.map((s) => (
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
                          <span className="text-zinc-400">No active lessons</span>
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
                          onClick={() => setHistoryStudent(s)}
                          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                        >
                          <History className="h-3 w-3 text-zinc-400" />
                          Lessons ({s.total_lessons_count})
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
                ))}
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

      {/* Student Lesson History & Upcoming Lessons Modal */}
      {historyStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">
                  Lessons — {historyStudent.full_name}
                </h3>
                <p className="text-xs text-zinc-500">
                  Upcoming and past scheduled music lessons
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryStudent(null)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto divide-y divide-zinc-100">
              {!historyStudent.schedules ||
              historyStudent.schedules.length === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-400">
                  No lessons recorded for this student yet.
                </div>
              ) : (
                historyStudent.schedules.map((sch) => (
                  <div
                    key={sch.id}
                    className="px-5 py-3.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-zinc-900">
                        {sch.instrument?.name} ·{" "}
                        {sch.teacher?.profile?.full_name}
                      </p>
                      <p className="text-zinc-500 mt-0.5">
                        {sch.room?.name}
                        {sch.notes ? ` — "${sch.notes}"` : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-medium text-zinc-900">
                        {formatJakartaDate(sch.start_at)}
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        {formatJakartaTimeRange(sch.start_at, sch.end_at)}
                      </p>
                      <span
                        className={`inline-block mt-0.5 rounded px-1.5 py-0.2 text-[10px] font-semibold uppercase ${
                          sch.status === "confirmed"
                            ? "bg-emerald-50 text-emerald-700"
                            : sch.status === "pending"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {sch.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="px-5 py-3 bg-zinc-50 border-t border-zinc-100 flex justify-end">
              <button
                type="button"
                onClick={() => setHistoryStudent(null)}
                className="rounded-lg border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

