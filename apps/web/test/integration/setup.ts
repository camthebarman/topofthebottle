import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Local stack settings from apps/web/.env.local (tests run with apps/web as the working directory). */
export function localEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

const e = localEnv();
export const URL_ = e.NEXT_PUBLIC_SUPABASE_URL!;
export const ANON = e.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const SERVICE = e.SUPABASE_SERVICE_ROLE_KEY!;

export function anon(): SupabaseClient {
  return createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function admin(): SupabaseClient {
  return createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Signed-in client for a seeded demo user (see supabase/seed.sql). */
export async function as(email: string): Promise<SupabaseClient> {
  const c = anon();
  const { error } = await c.auth.signInWithPassword({ email, password: "demo-password-123" });
  if (error) throw new Error(`sign-in ${email}: ${error.message}. Run \`supabase db reset\` to load the seed.`);
  return c;
}

export async function demoIds() {
  const a = admin();
  const org = (await a.from("organizations").select("id").eq("name", "Demo Cocktail Bar").single()).data!.id as string;
  const other = (await a.from("organizations").select("id").eq("name", "Unrelated Tavern").single()).data!.id as string;
  const loc = (await a.from("locations").select("id").eq("org_id", org).eq("name", "Main bar").single()).data!.id as string;
  const otherLoc = (await a.from("locations").select("id").eq("org_id", other).single()).data!.id as string;
  const product = (await a.from("products").select("id").eq("org_id", org).eq("name", "Campari").single()).data!.id as string;
  return { org, other, loc, otherLoc, product };
}
