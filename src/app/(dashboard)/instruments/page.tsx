"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Edit3,
  Music,
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
import type { Instrument } from "@/types/database";

interface InstrumentTeacher {
  id: string;
  full_name: string;
  email: string | null;
  is_active: boolean;
}

interface EnrichedInstrument extends Instrument {
  teachers: InstrumentTeacher[];
}

export default function InstrumentsPage() {
  const { profile } = useCurrentUser();
  const isAdmin = profile.role === "admin";

  const cachedInstruments = getCachedApiData<{
    instruments: EnrichedInstrument[];
    allTeachers: InstrumentTeacher[];
  }>("/api/instruments");
  const [instruments, setInstruments] = useState<EnrichedInstrument[]>(
    () => cachedInstruments?.instruments ?? []
  );
  const [allTeachers, setAllTeachers] = useState<InstrumentTeacher[]>(
    () => cachedInstruments?.allTeachers ?? []
  );
  const [loading, setLoading] = useState(() => !cachedInstruments);
  const [search, setSearch] = useState("");

  // Add / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingInst, setEditingInst] = useState<EnrichedInstrument | null>(
    null
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [toast, setToast] = useState<string | null>(null);

  const loadInstruments = useCallback(async () => {
    try {
      const res = await fetch("/api/instruments", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setCachedApiData("/api/instruments", data);
      setInstruments(data.instruments || []);
      setAllTeachers(data.allTeachers || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInstruments();
  }, [loadInstruments]);

  useRealtimeSubscription(() => {
    loadInstruments();
  }, "instruments-page");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return instruments;
    return instruments.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.description?.toLowerCase().includes(q) ||
        i.teachers?.some((t) => t.full_name.toLowerCase().includes(q))
    );
  }, [instruments, search]);

  const openAddModal = () => {
    setEditingInst(null);
    setName("");
    setDescription("");
    setIsActive(true);
    setSelectedTeacherIds([]);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (inst: EnrichedInstrument) => {
    setEditingInst(inst);
    setName(inst.name);
    setDescription(inst.description || "");
    setIsActive(inst.is_active);
    setSelectedTeacherIds((inst.teachers || []).map((t) => t.id));
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      const url = editingInst
        ? `/api/instruments/${editingInst.id}`
        : "/api/instruments";
      const method = editingInst ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          is_active: isActive,
          teacher_ids: selectedTeacherIds,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error || "Failed to save instrument");
        return;
      }

      setModalOpen(false);
      setToast(
        editingInst ? "Instrument updated." : "New instrument added."
      );
      await loadInstruments();
      await broadcastRealtimeSync("data_changed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (inst: EnrichedInstrument) => {
    if (!isAdmin) return;
    const res = await fetch(`/api/instruments/${inst.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !inst.is_active }),
    });
    if (res.ok) {
      setToast(
        `${inst.name} is now ${!inst.is_active ? "Active" : "Inactive"}.`
      );
      await loadInstruments();
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

      {/* Top Bar */}
      <div className="bg-white rounded-xl border border-zinc-200/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="h-3.5 w-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search instruments or teachers..."
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50/50 pl-8 pr-3 py-1.5 text-xs text-zinc-900 focus:bg-white focus:border-zinc-400 focus:outline-hidden"
          />
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Instrument
          </button>
        )}
      </div>

      {/* Instruments Grid */}
      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-zinc-200/80 py-14 text-center text-xs text-zinc-400">
          No instruments found.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((inst) => (
            <div
              key={inst.id}
              className="bg-white rounded-xl border border-zinc-200/80 p-5 flex flex-col justify-between gap-4 hover:border-zinc-300 transition-colors"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-700">
                      <Music className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900">
                        {inst.name}
                      </h3>
                      <span
                        className={`inline-block mt-0.5 rounded px-1.5 py-0.2 text-[10px] font-semibold uppercase ${
                          inst.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {inst.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditModal(inst)}
                        className="h-7 w-7 rounded-lg border border-zinc-200 flex items-center justify-center text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 cursor-pointer"
                        title="Edit instrument & assign teachers"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(inst)}
                        className="h-7 w-7 rounded-lg border border-zinc-200 flex items-center justify-center text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 cursor-pointer"
                        title={
                          inst.is_active
                            ? "Deactivate instrument"
                            : "Activate instrument"
                        }
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <p className="mt-3 text-xs text-zinc-500 leading-relaxed">
                  {inst.description || "No description provided."}
                </p>
              </div>

              <div className="pt-3 border-t border-zinc-100">
                <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-1.5">
                  Assigned Teachers ({inst.teachers?.length || 0})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {inst.teachers && inst.teachers.length > 0 ? (
                    inst.teachers.map((t) => (
                      <span
                        key={t.id}
                        className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700"
                      >
                        {t.full_name}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-zinc-400">
                      No teachers assigned yet
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Instrument Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">
                {editingInst ? "Edit Instrument" : "Add New Instrument"}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 space-y-3.5">
              {formError && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                  <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Instrument Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Piano, Guitar, Cello..."
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Assign Qualified Teachers
                </label>
                <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl border border-zinc-200 bg-zinc-50/50">
                  {allTeachers.map((t) => {
                    const selected = selectedTeacherIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() =>
                          setSelectedTeacherIds((prev) =>
                            prev.includes(t.id)
                              ? prev.filter((id) => id !== t.id)
                              : [...prev, t.id]
                          )
                        }
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                          selected
                            ? "bg-zinc-900 text-white"
                            : "bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
                        }`}
                      >
                        {t.full_name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                <span>Active Instrument</span>
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
                  {editingInst ? "Save Changes" : "Add Instrument"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

