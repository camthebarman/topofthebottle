/**
 * Decimal arithmetic for money and quantities.
 *
 * Every quantity and amount in the domain layer is a Decimal. Floats only
 * appear at the edges (rendering) and never feed back into calculations.
 */
import DecimalBase from "decimal.js";

export const Decimal = DecimalBase.clone({ precision: 40, rounding: DecimalBase.ROUND_HALF_UP });
export type Decimal = InstanceType<typeof Decimal>;
export type DecimalInput = Decimal | string | number;

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);
export const HUNDRED = new Decimal(100);

export function d(v: DecimalInput): Decimal {
  if (v instanceof Decimal) return v;
  if (typeof v === "number" && !Number.isFinite(v)) {
    throw new RangeError(`Non-finite number cannot become a Decimal: ${v}`);
  }
  return new Decimal(v);
}

/** Parse a user- or database-supplied value. Returns null instead of throwing. */
export function tryDecimal(v: unknown): Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Decimal) return v;
  if (typeof v === "number") return Number.isFinite(v) ? new Decimal(v) : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
    return new Decimal(s);
  }
  return null;
}

export function sum(values: Iterable<Decimal>): Decimal {
  let total = ZERO;
  for (const v of values) total = total.plus(v);
  return total;
}

export function minDecimal(values: Decimal[]): Decimal | null {
  let best: Decimal | null = null;
  for (const v of values) if (best === null || v.lt(best)) best = v;
  return best;
}

/** Round money to the currency's minor unit (2 dp for USD/EUR/GBP/CAD/AUD). */
export function roundMoney(v: Decimal, minorUnits = 2): Decimal {
  return v.toDecimalPlaces(minorUnits, Decimal.ROUND_HALF_UP);
}

/** Percentage (0-100 scale) of part over whole, or null when whole is zero. */
export function pct(part: Decimal, whole: Decimal): Decimal | null {
  if (whole.isZero()) return null;
  return part.div(whole).times(HUNDRED);
}

/** Stable string for storage: no exponent notation, trailing zeros trimmed. */
export function toFixedString(v: Decimal, maxDp = 6): string {
  const s = v.toDecimalPlaces(maxDp, Decimal.ROUND_HALF_UP).toFixed();
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}
