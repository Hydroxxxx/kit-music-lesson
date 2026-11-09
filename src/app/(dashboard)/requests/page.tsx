"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Ban,
  ArrowRight,
  Clock,
  Loader2,
  AlertCircle,
  X,
} from "lucide-react";
import { useCurrentUser } from "@/components/layout/AppShell";
import {
  broadcastRealtimeSync,
  getCachedApiData,
  setCachedApiData,
  useRealtimeSubscription,
} from "@/lib/realtime";
import {
  formatJakartaDate,
  formatJakartaTimeRange,
  toJakartaTimeString,
} from "@/lib/timezone";
import type { ScheduleRequestWithDetails } from "@/types/database";

export default function ScheduleRequestsPage() {
  const { profile, refreshNotifications } = useCurrentUser();
  const isAdmin = profile.role === "admin";

  const [requests, setRequests] = useState<ScheduleRequestWithDetails[]>(
    () => getCachedApiData<ScheduleRequestWithDetails[]>("/api/requests") ?? []
  );
  const [loading, setLoading] = useState(
    () => !getCachedApiData<ScheduleRequestWithDetails[]>("/api/requests")
  );
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/requests", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setCachedApiData("/api/requests", data.requests || []);
      setRequests(data.requests || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useRealtimeSubscription(() => {
    loadRequests();
  }, "requests-page");

  const filteredRequests = useMemo(() => {
    if (statusFilter === "all") return requests;
    return requests.filter((r) => r.status === statusFilter);
  }, [requests, statusFilter]);

  const handleAction = async (
    requestId: string,
    status: "approved" | "rejected" | "cancelled"
  ) => {
    setProcessingId(requestId);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMessage(json.error || "Failed to process schedule request");
        return;
      }

      setToast(
        status === "approved"
          ? "Schedule change request approved and original schedule updated."
          : status === "rejected"
          ? "Schedule change request rejected."
          : "Request cancelled."
      );
      await loadRequests();
      await refreshNotifications();
      await broadcastRealtimeSync("request_changed", { requestId, status });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
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

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-zinc-200/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {["all", "pending", "approved", "rejected", "cancelled"].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                statusFilter === st
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <span className="text-xs text-zinc-500">
          {isAdmin
            ? "Approving a request automatically verifies room/teacher availability and updates the calendar."
            : "Submit new requests directly by clicking any of your lessons on the Weekly Schedule."}
        </span>
      </div>

      {errorMessage && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-4 text-xs text-red-700">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Requests List */}
      <div className="space-y-3">
        {loading ? (
          <div className="bg-white rounded-xl border border-zinc-200/80 py-16 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="bg-white rounded-xl border border-zinc-200/80 py-14 text-center text-xs text-zinc-400">
            No schedule change requests found.
          </div>
        ) : (
          filteredRequests.map((req) => {
            const sched = req.schedule;
            return (
              <div
                key={req.id}
                className="bg-white rounded-xl border border-zinc-200/80 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-5"
              >
                <div className="space-y-2.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        req.status === "pending"
                          ? "bg-amber-50 text-amber-700"
                          : req.status === "approved"
                          ? "bg-emerald-50 text-emerald-700"
                          : req.status === "rejected"
                          ? "bg-red-50 text-red-700"
                          : "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {req.status}
                    </span>

                    <span className="text-xs font-semibold text-zinc-900">
                      {sched?.instrument?.name || "Music Lesson"} — Student:{" "}
                      {sched?.student?.full_name || "Unknown"}
                    </span>

                    <span className="text-xs text-zinc-400">·</span>

                    <span className="text-xs text-zinc-600">
                      Requested by {req.requester?.full_name || "Teacher"}
                    </span>

                    <span className="text-xs text-zinc-400">·</span>

                    <span className="text-xs text-zinc-500">
                      {sched?.room?.name}
                    </span>
                  </div>

                  {/* Current vs Proposed Time Comparison */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 text-xs pt-1">
                    {sched && (
                      <div className="rounded-lg bg-zinc-50 border border-zinc-200/70 px-3 py-2">
                        <span className="text-[10px] font-semibold uppercase text-zinc-400 block">
                          Original Schedule
                        </span>
                        <span className="font-medium text-zinc-700">
                          {formatJakartaDate(sched.start_at)} (
                          {formatJakartaTimeRange(
                            sched.start_at,
                            sched.end_at
                          )}
                          )
                        </span>
                      </div>
                    )}

                    <ArrowRight className="hidden sm:block h-4 w-4 text-zinc-400 shrink-0" />

                    <div className="rounded-lg bg-blue-50/50 border border-blue-200/70 px-3 py-2">
                      <span className="text-[10px] font-semibold uppercase text-blue-600 block">
                        Proposed New Time (WIB)
                      </span>
                      <span className="font-semibold text-zinc-900">
                        {formatJakartaDate(req.proposed_start_at)} (
                        {formatJakartaTimeRange(
                          req.proposed_start_at,
                          req.proposed_end_at
                        )}
                        )
                      </span>
                    </div>
                  </div>

                  {req.reason && (
                    <p className="text-xs text-zinc-600 bg-zinc-50/70 rounded-lg px-3 py-2 border border-zinc-100">
                      <span className="font-medium text-zinc-700">Reason:</span>{" "}
                      {req.reason}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Submitted {formatJakartaDate(req.created_at)} at{" "}
                      {toJakartaTimeString(req.created_at)} WIB
                    </span>
                    {req.reviewed_at && (
                      <span>
                        · Reviewed by {req.reviewer?.full_name || "Admin"} on{" "}
                        {formatJakartaDate(req.reviewed_at)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                {req.status === "pending" && (
                  <div className="flex items-center gap-2 shrink-0">
                    {isAdmin ? (
                      <>
                        <button
                          type="button"
                          disabled={processingId === req.id}
                          onClick={() => handleAction(req.id, "approved")}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                        >
                          {processingId === req.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          Approve & Reschedule
                        </button>
                        <button
                          type="button"
                          disabled={processingId === req.id}
                          onClick={() => handleAction(req.id, "rejected")}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer"
                        >
                          <XCircle className="h-3.5 w-3.5 text-zinc-400" />
                          Reject
                        </button>
                      </>
                    ) : (
                      req.requested_by === profile.id && (
                        <button
                          type="button"
                          disabled={processingId === req.id}
                          onClick={() => handleAction(req.id, "cancelled")}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer"
                        >
                          <Ban className="h-3.5 w-3.5 text-zinc-400" />
                          Withdraw Request
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

