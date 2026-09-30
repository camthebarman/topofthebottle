/**
 * Inventory ledger.
 *
 * Stock is never edited in place. Every change is a movement with a signed
 * base-unit quantity; corrections are reversals (a movement that negates an
 * earlier one) or explicit adjustments. Balances are sums over the ledger, so
 * any past balance can be reproduced from the movements dated before it.
 */
import { d, Decimal, type DecimalInput, ZERO } from "./decimal";
import { issue, type Issue } from "./issues";

export const MOVEMENT_TYPES = [
  "opening_balance",
  "receipt",
  "transfer_in",
  "transfer_out",
  "supplier_return",
  "waste",
  "breakage",
  "production_consume",
  "production_output",
  "event_dispatch",
  "event_return",
  "count_adjustment",
  "manual_adjustment",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Required sign of a non-reversal movement. 0 = either sign allowed. */
export const MOVEMENT_SIGN: Record<MovementType, 1 | -1 | 0> = {
  opening_balance: 1,
  receipt: 1,
  transfer_in: 1,
  transfer_out: -1,
  supplier_return: -1,
  waste: -1,
  breakage: -1,
  production_consume: -1,
  production_output: 1,
  event_dispatch: -1,
  event_return: 1,
  count_adjustment: 0,
  manual_adjustment: 0,
};

export interface Movement {
  id: string;
  productId: string;
  type: MovementType;
  /** Signed base-unit quantity: positive adds stock. */
  qtyBase: Decimal;
  /** UTC ISO instant the movement took effect. */
  occurredAt: string;
  /** Extended cost for receipts (what was paid for this quantity). */
  extendedCost?: Decimal | null;
  /** When set, this movement reverses the referenced one. */
  reversesId?: string | null;
  reason?: string | null;
}

export function validateMovement(m: Movement): Issue[] {
  const out: Issue[] = [];
  if (m.qtyBase.isZero()) out.push(issue("invalid_quantity", "A movement must change stock by a non-zero amount", { ref: m.id }));
  const sign = MOVEMENT_SIGN[m.type];
  const expected = m.reversesId ? -sign : sign;
  if (expected !== 0 && Math.sign(m.qtyBase.toNumber()) !== expected) {
    out.push(issue("invalid_quantity", `${m.type}${m.reversesId ? " reversal" : ""} must be ${expected > 0 ? "positive" : "negative"}`, { ref: m.id }));
  }
  if (m.type === "manual_adjustment" && !m.reversesId && !m.reason?.trim()) {
    out.push(issue("invalid_quantity", "Manual adjustments need a reason", { ref: m.id }));
  }
  return out;
}

/** Build the reversal of a movement. The original is never modified. */
export function reversalOf(original: Movement, id: string, occurredAt: string, reason: string): Movement {
  if (original.reversesId) throw new Error("Reverse the original movement, not a reversal");
  return {
    id,
    productId: original.productId,
    type: original.type,
    qtyBase: original.qtyBase.negated(),
    occurredAt,
    extendedCost: original.extendedCost ? original.extendedCost.negated() : null,
    reversesId: original.id,
    reason,
  };
}

/** Balance per product from movements that occurred at or before `asOf`. */
export function balances(movements: Iterable<Movement>, asOf?: string): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  const cutoff = asOf ? Date.parse(asOf) : Infinity;
  for (const m of movements) {
    if (Date.parse(m.occurredAt) > cutoff) continue;
    out.set(m.productId, (out.get(m.productId) ?? ZERO).plus(m.qtyBase));
  }
  return out;
}

// ---------- counting ----------

export type CountMethod = "full_units" | "tenths" | "weight" | "measured";

export interface ContainerSpec {
  /** Base-unit content of one full container (e.g. 750 for a 750 mL bottle). */
  sizeBase: Decimal;
  /** Gross weight in grams of a full container, for scale counts. */
  fullWeightG?: Decimal | null;
  /** Weight in grams of the empty container. */
  emptyWeightG?: Decimal | null;
}

export interface CountEntry {
  method: CountMethod;
  /** Unopened containers. */
  fullUnits?: DecimalInput;
  /** For tenths: 0..10 estimated remaining in the open container. */
  tenths?: DecimalInput;
  /** For weight: gross weight in grams of the open container on a scale. */
  grossWeightG?: DecimalInput;
  /** For measured: a direct base-unit quantity (e.g. mL in a labelled quart). */
  measuredBase?: DecimalInput;
}

export interface CountValue {
  qtyBase: Decimal | null;
  approximate: boolean;
  /**
   * Plus-or-minus allowance for the estimate, in base units. Tenths: half a
   * tenth of the container. Scale: 2% of the container, a planning assumption
   * covering tare and density error, not a measured accuracy.
   */
  uncertaintyBase: Decimal;
  issues: Issue[];
  /** How the figure was obtained, for display next to the number. */
  methodNote: string;
}

/** Turn a count-sheet entry into base units, marking estimates as approximate. */
export function countToBase(entry: CountEntry, container: ContainerSpec | null): CountValue {
  const issues: Issue[] = [];
  const full = entry.fullUnits === undefined || entry.fullUnits === "" ? ZERO : d(entry.fullUnits);
  if (full.lt(0)) issues.push(issue("invalid_quantity", "Full units cannot be negative"));
  const needsContainer = entry.method !== "measured" || full.gt(0);
  if (needsContainer && (!container || container.sizeBase.lte(0))) {
    return { qtyBase: null, approximate: false, uncertaintyBase: ZERO, issues: [issue("missing_conversion", "Product has no container size for counting")], methodNote: "" };
  }
  const size = container?.sizeBase ?? ZERO;
  let partial = ZERO;
  let approximate = false;
  let uncertainty = ZERO;
  let methodNote = "Full containers";
  switch (entry.method) {
    case "full_units":
      break;
    case "tenths": {
      const t = d(entry.tenths ?? 0);
      if (t.lt(0) || t.gt(10)) issues.push(issue("invalid_quantity", "Tenths must be between 0 and 10"));
      partial = size.times(t).div(10);
      approximate = t.gt(0);
      if (approximate) uncertainty = size.times("0.05");
      methodNote = "Visual estimate in tenths (approximate)";
      break;
    }
    case "weight": {
      const gross = d(entry.grossWeightG ?? 0);
      const fullW = container?.fullWeightG;
      const emptyW = container?.emptyWeightG;
      if (!fullW || !emptyW || fullW.lte(emptyW)) {
        issues.push(issue("missing_conversion", "Scale counts need full and empty container weights"));
        break;
      }
      if (gross.lt(emptyW) || gross.gt(fullW.times("1.05"))) {
        issues.push(issue("invalid_quantity", "Scale weight is outside the empty-to-full range for this container"));
        break;
      }
      partial = Decimal.min(size, size.times(gross.minus(emptyW)).div(fullW.minus(emptyW)));
      // Scale counts depend on the recorded tare and liquid density; still an estimate.
      approximate = true;
      uncertainty = size.times("0.02");
      methodNote = "Scale weight against recorded full/empty weights (estimate)";
      break;
    }
    case "measured": {
      partial = d(entry.measuredBase ?? 0);
      if (partial.lt(0)) issues.push(issue("invalid_quantity", "Measured quantity cannot be negative"));
      methodNote = "Measured quantity";
      break;
    }
  }
  if (issues.length) return { qtyBase: null, approximate, uncertaintyBase: ZERO, issues, methodNote };
  return { qtyBase: full.times(size).plus(partial), approximate, uncertaintyBase: uncertainty, issues, methodNote };
}

export interface CountLineTotal {
  productId: string;
  countedBase: Decimal;
  approximate: boolean;
  uncertaintyBase?: Decimal;
}

/**
 * Adjustments needed to align the book with a finalized count. Products not
 * counted in the session are reported, never assumed to be zero.
 */
export function countAdjustments(
  counted: CountLineTotal[],
  bookAtCount: ReadonlyMap<string, Decimal>,
  expectedProductIds: Iterable<string> = [],
): { adjustments: { productId: string; qtyBase: Decimal; countedBase: Decimal; bookBase: Decimal }[]; uncounted: string[] } {
  const totals = new Map<string, Decimal>();
  for (const c of counted) totals.set(c.productId, (totals.get(c.productId) ?? ZERO).plus(c.countedBase));
  const adjustments = [];
  for (const [productId, countedBase] of totals) {
    const bookBase = bookAtCount.get(productId) ?? ZERO;
    const delta = countedBase.minus(bookBase);
    if (!delta.isZero()) adjustments.push({ productId, qtyBase: delta, countedBase, bookBase });
  }
  const uncounted = [...new Set(expectedProductIds)].filter((id) => !totals.has(id));
  return { adjustments, uncounted };
}

// ---------- valuation ----------

export type ValuationMethod = "moving_average" | "last_cost";

/**
 * Cost per base unit after replaying receipts in order. Receipts carry the
 * quantity and extended (landed) cost; other movements only change quantity.
 * Returns null until at least one priced receipt exists.
 */
export function unitCost(movements: Movement[], method: ValuationMethod, asOf?: string): Decimal | null {
  const cutoff = asOf ? Date.parse(asOf) : Infinity;
  const ordered = [...movements].filter((m) => Date.parse(m.occurredAt) <= cutoff).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  let qty = ZERO;
  let avg: Decimal | null = null;
  let last: Decimal | null = null;
  for (const m of ordered) {
    const priced = (m.type === "receipt" || m.type === "opening_balance") && m.extendedCost != null && !m.qtyBase.isZero();
    if (priced && !m.reversesId) {
      const unit = m.extendedCost!.div(m.qtyBase);
      last = unit;
      const onHand = Decimal.max(qty, ZERO);
      avg = avg === null || onHand.isZero() ? unit : onHand.times(avg).plus(m.extendedCost!).div(onHand.plus(m.qtyBase));
    }
    qty = qty.plus(m.qtyBase);
  }
  return method === "last_cost" ? last : avg;
}

export function inventoryValue(qtyBase: Decimal, costPerBase: Decimal | null): Decimal | null {
  return costPerBase === null ? null : Decimal.max(qtyBase, ZERO).times(costPerBase);
}

/** Whole purchase packs needed to bring stock back up to par. */
export function suggestedOrderPacks(parBase: Decimal | null, onHandBase: Decimal | null, packBase: Decimal | null): { packs: number | null; shortBase: Decimal | null; issues: Issue[] } {
  if (parBase === null || parBase.lte(0)) return { packs: 0, shortBase: ZERO, issues: [] };
  if (onHandBase === null) return { packs: null, shortBase: null, issues: [issue("missing_count", "No stock figure to compare with par")] };
  const short = Decimal.max(ZERO, parBase.minus(onHandBase));
  if (short.isZero()) return { packs: 0, shortBase: short, issues: [] };
  if (packBase === null || packBase.lte(0)) return { packs: null, shortBase: short, issues: [issue("missing_conversion", "No purchase pack size")] };
  return { packs: short.div(packBase).ceil().toNumber(), shortBase: short, issues: [] };
}
