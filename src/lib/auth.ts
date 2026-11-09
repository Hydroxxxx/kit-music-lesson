import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/types/database";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

interface CachedProfileEntry {
  profile: Profile | null;
  expiresAt: number;
}

// Short-lived server memory cache (30s TTL) so switching menus & API calls
// don't make 3 sequential remote round-trips to Supabase on every click.
const PROFILE_CACHE_TTL_MS = 30_000;
const profileMemoryCache = new Map<string, CachedProfileEntry>();

export function invalidateProfileCache(userId?: string) {
  if (userId) {
    profileMemoryCache.delete(userId);
  } else {
    profileMemoryCache.clear();
  }
}

export const getCurrentUserProfile = cache(
  async (): Promise<Profile | null> => {
    try {
      const supabase = await createServerSupabaseClient();

      // Fast local session read (0ms) instead of slow remote auth.getUser() network call
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const user = session?.user;
      if (!user) {
        return null;
      }

      if (user.user_metadata?.is_active === false) {
        invalidateProfileCache(user.id);
        return null;
      }

      const now = Date.now();
      const cached = profileMemoryCache.get(user.id);
      if (cached && cached.expiresAt > now) {
        return cached.profile;
      }

      const admin = createAdminClient();
      // Fetch profile and teacher status in a single parallel round-trip
      const [{ data: profile }, { data: teacherRow }] = await Promise.all([
        admin.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        admin
          .from("teachers")
          .select("is_active")
          .eq("id", user.id)
          .maybeSingle(),
      ]);

      if (profile) {
        if (
          profile.role === "teacher" &&
          teacherRow &&
          teacherRow.is_active === false
        ) {
          profileMemoryCache.set(user.id, {
            profile: null,
            expiresAt: now + 5_000,
          });
          return null;
        }

        const typedProfile = profile as Profile;
        profileMemoryCache.set(user.id, {
          profile: typedProfile,
          expiresAt: now + PROFILE_CACHE_TTL_MS,
        });
        return typedProfile;
      }

      // Fallback: create profile if auth user exists but profile row is missing
      const fallbackRole =
        user.user_metadata?.role === "admin" ? "admin" : "teacher";
      const fallbackName =
        user.user_metadata?.full_name ||
        user.email?.split("@")[0] ||
        "Music Teacher";

      const { data: createdProfile } = await admin
        .from("profiles")
        .upsert({
          id: user.id,
          full_name: fallbackName,
          email: user.email ?? null,
          role: fallbackRole,
        })
        .select("*")
        .single();

      const result = (createdProfile as Profile) ?? null;
      if (result) {
        profileMemoryCache.set(user.id, {
          profile: result,
          expiresAt: now + PROFILE_CACHE_TTL_MS,
        });
      }
      return result;
    } catch {
      return null;
    }
  }
);

export async function requireAuth(): Promise<Profile> {
  const profile = await getCurrentUserProfile();
  if (!profile) {
    throw new AuthError("Authentication required. Please log in.", 401);
  }
  return profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireAuth();
  if (profile.role !== "admin") {
    throw new AuthError(
      "Forbidden. Administrator permissions are required for this action.",
      403
    );
  }
  return profile;
}

export async function logAuditEvent(params: {
  userId: string | null;
  action: string;
  tableName: string;
  recordId?: string | null;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
}) {
  try {
    const admin = createAdminClient();
    await admin.from("audit_logs").insert({
      user_id: params.userId,
      action: params.action,
      table_name: params.tableName,
      record_id: params.recordId ?? null,
      old_data: params.oldData ?? null,
      new_data: params.newData ?? null,
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

export async function createNotification(params: {
  userId: string;
  title: string;
  message: string;
}) {
  try {
    const admin = createAdminClient();
    await admin.from("notifications").insert({
      user_id: params.userId,
      title: params.title,
      message: params.message,
      is_read: false,
    });
  } catch (err) {
    console.error("Failed to create notification:", err);
  }
}

export async function notifyAllAdmins(params: {
  title: string;
  message: string;
  excludeUserId?: string;
}) {
  try {
    const admin = createAdminClient();
    const { data: admins } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "admin");

    if (!admins || admins.length === 0) return;

    const rows = admins
      .filter((a) => a.id !== params.excludeUserId)
      .map((a) => ({
        user_id: a.id,
        title: params.title,
        message: params.message,
        is_read: false,
      }));

    if (rows.length > 0) {
      await admin.from("notifications").insert(rows);
    }
  } catch (err) {
    console.error("Failed to notify admins:", err);
  }
}
