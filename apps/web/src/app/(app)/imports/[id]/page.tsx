import { notFound } from "next/navigation";
import { PRESETS } from "@tz/domain";
import { Badge, Card, DataList, Notice, PageHeader } from "@/components/ui";
import { must } from "@/lib/action";
import { dateLabel, money, num } from "@/lib/format";
import { getContext, pagePerm } from "@/lib/session";
import { AutoRefresh, CancelImportForm, CommitForm, MapItemForm, MappingForm } from "../forms";

interface Stats {
  headers?: string[];
  preview?: string[][];
  sensitive_headers?: string[];
  suggested_preset?: string | null;
  same_file_uploaded_before?: boolean;
  encoding?: string;
  rows_read?: number;
  accepted?: number;
  quarantined?: number;
  duplicates?: { in_file: number; existing: number };
  by_kind?: Record<string, number>;
  quantity?: string;
  gross_sales?: string;
  net_sales?: string;
  date_range?: { start: string; end: string } | null;
  items?: { key: string; name: string; qty: number; net: number; mapped: boolean }[];
  distinct_items?: number;
  unmapped_items?: number;
  overlaps?: { id: string; date_start: string; date_end: string }[];
  modifier_rows_for_earlier_imports?: number;
  inserted?: number;
  skipped_existing?: number;
  modifier_lines_updated?: number;
  superseded_imports?: number;
}

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const app = await getContext();
  pagePerm(app, "imports.manage");
  const { data: imp } = await app.supabase.from("pos_imports").select("*, documents(filename)").eq("id", id).maybeSingle();
  if (!imp) notFound();
  const s = imp.stats as Stats;
  const status = imp.status as string;
  const [jobRes, rejectedRes, recipesRes, mapsRes] = await Promise.all([
    app.supabase.from("jobs").select("status, progress, last_error, kind").contains("payload", { importId: id }).order("created_at", { ascending: false }).limit(1),
    status === "needs_review" || status === "committed" ? app.supabase.from("pos_import_rows").select("row_number, reasons, source").eq("import_id", id).eq("outcome", "quarantined").order("row_number").limit(50) : Promise.resolve({ data: [] }),
    app.supabase.from("recipes").select("id, name").eq("org_id", app.org.orgId).is("archived_at", null).neq("kind", "prep").order("name"),
    app.supabase.from("pos_item_mappings").select("item_key, recipe_id, not_stock").eq("location_id", app.location.id).is("effective_to", null),
  ]);
  const job = jobRes.data?.[0] as { status: string; progress: number; last_error: string | null } | undefined;
  const recipes = must(recipesRes) as { id: string; name: string }[];
  const mapped = new Map((mapsRes.data ?? []).map((m: { item_key: string; recipe_id: string | null; not_stock: boolean }) => [m.item_key, m.not_stock ? "not_stock" : m.recipe_id!]));
  const presets = PRESETS.filter((p) => p.requiredHeaders.every((h) => (s.headers ?? []).includes(h))).map((p) => ({ id: p.id, name: p.name, columns: p.columns as Record<string, string | undefined>, kind: p.kind, dateFormat: p.dateFormat, headerSource: p.headerSource }));
  const busy = status === "validating" || status === "committing";
  const items = s.items ?? [];
  const unmappedNow = items.filter((i) => !mapped.has(i.key));
  const netTotal = items.reduce((a, i) => a + i.net, 0);
  const coverage = netTotal > 0 ? (100 * items.filter((i) => mapped.has(i.key)).reduce((a, i) => a + i.net, 0)) / netTotal : null;

  return (
    <>
      <PageHeader title={(imp.documents as { filename: string } | null)?.filename ?? "Import"} description={<Badge tone={status === "committed" ? "ok" : status === "failed" ? "danger" : "warn"}>{status.replace("_", " ")}</Badge>} />
      <div className="space-y-4">
        {busy ? (
          <Notice tone="info" role="status" title={status === "validating" ? "Checking the file…" : "Importing…"}>
            <p>{job ? `${job.progress}% done` : "Queued"}. This page updates by itself; you can leave and come back.</p>
            <AutoRefresh />
          </Notice>
        ) : null}
        {imp.error ? <Notice tone="danger" role="alert" title="Problem">{imp.error}</Notice> : null}
        {s.same_file_uploaded_before ? <Notice tone="warn">This exact file was uploaded before. Lines already imported will be skipped as duplicates.</Notice> : null}

        {(status === "uploaded" || status === "failed" || status === "needs_review") && s.headers ? (
          <Card title={status === "needs_review" ? "Mapping (change and re-check if needed)" : "Map the columns"}>
            {s.preview?.length ? (
              <div className="mb-4 max-w-full overflow-x-auto rounded-lg border border-border">
                <table className="min-w-full text-xs">
                  <caption className="sr-only">First rows of the file</caption>
                  <thead><tr>{s.headers.map((h) => <th key={h} scope="col" className="whitespace-nowrap border-b border-border px-2 py-1 text-left">{h}</th>)}</tr></thead>
                  <tbody>{s.preview.slice(0, 5).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="whitespace-nowrap px-2 py-1">{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            ) : null}
            <MappingForm importId={id} headers={s.headers} sensitive={s.sensitive_headers ?? []} profile={imp.profile} presets={presets} suggested={s.suggested_preset ?? null} />
          </Card>
        ) : null}

        {(status === "needs_review" || status === "committed") && s.rows_read !== undefined ? (
          <Card title="What the file contains">
            <DataList items={[
              { label: "Rows read", value: num(s.rows_read) },
              { label: "Ready to import", value: num(s.accepted) },
              { label: "Rejected (see below)", value: num(s.quarantined) },
              { label: "Already imported / repeated", value: `${num(s.duplicates?.existing ?? 0)} / ${num(s.duplicates?.in_file ?? 0)}` },
              { label: "Dates", value: s.date_range ? `${dateLabel(s.date_range.start)} – ${dateLabel(s.date_range.end)}` : "—" },
              { label: "Net sales", value: money(s.net_sales) },
              { label: "Sales / comps / voids / refunds", value: `${s.by_kind?.sale ?? 0} / ${s.by_kind?.comp ?? 0} / ${s.by_kind?.void ?? 0} / ${s.by_kind?.refund ?? 0}` },
              { label: "Items mapped to recipes", value: coverage === null ? "—" : `${coverage.toFixed(1)}% of net sales` },
              { label: "File encoding", value: s.encoding ?? "—" },
            ]} />
            {s.modifier_rows_for_earlier_imports ? <p className="mt-2 text-sm text-muted">{s.modifier_rows_for_earlier_imports} modifier row(s) belong to items from an earlier import and will be attached to them.</p> : null}
            <p className="mt-2 text-xs text-muted">Voids and refunds are not treated as stock coming back. Comps still used stock. Totals are reconciled against the rows imported; check them against your POS report.</p>
          </Card>
        ) : null}

        {s.overlaps?.length ? (
          <Notice tone="warn" title="Overlaps an earlier summary report">
            {s.overlaps.map((o) => <p key={o.id}>{dateLabel(o.date_start)} – {dateLabel(o.date_end)}</p>)}
            <p>Choose “Replace the earlier report” in the mapping and check again, or cancel this import. Summary reports have no line ids, so the file alone cannot tell which is right.</p>
          </Notice>
        ) : null}

        {(rejectedRes.data ?? []).length ? (
          <Card title={`Rejected rows (${s.quarantined})`}>
            <ul className="space-y-2 text-sm">
              {(rejectedRes.data as { row_number: number; reasons: string[]; source: Record<string, string> | null }[]).map((r) => (
                <li key={r.row_number} className="rounded border border-border p-2">
                  <p className="font-medium">Line {r.row_number}: {r.reasons.join("; ")}</p>
                  {r.source ? <p className="break-all text-xs text-muted">{Object.entries(r.source).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p> : null}
                </li>
              ))}
            </ul>
            {(s.quarantined ?? 0) > 50 ? <p className="mt-2 text-xs text-muted">Showing the first 50.</p> : null}
          </Card>
        ) : null}

        {(status === "needs_review" || status === "committed") && unmappedNow.length ? (
          <Card title={`Items to map (${unmappedNow.length})`}>
            <p className="mb-3 text-sm text-muted">Sales of unmapped items are left out of ingredient usage and variance, and counted in coverage. You can map them now or later; nothing needs re-importing.</p>
            <ul className="space-y-3">
              {unmappedNow.slice(0, 25).map((i) => (
                <li key={i.key} className="rounded-lg border border-border p-3">
                  <p className="mb-1 text-xs text-muted">{num(i.qty)} sold · {money(i.net)}</p>
                  <MapItemForm itemKey={i.key} itemName={i.name} recipes={recipes} back={`/imports/${id}`} />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {status === "needs_review" && app.can("imports.manage") ? (
          <Card title="Import">
            <CommitForm importId={id} quarantined={s.quarantined ?? 0} />
          </Card>
        ) : null}

        {status === "committed" ? (
          <Card title="Import report">
            <DataList items={[
              { label: "Sales lines added", value: num(s.inserted) },
              { label: "Skipped (already imported)", value: num(s.skipped_existing) },
              { label: "Items given modifiers", value: num(s.modifier_lines_updated) },
              { label: "Earlier reports replaced", value: num(s.superseded_imports) },
              { label: "Imported", value: imp.committed_at ? dateLabel(imp.committed_at, app.location.timezone) : "—" },
            ]} />
          </Card>
        ) : null}

        {!["committed", "committing", "superseded", "cancelled"].includes(status) ? <CancelImportForm importId={id} /> : null}
      </div>
    </>
  );
}
