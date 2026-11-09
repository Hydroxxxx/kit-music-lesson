import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const markReadSchema = z.object({
  id: z.string().uuid().optional(),
  markAll: z.boolean().optional(),
});

export async function GET() {
  try {
    const profile = await requireAuth();
    const admin = createAdminClient();

    const { data: notifications, error } = await admin
      .from("notifications")
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const unreadCount = (notifications || []).filter((n) => !n.is_read).length;

    return NextResponse.json({
      notifications: notifications || [],
      unreadCount,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to load notifications" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const profile = await requireAuth();
    const body = await request.json();
    const parsed = markReadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid notification update payload" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    if (parsed.data.markAll) {
      await admin
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", profile.id)
        .eq("is_read", false);
    } else if (parsed.data.id) {
      await admin
        .from("notifications")
        .update({ is_read: true })
        .eq("id", parsed.data.id)
        .eq("user_id", profile.id);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to update notifications" },
      { status: 500 }
    );
  }
}

