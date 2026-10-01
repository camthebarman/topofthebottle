import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient, type Supabase } from "@/lib/supabase/server";
import { UserError } from "@/lib/errors";

export const CONTEXT_COOKIE = "tz_ctx";

export interface SessionUser {
  id: string;
  email: string | null;
  aal: string | null;
  /** True when the user has a verified second factor but this session has not used it. */
  mfaPending: boolean;
}

export const getUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const c = data.claims as { sub: string; email?: string; aal?: string };
  let mfaPending = false;
  if (c.aal !== "aal2") {
    // listFactors reads the user from the Auth server, not from the cookie.
    const { data: factors } = await supabase.auth.mfa.listFactors();
    mfaPending = (factors?.totp ?? []).some((f) => f.status === "verified");
  }
  return { id: c.sub, email: c.email ?? null, aal: c.aal ?? null, mfaPending };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/sign-in");
  return user;
}

export interface Membership {
  orgId: string;
  orgName: string;
  role: "owner" | "manager" | "bartender" | "read_only";
}

export interface LocationSummary {
  id: string;
  orgId: string;
  name: string;
  timezone: string;
  businessDayCutoff: string;
  currency: string;
}

export interface AppContext {
  supabase: Supabase;
  user: SessionUser;
  memberships: Membership[];
  org: Membership;
  locations: LocationSummary[];
  location: LocationSummary;
  perms: Set<string>;
  can: (perm: string) => boolean;
  /** Subscription state: active, grace, trial_unpaid or read_only. */
  entitlement: string;
}

/**
 * The signed-in user's active organization and location. The cookie only
 * records a preference; membership is re-checked against the database on
 * every request and row-level security enforces it again on every query.
 */
export const getContext = cache(async (): Promise<AppContext> => {
  const user = await requireUser();
  // Enforced here, not only in the layout, so server actions and API routes are covered too.
  if (user.mfaPending) redirect("/mfa");
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("memberships")
    .select("org_id, role, organizations(name)")
    .eq("user_id", user.id)
    .eq("status", "active");
  if (error) throw new Error("Could not load memberships");
  const memberships: Membership[] = (rows ?? []).map((r) => ({
    orgId: r.org_id as string,
    role: r.role as Membership["role"],
    orgName: (r.organizations as unknown as { name: string } | null)?.name ?? "Organization",
  }));
  if (!memberships.length) redirect("/onboarding");

  const pref = (await cookies()).get(CONTEXT_COOKIE)?.value ?? "";
  const [prefOrg, prefLoc] = pref.split(":");
  const org = memberships.find((m) => m.orgId === prefOrg) ?? memberships[0]!;

  const { data: locs } = await supabase
    .from("locations")
    .select("id, org_id, name, timezone, business_day_cutoff, currency")
    .eq("org_id", org.orgId)
    .is("archived_at", null)
    .order("created_at");
  const locations: LocationSummary[] = (locs ?? []).map((l) => ({
    id: l.id,
    orgId: l.org_id,
    name: l.name,
    timezone: l.timezone,
    businessDayCutoff: String(l.business_day_cutoff).slice(0, 5),
    currency: l.currency,
  }));
  if (!locations.length) throw new UserError("You do not have access to any location in this organization.", "forbidden");
  const location = locations.find((l) => l.id === prefLoc) ?? locations[0]!;

  const [{ data: permRows }, { data: ent }] = await Promise.all([
    supabase.rpc("my_permissions", { p_org: org.orgId }),
    supabase.rpc("org_entitlement", { p_org: org.orgId }).maybeSingle(),
  ]);
  const perms = new Set<string>((permRows ?? []).map((p: { permission: string }) => p.permission));
  const entitlement = (ent as { state?: string } | null)?.state ?? "trial_unpaid";
  return { supabase, user, memberships, org, locations, location, perms, can: (p) => perms.has(p), entitlement };
});

/** Permissions that stay usable after a subscription lapses, so data can be read, exported and billing fixed. */
const READ_ONLY_ALLOWED = new Set(["org.view", "costs.view", "insights.view", "schedule.view_team", "data.export", "audit.view", "billing.manage", "members.manage"]);

/** Throw unless the active membership has the permission. The database checks again. */
export function requirePerm(ctx: AppContext, perm: string): void {
  if (!ctx.perms.has(perm)) throw new UserError("You do not have permission to do that.", "forbidden");
  if (ctx.entitlement === "read_only" && !READ_ONLY_ALLOWED.has(perm)) {
    throw new UserError("The subscription has ended, so this organization is read-only. Your data is still here and can be exported.", "forbidden");
  }
}

/** For pages: send members without the permission to a plain explanation instead of an error. */
export function pagePerm(ctx: AppContext, perm: string): void {
  if (!ctx.perms.has(perm)) redirect(`/no-access?need=${encodeURIComponent(perm)}`);
}
