import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, logAuditEvent, requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const updateStudentSchema = z.object({
  full_name: z.string().min(2).optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().or(z.literal("")).nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAuth();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateStudentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid student update" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // If actor is a teacher, verify they teach this student
    if (actor.role !== "admin") {
      const { data: taughtSchedules } = await admin
        .from("schedules")
        .select("id")
        .eq("student_id", id)
        .eq("teacher_id", actor.id)
        .limit(1);

      if (!taughtSchedules || taughtSchedules.length === 0) {
        return NextResponse.json(
          { error: "Teachers can only edit students they teach." },
          { status: 403 }
        );
      }
    }

    const updates: Record<string, unknown> = {};
    const d = parsed.data;

    if (d.full_name !== undefined) updates.full_name = d.full_name.trim();
    if (d.phone !== undefined) updates.phone = d.phone?.trim() || null;
    if (d.email !== undefined) updates.email = d.email?.trim() || null;
    if (d.notes !== undefined) updates.notes = d.notes?.trim() || null;
    if (d.is_active !== undefined && actor.role === "admin") {
      updates.is_active = d.is_active;
    }

    const { data: student, error } = await admin
      .from("students")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await logAuditEvent({
      userId: actor.id,
      action: "UPDATE_STUDENT",
      tableName: "students",
      recordId: id,
      newData: updates,
    });

    return NextResponse.json({ student });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to update student" },
      { status: 500 }
    );
  }
}

