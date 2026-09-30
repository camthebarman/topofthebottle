"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CONTEXT_COOKIE, requireUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ target: z.string().regex(/^[0-9a-f-]{36}:[0-9a-f-]{36}$/) });

/** Switch organization/location. Verified against the database before the preference is stored. */
export async function switchContext(fd: FormData): Promise<void> {
  await requireUser();
  const parsed = schema.safeParse({ target: fd.get("target") });
  if (!parsed.success) redirect("/today");
  const [orgId, locationId] = parsed.data.target.split(":");
  const supabase = await createClient();
  // RLS returns the location only if the user may see it.
  let query = supabase.from("locations").select("id").eq("org_id", orgId!).is("archived_at", null);
  if (locationId !== "00000000-0000-0000-0000-000000000000") query = query.eq("id", locationId!);
  const { data } = await query.order("created_at").limit(1).maybeSingle();
  if (data) {
    (await cookies()).set(CONTEXT_COOKIE, `${orgId}:${data.id}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  }
  redirect("/today");
}
