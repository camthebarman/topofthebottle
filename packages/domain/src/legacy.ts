/**
 * Import plan for data exported from the earlier browser tools (86d food/bev,
 * Don't Go Pour, Clayton bar/catering). Those tools kept state in localStorage
 * with units in fl oz / oz (weight) / each.
 *
 * Rule: every source record is either mapped into the plan or reported as an
 * exception with a reason. Nothing is dropped silently, and invalid values
 * (zero yield, missing references) are reported, never coerced.
 */
import { d, type Decimal, tryDecimal } from "./decimal";
import { toBase } from "./units";

type Dim = "volume" | "mass" | "count";

export interface LegacyException {
  kind: string;
  sourceId: string | null;
  name: string | null;
  reason: string;
}

export interface PlannedProduct {
  sourceId: string;
  name: string;
  category: string;
  dimension: Dim;
  costPerBase: Decimal | null;
  onHandBase: Decimal | null;
  parBase: Decimal | null;
  usableYieldPct: Decimal | null;
}

export interface PlannedComponent {
  productSourceId: string | null;
  recipeSourceId: string | null;
  qty: string;
  unit: string;
}

export interface PlannedRecipe {
  sourceId: string;
  name: string;
  kind: "drink" | "dish" | "prep";
  components: PlannedComponent[];
  yieldServings: string | null;
  yieldQty: string | null;
  yieldUnit: string | null;
  menuPrice: Decimal | null;
}

export interface LegacyPlan {
  source: string;
  products: PlannedProduct[];
  recipes: PlannedRecipe[];
  exceptions: LegacyException[];
  counts: Record<string, { found: number; imported: number }>;
}

const BASE_TO_DIM: Record<string, { dim: Dim; unit: string }> = {
  floz: { dim: "volume", unit: "fl_oz" },
  ozwt: { dim: "mass", unit: "oz_wt" },
  each: { dim: "count", unit: "each" },
};

// Purchase units of the old tools, expressed in our units.
const PURCHASE: Record<string, { qty: string; unit: string }> = {
  floz: { qty: "1", unit: "fl_oz" }, ml: { qty: "1", unit: "ml" }, liter: { qty: "1", unit: "l" }, gal: { qty: "1", unit: "gal" },
  cup: { qty: "1", unit: "cup" }, pint: { qty: "1", unit: "pint" }, qt: { qty: "1", unit: "quart" }, tbsp: { qty: "1", unit: "tbsp" }, tsp: { qty: "1", unit: "tsp" },
  bottle750: { qty: "750", unit: "ml" }, ml750: { qty: "750", unit: "ml" }, bottle1l: { qty: "1000", unit: "ml" }, ml1000: { qty: "1000", unit: "ml" }, ml1750: { qty: "1750", unit: "ml" },
  "keg half": { qty: "58.67", unit: "l" }, "keg sixth": { qty: "19.55", unit: "l" }, can12: { qty: "12", unit: "fl_oz" },
  ozwt: { qty: "1", unit: "oz_wt" }, lb: { qty: "1", unit: "lb" }, g: { qty: "1", unit: "g" }, kg: { qty: "1", unit: "kg" },
  each: { qty: "1", unit: "each" }, dozen: { qty: "12", unit: "each" }, case24: { qty: "24", unit: "each" },
};

const KNOWN_TOP = new Set(["ingredients", "recipes", "preps", "settings", "version", "seedVersion"]);

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : typeof v === "number" ? String(v) : null;
}

/** Quantity maps (Clayton kept stock per location: {loc_a: 3, loc_b: 1}) are summed and reported. */
function quantity(v: unknown, ex: LegacyException[], ctx: { kind: string; id: string; name: string }): Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>);
    let total = d(0);
    for (const [, q] of entries) {
      const x = tryDecimal(q);
      if (x === null) {
        ex.push({ kind: ctx.kind, sourceId: ctx.id, name: ctx.name, reason: "A per-location quantity is not a number" });
        return null;
      }
      total = total.plus(x);
    }
    if (entries.length > 1) ex.push({ kind: ctx.kind, sourceId: ctx.id, name: ctx.name, reason: `Stock was split across ${entries.length} places; imported as one total at the chosen location` });
    return total;
  }
  return tryDecimal(v);
}

export function planLegacyImport(raw: unknown, source = "legacy export"): LegacyPlan {
  const exceptions: LegacyException[] = [];
  const counts: LegacyPlan["counts"] = {};
  const products: PlannedProduct[] = [];
  const recipes: PlannedRecipe[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { source, products, recipes, exceptions: [{ kind: "file", sourceId: null, name: null, reason: "Not a JSON object exported from the old tools" }], counts };
  }
  const state = raw as Record<string, unknown>;

  // Products from ingredients.
  const productIds = new Set<string>();
  const ingredients = asArray(state.ingredients);
  counts.ingredients = { found: ingredients.length, imported: 0 };
  for (const i of ingredients) {
    const id = str(i.id);
    const name = str(i.name);
    if (!id || !name) {
      exceptions.push({ kind: "ingredient", sourceId: id, name, reason: "Missing id or name" });
      continue;
    }
    const base = BASE_TO_DIM[String(i.baseUnit)];
    if (!base) {
      exceptions.push({ kind: "ingredient", sourceId: id, name, reason: `Unknown base unit "${String(i.baseUnit)}"` });
      continue;
    }
    const ctx = { kind: "ingredient", id, name };
    // Cost per base unit: purchase cost / (purchase qty in base).
    let costPerBase: Decimal | null = null;
    const pu = PURCHASE[String(i.purchaseUnit ?? i.baseUnit)];
    const pq = tryDecimal(i.purchaseQty);
    const pc = tryDecimal(i.purchaseCost);
    if (pu && pq && pc && pq.gt(0)) {
      const conv = toBase(d(pu.qty).times(pq), pu.unit, base.dim);
      if (conv.ok && conv.value.gt(0)) costPerBase = pc.div(conv.value);
      else exceptions.push({ kind: "ingredient", sourceId: id, name, reason: "Purchase unit does not match how it is measured; cost not imported" });
    } else if (i.purchaseCost !== undefined) {
      exceptions.push({ kind: "ingredient", sourceId: id, name, reason: "Purchase quantity or cost missing or zero; cost not imported" });
    }
    const toOurBase = (q: Decimal | null) => (q === null ? null : (() => { const c = toBase(q, base.unit, base.dim); return c.ok ? c.value : null; })());
    const onHand = toOurBase(quantity(i.onHandQty ?? i.onHand, exceptions, ctx));
    const par = toOurBase(quantity(i.parQty ?? i.par, exceptions, ctx));
    let usableYieldPct: Decimal | null = null;
    if (i.yieldPct !== undefined && i.yieldPct !== null) {
      const y = tryDecimal(i.yieldPct);
      // The old tools treated 0 as 100%; that silently hid bad data, so it is reported instead.
      if (y === null || y.lte(0) || y.gt(100)) exceptions.push({ kind: "ingredient", sourceId: id, name, reason: `Usable yield "${String(i.yieldPct)}" is invalid; left blank for review` });
      else if (!y.eq(100)) usableYieldPct = y;
    }
    products.push({ sourceId: id, name, category: String(i.category ?? "other").toLowerCase().slice(0, 30), dimension: base.dim, costPerBase, onHandBase: onHand, parBase: par, usableYieldPct });
    productIds.add(id);
    counts.ingredients.imported++;
  }

  // Preps become prep recipes with a measured yield.
  const prepIds = new Set(asArray(state.preps).map((p) => str(p.id)).filter((x): x is string => !!x));
  const preps = asArray(state.preps);
  counts.preps = { found: preps.length, imported: 0 };
  const componentsOf = (owner: Record<string, unknown>, kind: string, id: string, name: string): PlannedComponent[] | null => {
    const out: PlannedComponent[] = [];
    for (const c of asArray(owner.components)) {
      const ref = str(c.ingredientId);
      const qty = tryDecimal(c.qty);
      if (!ref || qty === null || qty.lt(0)) {
        exceptions.push({ kind, sourceId: id, name, reason: `A component has a missing reference or invalid quantity` });
        return null;
      }
      if (productIds.has(ref)) {
        const p = products.find((x) => x.sourceId === ref)!;
        out.push({ productSourceId: ref, recipeSourceId: null, qty: qty.toFixed(), unit: p.dimension === "volume" ? "fl_oz" : p.dimension === "mass" ? "oz_wt" : "each" });
      } else if (prepIds.has(ref)) {
        const prep = preps.find((x) => str(x.id) === ref)!;
        const unit = BASE_TO_DIM[String(prep.baseUnit ?? "floz")]?.unit ?? "fl_oz";
        out.push({ productSourceId: null, recipeSourceId: ref, qty: qty.toFixed(), unit });
      } else {
        exceptions.push({ kind, sourceId: id, name, reason: `Uses ingredient "${ref}", which is not in the file` });
        return null;
      }
    }
    return out;
  };
  for (const p of preps) {
    const id = str(p.id);
    const name = str(p.name);
    if (!id || !name) {
      exceptions.push({ kind: "prep", sourceId: id, name, reason: "Missing id or name" });
      continue;
    }
    const y = tryDecimal(p.yieldQty);
    const unit = BASE_TO_DIM[String(p.baseUnit ?? "floz")]?.unit;
    if (!y || y.lte(0) || !unit) {
      exceptions.push({ kind: "prep", sourceId: id, name, reason: "Zero or missing batch yield; not imported (the old tool treated it as free)" });
      continue;
    }
    const comps = componentsOf(p, "prep", id, name);
    if (!comps) continue;
    recipes.push({ sourceId: id, name, kind: "prep", components: comps, yieldServings: null, yieldQty: y.toFixed(), yieldUnit: unit, menuPrice: null });
    counts.preps.imported++;
  }

  const rs = asArray(state.recipes);
  counts.recipes = { found: rs.length, imported: 0 };
  for (const r of rs) {
    const id = str(r.id);
    const name = str(r.name);
    if (!id || !name) {
      exceptions.push({ kind: "recipe", sourceId: id, name, reason: "Missing id or name" });
      continue;
    }
    const comps = componentsOf(r, "recipe", id, name);
    if (!comps) continue;
    const portions = r.portions === undefined ? d(1) : tryDecimal(r.portions);
    if (!portions || portions.lte(0)) {
      exceptions.push({ kind: "recipe", sourceId: id, name, reason: "Zero or invalid portions per batch; not imported" });
      continue;
    }
    const price = tryDecimal(r.menuPrice);
    recipes.push({ sourceId: id, name, kind: r.portions !== undefined || r.menu === "food" ? "dish" : "drink", components: comps, yieldServings: portions.toFixed(), yieldQty: null, yieldUnit: null, menuPrice: price && price.gt(0) ? price : null });
    counts.recipes.imported++;
  }

  // Everything else in the file is reported, with a count, rather than dropped.
  const NOT_IMPORTED: Record<string, string> = {
    batches: "Prepared batches are not imported. Record current batch stock with a count after import.",
    transfers: "Transfer history is not imported. Stock is imported as current totals.",
    orders: "Catering orders are not imported. Recreate upcoming events in Events.",
    locations: "Locations are not created automatically. Create them in Settings, then import per location.",
    tables: "Floor/table data is outside this product.",
    waitlist: "Floor/table data is outside this product.",
  };
  for (const [key, value] of Object.entries(state)) {
    if (KNOWN_TOP.has(key)) continue;
    const n = Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 1;
    counts[key] = { found: n, imported: 0 };
    exceptions.push({ kind: key, sourceId: null, name: null, reason: `${n} record(s): ${NOT_IMPORTED[key] ?? "Not recognised; kept in the uploaded file only."}` });
  }
  if (state.settings && typeof state.settings === "object") {
    const keys = Object.keys(state.settings as object);
    counts.settings = { found: keys.length, imported: 0 };
    if (keys.length) exceptions.push({ kind: "settings", sourceId: null, name: null, reason: `Settings not imported (${keys.join(", ")}); review them in Settings.` });
  }
  return { source, products, recipes, exceptions, counts };
}


