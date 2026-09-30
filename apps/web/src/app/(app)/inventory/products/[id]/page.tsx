import { notFound } from "next/navigation";
import { d, fromBase, UNITS } from "@tz/domain";
import { Badge, Card, DataList, Notice, PageHeader } from "@/components/ui";
import { must } from "@/lib/action";
import { dateLabel, money, num, qty } from "@/lib/format";
import { getContext } from "@/lib/session";
import { ConversionForm, CostForm, ProductForm, ReverseForm, SupplierItemForm } from "../../forms";
import { unitOptions } from "../../units";

const MOVEMENT_LABEL: Record<string, string> = {
  opening_balance: "Opening balance",
  receipt: "Received",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  supplier_return: "Returned to supplier",
  waste: "Waste",
  breakage: "Breakage",
  production_consume: "Used in batch",
  production_output: "Batch made",
  event_dispatch: "Sent to event",
  event_return: "Returned from event",
  count_adjustment: "Count adjustment",
  manual_adjustment: "Adjustment",
};

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const app = await getContext();
  const { data: product } = await app.supabase.from("products").select("*").eq("id", id).eq("org_id", app.org.orgId).maybeSingle();
  if (!product) notFound();
  const canCost = app.can("costs.view");
  const [costs, conversions, items, suppliers, movements, par, balance] = await Promise.all([
    canCost ? app.supabase.from("product_costs").select("id, cost_per_base, effective_at, source, location_id").eq("product_id", id).order("effective_at", { ascending: false }).limit(10) : Promise.resolve({ data: [], error: null }),
    app.supabase.from("product_conversions").select("id, from_qty, from_unit, to_qty, to_unit, note").eq("product_id", id),
    app.supabase.from("supplier_items").select("id, supplier_sku, units_per_pack, unit_size_base, pack_label, suppliers(name)").eq("product_id", id),
    app.supabase.from("suppliers").select("id, name").eq("org_id", app.org.orgId).is("archived_at", null).order("name"),
    app.supabase.from("stock_movements").select("id, type, qty_base, occurred_at, reason, reverses_id").eq("product_id", id).eq("location_id", app.location.id).order("occurred_at", { ascending: false }).limit(25),
    app.supabase.from("location_products").select("par_base").eq("location_id", app.location.id).eq("product_id", id).maybeSingle(),
    app.supabase.rpc("book_balance", { p_org: app.org.orgId, p_location: app.location.id, p_product: id }),
  ]);
  const dim = product.dimension as "volume" | "mass" | "count";
  const baseUnit = dim === "volume" ? "ml" : dim === "mass" ? "g" : "each";
  const container = product.container_size_base ? d(product.container_size_base) : null;
  const containerUnit = dim === "volume" ? (container && container.gte(1000) && container.mod(1000).isZero() ? "l" : "ml") : dim === "mass" ? "g" : "each";
  const moves = must(movements) as { id: string; type: string; qty_base: string; occurred_at: string; reason: string | null; reverses_id: string | null }[];
  const reversedIds = new Set(moves.filter((m) => m.reverses_id).map((m) => m.reverses_id));
  const dimUnits = unitOptions.filter((u) => u.dimension === dim);

  return (
    <>
      <PageHeader title={product.name} description={`${product.category} · measured by ${dim}`} />
      <div className="space-y-4">
        {sp.saved ? <Notice tone="ok" role="status">Product saved.</Notice> : null}
        <Card title={`Stock at ${app.location.name}`}>
          <DataList
            items={[
              { label: "Book quantity", value: qty(must(balance) as string, dim, product.container_size_base, product.container_label) },
              { label: "In base units", value: `${num(must(balance) as string)} ${UNITS[baseUnit]!.label}` },
              { label: "Par", value: par.data?.par_base ? qty(par.data.par_base, dim, product.container_size_base, product.container_label) : "Not set" },
            ]}
          />
        </Card>

        {canCost ? (
          <Card title="Cost history">
            {(costs.data ?? []).length ? (
              <ul className="mb-3 divide-y divide-border text-sm">
                {(costs.data as { id: string; cost_per_base: string; effective_at: string; source: string; location_id: string | null }[]).map((c, i) => (
                  <li key={c.id} className="flex justify-between gap-3 py-2">
                    <span>{dateLabel(c.effective_at, app.location.timezone)} <Badge tone={i === 0 ? "ok" : "neutral"}>{c.source}</Badge>{c.location_id ? " (this location)" : ""}</span>
                    <span className="tabular">
                      {container ? `${money(d(c.cost_per_base).times(container))} / ${product.container_label ?? "container"}` : `${money(d(c.cost_per_base).times(dim === "volume" ? 1000 : dim === "mass" ? 1000 : 1))} / ${dim === "volume" ? "L" : dim === "mass" ? "kg" : "each"}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Notice tone="warn">No cost recorded. Recipes using this product show as incomplete until it has a cost.</Notice>
            )}
            {app.can("catalog.edit") ? <CostForm productId={id} units={dimUnits} /> : null}
            <p className="mt-2 text-xs text-muted">New costs never rewrite past reports: each report uses the cost in effect at its date.</p>
          </Card>
        ) : null}

        <Card title="Supplier pack sizes">
          <ul className="mb-3 text-sm">
            {(items.data ?? []).map((i: { id: string; supplier_sku: string | null; units_per_pack: string; unit_size_base: string; pack_label: string | null; suppliers: unknown }) => (
              <li key={i.id} className="py-1">
                {(i.suppliers as { name: string } | null)?.name}: {i.pack_label ?? "pack"} of {num(i.units_per_pack)} × {num(fromBase(i.unit_size_base, baseUnit))} {UNITS[baseUnit]!.label}{i.supplier_sku ? ` · SKU ${i.supplier_sku}` : ""}
              </li>
            ))}
            {!(items.data ?? []).length ? <li className="text-muted">None yet.</li> : null}
          </ul>
          {app.can("catalog.edit") ? <SupplierItemForm productId={id} suppliers={(suppliers.data ?? []) as { id: string; name: string }[]} units={dimUnits} /> : null}
        </Card>

        <Card title="Conversions">
          <p className="mb-2 text-sm text-muted">Bridges between measures for this product only, e.g. 1 lime = 30 mL juice, or 1 L honey = 1,420 g.</p>
          <ul className="mb-3 text-sm">
            {(conversions.data ?? []).map((c: { id: string; from_qty: string; from_unit: string; to_qty: string; to_unit: string; note: string | null }) => (
              <li key={c.id}>{num(c.from_qty)} {UNITS[c.from_unit]?.label} = {num(c.to_qty)} {UNITS[c.to_unit]?.label}{c.note ? ` (${c.note})` : ""}</li>
            ))}
          </ul>
          {app.can("catalog.edit") ? <ConversionForm productId={id} units={unitOptions} /> : null}
        </Card>

        <Card title="Recent movements here">
          {moves.length ? (
            <ul className="divide-y divide-border text-sm">
              {moves.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p>{MOVEMENT_LABEL[m.type] ?? m.type}{m.reverses_id ? " (reversal)" : ""}{reversedIds.has(m.id) ? <> <Badge>reversed</Badge></> : null}</p>
                    <p className="text-xs text-muted">{dateLabel(m.occurred_at, app.location.timezone)}{m.reason ? ` · ${m.reason}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="tabular font-medium">{Number(m.qty_base) > 0 ? "+" : ""}{qty(m.qty_base, dim, product.container_size_base, product.container_label)}</p>
                    {app.can("inventory.move") && !m.reverses_id && !reversedIds.has(m.id) && m.type !== "count_adjustment" ? <ReverseForm movementId={m.id} productId={id} /> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No movements yet.</p>
          )}
        </Card>

        {app.can("catalog.edit") ? (
          <Card title="Edit product">
            <ProductForm
              units={unitOptions}
              initial={{
                productId: id,
                version: String(product.version),
                name: product.name,
                category: product.category,
                dimension: dim,
                containerQty: container ? String(Number(fromBase(container, containerUnit))) : "",
                containerUnit,
                containerLabel: product.container_label ?? "",
                fullWeightG: product.full_weight_g ?? "",
                emptyWeightG: product.empty_weight_g ?? "",
                usableYieldPct: product.usable_yield_pct ?? "",
                countMethod: product.default_count_method,
                parQty: par.data?.par_base ? String(container ? Number(d(par.data.par_base).div(container)) : Number(par.data.par_base)) : "",
              }}
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}
