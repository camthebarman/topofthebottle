import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import type { AdminClient } from "@/lib/supabase/admin";

export function billingConfigured(): boolean {
  const e = env();
  return !!(e.STRIPE_SECRET_KEY && e.STRIPE_PRICE_ID && e.STRIPE_WEBHOOK_SECRET);
}

let client: Stripe | null = null;
export function stripe(): Stripe {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured");
  if (env().NODE_ENV === "production" && !key.startsWith("sk_live_") && !key.startsWith("rk_live_")) log("warn", "billing.test_key_in_production", {});
  client ??= new Stripe(key, { maxNetworkRetries: 2 });
  return client;
}

/** Map a Stripe subscription onto our entitlement row. Only called with verified events. */
export async function upsertSubscription(admin: AdminClient, sub: Stripe.Subscription, eventCreated: number): Promise<"applied" | "stale" | "unknown_org"> {
  let orgId = (sub.metadata?.org_id as string | undefined) ?? null;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  if (!orgId) {
    const { data } = await admin.from("billing_accounts").select("org_id").eq("stripe_customer_id", customerId).maybeSingle();
    orgId = (data?.org_id as string | undefined) ?? null;
  }
  if (!orgId) return "unknown_org";
  const { data: existing } = await admin.from("subscriptions").select("stripe_updated_at").eq("id", sub.id).maybeSingle();
  const updatedAt = new Date(eventCreated * 1000).toISOString();
  // Webhooks can arrive out of order; never let an older event overwrite a newer one.
  if (existing && existing.stripe_updated_at > updatedAt) return "stale";
  const item = sub.items.data[0];
  const { error } = await admin.from("subscriptions").upsert({
    id: sub.id,
    org_id: orgId,
    status: sub.status,
    price_id: item?.price.id ?? null,
    quantity: item?.quantity ?? 0,
    current_period_end: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
    cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
    canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
    stripe_updated_at: updatedAt,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  await admin.from("audit_events").insert({ org_id: orgId, actor_id: null, action: "billing.subscription_updated", entity_type: "subscription", entity_id: sub.id, data: { status: sub.status, quantity: item?.quantity ?? 0 } });
  return "applied";
}

/**
 * Process a verified event exactly once. Returns false if the event id was
 * already processed (a replay or a Stripe retry).
 */
export async function handleStripeEvent(admin: AdminClient, event: Stripe.Event): Promise<boolean> {
  const { data: inserted, error } = await admin.from("stripe_events").upsert({ id: event.id, type: event.type }, { onConflict: "id", ignoreDuplicates: true }).select("id, processed_at");
  if (error) throw new Error(error.message);
  if (!inserted?.length) {
    const { data: prior } = await admin.from("stripe_events").select("processed_at").eq("id", event.id).single();
    if (prior?.processed_at) return false;
  }
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const orgId = s.client_reference_id;
        const customer = typeof s.customer === "string" ? s.customer : s.customer?.id;
        if (orgId && customer) await admin.from("billing_accounts").upsert({ org_id: orgId, stripe_customer_id: customer });
        if (typeof s.subscription === "string") {
          const sub = await stripe().subscriptions.retrieve(s.subscription);
          await upsertSubscription(admin, sub, event.created);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await upsertSubscription(admin, event.data.object as Stripe.Subscription, event.created);
        break;
      default:
        break;
    }
    await admin.from("stripe_events").update({ processed_at: new Date().toISOString(), error: null }).eq("id", event.id);
    return true;
  } catch (e) {
    await admin.from("stripe_events").update({ error: e instanceof Error ? e.message.slice(0, 500) : "error" }).eq("id", event.id);
    throw e;
  }
}
