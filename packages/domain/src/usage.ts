/**
 * Theoretical usage: what the recorded sales should have consumed, according
 * to the recipe versions and mappings in effect on each business date.
 *
 * A sale that cannot be fully resolved (unmapped item, unmapped modifier,
 * incomplete recipe) contributes nothing to usage and is counted in the
 * coverage figures instead. Nothing is assumed: an unknown modifier is never
 * treated as a standard pour.
 */
import { type ComponentRef, type CostingContext, explodeServings, type RecipeComponent, type RecipeVersion } from "./costing";
import { d, Decimal, type DecimalInput, ZERO } from "./decimal";
import { issue, type Issue, uniqueIssues } from "./issues";
import { consumedServings, DEFAULT_TREATMENT, normalizeItemKey, type NormalizedSale, type TreatmentPolicy } from "./pos";

export interface PosItemMapping {
  itemKey: string;
  recipeId: string;
  /** Servings of the recipe per POS unit sold (e.g. a pitcher = 4). */
  servingsPerUnit?: DecimalInput;
}

export type ModifierAction =
  | { kind: "ignore" }
  | { kind: "scale"; factor: DecimalInput }
  | { kind: "add"; ref: ComponentRef; qty: DecimalInput; unit: string }
  | { kind: "substitute"; from: ComponentRef; to: ComponentRef };

export interface ModifierMapping {
  modifierKey: string;
  /** When set, the mapping applies only to this POS item. */
  itemKey?: string | null;
  actions: ModifierAction[];
}

export interface UsageDeps {
  /** Costing context (recipe versions, product mappings, costs) effective on a business date. */
  contextFor(businessDate: string): CostingContext;
  itemMapping(itemKey: string, businessDate: string): PosItemMapping | null;
  modifierMapping(modifierKey: string, itemKey: string, businessDate: string): ModifierMapping | null;
  policy?: TreatmentPolicy;
}

export interface ProductUsage {
  productId: string;
  name: string;
  asPurchasedBase: Decimal;
  usableBase: Decimal;
}

export interface UnresolvedItem {
  itemKey: string;
  name: string;
  quantity: Decimal;
  netSales: Decimal;
  lines: number;
  reason: string;
}

export interface UsageResult {
  byProduct: Map<string, ProductUsage>;
  lines: number;
  linesResolved: number;
  netSalesTotal: Decimal;
  netSalesResolved: Decimal;
  unresolved: UnresolvedItem[];
  treatmentNotes: Map<string, number>;
  issues: Issue[];
}

function sameRef(a: ComponentRef, b: ComponentRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

function applyModifiers(
  base: RecipeVersion,
  mods: ModifierMapping[],
): { recipe: RecipeVersion; scale: Decimal; error: string | null } {
  if (!mods.length) return { recipe: base, scale: d(1), error: null };
  let components: RecipeComponent[] = base.components.map((c) => ({ ...c }));
  let scale = d(1);
  const yieldServings = "servings" in base.yield ? d(base.yield.servings) : d(1);
  for (const m of mods) {
    for (const a of m.actions) {
      if (a.kind === "ignore") continue;
      if (a.kind === "scale") {
        const f = d(a.factor);
        if (f.lte(0)) return { recipe: base, scale, error: `Modifier "${m.modifierKey}" has an invalid scale` };
        scale = scale.times(f);
      } else if (a.kind === "add") {
        // Additions are per serving; recipe components are per batch.
        components.push({ ref: a.ref, qty: d(a.qty).times(yieldServings), unit: a.unit });
      } else if (a.kind === "substitute") {
        let matched = false;
        components = components.map((c) => {
          if (sameRef(c.ref, a.from)) {
            matched = true;
            return { ...c, ref: a.to };
          }
          return c;
        });
        if (!matched) return { recipe: base, scale, error: `Modifier "${m.modifierKey}" substitutes an ingredient the recipe does not use` };
      }
    }
  }
  const key = mods.map((m) => m.modifierKey).sort().join("+");
  return { recipe: { ...base, id: `${base.id}+${key}`, recipeId: `${base.recipeId}+${key}`, components }, scale, error: null };
}

export function theoreticalUsage(sales: Iterable<NormalizedSale>, deps: UsageDeps): UsageResult {
  const policy = deps.policy ?? DEFAULT_TREATMENT;
  const byProduct = new Map<string, ProductUsage>();
  const unresolved = new Map<string, UnresolvedItem>();
  const treatmentNotes = new Map<string, number>();
  const issues: Issue[] = [];
  let lines = 0;
  let linesResolved = 0;
  let netTotal = ZERO;
  let netResolved = ZERO;

  // Group identical (date, item, modifiers) lines so each combination is exploded once.
  type Group = { date: string; itemKey: string; name: string; modifiers: string[]; servings: Decimal; lines: number; net: Decimal; qty: Decimal };
  const groups = new Map<string, Group>();
  for (const s of sales) {
    lines++;
    const net = s.kind === "void" ? ZERO : (s.netSales ?? s.grossSales ?? ZERO);
    netTotal = netTotal.plus(s.kind === "refund" ? ZERO : net);
    const c = consumedServings(s, policy);
    if (c.note) treatmentNotes.set(c.note, (treatmentNotes.get(c.note) ?? 0) + 1);
    const mods = s.modifiers.map(normalizeItemKey).sort();
    const key = `${s.businessDate}|${s.itemKey}|${mods.join("+")}`;
    const g = groups.get(key) ?? { date: s.businessDate, itemKey: s.itemKey, name: s.itemName, modifiers: mods, servings: ZERO, lines: 0, net: ZERO, qty: ZERO };
    g.servings = g.servings.plus(c.servings);
    g.lines++;
    if (s.kind !== "refund") g.net = g.net.plus(net);
    g.qty = g.qty.plus(c.servings);
    groups.set(key, g);
  }

  const markUnresolved = (g: Group, reason: string) => {
    const k = `${g.itemKey}|${reason}`;
    const u = unresolved.get(k) ?? { itemKey: g.itemKey, name: g.name, quantity: ZERO, netSales: ZERO, lines: 0, reason };
    u.quantity = u.quantity.plus(g.qty);
    u.netSales = u.netSales.plus(g.net);
    u.lines += g.lines;
    unresolved.set(k, u);
  };

  for (const g of groups.values()) {
    if (g.servings.isZero()) {
      // Nothing consumed (e.g. unprepared voids); resolved by policy.
      linesResolved += g.lines;
      netResolved = netResolved.plus(g.net);
      continue;
    }
    const mapping = deps.itemMapping(g.itemKey, g.date);
    if (!mapping) {
      markUnresolved(g, "POS item is not mapped to a recipe");
      continue;
    }
    const mods: ModifierMapping[] = [];
    let missingMod: string | null = null;
    for (const m of g.modifiers) {
      const mm = deps.modifierMapping(m, g.itemKey, g.date);
      if (!mm) {
        missingMod = m;
        break;
      }
      mods.push(mm);
    }
    if (missingMod !== null) {
      markUnresolved(g, `Modifier "${missingMod}" is not mapped`);
      continue;
    }
    const ctx = deps.contextFor(g.date);
    const base = ctx.recipes.get(mapping.recipeId);
    if (!base) {
      markUnresolved(g, "Mapped recipe was not in effect on this date");
      continue;
    }
    const applied = applyModifiers(base, mods);
    if (applied.error) {
      markUnresolved(g, applied.error);
      continue;
    }
    const overlay: CostingContext = mods.length
      ? { ...ctx, recipes: new Map([...ctx.recipes, [applied.recipe.recipeId, applied.recipe]]) }
      : ctx;
    const servings = g.servings.times(d(mapping.servingsPerUnit ?? 1)).times(applied.scale);
    const exp = explodeServings(overlay, applied.recipe.recipeId, servings, "prepared");
    if (!exp.complete) {
      markUnresolved(g, `Recipe is incomplete: ${exp.issues[0]?.message ?? "unknown issue"}`);
      issues.push(...exp.issues);
      continue;
    }
    for (const dem of exp.demand.values()) {
      const u = byProduct.get(dem.productId) ?? { productId: dem.productId, name: dem.name, asPurchasedBase: ZERO, usableBase: ZERO };
      u.asPurchasedBase = u.asPurchasedBase.plus(dem.asPurchasedBase ?? ZERO);
      u.usableBase = u.usableBase.plus(dem.usableBase);
      byProduct.set(dem.productId, u);
    }
    linesResolved += g.lines;
    netResolved = netResolved.plus(g.net);
  }

  for (const u of unresolved.values()) {
    issues.push(issue(u.reason.startsWith("Modifier") ? "unmapped_modifier" : "unmapped_pos_item", `${u.name}: ${u.reason}`, { ref: u.itemKey }));
  }

  return {
    byProduct,
    lines,
    linesResolved,
    netSalesTotal: netTotal,
    netSalesResolved: netResolved,
    unresolved: [...unresolved.values()].sort((a, b) => b.netSales.comparedTo(a.netSales)),
    treatmentNotes,
    issues: uniqueIssues(issues),
  };
}
