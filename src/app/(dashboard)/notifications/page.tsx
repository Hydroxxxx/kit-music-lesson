"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, Check, Loader2 } from "lucide-react";
import { useCurrentUser } from "@/components/layout/AppShell";
import {
  getCachedApiData,
  setCachedApiData,
  useRealtimeSubscription,
} from "@/lib/realtime";
import { formatJakartaDate, toJakartaTimeString } from "@/lib/timezone";
import type { NotificationItem } from "@/types/database";

export default function NotificationsPage() {
  const { refreshNotifications } = useCurrentUser();
  const [notifications, setNotifications] = useState<NotificationItem[]>(
    () => getCachedApiData<NotificationItem[]>("/api/notifications") ?? []
  );
  const [loading, setLoading] = useState(
    () => !getCachedApiData<NotificationItem[]>("/api/notifications")
  );
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setCachedApiData("/api/notifications", data.notifications || []);
      setNotifications(data.notifications || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useRealtimeSubscription(() => {
    loadNotifications();
  }, "notifications-page");

  const handleMarkRead = async (id: string) => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    await refreshNotifications();
  };

  const handleMarkAllRead = async () => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAll: true }),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await refreshNotifications();
  };

  const displayed =
    filter === "unread"
      ? notifications.filter((n) => !n.is_read)
      : notifications;

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="bg-white rounded-xl border border-zinc-200/80 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              filter === "all"
                ? "bg-zinc-900 text-white"
                : "bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            All ({notifications.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("unread")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              filter === "unread"
                ? "bg-zinc-900 text-white"
                : "bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            Unread ({unreadCount})
          </button>
        </div>

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all as read
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-zinc-200/80 overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="py-14 text-center text-xs text-zinc-400">
            <Bell className="h-6 w-6 text-zinc-300 mx-auto mb-2" />
            No notifications to display.
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {displayed.map((n) => (
              <div
                key={n.id}
                className={`p-4 sm:p-5 flex items-start justify-between gap-4 transition-colors ${
                  n.is_read ? "bg-white" : "bg-blue-50/25"
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {!n.is_read && (
                      <span className="h-2 w-2 rounded-full bg-blue-600 shrink-0" />
                    )}
                    <h3 className="text-xs font-semibold text-zinc-900">
                      {n.title}
                    </h3>
                  </div>
                  <p className="text-xs text-zinc-600 leading-relaxed">
                    {n.message}
                  </p>
                  <p className="text-[11px] text-zinc-400 pt-0.5">
                    {formatJakartaDate(n.created_at)} ·{" "}
                    {toJakartaTimeString(n.created_at)} WIB
                  </p>
                </div>

                {!n.is_read && (
                  <button
                    type="button"
                    onClick={() => handleMarkRead(n.id)}
                    className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 cursor-pointer"
                  >
                    <Check className="h-3 w-3" />
                    Mark read
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

