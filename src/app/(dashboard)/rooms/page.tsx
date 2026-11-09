"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Edit3,
  DoorOpen,
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
import type { Room } from "@/types/database";

interface EnrichedRoom extends Room {
  upcoming_lessons_count: number;
}

export default function RoomsPage() {
  const { profile } = useCurrentUser();
  const isAdmin = profile.role === "admin";

  const [rooms, setRooms] = useState<EnrichedRoom[]>(
    () => getCachedApiData<EnrichedRoom[]>("/api/rooms") ?? []
  );
  const [loading, setLoading] = useState(
    () => !getCachedApiData<EnrichedRoom[]>("/api/rooms")
  );
  const [search, setSearch] = useState("");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<EnrichedRoom | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [toast, setToast] = useState<string | null>(null);

  const loadRooms = useCallback(async () => {
    try {
      const res = await fetch("/api/rooms", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setCachedApiData("/api/rooms", data.rooms || []);
      setRooms(data.rooms || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  useRealtimeSubscription(() => {
    loadRooms();
  }, "rooms-page");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q)
    );
  }, [rooms, search]);

  const openAddModal = () => {
    setEditingRoom(null);
    setName("");
    setDescription("");
    setIsActive(true);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (r: EnrichedRoom) => {
    setEditingRoom(r);
    setName(r.name);
    setDescription(r.description || "");
    setIsActive(r.is_active);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      const url = editingRoom ? `/api/rooms/${editingRoom.id}` : "/api/rooms";
      const method = editingRoom ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          is_active: isActive,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error || "Failed to save room");
        return;
      }

      setModalOpen(false);
      setToast(editingRoom ? "Room updated." : "New practice room created.");
      await loadRooms();
      await broadcastRealtimeSync("data_changed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (r: EnrichedRoom) => {
    if (!isAdmin) return;
    const res = await fetch(`/api/rooms/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !r.is_active }),
    });
    if (res.ok) {
      setToast(`${r.name} is now ${!r.is_active ? "Active" : "Inactive"}.`);
      await loadRooms();
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

      <div className="bg-white rounded-xl border border-zinc-200/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="h-3.5 w-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rooms..."
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
            Add Room
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-zinc-200/80 py-14 text-center text-xs text-zinc-400">
          No rooms found.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((r) => (
            <div
              key={r.id}
              className="bg-white rounded-xl border border-zinc-200/80 p-5 flex flex-col justify-between gap-4 hover:border-zinc-300 transition-colors"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-700">
                      <DoorOpen className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900">
                        {r.name}
                      </h3>
                      <span
                        className={`inline-block mt-0.5 rounded px-1.5 py-0.2 text-[10px] font-semibold uppercase ${
                          r.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {r.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditModal(r)}
                        className="h-7 w-7 rounded-lg border border-zinc-200 flex items-center justify-center text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 cursor-pointer"
                        title="Edit room"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(r)}
                        className="h-7 w-7 rounded-lg border border-zinc-200 flex items-center justify-center text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 cursor-pointer"
                        title={
                          r.is_active ? "Deactivate room" : "Activate room"
                        }
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <p className="mt-3 text-xs text-zinc-500 leading-relaxed">
                  {r.description || "No description provided."}
                </p>
              </div>

              <div className="pt-3 border-t border-zinc-100 flex items-center justify-between text-xs">
                <span className="text-zinc-400">
                  Protected by double-booking exclusion constraint
                </span>
                <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 font-medium text-zinc-700">
                  {r.upcoming_lessons_count} upcoming confirmed
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">
                {editingRoom ? "Edit Practice Room" : "Add Practice Room"}
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
                  Room Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Room 103 — Ensemble Studio"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Description & Equipment
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe instruments and equipment available in this room..."
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
                <span>Room Available for Scheduling</span>
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
                  {editingRoom ? "Save Changes" : "Add Room"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

