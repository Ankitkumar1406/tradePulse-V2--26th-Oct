import { NextResponse } from "next/server";
import { supabaseEnabled } from "@/lib/supabase";

// GET /api/auth/config — lets the login dialog tailor its UI (e.g. hide the
// one-tap demo accounts once real Supabase credentials are configured).
export async function GET() {
  return NextResponse.json({ supabase: supabaseEnabled });
}
