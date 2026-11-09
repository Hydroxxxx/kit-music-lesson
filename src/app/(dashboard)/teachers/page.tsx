"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Plus,
  Edit3,
  Clock,
  Calendar,
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
import {
  getTeacherPastelTheme,
  pickNextAvailablePastelColor,
  TEACHER_PASTEL_PALETTE,
} from "@/lib/teacher-colors";
import {
  DAY_OF_WEEK_LABELS,
  ORDERED_DAYS_MON_TO_SUN,
  generateTimeSlots,
} from "@/lib/timezone";
import type {
  Instrument,
  TeacherAvailability,
  TeacherWithDetails,
} from "@/types/database";

const TIME_SLOTS = generateTimeSlots(7, 21);

export default function TeachersPage() {
  const { profile } = useCurrentUser();
  const isAdmin = profile.role === "admin";

  const cachedTeachers = getCachedApiData<{
    teachers: TeacherWithDetails[];
    instruments: Instrument[];
  }>("/api/teachers");
  const [teachers, setTeachers] = useState<TeacherWithDetails[]>(
    () => cachedTeachers?.teachers ?? []
  );
  const [instruments, setInstruments] = useState<Instrument[]>(
    () => cachedTeachers?.instruments ?? []
  );
  const [loading, setLoading] = useState(() => !cachedTeachers);

  // Filters
  const [search, setSearch] = useState("");
  const [instrumentFilter, setInstrumentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Add / Edit Teacher Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] =
    useState<TeacherWithDetails | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("Teacher123!");
  const [phone, setPhone] = useState("");
  const [bio, setBio] = useState("");
  const [colorKey, setColorKey] = useState("sky");
  const [isActive, setIsActive] = useState(true);
  const [selectedInstrumentIds, setSelectedInstrumentIds] = useState<string[]>(
    []
  );
  const [quickInstrumentName, setQuickInstrumentName] = useState("");
  const [addingInstrument, setAddingInstrument] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Availability Modal
  const [availTeacher, setAvailTeacher] = useState<TeacherWithDetails | null>(
    null
  );
  const [availRows, setAvailRows] = useState<
    Array<{
      day_of_week: number;
      start_time: string;
      end_time: string;
      is_available: boolean;
    }>
  >([]);
  const [availSaving, setAvailSaving] = useState(false);
  const [availError, setAvailError] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);

  const loadTeachers = useCallback(async () => {
    try {
      const res = await fetch("/api/teachers", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setCachedApiData("/api/teachers", data);
      setTeachers(data.teachers || []);
      setInstruments(data.instruments || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeachers();
  }, [loadTeachers]);

  useRealtimeSubscription(() => {
    loadTeachers();
  }, "teachers-page");

  const filteredTeachers = useMemo(() => {
    return teachers.filter((t) => {
      const q = search.trim().toLowerCase();
      if (q) {
        const matchName = t.profile?.full_name?.toLowerCase().includes(q);
        const matchEmail = t.profile?.email?.toLowerCase().includes(q);
        const matchPhone = t.phone?.toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchPhone) return false;
      }
      if (statusFilter === "active" && !t.is_active) return false;
      if (statusFilter === "inactive" && t.is_active) return false;
      if (
        instrumentFilter !== "all" &&
        !t.instruments?.some((i) => i.id === instrumentFilter)
      ) {
        return false;
      }
      return true;
    });
  }, [teachers, search, statusFilter, instrumentFilter]);

  const openAddModal = () => {
    const nextColor = pickNextAvailablePastelColor(
      teachers.map((t) => t.profile?.avatar_url)
    );
    setEditingTeacher(null);
    setFullName("");
    setEmail("");
    setPassword("Teacher123!");
    setPhone("");
    setBio("");
    setColorKey(nextColor);
    setIsActive(true);
    setSelectedInstrumentIds([]);
    setQuickInstrumentName("");
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (t: TeacherWithDetails) => {
    const currentTheme = getTeacherPastelTheme(t.id, t.profile?.avatar_url);
    setEditingTeacher(t);
    setFullName(t.profile?.full_name || "");
    setEmail(t.profile?.email || "");
    setPhone(t.phone || "");
    setBio(t.bio || "");
    setColorKey(currentTheme.key);
    setIsActive(t.is_active);
    setSelectedInstrumentIds((t.instruments || []).map((i) => i.id));
    setQuickInstrumentName("");
    setFormError(null);
    setModalOpen(true);
  };

  const handleQuickCreateInstrument = async (presetName?: string) => {
    const targetName = (presetName ?? quickInstrumentName).trim();
    if (!targetName || addingInstrument) return;

    // If instrument with same name already exists, just select it
    const existing = instruments.find(
      (i) => i.name.toLowerCase() === targetName.toLowerCase()
    );
    if (existing) {
      setSelectedInstrumentIds((prev) =>
        prev.includes(existing.id) ? prev : [...prev, existing.id]
      );
      if (!presetName) setQuickInstrumentName("");
      return;
    }

    setAddingInstrument(true);
    setFormError(null);
    try {
      const res = await fetch("/api/instruments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: targetName,
          is_active: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error || "Failed to add instrument");
        return;
      }
      if (json.instrument) {
        setInstruments((prev) =>
          [...prev, json.instrument].sort((a, b) =>
            a.name.localeCompare(b.name)
          )
        );
        setSelectedInstrumentIds((prev) =>
          prev.includes(json.instrument.id)
            ? prev
            : [...prev, json.instrument.id]
        );
        if (!presetName) setQuickInstrumentName("");
        await broadcastRealtimeSync("data_changed", {
          id: json.instrument.id,
        });
      }
    } finally {
      setAddingInstrument(false);
    }
  };

  const handleSaveTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      if (editingTeacher) {
        const res = await fetch(`/api/teachers/${editingTeacher.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: fullName,
            email,
            phone: phone || null,
            bio: bio || null,
            color: colorKey,
            is_active: isActive,
            instrument_ids: selectedInstrumentIds,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setFormError(json.error || "Failed to update teacher");
          return;
        }
        setToast("Teacher information updated.");
      } else {
        const res = await fetch("/api/teachers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: fullName,
            email,
            password,
            phone: phone || null,
            bio: bio || null,
            color: colorKey,
            is_active: isActive,
            instrument_ids: selectedInstrumentIds,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setFormError(json.error || "Failed to create teacher");
          return;
        }
        setToast("New teacher account created.");
      }

      setModalOpen(false);
      await loadTeachers();
      await broadcastRealtimeSync("data_changed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (t: TeacherWithDetails) => {
    if (!isAdmin) return;
    const res = await fetch(`/api/teachers/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !t.is_active }),
    });
    if (res.ok) {
      setToast(
        `${t.profile?.full_name} is now ${!t.is_active ? "Active" : "Inactive"}.`
      );
      await loadTeachers();
      await broadcastRealtimeSync("data_changed");
    }
  };

  const openAvailabilityModal = (t: TeacherWithDetails) => {
    setAvailTeacher(t);
    setAvailError(null);
    const existingMap = new Map<number, TeacherAvailability>();
    for (const a of t.availability || []) {
      existingMap.set(a.day_of_week, a);
    }

    const rows = ORDERED_DAYS_MON_TO_SUN.map((dow) => {
      const found = existingMap.get(dow);
      return {
        day_of_week: dow,
        start_time: found ? found.start_time.slice(0, 5) : "09:00",
        end_time: found ? found.end_time.slice(0, 5) : "17:00",
        is_available: found ? found.is_available : dow !== 0,
      };
    });
    setAvailRows(rows);
  };

  const handleSaveAvailability = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!availTeacher) return;
    setAvailSaving(true);
    setAvailError(null);

    try {
      const activeSlots = availRows.filter((r) => r.is_available);
      const res = await fetch(`/api/teachers/${availTeacher.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability: activeSlots }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAvailError(json.error || "Failed to update availability");
        return;
      }
      setAvailTeacher(null);
      setToast("Teacher weekly availability updated.");
      await loadTeachers();
    } finally {
      setAvailSaving(false);
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

      {/* Top Filter & Action Bar */}
      <div className="bg-white rounded-xl border border-zinc-200/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="h-3.5 w-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search teacher name, email, phone..."
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50/50 pl-8 pr-3 py-1.5 text-xs text-zinc-900 focus:bg-white focus:border-zinc-400 focus:outline-hidden"
            />
          </div>

          <select
            value={instrumentFilter}
            onChange={(e) => setInstrumentFilter(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-1.5 text-xs text-zinc-800"
          >
            <option value="all">All Instruments</option>
            {instruments.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-1.5 text-xs text-zinc-800"
          >
            <option value="all">All Statuses</option>
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
            Add Teacher
          </button>
        )}
      </div>

      {/* Teachers Table */}
      <div className="bg-white rounded-xl border border-zinc-200/80 overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : filteredTeachers.length === 0 ? (
          <div className="py-14 text-center text-xs text-zinc-400">
            No teachers match the current filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/60 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  <th className="py-3 px-4">Teacher</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Instruments Taught</th>
                  <th className="py-3 px-4">Upcoming Lessons</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-xs">
                {filteredTeachers.map((t) => {
                  const canEdit = isAdmin || t.id === profile.id;
                  const pastel = getTeacherPastelTheme(
                    t.id,
                    t.profile?.avatar_url
                  );
                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-zinc-50/50 transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div
                            style={{
                              backgroundColor: pastel.bg,
                              borderColor: pastel.border,
                              color: pastel.text,
                            }}
                            className="h-8 w-8 rounded-full border flex items-center justify-center text-[11px] font-semibold shrink-0"
                            title={`Calendar Color: ${pastel.label}`}
                          >
                            {(t.profile?.full_name || "T")
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-zinc-900">
                                {t.profile?.full_name}
                              </p>
                              <span
                                style={{
                                  backgroundColor: pastel.bg,
                                  borderColor: pastel.border,
                                  color: pastel.text,
                                }}
                                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                              >
                                <span
                                  style={{ backgroundColor: pastel.accent }}
                                  className="h-1.5 w-1.5 rounded-full"
                                />
                                {pastel.label.replace("Pastel ", "")}
                              </span>
                            </div>
                            {t.bio && (
                              <p className="text-[11px] text-zinc-500 line-clamp-1 max-w-xs mt-0.5">
                                {t.bio}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <p className="text-zinc-800">{t.profile?.email}</p>
                        <p className="text-[11px] text-zinc-400">
                          {t.phone || "No phone"}
                        </p>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap gap-1">
                          {t.instruments && t.instruments.length > 0 ? (
                            t.instruments.map((inst) => (
                              <span
                                key={inst.id}
                                className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700"
                              >
                                {inst.name}
                              </span>
                            ))
                          ) : (
                            <span className="text-zinc-400">None assigned</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-800">
                          {t.upcoming_lessons_count ?? 0} lessons
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            t.is_active
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {t.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openAvailabilityModal(t)}
                            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                            title="View or manage weekly availability"
                          >
                            <Clock className="h-3 w-3 text-zinc-400" />
                            Availability
                          </button>

                          <Link
                            href="/schedule"
                            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
                          >
                            <Calendar className="h-3 w-3 text-zinc-400" />
                            Schedule
                          </Link>

                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(t)}
                              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                            >
                              <Edit3 className="h-3 w-3 text-zinc-400" />
                              Edit
                            </button>
                          )}

                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => handleToggleActive(t)}
                              className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 cursor-pointer"
                              title={
                                t.is_active
                                  ? "Deactivate teacher"
                                  : "Activate teacher"
                              }
                            >
                              <Power className="h-3.5 w-3.5" />
                            </button>
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

      {/* Add / Edit Teacher Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">
                {editingTeacher ? "Edit Teacher" : "Create Teacher Account"}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTeacher} className="p-5 space-y-3.5">
              {formError && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                  <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    disabled={!isAdmin && Boolean(editingTeacher)}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs disabled:bg-zinc-50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+62 812..."
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              {!editingTeacher && (
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Initial Password
                  </label>
                  <input
                    type="text"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs font-mono"
                  />
                </div>
              )}

              {isAdmin && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium text-zinc-700">
                      Qualified Instruments
                    </label>
                    <span className="text-[11px] text-zinc-400">
                      {selectedInstrumentIds.length} selected
                    </span>
                  </div>
                  <div className="space-y-2.5 p-2.5 rounded-xl border border-zinc-200 bg-zinc-50/50">
                    {instruments.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {instruments.map((inst) => {
                          const selected = selectedInstrumentIds.includes(
                            inst.id
                          );
                          return (
                            <button
                              key={inst.id}
                              type="button"
                              onClick={() =>
                                setSelectedInstrumentIds((prev) =>
                                  prev.includes(inst.id)
                                    ? prev.filter((id) => id !== inst.id)
                                    : [...prev, inst.id]
                                )
                              }
                              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                                selected
                                  ? "bg-zinc-900 text-white shadow-xs"
                                  : "bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
                              }`}
                            >
                              {inst.name}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <p className="text-[11px] text-zinc-500">
                          No instruments in database yet. Click to quick-add or
                          type below:
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            "Piano",
                            "Guitar",
                            "Bass",
                            "Drums",
                            "Violin",
                            "Vocal",
                            "Keyboard",
                            "Saxophone",
                          ].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              disabled={addingInstrument}
                              onClick={() =>
                                handleQuickCreateInstrument(preset)
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-dashed border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <Plus className="h-3 w-3" />
                              {preset}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 pt-1 border-t border-zinc-200/70">
                      <input
                        type="text"
                        value={quickInstrumentName}
                        onChange={(e) => setQuickInstrumentName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleQuickCreateInstrument();
                          }
                        }}
                        placeholder="Add new instrument (e.g. Piano, Cello)..."
                        className="flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400"
                      />
                      <button
                        type="button"
                        disabled={
                          addingInstrument || !quickInstrumentName.trim()
                        }
                        onClick={() => handleQuickCreateInstrument()}
                        className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 cursor-pointer shrink-0"
                      >
                        {addingInstrument ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Plus className="h-3 w-3" />
                        )}
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Calendar Pastel Color
                </label>
                <div className="grid grid-cols-6 gap-2 p-2.5 rounded-xl border border-zinc-200 bg-zinc-50/50">
                  {TEACHER_PASTEL_PALETTE.map((swatch) => {
                    const isSelected = colorKey === swatch.key;
                    return (
                      <button
                        key={swatch.key}
                        type="button"
                        onClick={() => setColorKey(swatch.key)}
                        title={swatch.label}
                        style={{
                          backgroundColor: swatch.bg,
                          borderColor: isSelected
                            ? swatch.accent
                            : swatch.border,
                        }}
                        className={`h-8 rounded-lg border flex items-center justify-center transition-all cursor-pointer ${
                          isSelected
                            ? "ring-2 ring-zinc-900/20 scale-105"
                            : "hover:opacity-85"
                        }`}
                      >
                        <span
                          style={{ backgroundColor: swatch.accent }}
                          className={`rounded-full transition-all ${
                            isSelected ? "h-3 w-3" : "h-2 w-2"
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Bio / Notes
                </label>
                <textarea
                  rows={2}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs"
                />
              </div>

              {isAdmin && (
                <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  <span>Active Teacher Account</span>
                </label>
              )}

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
                  {editingTeacher ? "Save Changes" : "Create Teacher"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Teacher Weekly Availability Modal */}
      {availTeacher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">
                  Weekly Availability — {availTeacher.profile?.full_name}
                </h3>
                <p className="text-xs text-zinc-500">
                  Regular teaching hours (Asia/Jakarta · WIB)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAvailTeacher(null)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAvailability} className="p-5 space-y-3">
              {availError && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                  {availError}
                </div>
              )}

              <div className="divide-y divide-zinc-100 border border-zinc-200/80 rounded-xl overflow-hidden">
                {availRows.map((row, idx) => {
                  const canModify = isAdmin || availTeacher.id === profile.id;
                  return (
                    <div
                      key={row.day_of_week}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-3 bg-white text-xs"
                    >
                      <label className="inline-flex items-center gap-2 font-medium text-zinc-800 min-w-[110px]">
                        <input
                          type="checkbox"
                          disabled={!canModify}
                          checked={row.is_available}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setAvailRows((prev) =>
                              prev.map((r, i) =>
                                i === idx ? { ...r, is_available: checked } : r
                              )
                            );
                          }}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                        <span>{DAY_OF_WEEK_LABELS[row.day_of_week]}</span>
                      </label>

                      {row.is_available ? (
                        <div className="flex items-center gap-2">
                          <select
                            disabled={!canModify}
                            value={row.start_time}
                            onChange={(e) => {
                              const val = e.target.value;
                              setAvailRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, start_time: val } : r
                                )
                              );
                            }}
                            className="rounded-lg border border-zinc-200 px-2 py-1 text-xs"
                          >
                            {TIME_SLOTS.slice(0, -1).map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                          <span className="text-zinc-400">to</span>
                          <select
                            disabled={!canModify}
                            value={row.end_time}
                            onChange={(e) => {
                              const val = e.target.value;
                              setAvailRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, end_time: val } : r
                                )
                              );
                            }}
                            className="rounded-lg border border-zinc-200 px-2 py-1 text-xs"
                          >
                            {TIME_SLOTS.filter((t) => t > row.start_time).map(
                              (t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              )
                            )}
                          </select>
                        </div>
                      ) : (
                        <span className="text-zinc-400 italic">
                          Unavailable
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAvailTeacher(null)}
                  className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Close
                </button>
                {(isAdmin || availTeacher.id === profile.id) && (
                  <button
                    type="submit"
                    disabled={availSaving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                  >
                    {availSaving && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    Save Availability
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

