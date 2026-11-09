import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  logAuditEvent,
  requireAdmin,
  requireAuth,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const createRoomSchema = z.object({
  name: z.string().min(1, "Room name is required"),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

export async function GET() {
  try {
    await requireAuth();
    const admin = createAdminClient();
    const nowIso = new Date().toISOString();

    const [{ data: rooms, error }, { data: upcomingSchedules }] =
      await Promise.all([
        admin.from("rooms").select("*").order("name", { ascending: true }),
        admin
          .from("schedules")
          .select("id, room_id, status, start_at")
          .eq("status", "confirmed")
          .gte("start_at", nowIso),
      ]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const roomCountMap = new Map<string, number>();
    for (const s of upcomingSchedules || []) {
      roomCountMap.set(s.room_id, (roomCountMap.get(s.room_id) || 0) + 1);
    }

    const enriched = (rooms || []).map((r) => ({
      ...r,
      upcoming_lessons_count: roomCountMap.get(r.id) || 0,
    }));

    return NextResponse.json({ rooms: enriched });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to load rooms" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const adminProfile = await requireAdmin();
    const body = await request.json();
    const parsed = createRoomSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid room data" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: room, error } = await admin
      .from("rooms")
      .insert({
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() || null,
        is_active: parsed.data.is_active,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await logAuditEvent({
      userId: adminProfile.id,
      action: "CREATE_ROOM",
      tableName: "rooms",
      recordId: room.id,
      newData: room,
    });

    return NextResponse.json({ room }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to create room" },
      { status: 500 }
    );
  }
}

