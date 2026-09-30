/**
 * Recipe costing and availability engine.
 *
 * A recipe is exploded into the stocked products it consumes. Quantities are
 * aggregated per product, so an ingredient listed twice (or reached through
 * two different preparations) is counted once with the combined demand.
 *
 * Anything that cannot be resolved (missing product mapping, missing price,
 * zero or invalid yield, a unit that cannot be converted, a cycle) becomes an
 * explicit issue. Results with issues are incomplete: their totals are null
 * and only a labelled "known subtotal" is returned.
 */
import { d, Decimal, type DecimalInput, HUNDRED, ZERO, pct } from "./decimal";
import { issue, type Issue, uniqueIssues } from "./issues";
import { type Dimension, type ProductConversion, toBase, UNITS } from "./units";

export interface ProductInfo {
  id: string;
  name: string;
  /** Dimension the product is stocked and costed in. */
  dimension: Dimension;
  /** Cost per base unit (per mL / g / each) as purchased. Null = unknown. */
  costPerBase: Decimal | null;
  /** ISO date the cost was last established. */
  costAsOf?: string | null;
  /** Share of the purchased quantity that is usable, 0 < pct <= 100. Null means 100. */
  usableYieldPct?: Decimal | null;
  conversions?: ProductConversion[];
  /** Book or counted on-hand quantity in base units, as purchased. */
  onHandBase?: Decimal | null;
  /** True when the on-hand figure includes estimated partial containers. */
  onHandApproximate?: boolean;
}

export type ComponentRef =
  | { kind: "product"; id: string }
  | { kind: "ingredient"; id: string }
  | { kind: "recipe"; id: string };

export interface RecipeComponent {
  ref: ComponentRef;
  qty: DecimalInput;
  unit: string;
  /** Overrides the product's usable yield for this use (e.g. trim for a specific cut). */
  yieldPct?: DecimalInput | null;
  label?: string;
}

export type RecipeYield = { servings: DecimalInput } | { qty: DecimalInput; unit: string };

export interface RecipeVersion {
  id: string;
  recipeId: string;
  name: string;
  kind: "drink" | "dish" | "prep";
  components: RecipeComponent[];
  yield: RecipeYield;
  /** A prep that is batched into stock is tracked as this product. */
  producesProductId?: string | null;
  conversions?: ProductConversion[];
}

export interface CostingContext {
  products: ReadonlyMap<string, ProductInfo>;
  /** Effective version per recipe id. */
  recipes: ReadonlyMap<string, RecipeVersion>;
  /** Generic ingredient id -> stocked product id at this location. */
  ingredientMap: ReadonlyMap<string, string>;
  ingredientNames?: ReadonlyMap<string, string>;
}

/**
 * raw: expand every prep down to raw products (what could be made from scratch).
 * prepared: consume batched preps from their own stock, not their ingredients.
 */
export type ExpansionMode = "raw" | "prepared";

export interface ProductDemand {
  productId: string;
  name: string;
  dimension: Dimension;
  /** Usable quantity required (base units). */
  usableBase: Decimal;
  /** As-purchased quantity required, after yield. Null when yield is invalid. */
  asPurchasedBase: Decimal | null;
  approximate: boolean;
}

export interface Explosion {
  demand: Map<string, ProductDemand>;
  issues: Issue[];
  complete: boolean;
  approximate: boolean;
}

function refLabel(ctx: CostingContext, ref: ComponentRef): string {
  if (ref.kind === "product") return ctx.products.get(ref.id)?.name ?? `product ${ref.id}`;
  if (ref.kind === "recipe") return ctx.recipes.get(ref.id)?.name ?? `recipe ${ref.id}`;
  return ctx.ingredientNames?.get(ref.id) ?? `ingredient ${ref.id}`;
}

function validYieldPct(v: DecimalInput | null | undefined): Decimal | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  let y: Decimal;
  try {
    y = d(v);
  } catch {
    return "invalid";
  }
  if (!y.isFinite() || y.lte(0) || y.gt(100)) return "invalid";
  return y;
}

/** Base-unit size of one batch of a recipe, or an issue if unusable. */
function recipeYieldBase(
  recipe: RecipeVersion,
): { ok: true; dimension: Dimension | "servings"; base: Decimal } | { ok: false; issue: Issue } {
  const y = recipe.yield;
  if ("servings" in y) {
    const s = safeDecimal(y.servings);
    if (!s || s.lte(0)) {
      return { ok: false, issue: issue("invalid_yield", `${recipe.name} has no valid serving yield`, { ref: recipe.recipeId }) };
    }
    return { ok: true, dimension: "servings", base: s };
  }
  const unit = UNITS[y.unit];
  const q = safeDecimal(y.qty);
  if (!unit || !q || q.lte(0)) {
    return { ok: false, issue: issue("invalid_yield", `${recipe.name} has no valid batch yield`, { ref: recipe.recipeId }) };
  }
  return { ok: true, dimension: unit.dimension, base: q.times(unit.toBase) };
}

function safeDecimal(v: DecimalInput | null | undefined): Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    const x = d(v);
    return x.isFinite() ? x : null;
  } catch {
    return null;
  }
}

/**
 * Explode `batches` of a recipe into product demand.
 * For serving-yield recipes, pass servings via {@link explodeServings}.
 */
export function explodeRecipe(
  ctx: CostingContext,
  recipeId: string,
  batches: Decimal,
  mode: ExpansionMode = "raw",
): Explosion {
  const demand = new Map<string, ProductDemand>();
  const issues: Issue[] = [];
  let approximate = false;

  const addProduct = (product: ProductInfo, usable: Decimal, yieldOverride: DecimalInput | null | undefined, path: string[], approx: boolean) => {
    const override = validYieldPct(yieldOverride);
    const productYield = validYieldPct(product.usableYieldPct ?? null);
    let yieldPct: Decimal | null | "invalid" = override !== null ? override : productYield;
    if (yieldPct === null) yieldPct = HUNDRED;
    let asPurchased: Decimal | null = null;
    if (yieldPct === "invalid") {
      issues.push(issue("invalid_yield", `${product.name} has a zero or invalid usable yield`, { ref: product.id, path }));
    } else {
      asPurchased = usable.times(HUNDRED).div(yieldPct);
    }
    const existing = demand.get(product.id);
    if (existing) {
      existing.usableBase = existing.usableBase.plus(usable);
      existing.asPurchasedBase =
        existing.asPurchasedBase === null || asPurchased === null ? null : existing.asPurchasedBase.plus(asPurchased);
      existing.approximate ||= approx;
    } else {
      demand.set(product.id, {
        productId: product.id,
        name: product.name,
        dimension: product.dimension,
        usableBase: usable,
        asPurchasedBase: asPurchased,
        approximate: approx,
      });
    }
    if (approx) approximate = true;
  };

  const walk = (rid: string, multiplier: Decimal, path: string[], stack: Set<string>) => {
    const recipe = ctx.recipes.get(rid);
    if (!recipe) {
      issues.push(issue("missing_component", `Recipe ${rid} could not be found`, { ref: rid, path }));
      return;
    }
    if (stack.has(rid)) {
      issues.push(issue("cycle", `${recipe.name} includes itself through ${path.join(" → ")}`, { ref: rid, path }));
      return;
    }
    const nextStack = new Set(stack).add(rid);
    const here = [...path, recipe.name];

    for (const comp of recipe.components) {
      const qty = safeDecimal(comp.qty);
      const label = refLabel(ctx, comp.ref);
      if (!qty || qty.lt(0)) {
        issues.push(issue("invalid_quantity", `${label} in ${recipe.name} has an invalid quantity`, { ref: comp.ref.id, path: here }));
        continue;
      }
      if (qty.isZero()) continue;

      if (comp.ref.kind === "recipe") {
        const sub = ctx.recipes.get(comp.ref.id);
        if (!sub) {
          issues.push(issue("missing_component", `${label} in ${recipe.name} could not be found`, { ref: comp.ref.id, path: here }));
          continue;
        }
        if (nextStack.has(sub.recipeId) || nextStack.has(comp.ref.id)) {
          issues.push(issue("cycle", `${sub.name} is used inside itself (${[...here, sub.name].join(" → ")})`, { ref: comp.ref.id, path: here }));
          continue;
        }
        // Batched prep held in stock: consume the prepared product itself.
        if (mode === "prepared" && sub.producesProductId) {
          const prepProduct = ctx.products.get(sub.producesProductId);
          if (prepProduct) {
            const conv = toBase(qty, comp.unit, prepProduct.dimension, [...(prepProduct.conversions ?? []), ...(sub.conversions ?? [])], prepProduct.id);
            if (!conv.ok) {
              issues.push({ ...conv.issue, path: here });
              continue;
            }
            addProduct(prepProduct, conv.value.times(multiplier), comp.yieldPct, here, conv.approximate);
            continue;
          }
        }
        const y = recipeYieldBase(sub);
        if (!y.ok) {
          issues.push({ ...y.issue, path: here });
          continue;
        }
        let compBase: Decimal;
        let approx = false;
        if (y.dimension === "servings") {
          if (comp.unit !== "each") {
            issues.push(issue("unit_mismatch", `${sub.name} is measured in servings; use "each"`, { ref: comp.ref.id, path: here }));
            continue;
          }
          compBase = qty;
        } else {
          const conv = toBase(qty, comp.unit, y.dimension, sub.conversions ?? [], sub.recipeId);
          if (!conv.ok) {
            issues.push({ ...conv.issue, path: here });
            continue;
          }
          compBase = conv.value;
          approx = conv.approximate;
        }
        if (approx) approximate = true;
        walk(comp.ref.id, multiplier.times(compBase).div(y.base), here, nextStack);
        continue;
      }

      let productId: string | undefined;
      if (comp.ref.kind === "ingredient") {
        productId = ctx.ingredientMap.get(comp.ref.id);
        if (!productId) {
          issues.push(issue("missing_mapping", `${label} is not mapped to a stocked product`, { ref: comp.ref.id, path: here }));
          continue;
        }
      } else {
        productId = comp.ref.id;
      }
      const product = ctx.products.get(productId);
      if (!product) {
        issues.push(issue("missing_component", `${label} refers to a product that could not be found`, { ref: productId, path: here }));
        continue;
      }
      const conv = toBase(qty, comp.unit, product.dimension, product.conversions ?? [], product.id);
      if (!conv.ok) {
        issues.push({ ...conv.issue, message: `${product.name}: ${conv.issue.message}`, path: here });
        continue;
      }
      addProduct(product, conv.value.times(multiplier), comp.yieldPct, here, conv.approximate);
    }
  };

  walk(recipeId, batches, [], new Set());
  const unique = uniqueIssues(issues);
  return { demand, issues: unique, complete: unique.length === 0, approximate };
}

/** Explode a number of servings of a serving-yield recipe (drink or dish). */
export function explodeServings(ctx: CostingContext, recipeId: string, servings: DecimalInput, mode: ExpansionMode = "raw"): Explosion {
  const recipe = ctx.recipes.get(recipeId);
  if (!recipe) {
    return {
      demand: new Map(),
      issues: [issue("missing_component", `Recipe ${recipeId} could not be found`, { ref: recipeId })],
      complete: false,
      approximate: false,
    };
  }
  const y = recipeYieldBase(recipe);
  if (!y.ok) return { demand: new Map(), issues: [y.issue], complete: false, approximate: false };
  if (y.dimension !== "servings") {
    return {
      demand: new Map(),
      issues: [issue("unit_mismatch", `${recipe.name} yields a quantity, not servings`, { ref: recipeId })],
      complete: false,
      approximate: false,
    };
  }
  return explodeRecipe(ctx, recipeId, d(servings).div(y.base), mode);
}

export interface CostLine {
  productId: string;
  name: string;
  asPurchasedBase: Decimal | null;
  costPerBase: Decimal | null;
  cost: Decimal | null;
  costAsOf: string | null;
}

export interface CostResult {
  /** Full cost; null whenever any input is missing or invalid. */
  total: Decimal | null;
  /** Sum of the lines that could be priced. Never present this as the total. */
  knownSubtotal: Decimal;
  complete: boolean;
  lines: CostLine[];
  issues: Issue[];
  warnings: Issue[];
  /** Oldest cost date among priced lines. */
  oldestCostAsOf: string | null;
}

export interface CostOptions {
  mode?: ExpansionMode;
  /** Reference date (YYYY-MM-DD) for freshness warnings. */
  asOf?: string;
  maxPriceAgeDays?: number;
}

export function costExplosion(ctx: CostingContext, exp: Explosion, opts: CostOptions = {}): CostResult {
  const issues = [...exp.issues];
  const warnings: Issue[] = [];
  const lines: CostLine[] = [];
  let known = ZERO;
  let oldest: string | null = null;
  for (const dem of exp.demand.values()) {
    const product = ctx.products.get(dem.productId);
    const cpb = product?.costPerBase ?? null;
    const asOf = product?.costAsOf ?? null;
    let cost: Decimal | null = null;
    if (cpb === null) {
      issues.push(issue("missing_price", `${dem.name} has no cost`, { ref: dem.productId }));
    } else if (cpb.lt(0)) {
      issues.push(issue("invalid_price", `${dem.name} has a negative cost`, { ref: dem.productId }));
    } else if (dem.asPurchasedBase !== null) {
      cost = dem.asPurchasedBase.times(cpb);
      known = known.plus(cost);
    }
    if (asOf && (oldest === null || asOf < oldest)) oldest = asOf;
    if (asOf && opts.asOf && opts.maxPriceAgeDays !== undefined) {
      const ageDays = (Date.parse(opts.asOf) - Date.parse(asOf)) / 86_400_000;
      if (ageDays > opts.maxPriceAgeDays) {
        warnings.push(issue("stale_price", `${dem.name} cost is ${Math.floor(ageDays)} days old`, { ref: dem.productId }));
      }
    }
    lines.push({ productId: dem.productId, name: dem.name, asPurchasedBase: dem.asPurchasedBase, costPerBase: cpb, cost, costAsOf: asOf });
  }
  const unique = uniqueIssues(issues);
  const complete = unique.length === 0;
  return { total: complete ? known : null, knownSubtotal: known, complete, lines, issues: unique, warnings, oldestCostAsOf: oldest };
}

/** Ingredient cost of one serving of a menu recipe. */
export function costPerServing(ctx: CostingContext, recipeId: string, opts: CostOptions = {}): CostResult {
  return costExplosion(ctx, explodeServings(ctx, recipeId, 1, opts.mode ?? "raw"), opts);
}

/** Cost per base unit of a prep's yield (e.g. per mL of syrup). */
export function prepCostPerBase(ctx: CostingContext, recipeId: string, opts: CostOptions = {}): { costPerBase: Decimal | null; result: CostResult } {
  const recipe = ctx.recipes.get(recipeId);
  const result = costExplosion(ctx, explodeRecipe(ctx, recipeId, d(1), opts.mode ?? "raw"), opts);
  if (!recipe) return { costPerBase: null, result };
  const y = recipeYieldBase(recipe);
  if (!y.ok) {
    return { costPerBase: null, result: { ...result, total: null, complete: false, issues: uniqueIssues([...result.issues, y.issue]) } };
  }
  return { costPerBase: result.total === null ? null : result.total.div(y.base), result };
}

export interface MenuMetrics {
  cost: Decimal | null;
  price: Decimal | null;
  /** Ingredient cost as % of selling price. */
  costPct: Decimal | null;
  /** Selling price minus ingredient cost. This is NOT operating profit. */
  ingredientMargin: Decimal | null;
  ingredientMarginPct: Decimal | null;
  /** Price that would hit the target ingredient cost %. */
  targetPrice: Decimal | null;
  complete: boolean;
}

export function menuMetrics(cost: CostResult, price: Decimal | null, targetCostPct: Decimal | null): MenuMetrics {
  const c = cost.total;
  const validPrice = price !== null && price.gt(0) ? price : null;
  const validTarget = targetCostPct !== null && targetCostPct.gt(0) && targetCostPct.lt(100) ? targetCostPct : null;
  return {
    cost: c,
    price: validPrice,
    costPct: c !== null && validPrice ? pct(c, validPrice) : null,
    ingredientMargin: c !== null && validPrice ? validPrice.minus(c) : null,
    ingredientMarginPct: c !== null && validPrice ? pct(validPrice.minus(c), validPrice) : null,
    targetPrice: c !== null && validTarget ? c.times(HUNDRED).div(validTarget) : null,
    complete: cost.complete && validPrice !== null,
  };
}

export interface Availability {
  /** Whole servings possible. Null when inputs are incomplete. */
  servings: number | null;
  /** Servings computed from the known inputs only; an upper bound, not a count. */
  upperBound: number | null;
  limitingProductIds: string[];
  complete: boolean;
  approximate: boolean;
  issues: Issue[];
}

/**
 * How many servings current stock supports. `raw` ignores batched prep stock
 * and asks what could be made from scratch; `prepared` draws preps from their
 * own stock. The two are reported separately so batch stock and the raw
 * ingredients already used to make it are never counted together.
 */
export function availableServings(ctx: CostingContext, recipeId: string, mode: ExpansionMode = "raw"): Availability {
  const exp = explodeServings(ctx, recipeId, 1, mode);
  const issues = [...exp.issues];
  let best: Decimal | null = null;
  let limiting: string[] = [];
  let approximate = exp.approximate;
  for (const dem of exp.demand.values()) {
    const product = ctx.products.get(dem.productId);
    if (dem.asPurchasedBase === null || dem.asPurchasedBase.lte(0)) continue;
    const onHand = product?.onHandBase ?? null;
    if (onHand === null) {
      issues.push(issue("missing_count", `${dem.name} has no stock figure`, { ref: dem.productId }));
      continue;
    }
    if (product?.onHandApproximate) approximate = true;
    const possible = Decimal.max(onHand, ZERO).div(dem.asPurchasedBase);
    if (best === null || possible.lt(best)) {
      best = possible;
      limiting = [dem.productId];
    } else if (possible.eq(best)) {
      limiting.push(dem.productId);
    }
  }
  const unique = uniqueIssues(issues);
  const complete = unique.length === 0 && exp.demand.size > 0;
  const bound = best === null ? null : best.floor().toNumber();
  return { servings: complete ? bound : null, upperBound: bound, limitingProductIds: limiting, complete, approximate, issues: unique };
}
