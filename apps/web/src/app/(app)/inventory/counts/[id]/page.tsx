import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { must } from "@/lib/action";
import { dateLabel, qty } from "@/lib/format";
import { getContext } from "@/lib/session";
import { CountLineForm, DeleteCountLineForm, FinalizeCountForm, VoidCountForm } from "../../forms";
import { unitOptions } from "../../units";

export default async function CountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; product?: string; finalized?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const app = await getContext();
  const { data: session } = await app.supabase.from("count_sessions").select("*").eq("id", id).eq("location_id", app.location.id).maybeSingle();
  if (!session) notFound();
  const [linesRes, productsRes, areasRes, adjRes] = await Promise.all([
    app.supabase.from("count_lines").select("id, product_id, area_id, method, full_units, tenths, gross_weight_g, qty_base, approximate, updated_at").eq("session_id", id).order("updated_at", { ascending: false }),
    app.supabase.from("products").select("id, name, dimension, container_size_base, container_label, default_count_method").eq("org_id", app.org.orgId).is("archived_at", null).order("name").limit(2000),
    app.supabase.from("inventory_areas").select("id, name").eq("location_id", app.location.id).is("archived_at", null).order("sort_order"),
    session.status === "finalized" ? app.supabase.from("stock_movements").select("product_id, qty_base").eq("source_type", "count").eq("source_id", id) : Promise.resolve({ data: [], error: null }),
  ]);
  const lines = must(linesRes) as { id: string; product_id: string; area_id: string | null; method: string; full_units: string; tenths: string | null; gross_weight_g: string | null; qty_base: string; approximate: boolean }[];
  const products = must(productsRes) as { id: string; name: string; dimension: "volume" | "mass" | "count"; container_size_base: string | null; container_label: string | null; default_count_method: string }[];
  const areas = must(areasRes) as { id: string; name: string }[];
  const byId = new Map(products.map((p) => [p.id, p]));
  const counted = new Set(lines.map((l) => l.product_id));
  const draft = session.status === "draft";
  const q = (sp.q ?? "").trim().toLowerCase();
  const matches = q ? products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20) : [];
  const selected = sp.product ? byId.get(sp.product) : undefined;
  const adjustments = (adjRes.data ?? []) as { product_id: string; qty_base: string }[];

  return (
    <>
      <PageHeader title={session.name || "Count"} description={<>Represents stock at {dateLabel(session.counted_at, app.location.timezone)} · <Badge tone={draft ? "warn" : "ok"}>{session.status}</Badge></>} />
      <div className="space-y-4">
        {sp.finalized ? <Notice tone="ok" role="status">Count finalized. {adjustments.length} product(s) were adjusted to match the count.</Notice> : null}
        {draft && app.can("inventory.count") ? (
          <Card title="Count a product">
            <form role="search" className="mb-3">
              <label htmlFor="q" className="sr-only">Find product</label>
              <input id="q" name="q" defaultValue={sp.q} autoFocus={!selected} placeholder="Find a product to count" className="block min-h-11 w-full rounded-lg border border-border bg-surface px-3" />
            </form>
            {matches.length ? (
              <ul className="mb-3 divide-y divide-border rounded-lg border border-border">
                {matches.map((p) => (
                  <li key={p.id}><Link className="flex min-h-11 items-center justify-between px-3 hover:bg-surface-2" href={`/inventory/counts/${id}?product=${p.id}`}>{p.name}{counted.has(p.id) ? <Badge tone="ok">counted</Badge> : null}</Link></li>
                ))}
              </ul>
            ) : q ? <p className="mb-3 text-sm text-muted">No products match.</p> : null}
            {selected ? (
              <div className="rounded-lg border border-accent p-3">
                <p className="mb-2 font-semibold">{selected.name}</p>
                <CountLineForm
                  sessionId={id}
                  areas={areas}
                  units={unitOptions}
                  product={{ id: selected.id, name: selected.name, dimension: selected.dimension, method: selected.default_count_method, containerLabel: selected.container_label, hasContainer: !!selected.container_size_base }}
                />
                <p className="mt-2 text-xs text-muted">Tenths and scale readings are estimates and are marked approximate in reports.</p>
              </div>
            ) : null}
          </Card>
        ) : null}

        <Card title={`Counted (${counted.size} products)`}>
          {lines.length ? (
            <ul className="divide-y divide-border">
              {lines.map((l) => {
                const p = byId.get(l.product_id);
                return (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p?.name ?? "Unknown"}</p>
                      <p className="text-xs text-muted">{areas.find((a) => a.id === l.area_id)?.name ?? "Whole location"} · {l.method}{l.approximate ? " · approximate" : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular">{p ? qty(l.qty_base, p.dimension, p.container_size_base, p.container_label) : l.qty_base}{l.approximate ? " ≈" : ""}</span>
                      {draft && app.can("inventory.count") ? <DeleteCountLineForm lineId={l.id} sessionId={id} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-sm text-muted">Nothing counted yet.</p>}
        </Card>

        {session.status === "finalized" && adjustments.length ? (
          <Card title="Adjustments posted">
            <ul className="text-sm">
              {adjustments.map((a) => {
                const p = byId.get(a.product_id);
                return <li key={a.product_id} className="flex justify-between py-1"><span>{p?.name}</span><span className="tabular">{Number(a.qty_base) > 0 ? "+" : ""}{p ? qty(a.qty_base, p.dimension, p.container_size_base, p.container_label) : a.qty_base}</span></li>;
              })}
            </ul>
            <p className="mt-2 text-xs text-muted">Differences between the count and the book. Insights explains them against sales and records.</p>
          </Card>
        ) : null}

        {draft ? (
          <div className="flex flex-wrap gap-2">
            {app.can("inventory.finalize") ? <FinalizeCountForm sessionId={id} version={session.version} uncounted={products.length - counted.size} /> : <Notice>A manager finalizes this count.</Notice>}
            {app.can("inventory.count") ? <VoidCountForm sessionId={id} version={session.version} /> : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
