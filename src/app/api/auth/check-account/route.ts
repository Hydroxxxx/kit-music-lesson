import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json(
        { active: false, reason: "unauthenticated" },
        { status: 401 }
      );
    }

    if (user.user_metadata?.is_active === false) {
      await supabase.auth.signOut();
      return NextResponse.json(
        {
          active: false,
          error:
            "Your account has been deactivated by an Administrator. Please contact an Admin.",
        },
        { status: 403 }
      );
    }

    const admin = createAdminClient();
    const [{ data: profile }, { data: teacher }] = await Promise.all([
      admin.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      admin
        .from("teachers")
        .select("is_active")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

    if (profile?.role === "teacher" && teacher && teacher.is_active === false) {
      await supabase.auth.signOut();
      return NextResponse.json(
        {
          active: false,
          error:
            "Your account has been deactivated by an Administrator. Please contact an Admin.",
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      active: true,
      role: profile?.role || "teacher",
    });
  } catch {
    return NextResponse.json(
      { active: false, error: "Failed to verify account status" },
      { status: 500 }
    );
  }
}
