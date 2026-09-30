import { Card, DataList, Notice, PageHeader } from "@/components/ui";
import { dateLabel } from "@/lib/format";
import { getContext, pagePerm } from "@/lib/session";
import { billingConfigured } from "@/server/billing";
import { CheckoutButton, PortalButton } from "./forms";

export const metadata = { title: "Billing" };

const STATE: Record<string, string> = {
  active: "Active",
  grace: "Grace period: data stays readable and exportable",
  trial_unpaid: "Not subscribed yet",
  read_only: "Ended: read-only; export remains available",
};

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const sp = await searchParams;
  const app = await getContext();
  pagePerm(app, "billing.manage");
  const { data } = await app.supabase.rpc("org_entitlement", { p_org: app.org.orgId }).maybeSingle();
  const ent = data as { state: string; paid_locations: number; active_locations: number; grace_until: string | null } | null;
  return (
    <>
      <PageHeader title="Billing" description="$39 per location per month. Onboarding is billed separately." />
      <div className="space-y-4">
        {sp.checkout ? <Notice tone="info" role="status">Thanks. Your subscription shows here once Stripe confirms it to us; that usually takes a few seconds.</Notice> : null}
        {!billingConfigured() ? <Notice tone="warn" title="Billing unavailable">Stripe is not configured on this server (STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET). Nothing is charged.</Notice> : null}
        <Card title="Subscription">
          <DataList items={[
            { label: "Status", value: STATE[ent?.state ?? "trial_unpaid"] ?? ent?.state ?? "—" },
            { label: "Paid locations", value: String(ent?.paid_locations ?? 0) },
            { label: "Active locations", value: String(ent?.active_locations ?? app.locations.length) },
            ...(ent?.grace_until ? [{ label: "Grace ends", value: dateLabel(ent.grace_until, app.location.timezone) }] : []),
          ]} />
          {ent && ent.state === "active" && ent.active_locations > ent.paid_locations ? <p className="mt-2 text-sm text-warn">You have more locations than paid seats. Update the quantity in billing.</p> : null}
          {billingConfigured() ? <div className="mt-3 flex flex-wrap gap-2">{ent?.state === "active" || ent?.state === "grace" ? <PortalButton /> : <CheckoutButton locations={app.locations.length} />}</div> : null}
        </Card>
        <p className="text-xs text-muted">After cancellation, data stays readable and exportable for 30 days.</p>
      </div>
    </>
  );
}
