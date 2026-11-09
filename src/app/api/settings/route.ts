import { NextResponse } from "next/server";
import { AuthError, requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const profile = await requireAuth();
    const admin = createAdminClient();

    const [{ data: teacher }, { data: availability }, { data: instruments }] =
      await Promise.all([
        admin.from("teachers").select("*").eq("id", profile.id).maybeSingle(),
        admin
          .from("teacher_availability")
          .select("*")
          .eq("teacher_id", profile.id)
          .order("day_of_week", { ascending: true }),
        admin
          .from("teacher_instruments")
          .select("instrument:instruments(id, name)")
          .eq("teacher_id", profile.id),
      ]);

    let auditLogs: unknown[] = [];
    if (profile.role === "admin") {
      const { data: logsRaw } = await admin
        .from("audit_logs")
        .select(
          "id, user_id, action, table_name, record_id, old_data, new_data, created_at, user:profiles(id, full_name, email, role)"
        )
        .order("created_at", { ascending: false })
        .limit(50);

      auditLogs = (logsRaw || []).map((l) => ({
        ...l,
        user: Array.isArray(l.user) ? l.user[0] : l.user,
      }));
    }

    return NextResponse.json({
      profile,
      teacher: teacher ?? null,
      availability: availability || [],
      instruments: (instruments || [])
        .map((r) => (Array.isArray(r.instrument) ? r.instrument[0] : r.instrument))
        .filter(Boolean),
      auditLogs,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to load settings" },
      { status: 500 }
    );
  }
}

