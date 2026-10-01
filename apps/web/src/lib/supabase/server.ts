import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Supabase client acting as the signed-in user. Row-level security applies to
 * every query made through it. Create one per request; never share across requests.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const e = env();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    // No browser Supabase client exists, so session cookies never need to be readable by scripts.
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: e.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes sessions.
        }
      },
    },
  });
}

export type Supabase = Awaited<ReturnType<typeof createClient>>;
