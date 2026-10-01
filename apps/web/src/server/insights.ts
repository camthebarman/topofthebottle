import "server-only";
import { createHash } from "node:crypto";
import {
  businessDate,
  businessDayBounds,
  capability,
  computeVariance,
  type CostingContext,
  type CountObservation,
  d,
  type Decimal,
  DEFAULT_VARIANCE_OPTIONS,
  type ModifierMapping,
  type Movement,
  type NormalizedSale,
  type PosItemMapping,
  type RecipeVersion,
  theoreticalUsage,
  type VarianceLine,
  ZERO,
} from "@tz/domain";
import { must } from "@/lib/action";
import { fetchAll } from "@/lib/fetch-all";
import type { AppContext } from "@/lib/session";
import { type ComponentRow, loadCatalog, toRecipeVersion, type VersionRow } from "./catalog";
import { orgSettings } from "./menu";

export const CALC_VERSION = "variance-v1";

export interface CountSession {
  id: string;
  name: string | null;
  counted_at: string;
}

export async function finalizedCounts(app: AppContext): Promise<CountSession[]> {
  return must(await app.supabase.from("count_sessions").select("id, name, counted_at").eq("location_id", app.location.id).eq("status", "finalized").order("counted_at", { ascending: false }).limit(60)) as CountSession[];
}

async function countObservations(app: AppContext, sessionId: string, countedAt: string): Promise<Map<string, CountObservation>> {
  const rows = (await fetchAll((a, b) => app.supabase.from("count_lines").select("id, product_id, qty_base, approximate, uncertainty_base").eq("session_id", sessionId).order("id").range(a, b))) as { product_id: string; qty_base: string; approximate: boolean; uncertainty_base: string }[];
  const out = new Map<string, CountObservation>();
  for (const r of rows) {
    const o = out.get(r.product_id) ?? { qtyBase: ZERO, countedAt, approximate: false, uncertaintyBase: ZERO };
    o.qtyBase = o.qtyBase.plus(r.qty_base);
    o.approximate ||= r.approximate;
    o.uncertaintyBase = o.uncertaintyBase.plus(r.uncertainty_base);
    out.set(r.product_id, o);
  }
  return out;
}

interface Effective {
  from: string;
  to: string | null;
}
const inEffect = (e: Effective, date: string) => e.from <= date && (e.to === null || date < e.to);

export interface InsightsReport {
  opening: CountSession;
  closing: CountSession;
  period: { fromDate: string; toDate: string };
  capability: ReturnType<typeof capability>;
  lines: VarianceLine[];
  totals: { unexplainedValueReview: Decimal; unexplainedValueAll: Decimal; netSales: Decimal; theoreticalCost: Decimal | null };
  coverage: { netTotal: Decimal; netResolved: Decimal; pct: Decimal | null; notStockNet: Decimal; lines: number; linesResolved: number };
  unresolved: { name: string; reason: string; quantity: Decimal; netSales: Decimal }[];
  treatmentNotes: [string, number][];
  menuMix: { itemKey: string; name: string; quantity: Decimal; netSales: Decimal; recipeName: string | null }[];
  voidCompByHour: { hour: number; kind: string; lines: number; quantity: string }[];
  partialAggregateLines: number;
  costBasis: string;
  inputHash: string;
  calcVersion: string;
}

export async function buildReport(app: AppContext, openingId: string, closingId: string): Promise<InsightsReport> {
  const counts = await finalizedCounts(app);
  const opening = counts.find((c) => c.id === openingId);
  const closing = counts.find((c) => c.id === closingId);
  if (!opening || !closing) throw new Error("Choose two finalized counts at this location");
  if (Date.parse(closing.counted_at) <= Date.parse(opening.counted_at)) throw new Error("The closing count must be after the opening count");
  const tz = app.location.timezone;
  const cutoff = app.location.businessDayCutoff;
  const fromDate = businessDate(new Date(opening.counted_at), tz, cutoff);
  const toDate = businessDate(new Date(closing.counted_at), tz, cutoff);
  const settings = await orgSettings(app);

  const [cat, openObs, closeObs, movesRes, salesRes, partialRes, itemMapRes, modMapRes, versionsRes, ingMapRes, ledgerRes, vcRes] = await Promise.all([
    loadCatalog(app, { asOf: closing.counted_at, includeArchived: true }),
    countObservations(app, opening.id, opening.counted_at),
    countObservations(app, closing.id, closing.counted_at),
    fetchAll((a, b) => app.supabase.from("stock_movements").select("id, product_id, type, qty_base, occurred_at, reverses_id, reason").eq("location_id", app.location.id).gt("occurred_at", opening.counted_at).lte("occurred_at", closing.counted_at).neq("type", "count_adjustment").order("occurred_at").order("id").range(a, b)),
    // Dates strictly inside the period for date-only rows: the opening day is partly before the count.
    fetchAll((a, b) => app.supabase.rpc("sales_summary", { p_org: app.org.orgId, p_location: app.location.id, p_from: opening.counted_at, p_to: closing.counted_at, p_from_date: fromDate, p_to_date: toDate }).range(a, b)),
    app.supabase.rpc("sales_partial_overlap", { p_org: app.org.orgId, p_location: app.location.id, p_from_date: fromDate, p_to_date: toDate }),
    fetchAll((a, b) => app.supabase.from("pos_item_mappings").select("id, item_key, item_name, recipe_id, not_stock, servings_per_unit, effective_from, effective_to").eq("location_id", app.location.id).order("id").range(a, b)),
    fetchAll((a, b) => app.supabase.from("modifier_mappings").select("id, modifier_key, item_key, actions, effective_from, effective_to").eq("location_id", app.location.id).order("id").range(a, b)),
    fetchAll((a, b) => app.supabase.from("recipe_versions").select("*").eq("org_id", app.org.orgId).lte("effective_from", closing.counted_at).order("id").range(a, b)),
    fetchAll((a, b) => app.supabase.from("ingredient_mappings").select("id, ingredient_id, product_id, effective_from, effective_to").eq("location_id", app.location.id).lte("effective_from", closing.counted_at).order("id").range(a, b)),
    app.can("costs.view") ? app.supabase.rpc("ledger_unit_costs", { p_org: app.org.orgId, p_location: app.location.id, p_as_of: closing.counted_at }) : Promise.resolve({ data: [], error: null }),
    app.supabase.rpc("void_comp_by_hour", { p_org: app.org.orgId, p_location: app.location.id, p_from: opening.counted_at, p_to: closing.counted_at, p_tz: tz }),
  ]);

  const moves: Movement[] = (movesRes as { id: string; product_id: string; type: Movement["type"]; qty_base: string; occurred_at: string; reverses_id: string | null; reason: string | null }[]).map((m) => ({
    id: m.id, productId: m.product_id, type: m.type, qtyBase: d(m.qty_base), occurredAt: m.occurred_at, reversesId: m.reverses_id, reason: m.reason,
  }));
  const salesGroups = salesRes as { business_date: string; item_key: string; item_name: string; modifiers: string[]; kind: NormalizedSale["kind"]; void_prepared: boolean | null; quantity: string; net_sales: string | null; gross_sales: string | null; lines: number }[];

  // Date-effective item mappings; "not stock" items are set aside, not counted as unmapped.
  const itemMaps = itemMapRes as { item_key: string; item_name: string; recipe_id: string | null; not_stock: boolean; servings_per_unit: string; effective_from: string; effective_to: string | null }[];
  const mapFor = (key: string, date: string) => itemMaps.find((m) => m.item_key === key && inEffect({ from: m.effective_from, to: m.effective_to }, date)) ?? null;
  const modMaps = modMapRes as { modifier_key: string; item_key: string | null; actions: ModifierMapping["actions"]; effective_from: string; effective_to: string | null }[];

  let notStockNet = ZERO;
  const sales: NormalizedSale[] = [];
  for (const g of salesGroups) {
    const m = mapFor(g.item_key, g.business_date);
    const net = d(g.net_sales ?? g.gross_sales ?? 0);
    if (m?.not_stock) {
      if (g.kind === "sale" || g.kind === "comp") notStockNet = notStockNet.plus(net);
      continue;
    }
    sales.push({
      rowNumber: 0, businessDate: g.business_date, businessDateEnd: g.business_date, occurredAt: null, transactionId: null, lineId: null, parentLineId: null,
      itemKey: g.item_key, itemName: g.item_name, category: null, modifiers: g.modifiers ?? [], quantity: d(g.quantity),
      grossSales: g.gross_sales === null ? null : d(g.gross_sales), netSales: g.net_sales === null ? null : d(g.net_sales), discount: null,
      kind: g.kind, voidPrepared: g.void_prepared, staffRef: null, dedupeKey: "",
    });
  }

  // Recipe versions and ingredient mappings in effect on each business date (end of that day).
  // Normalise timestamps so they compare correctly as strings (PostgREST uses +00:00 and microseconds).
  const iso = (t: string) => new Date(t).toISOString();
  const versions = (versionsRes as VersionRow[]).map((v) => ({ ...v, effective_from: iso(v.effective_from) }));
  const versionComps = new Map<string, ComponentRow[]>();
  const vIds = versions.map((v) => v.id);
  for (let i = 0; i < vIds.length; i += 150) {
    const chunk = vIds.slice(i, i + 150);
    const rows = (await fetchAll((a, b) => app.supabase.from("recipe_components").select("id, recipe_version_id, position, product_id, ingredient_id, sub_recipe_id, qty, unit, yield_pct, label").in("recipe_version_id", chunk).order("id").range(a, b))) as ComponentRow[];
    for (const r of rows) versionComps.set(r.recipe_version_id, [...(versionComps.get(r.recipe_version_id) ?? []), r]);
  }
  const ingMaps = (ingMapRes as { ingredient_id: string; product_id: string; effective_from: string; effective_to: string | null }[]).map((m) => ({ ...m, effective_from: iso(m.effective_from), effective_to: m.effective_to ? iso(m.effective_to) : null }));
  const ctxCache = new Map<string, CostingContext>();
  // Version in effect at the end of each business day. For dates before a recipe or
  // mapping was first entered, the version in effect at the closing count is used: it is
  // the spec the bar settled on, rather than a first draft saved during setup.
  const closeIso = iso(closing.counted_at);
  const atClose = new Map<string, VersionRow>();
  const firstEntered = new Map<string, string>();
  for (const v of versions) {
    const f = firstEntered.get(v.recipe_id);
    if (!f || v.effective_from < f) firstEntered.set(v.recipe_id, v.effective_from);
    if (v.effective_from > closeIso) continue;
    const c = atClose.get(v.recipe_id);
    if (!c || v.effective_from > c.effective_from || (v.effective_from === c.effective_from && v.version > c.version)) atClose.set(v.recipe_id, v);
  }
  const mapAtClose = new Map<string, (typeof ingMaps)[number]>();
  const mapFirstEntered = new Map<string, string>();
  for (const m of ingMaps) {
    const f = mapFirstEntered.get(m.ingredient_id);
    if (!f || m.effective_from < f) mapFirstEntered.set(m.ingredient_id, m.effective_from);
    if (m.effective_from <= closeIso && (m.effective_to === null || m.effective_to > closeIso)) mapAtClose.set(m.ingredient_id, m);
  }
  const contextFor = (date: string): CostingContext => {
    const cached = ctxCache.get(date);
    if (cached) return cached;
    const endOfDay = businessDayBounds(date, tz, cutoff).end.toISOString();
    const recipes = new Map<string, RecipeVersion>();
    const latest = new Map<string, VersionRow>();
    for (const [rid, first] of firstEntered) if (first > endOfDay && atClose.has(rid)) latest.set(rid, atClose.get(rid)!);
    for (const v of versions) {
      if (v.effective_from > endOfDay) continue;
      const cur = latest.get(v.recipe_id);
      if (!cur || v.effective_from > cur.effective_from || (v.effective_from === cur.effective_from && v.version > cur.version)) latest.set(v.recipe_id, v);
    }
    const prepForProduct = new Map<string, string>();
    for (const [rid, v] of latest) {
      const r = cat.recipeById.get(rid);
      if (!r) continue;
      recipes.set(rid, toRecipeVersion(r, v, versionComps.get(v.id) ?? []));
      if (v.produces_product_id) prepForProduct.set(v.produces_product_id, rid);
    }
    const ingredientMap = new Map<string, string>();
    for (const [iid, first] of mapFirstEntered) if (first > endOfDay && mapAtClose.has(iid)) ingredientMap.set(iid, mapAtClose.get(iid)!.product_id);
    for (const m of ingMaps) if (m.effective_from <= endOfDay && (m.effective_to === null || m.effective_to > endOfDay)) ingredientMap.set(m.ingredient_id, m.product_id);
    const ctx: CostingContext = { ...cat.ctx, recipes, ingredientMap, prepForProduct };
    ctxCache.set(date, ctx);
    return ctx;
  };

  const usage = theoreticalUsage(sales, {
    contextFor,
    itemMapping: (key, date): PosItemMapping | null => {
      const m = mapFor(key, date);
      return m?.recipe_id ? { itemKey: key, recipeId: m.recipe_id, servingsPerUnit: m.servings_per_unit } : null;
    },
    modifierMapping: (mod, key, date) => {
      const live = modMaps.filter((m) => m.modifier_key === mod && inEffect({ from: m.effective_from, to: m.effective_to }, date));
      const hit = live.find((m) => m.item_key === key) ?? live.find((m) => m.item_key === null);
      return hit ? { modifierKey: mod, itemKey: hit.item_key, actions: hit.actions } : null;
    },
    policy: { voidPreparedConsumes: settings.void_prepared_consumes, compConsumes: settings.comp_consumes },
  });
  const coveragePct = usage.netSalesTotal.isZero() ? (usage.lines ? d(100) : null) : usage.netSalesResolved.div(usage.netSalesTotal).times(100);

  // Cost basis: valuation from the ledger at the closing count, else the effective cost then.
  type LedgerCost = { product_id: string; moving_average: string | null; last_cost: string | null };
  const ledger = new Map(((ledgerRes.data ?? []) as LedgerCost[]).map((l) => [l.product_id, l]));
  const costOf = (pid: string): Decimal | null => {
    if (!app.can("costs.view")) return null;
    const l = ledger.get(pid);
    const v = l ? (settings.valuation_method === "last_cost" ? l.last_cost : l.moving_average) : null;
    return v ? d(v) : (cat.costs.get(pid)?.costPerBase ?? null);
  };
  const costBasis = `${settings.valuation_method === "last_cost" ? "Last receipt cost" : "Moving average cost"} at the closing count; recorded product cost where no receipts exist`;

  const productIds = new Set<string>([...openObs.keys(), ...closeObs.keys(), ...moves.map((m) => m.productId), ...usage.byProduct.keys()]);
  const lines: VarianceLine[] = [];
  const opts = { reviewThresholdPct: d(settings.variance_review_pct), minCoveragePct: d(settings.min_sales_coverage_pct) };
  for (const pid of productIds) {
    const p = cat.productById.get(pid);
    if (!p) continue;
    lines.push(
      computeVariance(
        {
          productId: pid,
          name: p.name,
          dimension: p.dimension,
          opening: openObs.get(pid) ?? null,
          closing: closeObs.get(pid) ?? null,
          movements: moves.filter((m) => m.productId === pid),
          servedBase: usage.byProduct.get(pid)?.asPurchasedBase ?? ZERO,
          salesCoveragePct: coveragePct,
          costPerBase: costOf(pid),
          costBasis,
        },
        opts ?? DEFAULT_VARIANCE_OPTIONS,
      ),
    );
  }
  const rank: Record<string, number> = { requires_review: 0, incomplete: 1, within_uncertainty: 2, insufficient_data: 3 };
  lines.sort((a, b) => rank[a.status]! - rank[b.status]! || (b.unexplainedValue?.abs().toNumber() ?? 0) - (a.unexplainedValue?.abs().toNumber() ?? 0) || a.name.localeCompare(b.name));

  // Menu mix and theoretical cost of sales.
  const mix = new Map<string, { name: string; quantity: Decimal; netSales: Decimal }>();
  let netSales = ZERO;
  for (const g of salesGroups) {
    if (g.kind === "void" || g.kind === "refund") continue;
    const e = mix.get(g.item_key) ?? { name: g.item_name, quantity: ZERO, netSales: ZERO };
    e.quantity = e.quantity.plus(g.quantity);
    e.netSales = e.netSales.plus(g.net_sales ?? g.gross_sales ?? 0);
    netSales = netSales.plus(g.net_sales ?? g.gross_sales ?? 0);
    mix.set(g.item_key, e);
  }
  let theoreticalCost: Decimal | null = app.can("costs.view") ? ZERO : null;
  for (const [pid, u] of usage.byProduct) {
    const c = costOf(pid);
    if (theoreticalCost !== null) theoreticalCost = c === null ? null : theoreticalCost.plus(u.asPurchasedBase.times(c));
  }

  const { count: txCount } = await app.supabase.from("sales_lines").select("id", { head: true, count: "exact" }).eq("location_id", app.location.id).gt("occurred_at", opening.counted_at).lte("occurred_at", closing.counted_at);
  const hasTransactions = (txCount ?? 0) > 0;
  const cap = capability({
    hasSales: salesGroups.length > 0,
    salesAreTransactions: hasTransactions,
    hasRecipeMappings: itemMaps.some((m) => m.recipe_id),
    hasPurchasesOrMovements: moves.length > 0,
    hasAlignedCounts: openObs.size > 0 && closeObs.size > 0,
  });

  const review = lines.filter((l) => l.status === "requires_review");
  const report: Omit<InsightsReport, "inputHash"> = {
    opening,
    closing,
    period: { fromDate, toDate },
    capability: cap,
    lines,
    totals: {
      unexplainedValueReview: review.reduce((a, l) => a.plus(l.unexplainedValue ?? 0), ZERO),
      unexplainedValueAll: lines.reduce((a, l) => a.plus(l.unexplainedValue ?? 0), ZERO),
      netSales,
      theoreticalCost,
    },
    coverage: { netTotal: usage.netSalesTotal, netResolved: usage.netSalesResolved, pct: coveragePct, notStockNet, lines: usage.lines, linesResolved: usage.linesResolved },
    unresolved: usage.unresolved.map((u) => ({ name: u.name, reason: u.reason, quantity: u.quantity, netSales: u.netSales })),
    treatmentNotes: [...usage.treatmentNotes.entries()],
    menuMix: [...mix.entries()].map(([k, v]) => ({ itemKey: k, ...v, recipeName: (() => { const m = mapFor(k, toDate); return m?.recipe_id ? (cat.recipeById.get(m.recipe_id)?.name ?? null) : m?.not_stock ? "Not stock" : null; })() })).sort((a, b) => b.netSales.comparedTo(a.netSales)).slice(0, 50),
    voidCompByHour: ((vcRes.data ?? []) as { hour: number; kind: string; lines: number; quantity: string }[]),
    partialAggregateLines: Number(partialRes.data ?? 0),
    costBasis,
    calcVersion: CALC_VERSION,
  };
  const inputHash = createHash("sha256").update(JSON.stringify({ v: CALC_VERSION, lines: report.lines, coverage: report.coverage, unresolved: report.unresolved })).digest("hex");
  return { ...report, inputHash };
}

/**
 * Evidence for an AI explanation: only computed figures, product names and
 * data gaps. No staff, guests, notes, costs of unrelated items or raw rows.
 */
export function aiEvidence(r: InsightsReport) {
  const lines = r.lines
    .filter((l) => l.status === "requires_review" || l.status === "incomplete")
    .slice(0, 25)
    .map((l) => ({
      id: `v:${l.productId.slice(0, 8)}`,
      product: l.name.slice(0, 80),
      status: l.status,
      unit: l.dimension === "volume" ? "mL" : l.dimension === "mass" ? "g" : "each",
      physical_depletion: l.physicalDepletion?.toFixed(1) ?? null,
      accounted_depletion: l.accountedDepletion.toFixed(1),
      served_by_recipe: l.served.toFixed(1),
      waste_and_breakage: l.waste.plus(l.breakage).toFixed(1),
      unexplained: l.unexplained?.toFixed(1) ?? null,
      unexplained_pct_of_accounted: l.unexplainedPct?.toFixed(1) ?? null,
      unexplained_value: l.unexplainedValue?.toFixed(2) ?? null,
      count_uncertainty: l.uncertaintyBase.toFixed(1),
      approximate_counts: l.issues.some((i) => i.code === "approximate_measurement"),
      manual_adjustments: l.manualAdjustments.toFixed(1),
    }));
  return {
    period: r.period,
    sales_coverage_pct: r.coverage.pct?.toFixed(1) ?? null,
    unmapped_sales: r.unresolved.slice(0, 10).map((u, i) => ({ id: `u:${i}`, item: u.name.slice(0, 80), reason: u.reason.slice(0, 120), quantity: u.quantity.toFixed() })),
    lines,
    capability: r.capability.level,
    missing_analysis: r.capability.unavailable,
  };
}
