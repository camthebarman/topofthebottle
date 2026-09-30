/**
 * Mapping presets for known POS exports.
 *
 * None of these are marked verified: verification requires checking a real
 * exported file from a live account. `headerSource` records where the header
 * names came from so the UI can say so honestly.
 */
import type { MappingProfile } from "./pos";

export interface Preset extends MappingProfile {
  id: string;
  headerSource: string;
  /** Headers that must all be present for the preset to be suggested. */
  requiredHeaders: string[];
}

export const PRESETS: Preset[] = [
  {
    id: "toast-item-selection",
    name: "Toast — Item Selection Details",
    vendor: "Toast",
    kind: "transactions",
    columns: {
      occurred_at: "Sent Date",
      transaction_id: "Order Id",
      line_id: "Item Selection Id",
      item_id: "Item Id",
      item_name: "Menu Item",
      category: "Sales Category",
      quantity: "Qty",
      gross_sales: "Gross Price",
      discount: "Discnt",
      net_sales: "Net Price",
      void_flag: "Void?",
    },
    dateFormat: "MM/DD/YYYY",
    decimalSeparator: ".",
    truthyValues: ["true"],
    verified: false,
    headerSource: "Toast data export field reference (doc.toasttab.com), ItemSelectionDetails.csv. Not yet checked against a real export; confirm the date format on first import.",
    sourceNote: "Item-level export with void flag. Server names are not imported.",
    requiredHeaders: ["Order Id", "Item Selection Id", "Menu Item", "Qty", "Void?"],
  },
  {
    id: "toast-modifier-selection",
    name: "Toast — Modifier Selection Details",
    vendor: "Toast",
    kind: "transactions",
    columns: {
      occurred_at: "Sent Date",
      transaction_id: "Order Id",
      line_id: "Modifier Id",
      parent_line_id: "Parent Menu Selection Item ID",
      item_name: "Modifier",
      quantity: "Qty",
      gross_sales: "Gross Price",
      discount: "Discnt",
      net_sales: "Net Price",
      void_flag: "Void?",
    },
    dateFormat: "MM/DD/YYYY",
    decimalSeparator: ".",
    truthyValues: ["true"],
    verified: false,
    headerSource: "Toast data export field reference, ModifiersSelectionDetails.csv. Import after the matching item file; modifiers attach to their parent items. Not yet checked against a real export.",
    sourceNote: "Modifier rows attach to the item selection they belong to.",
    requiredHeaders: ["Order Id", "Parent Menu Selection Item ID", "Modifier", "Qty"],
  },
  {
    id: "square-item-detail-draft",
    name: "Square — Item Sales detail (draft)",
    vendor: "Square",
    kind: "transactions",
    columns: {
      business_date: "Date",
      transaction_id: "Transaction ID",
      item_name: "Item",
      category: "Category",
      modifiers: "Modifiers Applied",
      quantity: "Qty",
      gross_sales: "Gross Sales",
      discount: "Discounts",
      net_sales: "Net Sales",
    },
    dateFormat: "YYYY-MM-DD",
    decimalSeparator: ".",
    modifierSeparator: ",",
    verified: false,
    headerSource: "Draft based on commonly seen Square item export headers. Square does not publish a stable header reference; check every mapping before importing.",
    sourceNote: "No line ID in this export, so duplicates are detected by row fingerprint.",
    requiredHeaders: ["Date", "Item", "Qty", "Transaction ID"],
  },
];

/** Presets whose required headers are all present, best match first. */
export function suggestPresets(headers: string[]): Preset[] {
  const set = new Set(headers.map((h) => h.trim()));
  return PRESETS.filter((p) => p.requiredHeaders.every((h) => set.has(h))).sort(
    (a, b) => Object.values(b.columns).filter((h) => h && set.has(h)).length - Object.values(a.columns).filter((h) => h && set.has(h)).length,
  );
}

/** Best-effort automatic mapping for an unknown file, for a person to review. */
export function guessColumns(headers: string[]): MappingProfile["columns"] {
  const rules: [keyof MappingProfile["columns"], RegExp][] = [
    ["occurred_at", /^(sent|order|transaction)?\s*(date\s*)?time(stamp)?$|^(sent|order) date$|date.?time/i],
    ["business_date", /^(business )?date$/i],
    ["transaction_id", /^(order|check|transaction|ticket|receipt)\s*(id|#|number|no)$/i],
    ["line_id", /^(line|item selection|selection)\s*(id|#)$/i],
    ["item_id", /^(item|product|menu item)\s*(id|sku|code)$|^sku$|^plu$/i],
    ["item_name", /^(menu )?item( name)?$|^product( name)?$|^description$/i],
    ["category", /categor/i],
    ["modifiers", /modifier/i],
    ["quantity", /^(qty|quantity|count|items? sold)$/i],
    ["gross_sales", /^gross/i],
    ["net_sales", /^net/i],
    ["discount", /^disc/i],
    ["void_flag", /^void\??$/i],
    ["comp_flag", /^comp(ed)?\??$/i],
    ["refund_flag", /^refund(ed)?\??$/i],
  ];
  const out: MappingProfile["columns"] = {};
  for (const [field, re] of rules) {
    const h = headers.find((x) => re.test(x.trim()) && !Object.values(out).includes(x));
    if (h) out[field] = h;
  }
  return out;
}
