import Link from "next/link";
import { sum } from "@tz/domain";
import { Badge, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import { money, qty } from "@/lib/format";
import { getContext } from "@/lib/session";
import { loadCatalog } from "@/server/catalog";
import { orgSettings } from "@/server/menu";
import { stockRows } from "@/server/stock";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  const sp = await searchParams;
  const app = await getContext();
  const [cat, settings] = await Promise.all([loadCatalog(app), orgSettings(app)]);
  let rows = await stockRows(app, cat, settings.valuation_method);
  const all = rows;
  const q = (sp.q ?? "").trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.category.includes(q));
  if (sp.filter === "below-par") rows = rows.filter((r) => r.belowPar);
  const valued = all.filter((r) => r.value !== null);
  const totalValue = sum(valued.map((r) => r.value!));
  const below = all.filter((r) => r.belowPar).length;

  const links: [string, string, string | null][] = [
    ["/inventory/counts", "Counts", "inventory.count"],
    ["/inventory/record", "Waste, transfers & batches", "inventory.move"],
    ["/inventory/invoices", "Invoices", "invoices.upload"],
    ["/inventory/products", "Products", null],
    ["/inventory/suppliers", "Suppliers", "catalog.edit"],
    ["/inventory/history", "History", null],
  ];
  return (
    <>
      <PageHeader title="Inventory" description={`Book stock at ${app.location.name}: last finalized count plus recorded movements.`} />
      <nav aria-label="Inventory sections" className="mb-4 flex flex-wrap gap-2">
        {links.filter(([, , p]) => !p || app.can(p)).map(([href, label]) => (
          <LinkButton key={href} href={href}>{label}</LinkButton>
        ))}
      </nav>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Products" value={all.length} />
        <Stat label="Below par" value={below} tone={below ? "warn" : undefined} hint={<Link className="underline" href="/inventory?filter=below-par">Show</Link>} />
        {app.can("costs.view") ? <Stat label="Book value" value={money(totalValue)} hint={`${valued.length} of ${all.length} valued · ${settings.valuation_method === "last_cost" ? "last cost" : "moving average"}`} /> : null}
      </div>
      <form role="search" className="mb-3">
        <label htmlFor="q" className="sr-only">Search products</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Search products" className="block min-h-11 w-full rounded-lg border border-border bg-surface px-3" />
      </form>
      {rows.length === 0 ? (
        <EmptyState title={all.length ? "No products match" : "No products yet"} action={app.can("catalog.edit") && !all.length ? <LinkButton variant="primary" href="/inventory/products/new">Add a product</LinkButton> : null}>
          {all.length ? "Try another search." : "Add the bottles, mixers and garnishes you stock."}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {rows.map((r) => (
            <li key={r.productId}>
              <Link href={`/inventory/products/${r.productId}`} className="flex min-h-14 items-center justify-between gap-3 px-3 py-2 hover:bg-surface-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.name}</p>
                  <p className="text-sm text-muted">
                    {r.category}
                    {r.belowPar ? <> · <Badge tone="warn">Below par</Badge></> : null}
                    {r.onHand.lt(0) ? <> · <Badge tone="danger">Negative book</Badge></> : null}
                  </p>
                </div>
                <div className="shrink-0 text-right text-sm tabular">
                  <p className="font-semibold">{qty(r.onHand, r.dimension, r.containerSizeBase, r.containerLabel)}</p>
                  {r.suggestedPacks ? <p className="text-warn">Order {r.suggestedPacks} {r.packLabel ?? "pack(s)"}</p> : null}
                  {app.can("costs.view") && r.value ? <p className="text-muted">{money(r.value)}</p> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
