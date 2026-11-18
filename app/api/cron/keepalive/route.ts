import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cronJob";
import { createServiceClient } from "@/lib/supabase/server";

// Daily (vercel.json): one tiny read of app_cache so the free-plan Supabase project never pauses
// for inactivity before the Monday job. Touches Supabase only, never CallboxOne or HubSpot.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });
  const { error } = await db.from("app_cache").select("key").limit(1);
  if (error) return NextResponse.json({ error: `Supabase: ${error.message}` }, { status: 502 });
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
