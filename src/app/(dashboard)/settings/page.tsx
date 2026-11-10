"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  User,
  Shield,
  Activity,
  CheckCircle2,
  Loader2,
  X,
  Sparkles,
} from "lucide-react";
import { useCurrentUser } from "@/components/layout/AppShell";
import { getCachedApiData, setCachedApiData } from "@/lib/realtime";
import { formatJakartaDate, toJakartaTimeString } from "@/lib/timezone";
import type { AuditLogWithUser } from "@/types/database";

export default function SettingsPage() {
  const { profile } = useCurrentUser();
  const isAdmin = profile.role === "admin";

  const cachedSettings = getCachedApiData<{
    profile?: { full_name?: string };
    teacher?: { phone?: string; bio?: string };
    auditLogs?: AuditLogWithUser[];
  }>("/api/settings");

  const [fullName, setFullName] = useState(
    () => cachedSettings?.profile?.full_name || profile.full_name
  );
  const [email, setEmail] = useState(() => profile.email || "");
  const [phone, setPhone] = useState(() => cachedSettings?.teacher?.phone || "");
  const [bio, setBio] = useState(() => cachedSettings?.teacher?.bio || "");
  const [auditLogs, setAuditLogs] = useState<AuditLogWithUser[]>(
    () => cachedSettings?.auditLogs ?? []
  );
  const [loading, setLoading] = useState(() => !cachedSettings);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setCachedApiData("/api/settings", data);
      if (data.profile) {
        setFullName(data.profile.full_name || "");
        if (data.profile.email) setEmail(data.profile.email);
      }
      if (data.teacher) {
        setPhone(data.teacher.phone || "");
        setBio(data.teacher.bio || "");
      }
      setAuditLogs(data.auditLogs || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          email: email.trim(),
          phone: phone || null,
          bio: bio || null,
        }),
      });
      if (res.ok) {
        setToast("Profile settings saved.");
        await loadSettings();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
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

      {/* Personal Profile Settings */}
      <div className="bg-white rounded-xl border border-zinc-200/80 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center gap-2">
          <User className="h-4 w-4 text-zinc-400" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">
              Account Profile
            </h2>
            <p className="text-xs text-zinc-500">
              Manage your personal information and contact details
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                Full Name
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                Email Address (Account ID)
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900"
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
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                System Role
              </label>
              <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase text-zinc-700">
                <Shield className="h-3.5 w-3.5 text-zinc-400" />
                {profile.role}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">
              Instructor Bio / Notes
            </label>
            <textarea
              rows={2}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Share your teaching background or notes..."
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save Profile
            </button>
          </div>
        </form>
      </div>

      {/* Version 1.1 & Patch Notes Card */}
      <div className="bg-white rounded-xl border border-zinc-200/80 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">
                System Version & Patch Release Notes
              </h2>
              <p className="text-xs text-zinc-500">
                KitMusicLesson Scheduling System — Update Patch 1.1
              </p>
            </div>
          </div>
          <span className="inline-flex items-center rounded-md bg-zinc-900 px-2.5 py-1 font-mono text-xs font-bold text-white">
            Version 1.1
          </span>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-900">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span>1. Teacher Schedule, Student & Email Access</span>
            </div>
            <p className="text-zinc-600 pl-5 leading-relaxed">
              Teachers can create their own lesson schedules, edit/cancel their own lessons, manage students they teach, and update their own email address (Admins can also update any account email).
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-900">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span>2. Student Report View & Absence Reason Notes</span>
            </div>
            <p className="text-zinc-600 pl-5 leading-relaxed">
              Removed the Attendance Record column from the Students table (accessible via the Student Report button) and added Attendance Notes / Reasons for Absence (e.g., <em>Sakit</em>, <em>Izin</em>).
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-900">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span>3. Streamlined Account Management Table</span>
            </div>
            <p className="text-zinc-600 pl-5 leading-relaxed">
              Removed the <em>Last Sign-In</em> column from the Account Management table for a cleaner layout.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-900">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span>4. Calendar Schedule Card Attributes</span>
            </div>
            <p className="text-zinc-600 pl-5 leading-relaxed">
              Weekly Calendar schedule blocks now display <strong>Instrument - Teacher Name - Practice Room</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* Admin Activity & Audit Logs */}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-zinc-200/80 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-zinc-400" />
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">
                  System Activity & Audit Logs
                </h2>
                <p className="text-xs text-zinc-500">
                  Complete audit trail of schedule changes, approvals, and
                  account actions
                </p>
              </div>
            </div>
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700">
              Latest {auditLogs.length} events
            </span>
          </div>

          {loading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-400">
              No audit log entries recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-100 bg-zinc-50/60 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    <th className="py-3 px-4">Timestamp (WIB)</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Table</th>
                    <th className="py-3 px-4">Record ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-xs">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-zinc-50/50">
                      <td className="py-3 px-4 text-zinc-600 whitespace-nowrap">
                        {formatJakartaDate(log.created_at)} ·{" "}
                        {toJakartaTimeString(log.created_at)}
                      </td>
                      <td className="py-3 px-4 font-medium text-zinc-900">
                        {log.user?.full_name || "System"}
                      </td>
                      <td className="py-3 px-4">
                        <span className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-[11px] font-medium text-zinc-800">
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-zinc-600 font-mono text-[11px]">
                        {log.table_name}
                      </td>
                      <td className="py-3 px-4 text-zinc-400 font-mono text-[11px] truncate max-w-[160px]">
                        {log.record_id || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

