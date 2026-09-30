/**
 * Supplier invoices: reconciliation, landed cost and duplicate detection.
 *
 * An invoice records what was billed. It does not prove goods arrived:
 * receiving is a separate confirmation with its own quantities.
 */
import { d, Decimal, type DecimalInput, ZERO, roundMoney } from "./decimal";

export interface InvoiceLineInput {
  description: string;
  /** Quantity billed, in the line's purchase unit (e.g. cases). */
  quantity: DecimalInput;
  /** Price per purchase unit before line discount. */
  unitPrice: DecimalInput | null;
  /** Line discount as a positive amount. */
  discount?: DecimalInput | null;
  /** Line total as printed on the invoice. */
  lineTotal: DecimalInput | null;
  /** Units per purchase unit (e.g. 12 bottles per case). */
  unitsPerPack: DecimalInput;
  /** Base-unit content of one unit (e.g. 750 mL). */
  unitSizeBase: DecimalInput | null;
  /** Bottle or keg deposit per purchase unit; excluded from product cost. */
  depositPerPack?: DecimalInput | null;
}

export interface InvoiceTotalsInput {
  subtotal: DecimalInput | null;
  freight: DecimalInput | null;
  deposits: DecimalInput | null;
  tax: DecimalInput | null;
  /** Invoice-level discount as a positive amount. */
  discount: DecimalInput | null;
  total: DecimalInput | null;
  isCreditNote: boolean;
}

export interface LineCheck {
  index: number;
  computed: Decimal | null;
  printed: Decimal | null;
  difference: Decimal | null;
}

export interface Reconciliation {
  lineChecks: LineCheck[];
  computedSubtotal: Decimal;
  subtotalDifference: Decimal | null;
  computedTotal: Decimal;
  totalDifference: Decimal | null;
  balanced: boolean;
  messages: string[];
}

function opt(v: DecimalInput | null | undefined): Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  return d(v);
}

export function reconcileInvoice(lines: InvoiceLineInput[], totals: InvoiceTotalsInput, tolerance: DecimalInput = "0.02"): Reconciliation {
  const tol = d(tolerance);
  const messages: string[] = [];
  const lineChecks: LineCheck[] = [];
  let subtotal = ZERO;
  lines.forEach((l, index) => {
    const printed = opt(l.lineTotal);
    const up = opt(l.unitPrice);
    const computed = up === null ? null : roundMoney(d(l.quantity).times(up).minus(opt(l.discount) ?? ZERO));
    const diff = computed !== null && printed !== null ? printed.minus(computed) : null;
    if (diff !== null && diff.abs().gt(tol)) messages.push(`Line ${index + 1} (${l.description}): quantity × price is ${computed!.toFixed(2)} but the line total is ${printed!.toFixed(2)}`);
    if (printed === null && computed === null) messages.push(`Line ${index + 1} (${l.description}) has no price or total`);
    subtotal = subtotal.plus(printed ?? computed ?? ZERO);
    lineChecks.push({ index, computed, printed, difference: diff });
  });
  const printedSubtotal = opt(totals.subtotal);
  const subDiff = printedSubtotal === null ? null : printedSubtotal.minus(subtotal);
  if (subDiff !== null && subDiff.abs().gt(tol)) messages.push(`Lines add up to ${subtotal.toFixed(2)} but the subtotal is ${printedSubtotal!.toFixed(2)}`);
  const base = printedSubtotal ?? subtotal;
  const computedTotal = base
    .plus(opt(totals.freight) ?? ZERO)
    .plus(opt(totals.deposits) ?? ZERO)
    .plus(opt(totals.tax) ?? ZERO)
    .minus(opt(totals.discount) ?? ZERO);
  const printedTotal = opt(totals.total);
  const totalDiff = printedTotal === null ? null : printedTotal.minus(computedTotal);
  if (printedTotal === null) messages.push("Invoice total is missing");
  else if (totalDiff!.abs().gt(tol)) messages.push(`Subtotal, freight, deposits, tax and discount give ${computedTotal.toFixed(2)} but the total is ${printedTotal.toFixed(2)}`);
  if (totals.isCreditNote && printedTotal !== null && printedTotal.gt(0)) messages.push("Credit note total should be negative");
  if (!totals.isCreditNote && printedTotal !== null && printedTotal.lt(0)) messages.push("Negative total: mark this as a credit note");
  return { lineChecks, computedSubtotal: subtotal, subtotalDifference: subDiff, computedTotal, totalDifference: totalDiff, balanced: messages.length === 0, messages };
}

/** Base-unit quantity for a number of purchase units on a line. */
export function lineBaseQty(line: InvoiceLineInput, quantity: DecimalInput = line.quantity): Decimal | null {
  const size = opt(line.unitSizeBase);
  if (size === null || size.lte(0)) return null;
  return d(quantity).times(d(line.unitsPerPack)).times(size);
}

export interface CostPolicy {
  /** How invoice freight is treated in product cost. */
  freight: "exclude" | "allocate_by_value";
  /** Recoverable tax (e.g. VAT/GST) is excluded; non-recoverable sales tax can be included. */
  tax: "exclude" | "allocate_by_value";
  /** Invoice-level discounts reduce product cost in proportion to value. */
  invoiceDiscount: "allocate_by_value" | "exclude";
}

export const DEFAULT_COST_POLICY: CostPolicy = { freight: "allocate_by_value", tax: "exclude", invoiceDiscount: "allocate_by_value" };

/**
 * Landed cost per base unit for each line under the cost policy. Deposits are
 * refundable and never part of product cost.
 */
export function landedCosts(lines: InvoiceLineInput[], totals: InvoiceTotalsInput, policy: CostPolicy = DEFAULT_COST_POLICY): { extendedCost: Decimal | null; costPerBase: Decimal | null }[] {
  const values = lines.map((l) => {
    const printed = opt(l.lineTotal);
    const up = opt(l.unitPrice);
    const v = printed ?? (up === null ? null : d(l.quantity).times(up).minus(opt(l.discount) ?? ZERO));
    const deposit = opt(l.depositPerPack);
    return v === null ? null : deposit ? v.minus(deposit.times(d(l.quantity))) : v;
  });
  const valueSum = values.reduce<Decimal>((s, v) => s.plus(v ?? ZERO), ZERO);
  let extra = ZERO;
  if (policy.freight === "allocate_by_value") extra = extra.plus(opt(totals.freight) ?? ZERO);
  if (policy.tax === "allocate_by_value") extra = extra.plus(opt(totals.tax) ?? ZERO);
  if (policy.invoiceDiscount === "allocate_by_value") extra = extra.minus(opt(totals.discount) ?? ZERO);
  return lines.map((l, i) => {
    const v = values[i];
    if (v === null || v === undefined) return { extendedCost: null, costPerBase: null };
    const share = valueSum.isZero() ? ZERO : extra.times(v).div(valueSum);
    const extended = v.plus(share);
    const base = lineBaseQty(l);
    return { extendedCost: extended, costPerBase: base && !base.isZero() ? extended.div(base) : null };
  });
}

export interface DuplicateCandidate {
  id: string;
  fileSha256: string | null;
  supplierId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  total: string | null;
  isCreditNote: boolean;
}

export interface DuplicateMatch {
  id: string;
  reason: "same_file" | "same_supplier_invoice_number" | "same_supplier_date_total";
}

export function normalizeInvoiceNumber(n: string): string {
  return n.trim().toUpperCase().replace(/^(INVOICE|INV)[\s#:-]*/i, "").replace(/[\s#-]/g, "").replace(/^0+(?=\d)/, "");
}

/** Possible duplicates of `c` among existing invoices, for human review. */
export function findDuplicates(c: DuplicateCandidate, existing: DuplicateCandidate[]): DuplicateMatch[] {
  const out: DuplicateMatch[] = [];
  for (const e of existing) {
    if (e.id === c.id) continue;
    if (c.fileSha256 && e.fileSha256 === c.fileSha256) out.push({ id: e.id, reason: "same_file" });
    else if (c.supplierId && e.supplierId === c.supplierId && c.invoiceNumber && e.invoiceNumber && e.isCreditNote === c.isCreditNote && normalizeInvoiceNumber(e.invoiceNumber) === normalizeInvoiceNumber(c.invoiceNumber)) {
      out.push({ id: e.id, reason: "same_supplier_invoice_number" });
    } else if (c.supplierId && e.supplierId === c.supplierId && c.invoiceDate && e.invoiceDate === c.invoiceDate && c.total && e.total && d(c.total).eq(d(e.total))) {
      out.push({ id: e.id, reason: "same_supplier_date_total" });
    }
  }
  return out;
}

export interface ReceivingLine {
  invoiceQuantity: DecimalInput;
  receivedQuantity: DecimalInput | null;
}

/** Lines where what arrived differs from what was billed. */
export function receivingDifferences(lines: ReceivingLine[]): { index: number; billed: Decimal; received: Decimal | null; difference: Decimal | null }[] {
  return lines
    .map((l, index) => {
      const billed = d(l.invoiceQuantity);
      const received = opt(l.receivedQuantity);
      return { index, billed, received, difference: received === null ? null : received.minus(billed) };
    })
    .filter((x) => x.received === null || !x.difference!.isZero());
}
