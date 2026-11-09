import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  createNotification,
  logAuditEvent,
  requireAdmin,
  requireAuth,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  encodeTeacherColorAvatar,
  extractTeacherColorKey,
  pickNextAvailablePastelColor,
} from "@/lib/teacher-colors";

const createTeacherSchema = z.object({
  full_name: z.string().min(2, "Full name is required"),
  email: z.string().email("Valid email address is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  phone: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  color: z.string().optional(),
  is_active: z.boolean().default(true),
  instrument_ids: z.array(z.string().uuid()).default([]),
});

export async function GET() {
  try {
    await requireAuth();
    const admin = createAdminClient();
    const nowIso = new Date().toISOString();

    const [
      { data: teachersRaw, error: tErr },
      { data: instruments },
      { data: teacherInstruments },
      { data: availability },
      { data: upcomingSchedules },
    ] = await Promise.all([
      admin
        .from("teachers")
        .select(
          "id, phone, bio, is_active, created_at, profile:profiles(id, full_name, email, role, avatar_url, created_at, updated_at)"
        )
        .order("created_at", { ascending: true }),
      admin.from("instruments").select("*").order("name", { ascending: true }),
      admin.from("teacher_instruments").select("teacher_id, instrument_id"),
      admin
        .from("teacher_availability")
        .select("*")
        .order("day_of_week", { ascending: true })
        .order("start_time", { ascending: true }),
      admin
        .from("schedules")
        .select("id, teacher_id, status, start_at")
        .neq("status", "cancelled")
        .gte("start_at", nowIso),
    ]);

    if (tErr) {
      return NextResponse.json({ error: tErr.message }, { status: 400 });
    }

    const instMap = new Map((instruments || []).map((i) => [i.id, i]));
    const upcomingCountMap = new Map<string, number>();

    for (const s of upcomingSchedules || []) {
      upcomingCountMap.set(
        s.teacher_id,
        (upcomingCountMap.get(s.teacher_id) || 0) + 1
      );
    }

    const teachers = (teachersRaw || []).map((t) => {
      const profile = Array.isArray(t.profile) ? t.profile[0] : t.profile;
      const assignedInsts = (teacherInstruments || [])
        .filter((ti) => ti.teacher_id === t.id)
        .map((ti) => instMap.get(ti.instrument_id))
        .filter(Boolean);
      const teacherAvail = (availability || []).filter(
        (a) => a.teacher_id === t.id
      );

      return {
        id: t.id,
        phone: t.phone,
        bio: t.bio,
        is_active: t.is_active,
        created_at: t.created_at,
        profile,
        instruments: assignedInsts,
        availability: teacherAvail,
        upcoming_lessons_count: upcomingCountMap.get(t.id) || 0,
      };
    });

    return NextResponse.json({
      teachers,
      instruments: instruments || [],
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to load teachers" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const adminProfile = await requireAdmin();
    const body = await request.json();
    const parsed = createTeacherSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid teacher data" },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const admin = createAdminClient();

    // 1. Create Supabase Auth user with teacher role
    const { data: authResult, error: authErr } =
      await admin.auth.admin.createUser({
        email: data.email.trim().toLowerCase(),
        password: data.password,
        email_confirm: true,
        user_metadata: {
          full_name: data.full_name.trim(),
          role: "teacher",
        },
      });

    if (authErr || !authResult.user) {
      return NextResponse.json(
        { error: authErr?.message || "Failed to provision teacher account" },
        { status: 400 }
      );
    }

    const userId = authResult.user.id;

    // Pick explicit pastel color or auto-assign next unused pastel color
    let chosenColorKey = extractTeacherColorKey(data.color);
    if (!chosenColorKey) {
      const { data: existingTeacherProfiles } = await admin
        .from("profiles")
        .select("avatar_url")
        .eq("role", "teacher");
      chosenColorKey = pickNextAvailablePastelColor(
        (existingTeacherProfiles || []).map((p) => p.avatar_url)
      );
    }

    // 2. Create Profile record (role strictly 'teacher')
    const { error: profErr } = await admin.from("profiles").upsert({
      id: userId,
      full_name: data.full_name.trim(),
      email: data.email.trim().toLowerCase(),
      role: "teacher",
      avatar_url: encodeTeacherColorAvatar(chosenColorKey),
    });

    if (profErr) {
      await admin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    // 3. Create Teacher record
    const { error: teacherErr } = await admin.from("teachers").upsert({
      id: userId,
      phone: data.phone ?? null,
      bio: data.bio ?? null,
      is_active: data.is_active,
    });

    if (teacherErr) {
      return NextResponse.json({ error: teacherErr.message }, { status: 400 });
    }

    // 4. Assign Instruments
    if (data.instrument_ids.length > 0) {
      const tiRows = data.instrument_ids.map((instrumentId) => ({
        teacher_id: userId,
        instrument_id: instrumentId,
      }));
      await admin.from("teacher_instruments").insert(tiRows);
    }

    // 5. Create default Mon-Sat 09:00-18:00 availability slots
    const defaultAvail = [1, 2, 3, 4, 5, 6].map((dow) => ({
      teacher_id: userId,
      day_of_week: dow,
      start_time: "09:00:00",
      end_time: "18:00:00",
      is_available: true,
    }));
    await admin.from("teacher_availability").insert(defaultAvail);

    await createNotification({
      userId,
      title: "Welcome to KitMusicLesson",
      message: `Your teacher account has been created by ${adminProfile.full_name}. You can now view your weekly schedule and manage availability.`,
    });

    await logAuditEvent({
      userId: adminProfile.id,
      action: "CREATE_TEACHER",
      tableName: "teachers",
      recordId: userId,
      newData: {
        full_name: data.full_name,
        email: data.email,
        instrument_ids: data.instrument_ids,
      },
    });

    return NextResponse.json({ id: userId, success: true }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to create teacher" },
      { status: 500 }
    );
  }
}

