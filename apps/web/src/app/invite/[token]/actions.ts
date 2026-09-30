"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";
import { fromDbError } from "@/lib/errors";
import { clientIp, limit } from "@/lib/rate-limit";
import { CONTEXT_COOKIE, requireUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const acceptInvite = action(z.object({ token: z.string().regex(/^[0-9a-f]{48}$/, "Invalid invitation"), displayName: z.string().trim().max(80).optional() }), async ({ token, displayName }) => {
  const user = await requireUser();
  await limit("invite", `${await clientIp()}:${user.id}`, 10, 60_000);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token, p_display_name: displayName ?? null });
  if (error) throw fromDbError(error, "This invitation could not be accepted.");
  (await cookies()).set(CONTEXT_COOKIE, `${data}:`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/today");
});
