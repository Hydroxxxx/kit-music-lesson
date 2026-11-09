import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, logAuditEvent, requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const updateInstrumentSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  teacher_ids: z.array(z.string().uuid()).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const adminProfile = await requireAdmin();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateInstrumentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid instrument data" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const d = parsed.data;
    const updates: Record<string, unknown> = {};

    if (d.name !== undefined) updates.name = d.name.trim();
    if (d.description !== undefined)
      updates.description = d.description?.trim() || null;
    if (d.is_active !== undefined) updates.is_active = d.is_active;

    if (Object.keys(updates).length > 0) {
      const { error } = await admin
        .from("instruments")
        .update(updates)
        .eq("id", id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    if (d.teacher_ids !== undefined) {
      await admin.from("teacher_instruments").delete().eq("instrument_id", id);
      if (d.teacher_ids.length > 0) {
        const rows = d.teacher_ids.map((tid) => ({
          teacher_id: tid,
          instrument_id: id,
        }));
        const { error: tiErr } = await admin
          .from("teacher_instruments")
          .insert(rows);
        if (tiErr) {
          return NextResponse.json({ error: tiErr.message }, { status: 400 });
        }
      }
    }

    await logAuditEvent({
      userId: adminProfile.id,
      action: "UPDATE_INSTRUMENT",
      tableName: "instruments",
      recordId: id,
      newData: d as Record<string, unknown>,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to update instrument" },
      { status: 500 }
    );
  }
}

