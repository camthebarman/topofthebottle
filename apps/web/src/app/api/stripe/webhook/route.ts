import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { billingConfigured, handleStripeEvent, stripe } from "@/server/billing";

// Stripe calls this. Only a valid signature on the raw body is trusted; browser
// redirects after checkout are never treated as proof of payment.
export async function POST(request: Request) {
  if (!billingConfigured()) return NextResponse.json({ error: "billing not configured" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  const body = await request.text();
  if (!signature || body.length > 1_000_000) return NextResponse.json({ error: "bad request" }, { status: 400 });
  let event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, env().STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  try {
    const processed = await handleStripeEvent(createAdminClient(), event);
    return NextResponse.json({ received: true, duplicate: !processed });
  } catch (e) {
    log("error", "stripe.webhook_failed", { eventId: event.id, type: event.type, error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "processing failed" }, { status: 500 }); // Stripe retries
  }
}
