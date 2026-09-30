import { Decimal, fromBase, type Dimension } from "@tz/domain";

export function money(v: Decimal | string | number | null | undefined, currency = "USD"): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "object" ? v.toNumber() : Number(v);
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export function pct(v: Decimal | number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "object" ? v.toNumber() : v;
  return `${n.toFixed(digits)}%`;
}

export function num(v: Decimal | string | number | null | undefined, maxDigits = 2): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "object" ? v.toNumber() : Number(v);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxDigits }).format(n);
}

const DISPLAY: Record<Dimension, { unit: string; label: string }[]> = {
  volume: [{ unit: "l", label: "L" }, { unit: "ml", label: "mL" }],
  mass: [{ unit: "kg", label: "kg" }, { unit: "g", label: "g" }],
  count: [{ unit: "each", label: "each" }],
};

/** Human-friendly quantity: 2250 mL -> "2.25 L", 12 each -> "12 each". */
export function qty(base: Decimal | string | number | null | undefined, dimension: Dimension, containerSizeBase?: string | number | null, containerLabel?: string | null): string {
  if (base === null || base === undefined || base === "") return "—";
  const d = new Decimal(typeof base === "object" ? base : String(base));
  if (containerSizeBase && Number(containerSizeBase) > 0) {
    const units = d.div(new Decimal(String(containerSizeBase)));
    return `${num(units, 2)} ${containerLabel || "units"}`;
  }
  const opts = DISPLAY[dimension];
  for (const o of opts) {
    const v = fromBase(d, o.unit);
    if (v.abs().gte(1) || o === opts[opts.length - 1]) return `${num(v, 2)} ${o.label}`;
  }
  return num(d);
}

export function dateLabel(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "—";
  const date = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(iso.length > 10 ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone: iso.length === 10 ? "UTC" : tz,
  }).format(date);
}
