import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  logAuditEvent,
  requireAdmin,
  requireAuth,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeScheduleRow, SCHEDULE_DETAIL_SELECT } from "@/lib/scheduling";

const createStudentSchema = z.object({
  full_name: z.string().min(2, "Student full name is required"),
  phone: z.string().nullable().optional(),
  email: z.string().email("Invalid email").or(z.literal("")).nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

export async function GET() {
  try {
    const profile = await requireAuth();
    const admin = createAdminClient();
    const nowIso = new Date().toISOString();

    const [{ data: students, error }, { data: schedulesRaw }] =
      await Promise.all([
        admin
          .from("students")
          .select("*")
          .order("full_name", { ascending: true }),
        admin
          .from("schedules")
          .select(SCHEDULE_DETAIL_SELECT)
          .order("start_at", { ascending: false }),
      ]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const schedules = (schedulesRaw || []).map((r) =>
      normalizeScheduleRow(r as Record<string, unknown>)
    ) as Array<Record<string, unknown>>;

    const enrichedStudents = (students || []).map((s) => {
      const stuSchedules = schedules.filter((sch) => sch.student_id === s.id);
      const activeSchedules = stuSchedules.filter(
        (sch) => sch.status !== "cancelled"
      );
      const upcomingSchedules = activeSchedules.filter(
        (sch) => (sch.start_at as string) >= nowIso
      );

      const instMap = new Map<string, { id: string; name: string }>();
      const teacherMap = new Map<string, { id: string; full_name: string }>();

      for (const sch of activeSchedules) {
        const inst = sch.instrument as { id: string; name: string } | null;
        if (inst?.id) {
          instMap.set(inst.id, { id: inst.id, name: inst.name });
        }
        const t = sch.teacher as {
          id: string;
          profile?: { full_name?: string };
        } | null;
        if (t?.id && t.profile?.full_name) {
          teacherMap.set(t.id, { id: t.id, full_name: t.profile.full_name });
        }
      }

      // Teachers only see contact info if they teach the student or if admin
      const isAssignedTeacher = teacherMap.has(profile.id);
      const canSeePrivateContact =
        profile.role === "admin" || isAssignedTeacher;

      return {
        ...s,
        phone: canSeePrivateContact ? s.phone : s.phone ? "Protected" : null,
        email: canSeePrivateContact ? s.email : s.email ? "Protected" : null,
        enrolled_instruments: Array.from(instMap.values()),
        assigned_teachers: Array.from(teacherMap.values()),
        upcoming_lessons_count: upcomingSchedules.length,
        total_lessons_count: activeSchedules.length,
        schedules: stuSchedules.slice(0, 25),
      };
    });

    return NextResponse.json({ students: enrichedStudents });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to load students" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const adminProfile = await requireAdmin();
    const body = await request.json();
    const parsed = createStudentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid student data" },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const admin = createAdminClient();

    const { data: student, error } = await admin
      .from("students")
      .insert({
        full_name: data.full_name.trim(),
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        notes: data.notes?.trim() || null,
        is_active: data.is_active,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await logAuditEvent({
      userId: adminProfile.id,
      action: "CREATE_STUDENT",
      tableName: "students",
      recordId: student.id,
      newData: student,
    });

    return NextResponse.json({ student }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to create student" },
      { status: 500 }
    );
  }
}

