/**
 * POS sales import: mapping profiles and row normalization.
 *
 * A mapping profile says which source column feeds which field. Rows are
 * normalized one at a time; a row that cannot be normalized is quarantined
 * with its reasons rather than dropped. Only mapped fields are kept, so
 * customer names, card numbers and other unneeded columns never reach
 * normalized storage.
 */
import { Decimal, ZERO } from "./decimal";
import { type DateFormat, type DecimalSeparator, parseDateTime, parseNumber } from "./csv";
import { businessDate, localToUtc } from "./time";

export const POS_FIELDS = [
  "business_date",
  "occurred_at",
  "transaction_id",
  "line_id",
  "parent_line_id",
  "item_id",
  "item_name",
  "category",
  "modifiers",
  "quantity",
  "gross_sales",
  "net_sales",
  "discount",
  "void_flag",
  "void_prepared_flag",
  "comp_flag",
  "refund_flag",
  "staff_ref",
  "location_ref",
] as const;
export type PosField = (typeof POS_FIELDS)[number];

export type ImportKind = "transactions" | "aggregate";

export interface MappingProfile {
  name: string;
  vendor: string;
  kind: ImportKind;
  /** Source header name for each mapped field. */
  columns: Partial<Record<PosField, string>>;
  dateFormat: DateFormat;
  decimalSeparator: DecimalSeparator;
  /** Separator between modifiers listed in one cell. */
  modifierSeparator?: string;
  /** Values (case-insensitive) that mean "true" in flag columns. */
  truthyValues?: string[];
  /**
   * True only when checked against real exported files from the vendor.
   * Presets that have not been checked must say so in the UI.
   */
  verified: boolean;
  sourceNote: string;
}

export interface ImportContext {
  timeZone: string;
  businessDayCutoff: string;
  /** For aggregate reports that have no date column: the report's business date range. */
  reportStart?: string;
  reportEnd?: string;
}

export type SaleKind = "sale" | "void" | "comp" | "refund";

export interface NormalizedSale {
  rowNumber: number;
  businessDate: string;
  /** Aggregate rows cover a range; transaction rows cover one day. */
  businessDateEnd: string;
  occurredAt: string | null;
  transactionId: string | null;
  lineId: string | null;
  parentLineId: string | null;
  /** Stable key used for item mapping: the POS item id, else the normalized name. */
  itemKey: string;
  itemName: string;
  category: string | null;
  modifiers: string[];
  quantity: Decimal;
  grossSales: Decimal | null;
  netSales: Decimal | null;
  discount: Decimal | null;
  kind: SaleKind;
  /** For voids: whether the item was already made (and so consumed stock). Null = unknown. */
  voidPrepared: boolean | null;
  staffRef: string | null;
  dedupeKey: string;
}

export type RowResult = { ok: true; sale: NormalizedSale; warnings: string[] } | { ok: false; reasons: string[] };

/** Headers that suggest personal or payment data. These are never mapped or stored. */
const SENSITIVE_HEADER = /(card|pan\b|last ?4|cvv|expir|customer|guest|e-?mail|phone|address|birth|dob|loyalty|member)/i;

export function sensitiveHeaders(headers: string[]): string[] {
  return headers.filter((h) => SENSITIVE_HEADER.test(h));
}

export function normalizeItemKey(s: string): string {
  return s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function flag(v: string | undefined, truthy: string[]): boolean {
  if (v === undefined) return false;
  const s = v.trim().toLowerCase();
  return s !== "" && truthy.includes(s);
}

const DEFAULT_TRUTHY = ["true", "yes", "y", "1", "x", "void", "voided", "comp", "comped", "refund", "refunded"];

/** Check a profile against the file's headers before any row is processed. */
export function validateProfile(profile: MappingProfile, headers: string[]): string[] {
  const errors: string[] = [];
  const set = new Set(headers);
  for (const [field, header] of Object.entries(profile.columns)) {
    if (header && !set.has(header)) errors.push(`Column "${header}" mapped to ${field} is not in the file`);
    if (header && SENSITIVE_HEADER.test(header)) errors.push(`Column "${header}" looks like personal or payment data and cannot be mapped`);
  }
  if (!profile.columns.item_id && !profile.columns.item_name) errors.push("Map an item ID or item name column");
  if (!profile.columns.quantity) errors.push("Map a quantity column");
  if (profile.kind === "transactions" && !profile.columns.occurred_at && !profile.columns.business_date) {
    errors.push("Transaction imports need a date or timestamp column");
  }
  return errors;
}

export function normalizeRow(record: Record<string, string>, rowNumber: number, profile: MappingProfile, ctx: ImportContext): RowResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const col = (f: PosField): string | undefined => {
    const h = profile.columns[f];
    return h ? record[h] : undefined;
  };
  const truthy = (profile.truthyValues ?? DEFAULT_TRUTHY).map((x) => x.toLowerCase());
  const num = (f: PosField, required = false): Decimal | null => {
    const raw = col(f);
    if (raw === undefined || raw.trim() === "") {
      if (required) reasons.push(`${f.replace(/_/g, " ")} is empty`);
      return null;
    }
    const v = parseNumber(raw, profile.decimalSeparator);
    if (v === null) reasons.push(`${f.replace(/_/g, " ")} "${raw.slice(0, 40)}" is not a number`);
    return v;
  };

  const itemId = col("item_id")?.trim() || null;
  const itemName = col("item_name")?.trim() || itemId || "";
  if (!itemId && !itemName) reasons.push("Item is empty");

  const quantity = num("quantity", true);
  const grossSales = num("gross_sales");
  const netSales = num("net_sales");
  const discount = num("discount");

  // Dates
  let bDate: string | null = null;
  let occurredAt: string | null = null;
  const occRaw = col("occurred_at");
  if (occRaw !== undefined && occRaw.trim() !== "") {
    const p = parseDateTime(occRaw, profile.dateFormat);
    if (!p) reasons.push(`Timestamp "${occRaw.slice(0, 40)}" does not match ${profile.dateFormat}`);
    else {
      let instant: Date;
      try {
        instant = p.instant ?? localToUtc(p.date, p.time ?? "12:00", ctx.timeZone);
        occurredAt = instant.toISOString();
        if (!p.time && !p.instant) {
          warnings.push("Timestamp has no time; business date taken from the calendar date");
          bDate = p.date;
        } else {
          bDate = businessDate(instant, ctx.timeZone, ctx.businessDayCutoff);
        }
      } catch {
        reasons.push(`Timestamp "${occRaw.slice(0, 40)}" could not be converted`);
      }
    }
  }
  const bdRaw = col("business_date");
  if (bdRaw !== undefined && bdRaw.trim() !== "") {
    const p = parseDateTime(bdRaw, profile.dateFormat);
    if (!p) reasons.push(`Business date "${bdRaw.slice(0, 40)}" does not match ${profile.dateFormat}`);
    else {
      if (bDate && bDate !== p.date) warnings.push(`Business date column (${p.date}) differs from timestamp-derived date (${bDate}); using the column`);
      bDate = p.date;
    }
  }
  let bDateEnd = bDate;
  if (!bDate && profile.kind === "aggregate" && ctx.reportStart && ctx.reportEnd) {
    bDate = ctx.reportStart;
    bDateEnd = ctx.reportEnd;
  }
  if (!bDate) reasons.push("No business date: map a date column or set the report date range");

  const isVoid = flag(col("void_flag"), truthy);
  const isComp = flag(col("comp_flag"), truthy);
  let isRefund = flag(col("refund_flag"), truthy);
  const kinds = [isVoid, isComp, isRefund].filter(Boolean).length;
  if (kinds > 1) reasons.push("Row is marked as more than one of void, comp and refund");

  if (quantity && quantity.lt(0) && !isVoid && !isRefund) {
    // Negative quantity with no flag is how several POS systems record refunds.
    isRefund = true;
    warnings.push("Negative quantity treated as a refund");
  }
  if (quantity && quantity.isZero()) reasons.push("Quantity is zero");

  const voidPreparedRaw = col("void_prepared_flag");
  const voidPrepared = voidPreparedRaw === undefined || voidPreparedRaw.trim() === "" ? null : flag(voidPreparedRaw, truthy);

  const modSep = profile.modifierSeparator ?? ";";
  const modifiers = (col("modifiers") ?? "")
    .split(modSep)
    .map((m) => m.trim())
    .filter(Boolean);

  if (reasons.length || !quantity || !bDate) return { ok: false, reasons: reasons.length ? reasons : ["Row is incomplete"] };

  const transactionId = col("transaction_id")?.trim() || null;
  const lineId = col("line_id")?.trim() || null;
  const itemKey = itemId ? `id:${itemId}` : `name:${normalizeItemKey(itemName)}`;
  const kind: SaleKind = isVoid ? "void" : isComp ? "comp" : isRefund ? "refund" : "sale";
  let dedupeKey: string;
  if (transactionId && lineId) dedupeKey = `line:${transactionId}:${lineId}`;
  else if (profile.kind === "aggregate") dedupeKey = `agg:${bDate}:${bDateEnd}:${itemKey}:${kind}:${modifiers.map(normalizeItemKey).sort().join("+")}`;
  else {
    // No line id: the best available fingerprint. Identical lines in one ticket are disambiguated by row order.
    dedupeKey = `fp:${transactionId ?? ""}:${occurredAt ?? bDate}:${itemKey}:${kind}:${quantity.toFixed()}:${netSales?.toFixed() ?? grossSales?.toFixed() ?? ""}:${modifiers.join("+")}`;
    warnings.push("No line ID: duplicate detection relies on a row fingerprint");
  }

  return {
    ok: true,
    warnings,
    sale: {
      rowNumber,
      businessDate: bDate,
      businessDateEnd: bDateEnd ?? bDate,
      occurredAt,
      transactionId,
      lineId,
      parentLineId: col("parent_line_id")?.trim() || null,
      itemKey,
      itemName,
      category: col("category")?.trim() || null,
      modifiers,
      quantity: quantity.abs(),
      grossSales,
      netSales,
      discount,
      kind,
      voidPrepared,
      staffRef: col("staff_ref")?.trim() || null,
      dedupeKey,
    },
  };
}

/**
 * Fold modifier rows (rows that reference a parent line) into their parent's
 * modifier list. Returns orphaned modifier rows separately.
 */
export function attachModifierRows(sales: NormalizedSale[]): { sales: NormalizedSale[]; orphans: NormalizedSale[] } {
  const byLine = new Map<string, NormalizedSale>();
  for (const s of sales) if (s.lineId && !s.parentLineId) byLine.set(`${s.transactionId}:${s.lineId}`, s);
  const out: NormalizedSale[] = [];
  const orphans: NormalizedSale[] = [];
  for (const s of sales) {
    if (!s.parentLineId) {
      out.push(s);
      continue;
    }
    const parent = byLine.get(`${s.transactionId}:${s.parentLineId}`);
    if (parent) parent.modifiers.push(s.itemName);
    else orphans.push(s);
  }
  return { sales: out, orphans };
}

/** Disambiguate fingerprint keys of identical lines within one file by occurrence. */
export function finalizeDedupeKeys(sales: NormalizedSale[]): void {
  const seen = new Map<string, number>();
  for (const s of sales) {
    if (!s.dedupeKey.startsWith("fp:")) continue;
    const n = (seen.get(s.dedupeKey) ?? 0) + 1;
    seen.set(s.dedupeKey, n);
    s.dedupeKey = `${s.dedupeKey}#${n}`;
  }
}

export interface ImportSummary {
  rowsRead: number;
  accepted: number;
  quarantined: number;
  byKind: Record<SaleKind, number>;
  quantity: Decimal;
  grossSales: Decimal;
  netSales: Decimal;
  dateRange: { start: string; end: string } | null;
  duplicateKeysInFile: number;
}

export function summarize(sales: NormalizedSale[], rowsRead: number, quarantined: number): ImportSummary {
  const byKind: Record<SaleKind, number> = { sale: 0, void: 0, comp: 0, refund: 0 };
  let quantity = ZERO;
  let gross = ZERO;
  let net = ZERO;
  let start: string | null = null;
  let end: string | null = null;
  const keys = new Set<string>();
  let dupes = 0;
  for (const s of sales) {
    byKind[s.kind]++;
    const sign = s.kind === "refund" ? -1 : s.kind === "void" ? 0 : 1;
    quantity = quantity.plus(s.quantity.times(sign));
    if (s.grossSales) gross = gross.plus(s.kind === "void" ? 0 : s.grossSales);
    if (s.netSales) net = net.plus(s.kind === "void" ? 0 : s.netSales);
    if (!start || s.businessDate < start) start = s.businessDate;
    if (!end || s.businessDateEnd > end) end = s.businessDateEnd;
    if (keys.has(s.dedupeKey)) dupes++;
    keys.add(s.dedupeKey);
  }
  return {
    rowsRead,
    accepted: sales.length,
    quarantined,
    byKind,
    quantity,
    grossSales: gross,
    netSales: net,
    dateRange: start && end ? { start, end } : null,
    duplicateKeysInFile: dupes,
  };
}

// ---------- stock treatment ----------

export interface TreatmentPolicy {
  /** Voids consume stock only when marked prepared; unknown voids are excluded and counted. */
  voidPreparedConsumes: boolean;
  /** Comped drinks were still poured. */
  compConsumes: boolean;
}

export const DEFAULT_TREATMENT: TreatmentPolicy = { voidPreparedConsumes: true, compConsumes: true };

/**
 * How many servings of a sale line physically consumed stock.
 * Refunds never return stock: a refunded drink was usually poured.
 * Their original sale line already counted the pour, so the refund adds nothing.
 */
export function consumedServings(s: NormalizedSale, policy: TreatmentPolicy = DEFAULT_TREATMENT): { servings: Decimal; note: string | null } {
  switch (s.kind) {
    case "sale":
      return { servings: s.quantity, note: null };
    case "comp":
      return policy.compConsumes ? { servings: s.quantity, note: null } : { servings: ZERO, note: "Comp excluded by policy" };
    case "refund":
      return { servings: ZERO, note: "Refund: stock not returned; the original sale already counted the pour" };
    case "void":
      if (s.voidPrepared === true && policy.voidPreparedConsumes) return { servings: s.quantity, note: "Void marked prepared: counted as consumed" };
      if (s.voidPrepared === null) return { servings: ZERO, note: "Void with unknown preparation status: excluded" };
      return { servings: ZERO, note: "Void before preparation: no stock consumed" };
  }
}

export function aggregateOverlap(existing: { start: string; end: string }[], incoming: { start: string; end: string }): boolean {
  return existing.some((r) => r.start <= incoming.end && incoming.start <= r.end);
}

