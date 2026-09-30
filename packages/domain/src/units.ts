/**
 * Dimensional units.
 *
 * Every quantity belongs to exactly one dimension and is stored in that
 * dimension's base unit: millilitres for volume, grams for mass, "each" for
 * count. Factors are exact (the US customary definitions are exact multiples
 * of SI units), so no approximation creeps in from conversions.
 *
 * Crossing dimensions (weight to volume, each to volume) is never done with a
 * global factor. It needs a product-specific conversion, e.g. "1 lime yields
 * 30 mL juice" or "1 L of simple syrup weighs 1,300 g".
 */
import { d, Decimal, type DecimalInput } from "./decimal";
import { issue, type Issue } from "./issues";

export type Dimension = "volume" | "mass" | "count";

export interface UnitDef {
  id: string;
  label: string;
  dimension: Dimension;
  /** Multiply a quantity in this unit by `toBase` to get base units. */
  toBase: Decimal;
  /** True for units whose size is a convention, not a measurement (dash). */
  approximate?: boolean;
}

const US_FL_OZ_ML = "29.5735295625";
const OZ_WT_G = "28.349523125";
const LB_G = "453.59237";

function u(id: string, label: string, dimension: Dimension, toBase: string, approximate = false): UnitDef {
  return { id, label, dimension, toBase: d(toBase), ...(approximate ? { approximate } : {}) };
}

export const UNITS: Record<string, UnitDef> = Object.fromEntries(
  [
    // volume, base mL
    u("ml", "mL", "volume", "1"),
    u("cl", "cL", "volume", "10"),
    u("l", "L", "volume", "1000"),
    u("fl_oz", "fl oz (US)", "volume", US_FL_OZ_ML),
    u("tsp", "tsp", "volume", "4.92892159375"),
    u("tbsp", "tbsp", "volume", "14.78676478125"),
    u("barspoon", "barspoon", "volume", "5", true),
    u("dash", "dash", "volume", "0.9", true),
    u("cup", "cup (US)", "volume", "236.5882365"),
    u("pint", "pint (US)", "volume", "473.176473"),
    u("quart", "quart (US)", "volume", "946.352946"),
    u("gal", "gallon (US)", "volume", "3785.411784"),
    // mass, base g
    u("g", "g", "mass", "1"),
    u("kg", "kg", "mass", "1000"),
    u("oz_wt", "oz (weight)", "mass", OZ_WT_G),
    u("lb", "lb", "mass", LB_G),
    // count, base each
    u("each", "each", "count", "1"),
    u("dozen", "dozen", "count", "12"),
  ].map((x) => [x.id, x]),
);

export const BASE_UNIT: Record<Dimension, string> = { volume: "ml", mass: "g", count: "each" };

export function unitDef(unitId: string): UnitDef | undefined {
  return UNITS[unitId];
}

/**
 * A product-specific bridge between dimensions, expressed as
 * `fromQty fromUnit = toQty toUnit`, e.g. 1 each = 30 ml for lime juice yield.
 */
export interface ProductConversion {
  fromQty: DecimalInput;
  fromUnit: string;
  toQty: DecimalInput;
  toUnit: string;
}

export type ConvertResult = { ok: true; value: Decimal; approximate: boolean } | { ok: false; issue: Issue };

/** Convert a quantity to the base unit of `targetDimension`. */
export function toBase(
  qty: DecimalInput,
  unitId: string,
  targetDimension: Dimension,
  conversions: ProductConversion[] = [],
  ref?: string,
): ConvertResult {
  const unit = UNITS[unitId];
  if (!unit) {
    return { ok: false, issue: issue("unit_mismatch", `Unknown unit "${unitId}"`, ref ? { ref } : {}) };
  }
  const q = d(qty);
  const inOwnBase = q.times(unit.toBase);
  if (unit.dimension === targetDimension) {
    return { ok: true, value: inOwnBase, approximate: !!unit.approximate };
  }
  for (const c of conversions) {
    const from = UNITS[c.fromUnit];
    const to = UNITS[c.toUnit];
    if (!from || !to) continue;
    const fromBase = d(c.fromQty).times(from.toBase);
    const toBaseQty = d(c.toQty).times(to.toBase);
    if (fromBase.lte(0) || toBaseQty.lte(0)) continue;
    if (from.dimension === unit.dimension && to.dimension === targetDimension) {
      return { ok: true, value: inOwnBase.times(toBaseQty).div(fromBase), approximate: !!unit.approximate };
    }
    if (to.dimension === unit.dimension && from.dimension === targetDimension) {
      return { ok: true, value: inOwnBase.times(fromBase).div(toBaseQty), approximate: !!unit.approximate };
    }
  }
  return {
    ok: false,
    issue: issue(
      "missing_conversion",
      `Cannot convert ${unit.label} (${unit.dimension}) to ${targetDimension} without a product-specific conversion`,
      ref ? { ref } : {},
    ),
  };
}

/** Convert a base-unit quantity for display in another unit of the same dimension. */
export function fromBase(baseQty: DecimalInput, unitId: string): Decimal {
  const unit = UNITS[unitId];
  if (!unit) throw new RangeError(`Unknown unit "${unitId}"`);
  return d(baseQty).div(unit.toBase);
}

export function unitsForDimension(dimension: Dimension): UnitDef[] {
  return Object.values(UNITS).filter((x) => x.dimension === dimension);
}
