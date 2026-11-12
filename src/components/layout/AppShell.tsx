"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  Users,
  GraduationCap,
  Music,
  DoorOpen,
  GitPullRequest,
  Bell,
  Settings,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  LogOut,
  ChevronDown,
  CheckCheck,
  Search,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import type { NotificationItem, Profile } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeSubscription } from "@/lib/realtime";
import { isSuperAdminEmail } from "@/lib/teacher-colors";
import { formatJakartaDate, toJakartaTimeString } from "@/lib/timezone";

interface UserContextValue {
  profile: Profile;
  refreshNotifications: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | null>(null);

export function useCurrentUser() {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error("useCurrentUser must be used within AppShell");
  }
  return ctx;
}

const NAV_ITEMS: Array<{
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}> = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Weekly Schedule", href: "/schedule", icon: Calendar },
  { name: "Teachers", href: "/teachers", icon: Users },
  { name: "Students", href: "/students", icon: GraduationCap },
  { name: "Instruments", href: "/instruments", icon: Music },
  { name: "Rooms", href: "/rooms", icon: DoorOpen },
  { name: "Schedule Requests", href: "/requests", icon: GitPullRequest },
  { name: "Notifications", href: "/notifications", icon: Bell },
  {
    name: "Account Management",
    href: "/accounts",
    icon: ShieldCheck,
    adminOnly: true,
  },
  { name: "Settings", href: "/settings", icon: Settings },
];

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/": {
    title: "Dashboard",
    subtitle: "Overview of today's music lessons and schedule activity",
  },
  "/schedule": {
    title: "Weekly Schedule",
    subtitle: "Real-time shared lesson calendar (Asia/Jakarta · WIB)",
  },
  "/teachers": {
    title: "Teachers",
    subtitle: "Manage music instructors, qualifications, and weekly availability",
  },
  "/students": {
    title: "Students",
    subtitle: "Student directory, instrument enrollments, and lesson history",
  },
  "/instruments": {
    title: "Instruments",
    subtitle: "Configure musical instruments and qualified teachers",
  },
  "/rooms": {
    title: "Rooms",
    subtitle: "Practice rooms and studio capacity management",
  },
  "/requests": {
    title: "Schedule Requests",
    subtitle: "Review and track teacher schedule change requests",
  },
  "/notifications": {
    title: "Notifications",
    subtitle: "In-app alerts for schedule updates and requests",
  },
  "/accounts": {
    title: "Account Management",
    subtitle:
      "Monitor registered accounts, manage role permissions, and activate or deactivate users",
  },
  "/settings": {
    title: "Settings",
    subtitle: "Account profile, availability preferences, and audit logs",
  },
};

export function AppShell({
  initialProfile,
  children,
}: {
  initialProfile: Profile;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const [profile] = useState<Profile>(initialProfile);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [quickSearch, setQuickSearch] = useState("");
  const [patchNotesOpen, setPatchNotesOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch {
      // Ignore transient fetch errors
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/notifications", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) {
          setNotifications(data.notifications || []);
          setUnreadCount(data.unreadCount || 0);
        }
      })
      .catch(() => {
        // Ignore transient fetch errors
      });
    return () => {
      active = false;
    };
  }, []);

  useRealtimeSubscription(() => {
    fetchNotifications();
  }, "appshell-notifications");

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  };

  const handleMarkSingleRead = async (id: string) => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // ignore
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const handleQuickSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = quickSearch.trim().toLowerCase();
    if (!q) return;
    if (
      profile.role === "admin" &&
      (q.includes("account") || q.includes("user"))
    )
      router.push("/accounts");
    else if (q.includes("teach")) router.push("/teachers");
    else if (q.includes("stud")) router.push("/students");
    else if (q.includes("inst") || q.includes("piano") || q.includes("guitar"))
      router.push("/instruments");
    else if (q.includes("room") || q.includes("studio")) router.push("/rooms");
    else if (q.includes("req")) router.push("/requests");
    else if (q.includes("set") || q.includes("log")) router.push("/settings");
    else router.push("/schedule");
    setQuickSearch("");
  };

  const currentPageMeta = PAGE_TITLES[pathname] || {
    title: "KitMusicLesson",
    subtitle: "KitMusicLesson Scheduling System",
  };

  const isSuperAdmin = isSuperAdminEmail(profile.email);
  const roleLabel = isSuperAdmin ? "Super Admin" : profile.role;

  const initials = profile.full_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <UserContext.Provider
      value={{ profile, refreshNotifications: fetchNotifications }}
    >
      <div className="h-dvh overflow-hidden flex bg-[#fafafa] text-zinc-900">
        {/* Mobile Sidebar Drawer Backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Sidebar Navigation */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 h-dvh shrink-0 flex flex-col bg-white border-r border-zinc-200/80 transition-all duration-200 lg:static lg:z-auto ${
            collapsed ? "lg:w-[68px]" : "lg:w-60"
          } ${
            mobileOpen
              ? "translate-x-0 w-64 shadow-xl"
              : "-translate-x-full lg:translate-x-0"
          }`}
        >
          {/* Brand Header */}
          <div className="h-15 flex items-center justify-between px-3.5 border-b border-zinc-100 shrink-0">
            <Link
              href="/schedule"
              className="flex items-center gap-2.5 min-w-0"
              onClick={() => setMobileOpen(false)}
            >
              <div className="h-10 w-10 rounded-lg bg-white border border-zinc-100 flex items-center justify-center overflow-hidden shrink-0">
                <Image
                  src="/KIT-Music_Lesson-Logo_Black.svg"
                  alt="KitMusicLesson Logo"
                  width={48}
                  height={48}
                  priority
                  className="h-12 w-12 max-w-none object-contain scale-110"
                />
              </div>
              {!collapsed && (
                <div className="truncate">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold tracking-tight text-zinc-900 leading-none">
                      KitMusicLesson
                    </span>
                    <span className="inline-flex items-center rounded bg-zinc-900 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white">
                      v1.2
                    </span>
                  </div>
                  <span className="text-[11px] text-zinc-400 font-medium block mt-0.5">
                    Scheduling System
                  </span>
                </div>
              )}
            </Link>

            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="hidden lg:flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors cursor-pointer"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="lg:hidden h-7 w-7 flex items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Nav Links */}
          <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
            {NAV_ITEMS.filter(
              (item) => !item.adminOnly || profile.role === "admin"
            ).map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  title={collapsed ? item.name : undefined}
                  className={`group flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:bg-zinc-100/80 hover:text-zinc-900"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        isActive
                          ? "text-white"
                          : "text-zinc-400 group-hover:text-zinc-700"
                      }`}
                    />
                    {!collapsed && <span className="truncate">{item.name}</span>}
                  </div>
                  {!collapsed &&
                    item.href === "/notifications" &&
                    unreadCount > 0 && (
                      <span
                        className={`ml-2 rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
                          isActive
                            ? "bg-white text-zinc-900"
                            : "bg-blue-600 text-white"
                        }`}
                      >
                        {unreadCount}
                      </span>
                    )}
                </Link>
              );
            })}
          </nav>

          {/* Footer Role Card */}
          <div className="p-3 border-t border-zinc-100 shrink-0 space-y-2">
            {!collapsed ? (
              <>
                <div className="rounded-lg bg-zinc-50 border border-zinc-200/60 px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-zinc-500">
                      Signed in as
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        isSuperAdmin
                          ? "bg-amber-100 text-amber-900 border border-amber-300/80"
                          : profile.role === "admin"
                          ? "bg-zinc-900 text-white"
                          : "bg-zinc-200 text-zinc-700"
                      }`}
                    >
                      {roleLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-medium text-zinc-900 truncate">
                    {profile.full_name}
                  </p>
                  <p className="text-[11px] text-zinc-400 truncate">
                    {profile.email}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setPatchNotesOpen(true)}
                  className="w-full flex items-center justify-between rounded-lg border border-zinc-200/80 bg-white px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3 text-amber-500" />
                    <span>Patch 1.2 Notes</span>
                  </span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-800">
                    v1.2
                  </span>
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div
                  className="h-8 w-8 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center text-xs font-semibold text-zinc-700"
                  title={`${profile.full_name} (${profile.role})`}
                >
                  {initials}
                </div>
                <button
                  type="button"
                  onClick={() => setPatchNotesOpen(true)}
                  title="KitMusicLesson v1.2 — Patch Notes"
                  className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white hover:bg-zinc-700 cursor-pointer"
                >
                  v1.2
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content Column */}
        <div className="flex-1 flex flex-col min-w-0 h-dvh overflow-hidden">
          {/* Top Navigation Bar */}
          <header className="h-15 shrink-0 bg-white border-b border-zinc-200/80 px-4 sm:px-6 flex items-center justify-between gap-4 z-30">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="lg:hidden h-8 w-8 flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-base font-semibold tracking-tight text-zinc-900 truncate">
                  {currentPageMeta.title}
                </h1>
                <p className="hidden sm:block text-xs text-zinc-500 truncate">
                  {currentPageMeta.subtitle}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {/* Version & Patch Notes Trigger */}
              <button
                type="button"
                onClick={() => setPatchNotesOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50/80 px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 transition-colors cursor-pointer"
                title="View Update Patch 1.2 Release Notes"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                <span>Patch v1.2</span>
              </button>

              {/* Quick Search */}
              <form
                onSubmit={handleQuickSearchSubmit}
                className="hidden md:flex items-center relative"
              >
                <Search className="h-3.5 w-3.5 text-zinc-400 absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  value={quickSearch}
                  onChange={(e) => setQuickSearch(e.target.value)}
                  placeholder="Jump to schedule, teachers, rooms..."
                  className="w-56 lg:w-64 rounded-lg border border-zinc-200 bg-zinc-50/60 pl-8 pr-3 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:bg-white focus:border-zinc-400 focus:outline-hidden transition-colors"
                />
              </form>

              {/* Notification Bell & Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setNotifDropdownOpen((o) => !o);
                    setProfileDropdownOpen(false);
                  }}
                  className="relative h-9 w-9 rounded-lg border border-zinc-200/80 bg-white flex items-center justify-center text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors cursor-pointer"
                  aria-label="Notifications"
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-blue-600 text-[10px] font-semibold text-white flex items-center justify-center">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>

                {notifDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setNotifDropdownOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-white border border-zinc-200 shadow-lg z-40 overflow-hidden">
                      <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-zinc-900">
                            Notifications
                          </span>
                          {unreadCount > 0 && (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                              {unreadCount} unread
                            </span>
                          )}
                        </div>
                        {unreadCount > 0 && (
                          <button
                            type="button"
                            onClick={handleMarkAllRead}
                            className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 cursor-pointer"
                          >
                            <CheckCheck className="h-3.5 w-3.5" />
                            Mark all read
                          </button>
                        )}
                      </div>

                      <div className="max-h-80 overflow-y-auto divide-y divide-zinc-100">
                        {notifications.length === 0 ? (
                          <div className="py-8 px-4 text-center text-xs text-zinc-400">
                            No notifications yet
                          </div>
                        ) : (
                          notifications.slice(0, 8).map((n) => (
                            <div
                              key={n.id}
                              onClick={() => {
                                if (!n.is_read) handleMarkSingleRead(n.id);
                              }}
                              className={`px-4 py-3 text-left transition-colors cursor-pointer ${
                                n.is_read
                                  ? "bg-white hover:bg-zinc-50"
                                  : "bg-blue-50/30 hover:bg-blue-50/50"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-xs font-medium text-zinc-900">
                                  {n.title}
                                </p>
                                {!n.is_read && (
                                  <span className="h-2 w-2 rounded-full bg-blue-600 shrink-0 mt-1" />
                                )}
                              </div>
                              <p className="mt-0.5 text-xs text-zinc-600 line-clamp-2">
                                {n.message}
                              </p>
                              <p className="mt-1 text-[10px] text-zinc-400">
                                {formatJakartaDate(n.created_at)} ·{" "}
                                {toJakartaTimeString(n.created_at)} WIB
                              </p>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="px-4 py-2.5 bg-zinc-50 border-t border-zinc-100 text-center">
                        <Link
                          href="/notifications"
                          onClick={() => setNotifDropdownOpen(false)}
                          className="text-xs font-medium text-zinc-700 hover:text-zinc-900"
                        >
                          View all notifications →
                        </Link>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* User Profile Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setProfileDropdownOpen((o) => !o);
                    setNotifDropdownOpen(false);
                  }}
                  className="flex items-center gap-2.5 rounded-lg border border-zinc-200/80 bg-white pl-2 pr-2.5 py-1.5 hover:bg-zinc-50 transition-colors cursor-pointer"
                >
                  <div className="h-6 w-6 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[11px] font-semibold">
                    {initials}
                  </div>
                  <div className="hidden sm:block text-left">
                    <p className="text-xs font-medium text-zinc-900 leading-none">
                      {profile.full_name}
                    </p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">
                      {roleLabel}
                    </p>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                </button>

                {profileDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setProfileDropdownOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 w-56 rounded-xl bg-white border border-zinc-200 shadow-lg z-40 py-1.5 overflow-hidden">
                      <div className="px-3.5 py-2.5 border-b border-zinc-100">
                        <p className="text-xs font-semibold text-zinc-900 truncate">
                          {profile.full_name}
                        </p>
                        <p className="text-[11px] text-zinc-500 truncate">
                          {profile.email}
                        </p>
                        <span className="mt-1.5 inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-700">
                          Role: {roleLabel}
                        </span>
                      </div>

                      <div className="py-1">
                        <Link
                          href="/schedule"
                          onClick={() => setProfileDropdownOpen(false)}
                          className="flex items-center gap-2 px-3.5 py-2 text-xs text-zinc-700 hover:bg-zinc-50"
                        >
                          <Calendar className="h-3.5 w-3.5 text-zinc-400" />
                          Weekly Calendar
                        </Link>
                        {profile.role === "admin" && (
                          <Link
                            href="/accounts"
                            onClick={() => setProfileDropdownOpen(false)}
                            className="flex items-center gap-2 px-3.5 py-2 text-xs text-zinc-700 hover:bg-zinc-50"
                          >
                            <ShieldCheck className="h-3.5 w-3.5 text-zinc-400" />
                            Account Management
                          </Link>
                        )}
                        <Link
                          href="/settings"
                          onClick={() => setProfileDropdownOpen(false)}
                          className="flex items-center gap-2 px-3.5 py-2 text-xs text-zinc-700 hover:bg-zinc-50"
                        >
                          <Settings className="h-3.5 w-3.5 text-zinc-400" />
                          Profile & Settings
                        </Link>
                      </div>

                      <div className="border-t border-zinc-100 pt-1">
                        <button
                          type="button"
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50/60 transition-colors cursor-pointer"
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          Sign out
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>

          {/* Page Content */}
          <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
            {children}
          </main>
        </div>

        {/* Update Patch 1.2 — Release Notes Modal */}
        {patchNotesOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
            <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-zinc-900 text-white flex items-center justify-center">
                    <Sparkles className="h-4 w-4 text-amber-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-zinc-900">
                        KitMusicLesson — Update Patch 1.2
                      </h3>
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                        v1.2
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500">
                      Changelog & release notes for version 1.2
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPatchNotesOpen(false)}
                  className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
                {/* Patch 1.2 Section */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-900">
                      Update Patch 1.2 (Latest)
                    </span>
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                      New in v1.2
                    </span>
                  </div>

                  <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3.5 space-y-1">
                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>1. Student Report Exclusively Shows Completed Attendance</span>
                    </div>
                    <p className="text-xs text-zinc-600 pl-5 leading-relaxed">
                      Future recurring schedules (e.g., 6 months ahead) that have not occurred yet are no longer counted or listed in the Student Report. The report now purely records lessons after attendance (<strong>Present</strong> or <strong>Absent</strong>) has been marked.
                    </p>
                  </div>

                  <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3.5 space-y-1">
                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>2. Move / Edit Single Week Occurrence Only</span>
                    </div>
                    <p className="text-xs text-zinc-600 pl-5 leading-relaxed">
                      Clicking any lesson on the Weekly Schedule and choosing <strong>Move / Edit This Week</strong> allows you to move the date, time, or room for that specific week only while leaving all other weeks in a 6-month recurring series untouched.
                    </p>
                  </div>

                  <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3.5 space-y-1">
                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>3. Flexible Schedule Deletion & Full Student Schedule Overhaul</span>
                    </div>
                    <p className="text-xs text-zinc-600 pl-5 leading-relaxed">
                      Added a <strong>Delete</strong> action on schedules with 3 modes: delete <strong>This Week Only</strong>, delete <strong>This &amp; Following Weeks in Series</strong>, or <strong>Overhaul / Delete All Unattended Schedules</strong> for that student so you can rebuild their schedule from scratch while keeping past attended records safe.
                    </p>
                  </div>

                  <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3.5 space-y-1">
                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>4. Full-Width Vertical Stacking on Weekly Schedule</span>
                    </div>
                    <p className="text-xs text-zinc-600 pl-5 leading-relaxed">
                      Multiple lessons in the same time slot now stack vertically at full column width instead of squeezing side-by-side.
                    </p>
                  </div>
                </div>

                {/* Patch 1.1 Archive Section */}
                <div className="pt-2 border-t border-zinc-100 space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block">
                    Previous — Patch 1.1
                  </span>
                  <div className="rounded-xl border border-zinc-100 bg-zinc-50/40 p-3 text-[11px] text-zinc-500 space-y-1">
                    <p>• Teacher self-scheduling, student management, and email editing.</p>
                    <p>• Streamlined Student table &amp; Attendance Reason notes (e.g. <em>Sakit</em>, <em>Izin</em>).</p>
                    <p>• Removed Last Sign-In column from Account Management.</p>
                    <p>• Updated schedule cards to show <em>Instrument - Teacher - Room</em>.</p>
                  </div>
                </div>
              </div>

              <div className="px-5 py-3.5 border-t border-zinc-100 bg-zinc-50/50 flex items-center justify-between">
                <span className="text-[11px] text-zinc-500">
                  KitMusicLesson Scheduling System · Version 1.2
                </span>
                <button
                  type="button"
                  onClick={() => setPatchNotesOpen(false)}
                  className="rounded-lg bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </UserContext.Provider>
  );
}
