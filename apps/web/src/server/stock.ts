import "server-only";
import { d, type Decimal, suggestedOrderPacks } from "@tz/domain";
import { must } from "@/lib/action";
import type { AppContext } from "@/lib/session";
import type { Catalog } from "./catalog";

export interface StockRow {
  productId: string;
  name: string;
  category: string;
  dimension: "volume" | "mass" | "count";
  onHand: Decimal;
  parBase: Decimal | null;
  belowPar: boolean;
  suggestedPacks: number | null;
  packLabel: string | null;
  value: Decimal | null;
  containerSizeBase: string | null;
  containerLabel: string | null;
}

/** Book stock, par and value for the location. Value uses the configured valuation method. */
export async function stockRows(app: AppContext, cat: Catalog, valuation: "moving_average" | "last_cost"): Promise<StockRow[]> {
  const [lp, items, ledger] = await Promise.all([
    app.supabase.from("location_products").select("product_id, par_base, preferred_supplier_item_id").eq("location_id", app.location.id).limit(5000),
    app.supabase.from("supplier_items").select("id, product_id, units_per_pack, unit_size_base, pack_label").eq("org_id", app.org.orgId).limit(5000),
    app.can("costs.view") ? app.supabase.rpc("ledger_unit_costs", { p_org: app.org.orgId, p_location: app.location.id }) : Promise.resolve({ data: [], error: null }),
  ]);
  const pars = new Map((must(lp) as { product_id: string; par_base: string | null; preferred_supplier_item_id: string | null }[]).map((r) => [r.product_id, r]));
  const packs = new Map<string, { base: Decimal; label: string | null }>();
  const itemRows = must(items) as { id: string; product_id: string; units_per_pack: string; unit_size_base: string; pack_label: string | null }[];
  for (const i of itemRows) {
    const pref = pars.get(i.product_id)?.preferred_supplier_item_id;
    if (!packs.has(i.product_id) || pref === i.id) packs.set(i.product_id, { base: d(i.units_per_pack).times(i.unit_size_base), label: i.pack_label });
  }
  type LedgerCost = { product_id: string; last_cost: string | null; moving_average: string | null };
  const ledgerCosts = new Map<string, LedgerCost>(((ledger.data ?? []) as LedgerCost[]).map((l) => [l.product_id, l]));
  return cat.products
    .filter((p) => !p.archived_at)
    .map((p) => {
      const onHand = cat.onHand.get(p.id) ?? d(0);
      const par = pars.get(p.id)?.par_base ? d(pars.get(p.id)!.par_base!) : null;
      const pack = packs.get(p.id) ?? null;
      const sug = suggestedOrderPacks(par, onHand, pack?.base ?? null);
      let cpb: Decimal | null = null;
      if (app.can("costs.view")) {
        const l = ledgerCosts.get(p.id);
        const v = l ? (valuation === "last_cost" ? l.last_cost : l.moving_average) : null;
        if (v !== null && v !== undefined) cpb = d(v);
        cpb ??= cat.costs.get(p.id)?.costPerBase ?? null;
      }
      return {
        productId: p.id,
        name: p.name,
        category: p.category,
        dimension: p.dimension,
        onHand,
        parBase: par,
        belowPar: !!par && onHand.lt(par),
        suggestedPacks: sug.packs,
        packLabel: pack?.label ?? null,
        value: cpb ? Decimal_max0(onHand).times(cpb) : null,
        containerSizeBase: p.container_size_base,
        containerLabel: p.container_label,
      };
    });
}

function Decimal_max0(v: Decimal): Decimal {
  return v.lt(0) ? d(0) : v;
}
