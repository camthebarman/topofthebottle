import { Badge, EmptyState, PageHeader, Pagination } from "@/components/ui";
import { must } from "@/lib/action";
import { dateLabel, qty } from "@/lib/format";
import { getContext } from "@/lib/session";

export const metadata = { title: "Stock history" };
const PAGE = 50;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const app = await getContext();
  const rows = must(
    await app.supabase
      .from("stock_movements")
      .select("id, type, qty_base, occurred_at, reason, reverses_id, source_type, products(name, dimension, container_size_base, container_label)")
      .eq("location_id", app.location.id)
      .order("occurred_at", { ascending: false })
      .order("id")
      .range((page - 1) * PAGE, page * PAGE),
  ) as { id: string; type: string; qty_base: string; occurred_at: string; reason: string | null; reverses_id: string | null; source_type: string | null; products: unknown }[];
  const hasMore = rows.length > PAGE;
  return (
    <>
      <PageHeader title="Stock history" description={`All recorded movements at ${app.location.name}, newest first.`} />
      {rows.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {rows.slice(0, PAGE).map((m) => {
            const p = m.products as { name: string; dimension: "volume" | "mass" | "count"; container_size_base: string | null; container_label: string | null } | null;
            return (
              <li key={m.id} className="flex justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p?.name}</p>
                  <p className="text-xs text-muted">{m.type.replace(/_/g, " ")}{m.reverses_id ? " · reversal" : ""} · {dateLabel(m.occurred_at, app.location.timezone)}{m.reason ? ` · ${m.reason}` : ""}</p>
                </div>
                <span className="tabular shrink-0">{Number(m.qty_base) > 0 ? "+" : ""}{p ? qty(m.qty_base, p.dimension, p.container_size_base, p.container_label) : m.qty_base}{m.source_type === "count" ? <> <Badge>count</Badge></> : null}</span>
              </li>
            );
          })}
        </ul>
      ) : <EmptyState title="No movements yet" />}
      <Pagination page={page} hasMore={hasMore} makeHref={(p) => `/inventory/history?page=${p}`} />
    </>
  );
}
