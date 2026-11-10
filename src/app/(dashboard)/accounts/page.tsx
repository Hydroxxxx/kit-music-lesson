"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  ShieldCheck,
  UserCheck,
  UserX,
  Users,
  Power,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import { useCurrentUser } from "@/components/layout/AppShell";
import {
  broadcastRealtimeSync,
  getCachedApiData,
  setCachedApiData,
  useRealtimeSubscription,
} from "@/lib/realtime";
import { formatJakartaDate } from "@/lib/timezone";
import type { UserRole } from "@/types/database";

interface AccountRecord {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  is_super_admin?: boolean;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  registration_source: string;
}

export default function AccountsManagementPage() {
  const { profile } = useCurrentUser();
  const router = useRouter();
  const isAdmin = profile.role === "admin";

  const [accounts, setAccounts] = useState<AccountRecord[]>(
    () => getCachedApiData<AccountRecord[]>("/api/accounts") ?? []
  );
  const [loading, setLoading] = useState(
    () => !getCachedApiData<AccountRecord[]>("/api/accounts")
  );

  // Filters
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Create Account Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [newFullName, setNewFullName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("teacher");
  const [newPhone, setNewPhone] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Edit / Reset Password Modal
  const [editTarget, setEditTarget] = useState<AccountRecord | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("teacher");
  const [editNewPassword, setEditNewPassword] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Confirm Deactivate/Activate Modal
  const [toggleTarget, setToggleTarget] = useState<AccountRecord | null>(null);
  const [toggling, setToggling] = useState(false);

  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  useEffect(() => {
    if (!isAdmin) {
      router.replace("/schedule");
    }
  }, [isAdmin, router]);

  const loadAccounts = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch("/api/accounts", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setCachedApiData("/api/accounts", data.accounts || []);
      setAccounts(data.accounts || []);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useRealtimeSubscription(() => {
    loadAccounts();
  }, "accounts-management");

  const stats = useMemo(() => {
    const total = accounts.length;
    const active = accounts.filter((a) => a.is_active).length;
    const inactive = total - active;
    const admins = accounts.filter((a) => a.role === "admin").length;
    return { total, active, inactive, admins };
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const q = search.trim().toLowerCase();
      if (q) {
        const matchName = acc.full_name.toLowerCase().includes(q);
        const matchEmail = acc.email.toLowerCase().includes(q);
        const matchPhone = acc.phone?.toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchPhone) return false;
      }
      if (roleFilter !== "all" && acc.role !== roleFilter) return false;
      if (statusFilter === "active" && !acc.is_active) return false;
      if (statusFilter === "inactive" && acc.is_active) return false;
      return true;
    });
  }, [accounts, search, roleFilter, statusFilter]);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);

    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: newFullName.trim(),
          email: newEmail.trim().toLowerCase(),
          password: newPassword,
          role: newRole,
          phone: newPhone.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setCreateError(json.error || "Failed to create account");
        return;
      }

      setCreateOpen(false);
      setNewFullName("");
      setNewEmail("");
      setNewPassword("");
      setNewPhone("");
      setNewRole("teacher");
      showToast("New account successfully added to the database.");
      await loadAccounts();
      await broadcastRealtimeSync("data_changed");
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (acc: AccountRecord) => {
    setEditTarget(acc);
    setEditFullName(acc.full_name);
    setEditEmail(acc.email);
    setEditRole(acc.role);
    setEditNewPassword("");
    setEditError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setEditError(null);
    setSavingEdit(true);

    try {
      const payload: Record<string, unknown> = {
        full_name: editFullName.trim(),
        email: editEmail.trim().toLowerCase(),
        role: editRole,
      };
      if (editNewPassword.trim()) {
        payload.password = editNewPassword.trim();
      }

      const res = await fetch(`/api/accounts/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setEditError(json.error || "Failed to update account");
        return;
      }

      setEditTarget(null);
      showToast("Account changes saved successfully.");
      await loadAccounts();
      await broadcastRealtimeSync("data_changed");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmToggleStatus = async () => {
    if (!toggleTarget) return;
    setToggling(true);

    try {
      const nextStatus = !toggleTarget.is_active;
      const res = await fetch(`/api/accounts/${toggleTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: nextStatus }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || "Failed to update account status");
        return;
      }

      showToast(
        nextStatus
          ? `Account ${toggleTarget.email} has been reactivated.`
          : `Account ${toggleTarget.email} has been deactivated.`
      );
      setToggleTarget(null);
      await loadAccounts();
      await broadcastRealtimeSync("data_changed");
    } finally {
      setToggling(false);
    }
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-xs font-medium text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-zinc-200/80 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">
              Total Accounts
            </span>
            <Users className="h-4 w-4 text-zinc-400" />
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
            {stats.total}
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">
            Registered in database
          </p>
        </div>

        <div className="bg-white rounded-xl border border-zinc-200/80 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">
              Active Accounts
            </span>
            <UserCheck className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
            {stats.active}
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">
            Permitted to sign in
          </p>
        </div>

        <div className="bg-white rounded-xl border border-zinc-200/80 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">
              Deactivated Accounts
            </span>
            <UserX className="h-4 w-4 text-red-500" />
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
            {stats.inactive}
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">
            Sign-in access blocked
          </p>
        </div>

        <div className="bg-white rounded-xl border border-zinc-200/80 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">
              Administrators
            </span>
            <ShieldCheck className="h-4 w-4 text-zinc-700" />
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
            {stats.admins}
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">
            Full management access
          </p>
        </div>
      </div>

      {/* Search, Filter & Add Account Bar */}
      <div className="bg-white rounded-xl border border-zinc-200/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-xs">
            <Search className="h-3.5 w-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or Gmail address..."
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50/50 pl-8 pr-3 py-1.5 text-xs text-zinc-900 focus:bg-white focus:border-zinc-400 focus:outline-hidden"
            />
          </div>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-1.5 text-xs text-zinc-800"
          >
            <option value="all">All Roles</option>
            <option value="admin">Admin</option>
            <option value="teacher">Teacher</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-1.5 text-xs text-zinc-800"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Deactivated</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => {
            setCreateError(null);
            setCreateOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Account
        </button>
      </div>

      {/* Accounts Table */}
      <div className="bg-white rounded-xl border border-zinc-200/80 overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : filteredAccounts.length === 0 ? (
          <div className="py-14 text-center text-xs text-zinc-400">
            No accounts match your search filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/60 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Username (Gmail / Email)</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Registered</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Admin Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-xs">
                {filteredAccounts.map((acc) => {
                  const isSelf = acc.id === profile.id;
                  return (
                    <tr
                      key={acc.id}
                      className="hover:bg-zinc-50/50 transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center text-[11px] font-semibold text-zinc-700 shrink-0">
                            {acc.full_name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-zinc-900">
                              {acc.full_name}
                              {isSelf && (
                                <span className="ml-1.5 text-[10px] font-medium text-blue-600">
                                  (You)
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-zinc-400">
                              Provisioned by Admin
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <p className="font-medium text-zinc-800">{acc.email}</p>
                        {acc.phone && (
                          <p className="text-[11px] text-zinc-400">
                            {acc.phone}
                          </p>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                            acc.is_super_admin
                              ? "bg-amber-100 text-amber-900 border border-amber-300/80"
                              : acc.role === "admin"
                              ? "bg-zinc-900 text-white"
                              : "bg-zinc-100 text-zinc-700"
                          }`}
                        >
                          {acc.is_super_admin ? "Super Admin" : acc.role}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-zinc-600 whitespace-nowrap">
                        {formatJakartaDate(acc.created_at)}
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            acc.is_active
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              acc.is_active ? "bg-emerald-500" : "bg-red-500"
                            }`}
                          />
                          {acc.is_active ? "Active" : "Deactivated"}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(acc)}
                            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                            title="Update role, name, or reset password"
                          >
                            <KeyRound className="h-3 w-3 text-zinc-400" />
                            Manage
                          </button>

                          {!isSelf && !acc.is_super_admin && (
                            <button
                              type="button"
                              onClick={() => setToggleTarget(acc)}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                                acc.is_active
                                  ? "border-red-200 bg-red-50/60 text-red-700 hover:bg-red-100/80"
                                  : "border-emerald-200 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100/80"
                              }`}
                            >
                              <Power className="h-3 w-3" />
                              {acc.is_active ? "Deactivate" : "Activate"}
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

      {/* Add New Account Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">
                  Add New Account
                </h3>
                <p className="text-xs text-zinc-500">
                  Create a new Teacher or Administrator account in the database
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAccount} className="p-5 space-y-3.5">
              {createError && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                  <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{createError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="e.g. Samuel Wijaya"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Gmail Address
                </label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="samuel@gmail.com"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Password
                  </label>
                  <input
                    type="text"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min. 6 characters"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Account Role
                  </label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs"
                  >
                    <option value="teacher">Teacher</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Phone Number (Optional)
                </label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+62 812..."
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                >
                  {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Role & Reset Password Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">
                  Manage Account — {editTarget.email}
                </h3>
                <p className="text-xs text-zinc-500">
                  Update full name, role permissions, or reset password
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-5 space-y-3.5">
              {editError && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                  <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{editError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Email Address (Username)
                </label>
                <input
                  type="email"
                  required
                  disabled={
                    Boolean(editTarget.is_super_admin) &&
                    editTarget.id !== profile.id
                  }
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs disabled:bg-zinc-50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Account Role
                </label>
                <select
                  value={editRole}
                  disabled={
                    editTarget.id === profile.id ||
                    Boolean(editTarget.is_super_admin)
                  }
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs disabled:bg-zinc-50"
                >
                  <option value="teacher">Teacher</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Reset Password{" "}
                  <span className="text-zinc-400 font-normal">
                    (Leave blank to keep current password)
                  </span>
                </label>
                <input
                  type="text"
                  minLength={6}
                  value={editNewPassword}
                  onChange={(e) => setEditNewPassword(e.target.value)}
                  placeholder="Enter new password (min. 6 characters)..."
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs font-mono"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                >
                  {savingEdit && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Deactivate / Activate Modal */}
      {toggleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-sm p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                {toggleTarget.is_active
                  ? "Deactivate This Account?"
                  : "Reactivate This Account?"}
              </h3>
              <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed">
                {toggleTarget.is_active ? (
                  <>
                    <span className="font-semibold text-zinc-800">
                      {toggleTarget.full_name} ({toggleTarget.email})
                    </span>{" "}
                    will no longer be able to sign in until reactivated by an
                    Administrator.
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-zinc-800">
                      {toggleTarget.full_name} ({toggleTarget.email})
                    </span>{" "}
                    will be permitted to sign in again using their Gmail address
                    and password.
                  </>
                )}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setToggleTarget(null)}
                className="rounded-lg border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={toggling}
                onClick={handleConfirmToggleStatus}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-50 cursor-pointer ${
                  toggleTarget.is_active
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {toggling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {toggleTarget.is_active ? "Yes, Deactivate" : "Yes, Activate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
