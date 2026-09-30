import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Supabase integration — login (Supabase Auth, email + password) and the
// user login & profile database (public.profiles table in Supabase Postgres).
//
// Enabled when NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY are
// set. Without them TradePulse runs the identical UX against the local
// SQLite mirror (see src/lib/auth.ts) so previews keep working.
//
// Required table (run once in the Supabase SQL editor):
// ---------------------------------------------------------------
// create table if not exists public.profiles (
//   id            uuid primary key default gen_random_uuid(),
//   auth_user_id  uuid unique references auth.users(id) on delete cascade,
//   email         text unique not null,
//   name          text,
//   phone         text,
//   city          text,
//   experience    text,
//   interests     text[],
//   onboarded     boolean not null default false,
//   plan          text not null default 'basic',
//   created_at    timestamptz not null default now(),
//   updated_at    timestamptz not null default now()
// );
// alter table public.profiles enable row level security;
// create policy "profiles readable by owner"
//   on public.profiles for select using (auth.uid() = auth_user_id);
// create policy "profiles upsertable by owner"
//   on public.profiles for insert with check (auth.uid() = auth_user_id);
// create policy "profiles updatable by owner"
//   on public.profiles for update using (auth.uid() = auth_user_id);
// ---------------------------------------------------------------
// SUPABASE_SERVICE_ROLE_KEY (server-only) bypasses RLS so the app can keep
// profiles in sync from API routes after onboarding.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const supabaseEnabled = !!(URL && ANON);

let serverClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

/** Anon-key server client — enough for sign-in/sign-up verification. */
export function supabaseServer(): SupabaseClient {
  if (!supabaseEnabled) throw new Error("Supabase is not configured");
  serverClient ??= createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serverClient;
}

/** Service-role client — bypasses RLS for profile writes from API routes. */
export function supabaseAdmin(): SupabaseClient | null {
  if (!URL || !SERVICE) return null;
  adminClient ??= createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

export interface SupabaseAuthResult {
  ok: boolean;
  needsEmailConfirm?: boolean;
  error?: string;
  userId?: string;
  email?: string;
  name?: string | null;
}

/** Verify credentials against Supabase Auth (sign-in). */
export async function supabaseSignIn(email: string, password: string): Promise<SupabaseAuthResult> {
  try {
    const { data, error } = await supabaseServer().auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      userId: data.user?.id,
      email: data.user?.email ?? email,
      name: (data.user?.user_metadata?.name as string | undefined) ?? null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Supabase sign-in failed" };
  }
}

/**
 * Register a new account in Supabase Auth. When "Confirm email" is ON in the
 * project settings the user must click the emailed link before sign-in;
 * with it OFF a session comes straight back and the flow is seamless.
 */
export async function supabaseSignUp(email: string, password: string, name: string): Promise<SupabaseAuthResult> {
  try {
    const { data, error } = await supabaseServer().auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      needsEmailConfirm: !data.session,
      userId: data.user?.id,
      email: data.user?.email ?? email,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Supabase sign-up failed" };
  }
}

export interface SupabaseProfileInput {
  authUserId?: string | null;
  email: string;
  name?: string | null;
  phone?: string | null;
  city?: string | null;
  experience?: string | null;
  interests?: string[] | null;
  onboarded?: boolean;
  plan?: string | null;
}

/**
 * Mirror the TradePulse profile into the Supabase `profiles` table.
 * Uses the service-role key when present, else the anon key. Best-effort:
 * callers must treat failures as non-fatal (the local mirror stays the
 * operational store for session/plan gating).
 */
export async function upsertSupabaseProfile(p: SupabaseProfileInput): Promise<boolean> {
  if (!supabaseEnabled) return false;
  const client = supabaseAdmin() ?? supabaseServer();
  try {
    const row = {
      auth_user_id: p.authUserId ?? null,
      email: p.email,
      name: p.name ?? null,
      phone: p.phone ?? null,
      city: p.city ?? null,
      experience: p.experience ?? null,
      interests: p.interests ?? [],
      onboarded: p.onboarded ?? false,
      plan: p.plan ?? "basic",
      updated_at: new Date().toISOString(),
    };
    const { error } = await client.from("profiles").upsert(row, { onConflict: "email" });
    if (error) {
      console.error("[supabase] profile upsert failed:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[supabase] profile upsert error:", e);
    return false;
  }
}
