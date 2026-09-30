import { Card, ListLink, PageHeader } from "@/components/ui";
import { getContext } from "@/lib/session";
import { aiMode } from "@/server/ai/provider";
import { orgSettings } from "@/server/menu";
import { AreaForm, LocationForm, SettingsForm } from "./forms";

export const metadata = { title: "Settings" };

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Toronto", "America/Vancouver", "Europe/London", "Europe/Dublin", "Australia/Sydney"];

export default async function SettingsPage() {
  const app = await getContext();
  const manage = app.can("settings.manage");
  const [settings, areas] = await Promise.all([orgSettings(app), app.supabase.from("inventory_areas").select("id, name").eq("location_id", app.location.id).is("archived_at", null).order("sort_order")]);
  const links: [string, string, string, string | null][] = [
    ["/settings/members", "Team", "Invite staff, change roles, remove access", "members.manage"],
    ["/settings/security", "Security", "Two-factor authentication", null],
    ["/settings/billing", "Billing", "Subscription per location", "billing.manage"],
    ["/settings/data", "Your data", "Export, retention and deletion", "data.export"],
    ["/settings/audit", "Audit log", "Who changed what", "audit.view"],
  ];
  const zones = ZONES.includes(app.location.timezone) ? ZONES : [app.location.timezone, ...ZONES];
  return (
    <>
      <PageHeader title="Settings" description={app.org.orgName} />
      <div className="space-y-4">
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {links.filter(([, , , p]) => !p || app.can(p)).map(([h, t, m]) => <ListLink key={h} href={h} title={t} meta={m} />)}
        </ul>
        {manage ? (
          <>
            <Card title="Costing, inventory and AI"><SettingsForm aiAvailable={aiMode() !== "unavailable"} s={{ orgName: app.org.orgName, ...settings, target_cost_pct: String(Number(settings.target_cost_pct)), variance_review_pct: String(Number(settings.variance_review_pct)), min_sales_coverage_pct: String(Number(settings.min_sales_coverage_pct)) }} /></Card>
            <Card title="Locations">
              <div className="space-y-4">
                {app.locations.map((l) => <LocationForm key={l.id} zones={zones} initial={{ id: l.id, name: l.name, timezone: l.timezone, cutoff: l.businessDayCutoff }} />)}
                <LocationForm zones={zones} />
              </div>
            </Card>
            <Card title={`Storage areas at ${app.location.name}`}>
              <ul className="mb-3 text-sm">{(areas.data ?? []).map((a: { id: string; name: string }) => <li key={a.id}>{a.name}</li>)}</ul>
              <AreaForm />
            </Card>
          </>
        ) : <p className="text-sm text-muted">Only owners and managers change settings.</p>}
      </div>
    </>
  );
}
