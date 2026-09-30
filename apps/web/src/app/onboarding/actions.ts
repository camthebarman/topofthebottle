"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action, zRequired } from "@/lib/action";
import { fromDbError } from "@/lib/errors";
import { CONTEXT_COOKIE, requireUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const createOrganization = action(
  z.object({
    orgName: zRequired(120),
    locationName: zRequired(120),
    timezone: zRequired(64),
    displayName: z.string().trim().max(80).optional(),
  }),
  async (input) => {
    await requireUser();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_organization", {
      p_name: input.orgName,
      p_location_name: input.locationName,
      p_timezone: input.timezone,
      p_display_name: input.displayName ?? null,
    });
    if (error) throw fromDbError(error);
    (await cookies()).set(CONTEXT_COOKIE, `${data}:`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
    redirect("/today?welcome=1");
  },
);
