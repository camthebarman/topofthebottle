"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";
import { clientIp, limit } from "@/lib/rate-limit";
import { CONTEXT_COOKIE } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const safeNext = (n: unknown) => (typeof n === "string" && /^\/[A-Za-z0-9/_-]*$/.test(n) && !n.startsWith("//") ? n : "/today");

export const signIn = action(
  z.object({ email: z.email("Enter a valid email"), password: z.string().min(1, "Enter your password"), next: z.string().optional() }),
  async ({ email, password, next }) => {
    await limit("sign-in", `${await clientIp()}:${email.toLowerCase()}`, 8, 60_000);
    // Per account regardless of address, so rotating addresses cannot multiply guesses.
    await limit("sign-in-account", email.toLowerCase(), 30, 15 * 60_000);
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new UserError("Email or password is incorrect.");
    redirect(safeNext(next));
  },
);

export const signUp = action(
  z.object({
    email: z.email("Enter a valid email"),
    password: z.string().min(10, "Use at least 10 characters").max(200),
    next: z.string().optional(),
  }),
  async ({ email, password, next }) => {
    await limit("sign-up", await clientIp(), 5, 60_000);
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${env().APP_URL}/auth/confirm?next=${encodeURIComponent(safeNext(next ?? "/onboarding"))}` },
    });
    if (error) throw new UserError(error.message.includes("registered") ? "An account with that email already exists. Sign in instead." : "Could not create the account.");
    if (!data.session) return { status: "success", message: "Check your email to confirm your address, then sign in." };
    redirect(safeNext(next ?? "/onboarding"));
  },
);

export const sendMagicLink = action(z.object({ email: z.email("Enter a valid email"), next: z.string().optional() }), async ({ email, next }) => {
  await limit("magic", `${await clientIp()}:${email.toLowerCase()}`, 3, 60_000);
  await limit("magic-account", email.toLowerCase(), 6, 15 * 60_000);
  const supabase = await createClient();
  await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${env().APP_URL}/auth/confirm?next=${encodeURIComponent(safeNext(next))}` },
  });
  // Same response whether or not the account exists.
  return { status: "success", message: "If that email has an account, a sign-in link is on its way." };
});

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  const jar = await cookies();
  jar.delete(CONTEXT_COOKIE);
  redirect("/sign-in?signed_out=1");
}
