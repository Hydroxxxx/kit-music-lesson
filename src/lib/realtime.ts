"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type RealtimeSyncEvent =
  | "schedule_changed"
  | "request_changed"
  | "notification_changed"
  | "data_changed";

const SYNC_CHANNEL_NAME = "kitmusiclesson-realtime-sync";

// Singleton listener registry so page navigations don't open/close new WebSockets
const listeners = new Set<(event?: string) => void>();
let sharedChannel: RealtimeChannel | null = null;

// Client-side in-memory GET response cache for instant 0ms menu switching
interface ClientCacheEntry {
  data: unknown;
  timestamp: number;
}
const clientApiCache = new Map<string, ClientCacheEntry>();

export function clearClientApiCache() {
  clientApiCache.clear();
}

export function getCachedApiData<T>(url: string): T | null {
  const entry = clientApiCache.get(url);
  return entry ? (entry.data as T) : null;
}

export function setCachedApiData(url: string, data: unknown) {
  clientApiCache.set(url, { data, timestamp: Date.now() });
}

function notifyAllLocalListeners(eventName: string) {
  clearClientApiCache();
  for (const cb of listeners) {
    try {
      cb(eventName);
    } catch {
      // Ignore individual listener errors
    }
  }
}

function ensureSharedChannel() {
  if (typeof window === "undefined" || sharedChannel) return;

  const supabase = createClient();
  sharedChannel = supabase
    .channel(SYNC_CHANNEL_NAME)
    .on(
      "broadcast",
      { event: "sync" },
      (msg: { payload?: { event?: string } }) => {
        notifyAllLocalListeners(msg.payload?.event || "broadcast");
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "schedules" },
      () => notifyAllLocalListeners("schedules")
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "schedule_requests" },
      () => notifyAllLocalListeners("schedule_requests")
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notifications" },
      () => notifyAllLocalListeners("notifications")
    )
    .subscribe();
}

/**
 * Broadcasts a realtime update to all connected clients via the shared Supabase channel
 * and notifies all active local listeners immediately.
 */
export async function broadcastRealtimeSync(
  event: RealtimeSyncEvent = "data_changed",
  payload: Record<string, unknown> = {}
) {
  notifyAllLocalListeners(event);

  try {
    ensureSharedChannel();
    if (sharedChannel) {
      await sharedChannel.send({
        type: "broadcast",
        event: "sync",
        payload: { event, ...payload, timestamp: Date.now() },
      });
    }
  } catch {
    // Ignore transient network errors
  }
}

/**
 * React hook that subscribes to the shared realtime channel in 0ms without
 * creating/destroying WebSocket connections when navigating between pages.
 */
export function useRealtimeSubscription(
  onUpdate: (event?: string) => void,
  _channelKey = "default"
) {
  const callbackRef = useRef(onUpdate);
  useEffect(() => {
    callbackRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    ensureSharedChannel();
    const handler = (evt?: string) => {
      callbackRef.current(evt);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, [_channelKey]);
}
