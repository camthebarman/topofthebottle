"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";
import { UserError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { notInDemo } from "@/lib/demo";

export const startTotp = action(z.object({}), async () => {
    notInDemo("Two-factor setup");
  await requireUser();
  const supabase = await createClient();
  // Remove abandoned, unverified factors first so enrolment can be retried.
  const { data: list } = await supabase.auth.mfa.listFactors();
  for (const f of list?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) throw new UserError("Two-factor setup is not available right now.");
  return { status: "success", message: "Scan the code, then enter the 6-digit number.", data: { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret } };
});

export const verifyTotp = action(z.object({ factorId: z.string().min(1).max(64), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") }), async ({ factorId, code }) => {
    notInDemo("Two-factor setup");
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw new UserError("That code did not match. Check the time on your phone and try again.");
  revalidatePath("/settings/security");
  return { status: "success", message: "Two-factor authentication is on." };
});
