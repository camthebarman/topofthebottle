import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";
import { admin, demoIds, localEnv } from "./setup";

const SECRET = "whsec_test_integration_secret_value";
let POST: (req: Request) => Promise<Response>;
let ids: Awaited<ReturnType<typeof demoIds>>;

beforeAll(async () => {
  const e = localEnv();
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: e.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: e.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: e.SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_SECRET_KEY: "sk_test_integration_not_used_for_network",
    STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_PRICE_ID: "price_test_123",
  });
  ({ POST } = await import("@/app/api/stripe/webhook/route"));
  ids = await demoIds();
  await admin().from("billing_accounts").upsert({ org_id: ids.org, stripe_customer_id: "cus_test_demo" });
});

function subscriptionEvent(id: string, created: number, status: string, quantity: number) {
  return {
    id,
    object: "event",
    type: "customer.subscription.updated",
    created,
    data: {
      object: {
        id: "sub_test_demo",
        object: "subscription",
        customer: "cus_test_demo",
        status,
        metadata: {},
        cancel_at: null,
        canceled_at: status === "canceled" ? created : null,
        items: { data: [{ price: { id: "price_test_123" }, quantity, current_period_end: created + 30 * 86400 }] },
      },
    },
  };
}

function signed(payload: object, secret = SECRET): Request {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  return new Request("http://localhost/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": header, "content-type": "application/json" } });
}

describe("Stripe webhook", () => {
  it("rejects a bad signature and never applies it", async () => {
    const res = await POST(signed(subscriptionEvent("evt_forged", 1_900_000_000, "active", 99), "whsec_wrong"));
    expect(res.status).toBe(400);
    const unsigned = await POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: "{}" }));
    expect(unsigned.status).toBe(400);
    const { data } = await admin().from("subscriptions").select("quantity").eq("id", "sub_test_demo").maybeSingle();
    expect(data?.quantity).not.toBe(99);
  });

  it("applies a verified event once and treats a replay as a duplicate", async () => {
    const ev = subscriptionEvent(`evt_${Date.now()}`, Math.floor(Date.now() / 1000), "active", 2);
    const first = await (await POST(signed(ev))).json();
    expect(first).toEqual({ received: true, duplicate: false });
    const replay = await (await POST(signed(ev))).json();
    expect(replay).toEqual({ received: true, duplicate: true });
    const { data } = await admin().from("subscriptions").select("status, quantity, org_id").eq("id", "sub_test_demo").single();
    expect(data).toMatchObject({ status: "active", quantity: 2, org_id: ids.org });
  });

  it("ignores an older event that arrives late", async () => {
    const old = subscriptionEvent(`evt_old_${Date.now()}`, Math.floor(Date.now() / 1000) - 3600, "canceled", 1);
    const res = await POST(signed(old));
    expect(res.status).toBe(200);
    const { data } = await admin().from("subscriptions").select("status").eq("id", "sub_test_demo").single();
    expect(data?.status).toBe("active");
  });
});
