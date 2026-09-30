import { ListLink, PageHeader } from "@/components/ui";
import { getContext } from "@/lib/session";

export const metadata = { title: "More" };

export default async function MorePage() {
  const app = await getContext();
  const items: [string, string, string, string | null][] = [
    ["/schedule", "Schedule", "Your shifts and the team's week", null],
    ["/events", "Events", "Plan drinks for private events and catering", "events.manage"],
    ["/imports", "Imports", "POS sales files and item mappings", "imports.manage"],
    ["/insights", "Insights", "Usage, variance and menu mix", "insights.view"],
    ["/notifications", "Alerts", "Schedule changes and assignments", null],
    ["/settings", "Settings", "Organization, locations, team, billing and data", null],
  ];
  return (
    <>
      <PageHeader title="More" />
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {items.filter(([, , , p]) => !p || app.can(p)).map(([href, title, meta]) => <ListLink key={href} href={href} title={title} meta={meta} />)}
      </ul>
    </>
  );
}
