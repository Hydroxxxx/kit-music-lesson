import { NextResponse } from "next/server";
import { invalidateProfileCache } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  invalidateProfileCache();
  return NextResponse.json({ success: true });
}

