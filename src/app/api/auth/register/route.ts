import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Self-registration is disabled. New accounts must be created manually by an Administrator.",
    },
    { status: 403 }
  );
}
