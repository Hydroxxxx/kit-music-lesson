import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  logAuditEvent,
  requireAdmin,
  requireAuth,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const createInstrumentSchema = z.object({
  name: z.string().min(1, "Instrument name is required"),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  teacher_ids: z.array(z.string().uuid()).optional(),
});

export async function GET() {
  try {
    await requireAuth();
    const admin = createAdminClient();

    const [
      { data: instruments, error },
      { data: teacherInstruments },
      { data: teachersRaw },
    ] = await Promise.all([
      admin.from("instruments").select("*").order("name", { ascending: true }),
      admin.from("teacher_instruments").select("teacher_id, instrument_id"),
      admin
        .from("teachers")
        .select("id, is_active, profile:profiles(id, full_name, email)"),
    ]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const teacherMap = new Map(
      (teachersRaw || []).map((t) => {
        const prof = Array.isArray(t.profile) ? t.profile[0] : t.profile;
        return [
          t.id,
          {
            id: t.id,
            is_active: t.is_active,
            full_name: prof?.full_name || "Teacher",
            email: prof?.email || null,
          },
        ];
      })
    );

    const enriched = (instruments || []).map((inst) => {
      const assignedTeachers = (teacherInstruments || [])
        .filter((ti) => ti.instrument_id === inst.id)
        .map((ti) => teacherMap.get(ti.teacher_id))
        .filter(Boolean);

      return {
        ...inst,
        teachers: assignedTeachers,
      };
    });

    return NextResponse.json({
      instruments: enriched,
      allTeachers: Array.from(teacherMap.values()),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to load instruments" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const adminProfile = await requireAdmin();
    const body = await request.json();
    const parsed = createInstrumentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid instrument data" },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const admin = createAdminClient();

    const { data: instrument, error } = await admin
      .from("instruments")
      .insert({
        name: data.name.trim(),
        description: data.description?.trim() || null,
        is_active: data.is_active,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (data.teacher_ids && data.teacher_ids.length > 0) {
      const rows = data.teacher_ids.map((tid) => ({
        teacher_id: tid,
        instrument_id: instrument.id,
      }));
      await admin.from("teacher_instruments").insert(rows);
    }

    await logAuditEvent({
      userId: adminProfile.id,
      action: "CREATE_INSTRUMENT",
      tableName: "instruments",
      recordId: instrument.id,
      newData: instrument,
    });

    return NextResponse.json({ instrument }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to create instrument" },
      { status: 500 }
    );
  }
}

