"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";
import { getContext, requirePerm } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { billingConfigured, stripe } from "@/server/billing";

async function customerFor(orgId: string, orgName: string, email: string | null): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin.from("billing_accounts").select("stripe_customer_id").eq("org_id", orgId).maybeSingle();
  if (data?.stripe_customer_id) return data.stripe_customer_id as string;
  const c = await stripe().customers.create({ name: orgName, ...(email ? { email } : {}), metadata: { org_id: orgId } }, { idempotencyKey: `customer:${orgId}` });
  await admin.from("billing_accounts").upsert({ org_id: orgId, stripe_customer_id: c.id });
  return c.id;
}

export const startCheckout = action(z.object({}), async () => {
  const app = await getContext();
  requirePerm(app, "billing.manage");
  if (!billingConfigured()) throw new UserError("Billing is not set up on this server.", "unavailable");
  const customer = await customerFor(app.org.orgId, app.org.orgName, app.user.email);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: app.org.orgId,
    line_items: [{ price: env().STRIPE_PRICE_ID!, quantity: Math.max(1, app.locations.length) }],
    subscription_data: { metadata: { org_id: app.org.orgId } },
    success_url: `${env().APP_URL}/settings/billing?checkout=returned`,
    cancel_url: `${env().APP_URL}/settings/billing`,
  });
  if (!session.url) throw new UserError("Stripe did not return a checkout page.");
  redirect(session.url);
});

export const openPortal = action(z.object({}), async () => {
  const app = await getContext();
  requirePerm(app, "billing.manage");
  if (!billingConfigured()) throw new UserError("Billing is not set up on this server.", "unavailable");
  const customer = await customerFor(app.org.orgId, app.org.orgName, app.user.email);
  const portal = await stripe().billingPortal.sessions.create({ customer, return_url: `${env().APP_URL}/settings/billing` });
  redirect(portal.url);
});
