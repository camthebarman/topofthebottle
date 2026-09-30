import { Badge, Card, EmptyState, LinkButton, ListLink, PageHeader } from "@/components/ui";
import { UploadForm } from "@/components/upload";
import { must } from "@/lib/action";
import { dateLabel } from "@/lib/format";
import { getContext, requirePerm } from "@/lib/session";

export const metadata = { title: "Imports" };

export default async function ImportsPage() {
  const app = await getContext();
  requirePerm(app, "imports.manage");
  const rows = must(await app.supabase.from("pos_imports").select("id, status, kind, date_start, date_end, created_at, stats, documents(filename)").eq("location_id", app.location.id).order("created_at", { ascending: false }).limit(50)) as { id: string; status: string; kind: string; date_start: string | null; date_end: string | null; created_at: string; stats: { accepted?: number; inserted?: number }; documents: unknown }[];
  return (
    <>
      <PageHeader title="POS imports" description="Upload a CSV export from your POS. Nothing is imported until you review it." actions={<LinkButton href="/imports/mappings">Item mappings</LinkButton>} />
      <div className="space-y-4">
        <Card title="Upload sales">
          <UploadForm kind="pos_export" label="CSV export (max 25 MB)" accept=".csv,text/csv" />
          <p className="mt-2 text-xs text-muted">Toast item and modifier exports and Square item exports are recognised from their headers but have not been verified against real files yet; any other POS works through the column mapper.</p>
        </Card>
        {rows.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {rows.map((r) => (
              <ListLink key={r.id} href={`/imports/${r.id}`} title={(r.documents as { filename: string } | null)?.filename ?? "Import"} meta={`${r.kind === "aggregate" ? "Summary" : "Transactions"} · ${r.date_start ? `${dateLabel(r.date_start)} – ${dateLabel(r.date_end)}` : dateLabel(r.created_at, app.location.timezone)}`} right={<Badge tone={r.status === "committed" ? "ok" : r.status === "failed" ? "danger" : r.status === "cancelled" || r.status === "superseded" ? "neutral" : "warn"}>{r.status.replace("_", " ")}</Badge>} />
            ))}
          </ul>
        ) : <EmptyState title="No imports yet" />}
      </div>
    </>
  );
}
