import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  invalidateProfileCache,
  logAuditEvent,
  requireAdmin,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  encodeTeacherColorAvatar,
  extractTeacherColorKey,
  isSuperAdminEmail,
  pickNextAvailablePastelColor,
} from "@/lib/teacher-colors";

const updateAccountSchema = z.object({
  full_name: z.string().min(2).optional(),
  email: z.string().email("Valid email address is required").optional(),
  role: z.enum(["admin", "teacher"]).optional(),
  is_active: z.boolean().optional(),
  password: z
    .string()
    .min(6, "New password must be at least 6 characters")
    .optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const adminProfile = await requireAdmin();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateAccountSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid account update" },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Prevent Admin from deactivating or demoting their own currently logged-in account
    if (id === adminProfile.id) {
      if (data.is_active === false) {
        return NextResponse.json(
          { error: "You cannot deactivate your own currently signed-in account." },
          { status: 400 }
        );
      }
      if (data.role && data.role !== "admin") {
        return NextResponse.json(
          { error: "You cannot change the role of your own account." },
          { status: 400 }
        );
      }
    }

    const admin = createAdminClient();
    const { data: targetUserRes, error: getUserErr } =
      await admin.auth.admin.getUserById(id);

    if (getUserErr || !targetUserRes?.user) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      );
    }

    const existingMeta = targetUserRes.user.user_metadata || {};
    const targetIsSuperAdmin =
      isSuperAdminEmail(targetUserRes.user.email) ||
      existingMeta.is_super_admin === true;

    if (targetIsSuperAdmin) {
      if (data.is_active === false) {
        return NextResponse.json(
          { error: "The Super Admin account cannot be deactivated." },
          { status: 403 }
        );
      }
      if (data.role && data.role !== "admin") {
        return NextResponse.json(
          { error: "The Super Admin role cannot be changed." },
          { status: 403 }
        );
      }
      if (data.password && id !== adminProfile.id) {
        return NextResponse.json(
          { error: "Only the Super Admin can change their own password." },
          { status: 403 }
        );
      }
    }

    const updatedMeta: Record<string, unknown> = { ...existingMeta };

    if (data.full_name !== undefined) {
      updatedMeta.full_name = data.full_name.trim();
    }
    if (data.role !== undefined) {
      updatedMeta.role = data.role;
    }
    if (data.is_active !== undefined) {
      updatedMeta.is_active = data.is_active;
    }

    // Build Supabase Auth Admin update payload
    const authUpdatePayload: {
      user_metadata: Record<string, unknown>;
      email?: string;
      email_confirm?: boolean;
      ban_duration?: string;
      password?: string;
    } = {
      user_metadata: updatedMeta,
    };

    if (
      data.email !== undefined &&
      data.email.trim().toLowerCase() !==
        targetUserRes.user.email?.toLowerCase()
    ) {
      if (targetIsSuperAdmin && id !== adminProfile.id) {
        return NextResponse.json(
          { error: "Only the Super Admin can change their own email." },
          { status: 403 }
        );
      }
      authUpdatePayload.email = data.email.trim().toLowerCase();
      authUpdatePayload.email_confirm = true;
    }

    if (data.is_active !== undefined) {
      // Lock/unlock account at Supabase Auth database level as well
      authUpdatePayload.ban_duration = data.is_active ? "none" : "876000h";
    }
    if (data.password) {
      authUpdatePayload.password = data.password;
    }

    const { error: authUpdateErr } = await admin.auth.admin.updateUserById(
      id,
      authUpdatePayload
    );

    if (authUpdateErr) {
      return NextResponse.json(
        { error: authUpdateErr.message },
        { status: 400 }
      );
    }

    // Update profiles table
    const profileUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (data.full_name !== undefined) {
      profileUpdate.full_name = data.full_name.trim();
    }
    if (data.email !== undefined) {
      profileUpdate.email = data.email.trim().toLowerCase();
    }
    if (data.role !== undefined) {
      profileUpdate.role = data.role;
      if (data.role === "teacher") {
        const { data: currProf } = await admin
          .from("profiles")
          .select("avatar_url")
          .eq("id", id)
          .maybeSingle();
        if (!extractTeacherColorKey(currProf?.avatar_url)) {
          const { data: existingTeacherProfiles } = await admin
            .from("profiles")
            .select("avatar_url")
            .eq("role", "teacher");
          const nextColor = pickNextAvailablePastelColor(
            (existingTeacherProfiles || []).map((p) => p.avatar_url)
          );
          profileUpdate.avatar_url = encodeTeacherColorAvatar(nextColor);
        }
      }
    }

    await admin.from("profiles").update(profileUpdate).eq("id", id);

    // Ensure teacher row exists if switched to teacher, and sync is_active
    const { data: existingTeacher } = await admin
      .from("teachers")
      .select("id, is_active")
      .eq("id", id)
      .maybeSingle();

    if (data.role === "teacher" && !existingTeacher) {
      await admin.from("teachers").insert({
        id,
        is_active: data.is_active ?? true,
      });
    } else if (existingTeacher && data.is_active !== undefined) {
      await admin
        .from("teachers")
        .update({ is_active: data.is_active })
        .eq("id", id);
    }

    const auditAction =
      data.is_active === false
        ? "DEACTIVATE_ACCOUNT"
        : data.is_active === true
        ? "ACTIVATE_ACCOUNT"
        : "UPDATE_ACCOUNT";

    await logAuditEvent({
      userId: adminProfile.id,
      action: auditAction,
      tableName: "profiles",
      recordId: id,
      newData: {
        full_name: data.full_name,
        role: data.role,
        is_active: data.is_active,
        password_reset: Boolean(data.password),
      },
    });

    invalidateProfileCache(id);

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to update account" },
      { status: 500 }
    );
  }
}
