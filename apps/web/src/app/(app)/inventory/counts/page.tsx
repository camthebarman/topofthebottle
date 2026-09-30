import { Badge, Card, EmptyState, ListLink, PageHeader } from "@/components/ui";
import { must } from "@/lib/action";
import { dateLabel } from "@/lib/format";
import { getContext } from "@/lib/session";
import { StartCountForm } from "../forms";

export const metadata = { title: "Counts" };

export default async function CountsPage() {
  const app = await getContext();
  const sessions = must(await app.supabase.from("count_sessions").select("id, name, status, counted_at, finalized_at").eq("location_id", app.location.id).neq("status", "void").order("counted_at", { ascending: false }).limit(50)) as { id: string; name: string | null; status: string; counted_at: string; finalized_at: string | null }[];
  return (
    <>
      <PageHeader title="Counts" description="Draft counts can be edited by the team. Finalizing adjusts the book to match." />
      <div className="space-y-4">
        {app.can("inventory.count") ? <Card title="New count"><StartCountForm /></Card> : null}
        {sessions.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {sessions.map((s) => (
              <ListLink key={s.id} href={`/inventory/counts/${s.id}`} title={s.name || `Count ${dateLabel(s.counted_at, app.location.timezone)}`} meta={dateLabel(s.counted_at, app.location.timezone)} right={<Badge tone={s.status === "finalized" ? "ok" : "warn"}>{s.status}</Badge>} />
            ))}
          </ul>
        ) : <EmptyState title="No counts yet" />}
      </div>
    </>
  );
}
