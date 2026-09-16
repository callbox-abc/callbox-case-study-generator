import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// This app has no end-user authentication, so there is no session/cookie handling here —
// just a plain server-side client used exclusively inside API routes (never imported by
// client components). Reads/writes go through the RLS policies on `mapping_examples`,
// which are scoped to the anon/authenticated roles rather than a specific user.
export function createClient() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return createSupabaseClient(url, anonKey);
}
