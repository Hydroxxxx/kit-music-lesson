import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, logAuditEvent, requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const updateRoomSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const adminProfile = await requireAdmin();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateRoomSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid room data" },
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

    const { data: room, error } = await admin
      .from("rooms")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await logAuditEvent({
      userId: adminProfile.id,
      action: "UPDATE_ROOM",
      tableName: "rooms",
      recordId: id,
      newData: updates,
    });

    return NextResponse.json({ room });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to update room" },
      { status: 500 }
    );
  }
}

