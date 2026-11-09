import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  createNotification,
  logAuditEvent,
  requireAdmin,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  encodeTeacherColorAvatar,
  isSuperAdminEmail,
  pickNextAvailablePastelColor,
} from "@/lib/teacher-colors";

const createAccountSchema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["admin", "teacher"]).default("teacher"),
  phone: z.string().trim().nullable().optional(),
});

function isUserBanned(bannedUntil?: string | null): boolean {
  if (!bannedUntil) return false;
  const ts = new Date(bannedUntil).getTime();
  return !Number.isNaN(ts) && ts > Date.now();
}

export async function GET() {
  try {
    await requireAdmin();
    const admin = createAdminClient();

    const [
      { data: authList, error: authErr },
      { data: profiles },
      { data: teachers },
    ] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false }),
      admin.from("teachers").select("id, phone, is_active"),
    ]);

    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: 400 });
    }

    const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
    const teacherMap = new Map((teachers || []).map((t) => [t.id, t]));

    const accounts = (authList?.users || [])
      .map((u) => {
        const prof = profileMap.get(u.id);
        const teacher = teacherMap.get(u.id);
        const role =
          prof?.role ||
          (u.user_metadata?.role === "admin" ? "admin" : "teacher");

        const banned = isUserBanned(u.banned_until);
        const metaInactive = u.user_metadata?.is_active === false;
        const teacherInactive =
          role === "teacher" && teacher ? teacher.is_active === false : false;

        const isActive = !banned && !metaInactive && !teacherInactive;

        const emailVal = u.email || prof?.email || "";
        const isSuperAdmin =
          isSuperAdminEmail(emailVal) ||
          u.user_metadata?.is_super_admin === true;

        return {
          id: u.id,
          full_name:
            prof?.full_name ||
            u.user_metadata?.full_name ||
            u.email?.split("@")[0] ||
            "User",
          email: emailVal,
          role,
          is_super_admin: isSuperAdmin,
          phone: teacher?.phone || null,
          is_active: isSuperAdmin ? true : isActive,
          created_at: prof?.created_at || u.created_at,
          last_sign_in_at: u.last_sign_in_at || null,
          registration_source:
            (u.user_metadata?.registration_source as string | undefined) ||
            "admin_provisioned",
        };
      })
      .sort((a, b) => {
        if (a.is_super_admin && !b.is_super_admin) return -1;
        if (!a.is_super_admin && b.is_super_admin) return 1;
        return (
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      });

    return NextResponse.json({ accounts });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to load accounts" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const adminProfile = await requireAdmin();
    const body = await request.json();
    const parsed = createAccountSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid account data" },
        { status: 400 }
      );
    }

    const { full_name, email, password, role, phone } = parsed.data;
    const admin = createAdminClient();

    const { data: authResult, error: authErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: full_name.trim(),
          role,
          is_active: true,
          registration_source: "admin_provisioned",
        },
      });

    if (authErr || !authResult.user) {
      return NextResponse.json(
        { error: authErr?.message || "Failed to create account" },
        { status: 400 }
      );
    }

    const userId = authResult.user.id;

    let avatarUrl: string | null = null;
    if (role === "teacher") {
      const { data: existingTeacherProfiles } = await admin
        .from("profiles")
        .select("avatar_url")
        .eq("role", "teacher");
      const nextColor = pickNextAvailablePastelColor(
        (existingTeacherProfiles || []).map((p) => p.avatar_url)
      );
      avatarUrl = encodeTeacherColorAvatar(nextColor);
    }

    const { error: profErr } = await admin.from("profiles").upsert({
      id: userId,
      full_name: full_name.trim(),
      email,
      role,
      avatar_url: avatarUrl,
    });

    if (profErr) {
      await admin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    if (role === "teacher") {
      await admin.from("teachers").upsert({
        id: userId,
        phone: phone || null,
        bio: null,
        is_active: true,
      });

      const defaultAvail = [1, 2, 3, 4, 5, 6].map((dow) => ({
        teacher_id: userId,
        day_of_week: dow,
        start_time: "09:00:00",
        end_time: "18:00:00",
        is_available: true,
      }));
      await admin.from("teacher_availability").insert(defaultAvail);
    }

    await createNotification({
      userId,
      title: "KitMusicLesson Account Created",
      message: `Your account has been created by an Administrator (${adminProfile.full_name}) with the ${role.toUpperCase()} role.`,
    });

    await logAuditEvent({
      userId: adminProfile.id,
      action: "ADMIN_CREATE_ACCOUNT",
      tableName: "profiles",
      recordId: userId,
      newData: { full_name: full_name.trim(), email, role },
    });

    return NextResponse.json({ success: true, id: userId }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to create new account" },
      { status: 500 }
    );
  }
}
