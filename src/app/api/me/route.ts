import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  invalidateProfileCache,
  logAuditEvent,
  requireAuth,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const updateProfileSchema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters").optional(),
  email: z.string().email("Valid email address is required").optional(),
  phone: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
});

export async function GET() {
  try {
    const profile = await requireAuth();
    const admin = createAdminClient();

    const [{ data: teacher }, { count: unreadCount }] = await Promise.all([
      admin.from("teachers").select("*").eq("id", profile.id).maybeSingle(),
      admin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile.id)
        .eq("is_read", false),
    ]);

    return NextResponse.json({
      profile,
      teacher: teacher ?? null,
      unreadNotifications: unreadCount ?? 0,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to load user profile" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const profile = await requireAuth();
    const body = await request.json();
    const parsed = updateProfileSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { full_name, email, avatar_url, phone, bio } = parsed.data;

    if (
      email !== undefined &&
      email.trim().toLowerCase() !== profile.email?.toLowerCase()
    ) {
      const cleanEmail = email.trim().toLowerCase();
      const { error: authErr } = await admin.auth.admin.updateUserById(
        profile.id,
        {
          email: cleanEmail,
          email_confirm: true,
        }
      );
      if (authErr) {
        return NextResponse.json({ error: authErr.message }, { status: 400 });
      }
    }

    if (
      full_name !== undefined ||
      email !== undefined ||
      avatar_url !== undefined
    ) {
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (full_name !== undefined) updates.full_name = full_name.trim();
      if (email !== undefined) updates.email = email.trim().toLowerCase();
      if (avatar_url !== undefined) updates.avatar_url = avatar_url;

      const { error: profErr } = await admin
        .from("profiles")
        .update(updates)
        .eq("id", profile.id);

      if (profErr) {
        return NextResponse.json({ error: profErr.message }, { status: 400 });
      }
    }

    if (phone !== undefined || bio !== undefined) {
      const { data: existingTeacher } = await admin
        .from("teachers")
        .select("id")
        .eq("id", profile.id)
        .maybeSingle();

      if (existingTeacher) {
        const teacherUpdates: Record<string, unknown> = {};
        if (phone !== undefined) teacherUpdates.phone = phone;
        if (bio !== undefined) teacherUpdates.bio = bio;

        await admin
          .from("teachers")
          .update(teacherUpdates)
          .eq("id", profile.id);
      }
    }

    await logAuditEvent({
      userId: profile.id,
      action: "UPDATE_OWN_PROFILE",
      tableName: "profiles",
      recordId: profile.id,
      newData: parsed.data,
    });

    const { data: updatedProfile } = await admin
      .from("profiles")
      .select("*")
      .eq("id", profile.id)
      .single();

    invalidateProfileCache(profile.id);

    return NextResponse.json({ profile: updatedProfile });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}

