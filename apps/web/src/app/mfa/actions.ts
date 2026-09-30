"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";
import { UserError } from "@/lib/errors";
import { clientIp, limit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const stepUp = action(z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") }), async ({ code }) => {
  const user = await requireUser();
  await limit("mfa", `${await clientIp()}:${user.id}`, 6, 60_000);
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = (data?.totp ?? []).find((f) => f.status === "verified");
  if (!factor) redirect("/today");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) throw new UserError("That code did not match.");
  redirect("/today");
});
