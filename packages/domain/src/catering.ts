/**
 * Beverage event planning.
 *
 * Planning figures are adjustable assumptions, not predictions. Allocation
 * uses the largest-remainder method so whole-drink counts by category and by
 * recipe always add back up to the event total.
 */
import { type CostingContext, costExplosion, explodeServings } from "./costing";
import { d, Decimal, type DecimalInput, HUNDRED, ZERO } from "./decimal";
import { issue, type Issue } from "./issues";

export const DRINK_CATEGORIES = ["cocktail", "beer", "wine", "non_alcoholic"] as const;
export type DrinkCategory = (typeof DRINK_CATEGORIES)[number];

/** Split `total` whole units by `weights`, preserving the total exactly. */
export function largestRemainder(total: number, weights: Decimal[]): number[] {
  const sumW = weights.reduce((s, w) => s.plus(w), ZERO);
  if (total <= 0 || sumW.lte(0)) return weights.map(() => 0);
  const exact = weights.map((w) => w.times(total).div(sumW));
  const floors = exact.map((x) => x.floor().toNumber());
  let remaining = total - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x.minus(x.floor()) })).sort((a, b) => b.r.comparedTo(a.r) || a.i - b.i);
  for (const { i } of order) {
    if (remaining <= 0) break;
    floors[i]!++;
    remaining--;
  }
  return floors;
}

export interface EventAssumptions {
  guests: number;
  /** Share of guests expected to drink, 0-100. */
  participationPct: DecimalInput;
  durationHours: DecimalInput;
  /** Drinks per participant in the first hour. */
  firstHourDrinks: DecimalInput;
  /** Drinks per participant in each later hour. */
  laterHourDrinks: DecimalInput;
  /** Extra allowance on top of expected demand, 0-100. */
  contingencyPct: DecimalInput;
  mix: Record<DrinkCategory, DecimalInput>;
}

export interface EventRecipeChoice {
  recipeId: string;
  category: DrinkCategory;
  /** Share within its category, 0-100. */
  sharePct: DecimalInput;
}

export interface EventDemand {
  expectedDrinks: Decimal;
  plannedDrinks: number;
  byCategory: Record<DrinkCategory, number>;
  byRecipe: { recipeId: string; category: DrinkCategory; servings: number }[];
  /** Planned drinks in categories that have no recipe selected (e.g. beer by the bottle). */
  unassigned: Record<DrinkCategory, number>;
  issues: Issue[];
}

function sumPct(values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>((s, v) => s.plus(d(v)), ZERO);
}

export function planEventDemand(a: EventAssumptions, choices: EventRecipeChoice[]): EventDemand {
  const issues: Issue[] = [];
  const mixTotal = sumPct(DRINK_CATEGORIES.map((c) => a.mix[c]));
  if (!mixTotal.eq(100)) issues.push(issue("invalid_quantity", `Drink mix adds up to ${mixTotal.toFixed()}%, not 100%`));
  for (const c of DRINK_CATEGORIES) {
    const inCat = choices.filter((x) => x.category === c);
    if (inCat.length) {
      const t = sumPct(inCat.map((x) => x.sharePct));
      if (!t.eq(100)) issues.push(issue("invalid_quantity", `${c.replace("_", "-")} recipe shares add up to ${t.toFixed()}%, not 100%`));
    }
  }
  const part = d(a.participationPct);
  const hours = d(a.durationHours);
  if (a.guests < 0 || !Number.isInteger(a.guests)) issues.push(issue("invalid_quantity", "Guest count must be a whole number"));
  if (part.lt(0) || part.gt(100)) issues.push(issue("invalid_quantity", "Participation must be between 0 and 100%"));
  if (hours.lte(0)) issues.push(issue("invalid_quantity", "Duration must be more than zero hours"));
  const perParticipant = hours.lte(0) ? ZERO : d(a.firstHourDrinks).times(Decimal.min(hours, 1)).plus(d(a.laterHourDrinks).times(Decimal.max(hours.minus(1), 0)));
  const expected = d(Math.max(a.guests, 0)).times(part).div(HUNDRED).times(perParticipant);
  const planned = issues.length ? 0 : expected.times(HUNDRED.plus(d(a.contingencyPct))).div(HUNDRED).ceil().toNumber();

  const catCounts = largestRemainder(planned, DRINK_CATEGORIES.map((c) => d(a.mix[c])));
  const byCategory = Object.fromEntries(DRINK_CATEGORIES.map((c, i) => [c, catCounts[i]!])) as Record<DrinkCategory, number>;
  const byRecipe: EventDemand["byRecipe"] = [];
  const unassigned = Object.fromEntries(DRINK_CATEGORIES.map((c) => [c, 0])) as Record<DrinkCategory, number>;
  for (const c of DRINK_CATEGORIES) {
    const inCat = choices.filter((x) => x.category === c);
    if (!inCat.length) {
      unassigned[c] = byCategory[c];
      continue;
    }
    const split = largestRemainder(byCategory[c], inCat.map((x) => d(x.sharePct)));
    inCat.forEach((x, i) => byRecipe.push({ recipeId: x.recipeId, category: c, servings: split[i]! }));
  }
  return { expectedDrinks: expected, plannedDrinks: planned, byCategory, byRecipe, unassigned, issues };
}

export interface PurchaseLine {
  productId: string;
  name: string;
  requiredBase: Decimal;
  onHandBase: Decimal | null;
  /** Quantity to source after using available stock. */
  toBuyBase: Decimal;
  packBase: Decimal | null;
  packs: number | null;
  packCost: Decimal | null;
  purchaseCost: Decimal | null;
}

export interface IngredientPlan {
  lines: PurchaseLine[];
  ingredientCost: Decimal | null;
  knownIngredientCost: Decimal;
  complete: boolean;
  issues: Issue[];
}

export interface PackInfo {
  packBase: Decimal | null;
  packCost: Decimal | null;
}

/**
 * Ingredient needs for the planned servings, rounded up to whole purchase packs.
 * `useStock` subtracts current stock before rounding; plans never deduct stock.
 */
export function planIngredients(
  ctx: CostingContext,
  byRecipe: { recipeId: string; servings: number }[],
  packs: ReadonlyMap<string, PackInfo>,
  useStock: boolean,
): IngredientPlan {
  const totals = new Map<string, { name: string; base: Decimal }>();
  const issues: Issue[] = [];
  let complete = true;
  let known = ZERO;
  for (const r of byRecipe) {
    if (r.servings <= 0) continue;
    const exp = explodeServings(ctx, r.recipeId, r.servings, "raw");
    const cost = costExplosion(ctx, exp);
    if (!cost.complete) complete = false;
    issues.push(...cost.issues);
    known = known.plus(cost.knownSubtotal);
    for (const dem of exp.demand.values()) {
      const t = totals.get(dem.productId) ?? { name: dem.name, base: ZERO };
      t.base = t.base.plus(dem.asPurchasedBase ?? ZERO);
      totals.set(dem.productId, t);
    }
  }
  const lines: PurchaseLine[] = [];
  for (const [productId, t] of totals) {
    const product = ctx.products.get(productId);
    const onHand = product?.onHandBase ?? null;
    const toBuy = useStock && onHand ? Decimal.max(ZERO, t.base.minus(Decimal.max(onHand, ZERO))) : t.base;
    const p = packs.get(productId);
    const packBase = p?.packBase && p.packBase.gt(0) ? p.packBase : null;
    const n = packBase ? toBuy.div(packBase).ceil().toNumber() : null;
    if (!packBase && toBuy.gt(0)) {
      issues.push(issue("missing_conversion", `${t.name} has no purchase pack size, so it cannot be rounded to packs`, { ref: productId }));
    }
    lines.push({
      productId,
      name: t.name,
      requiredBase: t.base,
      onHandBase: onHand,
      toBuyBase: toBuy,
      packBase,
      packs: n,
      packCost: p?.packCost ?? null,
      purchaseCost: n !== null && p?.packCost ? p.packCost.times(n) : null,
    });
  }
  lines.sort((a, b) => a.name.localeCompare(b.name));
  return { lines, ingredientCost: complete ? known : null, knownIngredientCost: known, complete, issues };
}

export interface ConsumableAssumptions {
  /** Pounds of ice per participant for drinks, and extra for chilling beer/wine. */
  iceLbPerParticipant: DecimalInput;
  chillIceLbPerBottleDrink: DecimalInput;
  cupsPerDrink: DecimalInput;
  napkinsPerDrink: DecimalInput;
}

export const DEFAULT_CONSUMABLES: ConsumableAssumptions = {
  iceLbPerParticipant: "1.5",
  chillIceLbPerBottleDrink: "0.25",
  cupsPerDrink: "1.2",
  napkinsPerDrink: "1.5",
};

export function consumables(participants: Decimal, demand: EventDemand, a: ConsumableAssumptions) {
  const bottleDrinks = demand.byCategory.beer + demand.byCategory.wine;
  return {
    iceLb: participants.times(d(a.iceLbPerParticipant)).plus(d(bottleDrinks).times(d(a.chillIceLbPerBottleDrink))).ceil(),
    cups: d(demand.plannedDrinks).times(d(a.cupsPerDrink)).ceil(),
    napkins: d(demand.plannedDrinks).times(d(a.napkinsPerDrink)).ceil(),
    assumptions: a,
  };
}

export type QuoteMode = { kind: "markup"; pct: DecimalInput } | { kind: "margin"; pct: DecimalInput };

export interface QuoteEstimate {
  ingredientCost: Decimal | null;
  otherCosts: Decimal;
  totalCost: Decimal | null;
  price: Decimal | null;
  mode: QuoteMode;
  issues: Issue[];
}

/**
 * Markup is added on cost (cost x (1 + markup)); margin is the share of the
 * price that is not cost (cost / (1 - margin)). A 50% markup is a 33% margin.
 */
export function quote(ingredientCost: Decimal | null, otherCosts: DecimalInput[], mode: QuoteMode): QuoteEstimate {
  const issues: Issue[] = [];
  const other = otherCosts.reduce<Decimal>((s, v) => s.plus(d(v)), ZERO);
  const total = ingredientCost === null ? null : ingredientCost.plus(other);
  if (ingredientCost === null) issues.push(issue("missing_price", "Ingredient cost is incomplete, so no quote can be calculated"));
  const p = d(mode.pct);
  let price: Decimal | null = null;
  if (total !== null) {
    if (mode.kind === "markup") {
      if (p.lt(0)) issues.push(issue("invalid_price", "Markup cannot be negative"));
      else price = total.times(HUNDRED.plus(p)).div(HUNDRED);
    } else if (p.lt(0) || p.gte(100)) issues.push(issue("invalid_price", "Margin must be at least 0% and below 100%"));
    else price = total.times(HUNDRED).div(HUNDRED.minus(p));
  }
  return { ingredientCost, otherCosts: other, totalCost: total, price, mode, issues };
}
