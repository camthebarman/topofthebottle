"use server";

import { revalidatePath } from "next/cache";
import { isValidTimeZone } from "@tz/domain";
import { z } from "zod";
import { action, zUuid } from "@/lib/action";
import { env } from "@/lib/env";
import { fromDbError, UserError } from "@/lib/errors";
import { getContext, requirePerm } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

const pctField = z.string().trim().regex(/^\d+(\.\d+)?$/, "Enter a number");

export const saveOrgSettings = action(
  z.object({
    orgName: z.string().trim().min(1).max(120),
    targetCostPct: pctField,
    priceStaleDays: z.string().regex(/^\d+$/),
    valuationMethod: z.enum(["moving_average", "last_cost"]),
    freightPolicy: z.enum(["exclude", "allocate_by_value"]),
    taxPolicy: z.enum(["exclude", "allocate_by_value"]),
    varianceReviewPct: pctField,
    minSalesCoveragePct: pctField,
    voidPreparedConsumes: z.string().optional(),
    compConsumes: z.string().optional(),
    aiInsights: z.string().optional(),
    aiInvoices: z.string().optional(),
  }),
  async (i) => {
    const app = await getContext();
    requirePerm(app, "settings.manage");
    const t = Number(i.targetCostPct);
    if (t <= 0 || t >= 100) throw new UserError("Target cost % must be between 0 and 100.");
    const a = await app.supabase.from("organizations").update({ name: i.orgName }).eq("id", app.org.orgId);
    if (a.error) throw fromDbError(a.error);
    const b = await app.supabase
      .from("org_settings")
      .update({
        target_cost_pct: i.targetCostPct,
        price_stale_days: Number(i.priceStaleDays),
        valuation_method: i.valuationMethod,
        freight_policy: i.freightPolicy,
        tax_policy: i.taxPolicy,
        variance_review_pct: i.varianceReviewPct,
        min_sales_coverage_pct: i.minSalesCoveragePct,
        void_prepared_consumes: i.voidPreparedConsumes === "on",
        comp_consumes: i.compConsumes === "on",
        ai_insights_opt_in: i.aiInsights === "on",
        ai_invoice_opt_in: i.aiInvoices === "on",
        updated_by: app.user.id,
      })
      .eq("org_id", app.org.orgId)
      .select("org_id");
    if (b.error) throw fromDbError(b.error);
    revalidatePath("/settings");
    return { status: "success", message: "Settings saved" };
  },
);

export const addLocation = action(z.object({ name: z.string().trim().min(1).max(120), timezone: z.string().refine(isValidTimeZone, "Unknown time zone"), cutoff: z.string().regex(/^\d{2}:\d{2}$/) }), async (i) => {
  const app = await getContext();
  requirePerm(app, "settings.manage");
  const res = await app.supabase.from("locations").insert({ org_id: app.org.orgId, name: i.name, timezone: i.timezone, business_day_cutoff: i.cutoff, currency: app.location.currency });
  if (res.error) throw fromDbError(res.error);
  revalidatePath("/settings");
  return { status: "success", message: "Location added. Billing is per location." };
});

export const updateLocation = action(z.object({ locationId: zUuid, name: z.string().trim().min(1).max(120), timezone: z.string().refine(isValidTimeZone, "Unknown time zone"), cutoff: z.string().regex(/^\d{2}:\d{2}$/) }), async (i) => {
  const app = await getContext();
  requirePerm(app, "settings.manage");
  const res = await app.supabase.from("locations").update({ name: i.name, timezone: i.timezone, business_day_cutoff: i.cutoff }).eq("id", i.locationId).eq("org_id", app.org.orgId).select("id");
  if (res.error) throw fromDbError(res.error);
  revalidatePath("/settings");
  return { status: "success", message: "Location saved" };
});

export const addArea = action(z.object({ name: z.string().trim().min(1).max(80) }), async ({ name }) => {
  const app = await getContext();
  requirePerm(app, "settings.manage");
  const res = await app.supabase.from("inventory_areas").insert({ org_id: app.org.orgId, location_id: app.location.id, name });
  if (res.error) throw fromDbError(res.error);
  revalidatePath("/settings");
  return { status: "success", message: "Area added" };
});

export const invite = action(z.object({ email: z.email("Enter a valid email"), role: z.enum(["owner", "manager", "bartender", "read_only"]), thisLocationOnly: z.string().optional() }), async (i) => {
  const app = await getContext();
  requirePerm(app, "members.manage");
  const { data, error } = await app.supabase.rpc("create_invitation", { p_org: app.org.orgId, p_email: i.email, p_role: i.role, p_location_ids: i.thisLocationOnly ? [app.location.id] : null });
  if (error) throw fromDbError(error);
  revalidatePath("/settings/members");
  // The link is shown once to the person who created it; only a hash is stored.
  return { status: "success", message: "Invitation created", data: { link: `${env().APP_URL}/invite/${data}` } };
});

export const revokeInvite = action(z.object({ invitationId: zUuid }), async ({ invitationId }) => {
  const app = await getContext();
  requirePerm(app, "members.manage");
  const { error } = await app.supabase.rpc("revoke_invitation", { p_invitation: invitationId });
  if (error) throw fromDbError(error);
  revalidatePath("/settings/members");
  return { status: "success", message: "Invitation revoked" };
});

export const updateMember = action(z.object({ userId: zUuid, role: z.enum(["owner", "manager", "bartender", "read_only"]), status: z.enum(["active", "revoked"]), thisLocationOnly: z.string().optional() }), async (i) => {
  const app = await getContext();
  requirePerm(app, "members.manage");
  if (i.userId === app.user.id && i.status === "revoked") throw new UserError("You cannot remove yourself.");
  const { error } = await app.supabase.rpc("update_membership", { p_org: app.org.orgId, p_user: i.userId, p_role: i.role, p_location_ids: i.thisLocationOnly ? [app.location.id] : null, p_status: i.status });
  if (error) throw fromDbError(error);
  revalidatePath("/settings/members");
  return { status: "success", message: i.status === "revoked" ? "Access removed" : "Member updated" };
});

export const requestDeletion = action(z.object({ confirm: z.string() }), async ({ confirm }) => {
  const app = await getContext();
  requirePerm(app, "data.export");
  if (confirm.trim() !== app.org.orgName) throw new UserError("Type the organization name exactly to confirm.");
  const admin = createAdminClient();
  const { data: existing } = await admin.from("data_requests").select("id").eq("org_id", app.org.orgId).eq("kind", "delete_organization").eq("status", "requested").maybeSingle();
  if (existing) throw new UserError("A deletion request is already scheduled.");
  const when = new Date(Date.now() + 30 * 86400000).toISOString();
  const { error } = await admin.from("data_requests").insert({ org_id: app.org.orgId, kind: "delete_organization", requested_by: app.user.id, scheduled_for: when });
  if (error) throw fromDbError(error);
  await admin.from("audit_events").insert({ org_id: app.org.orgId, actor_id: app.user.id, action: "organization.deletion_requested", entity_type: "organization", entity_id: app.org.orgId, data: { scheduled_for: when } });
  revalidatePath("/settings/data");
  return { status: "success", message: "Deletion scheduled in 30 days. Export your data before then; you can cancel until it runs." };
});

export const cancelDeletion = action(z.object({ requestId: zUuid }), async ({ requestId }) => {
  const app = await getContext();
  requirePerm(app, "data.export");
  const admin = createAdminClient();
  const { data, error } = await admin.from("data_requests").update({ status: "cancelled" }).eq("id", requestId).eq("org_id", app.org.orgId).eq("status", "requested").select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw new UserError("Nothing to cancel.");
  await admin.from("audit_events").insert({ org_id: app.org.orgId, actor_id: app.user.id, action: "organization.deletion_cancelled", entity_type: "organization", entity_id: app.org.orgId, data: {} });
  revalidatePath("/settings/data");
  return { status: "success", message: "Deletion cancelled" };
});
