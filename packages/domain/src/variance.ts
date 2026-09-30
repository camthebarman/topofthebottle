/**
 * Inventory variance.
 *
 * For each product over a period bounded by two counts:
 *
 *   physical depletion  = opening count + receipts + transfers in + production output + event returns
 *                         - transfers out - supplier returns - closing count
 *   accounted depletion = recipe-based served usage + confirmed waste + breakage
 *                         + production consumption + event dispatch
 *   unexplained usage   = physical depletion - accounted depletion
 *
 * Sign: positive unexplained usage means more stock left the shelf than the
 * records explain; negative means less did. The percentage denominator is
 * accounted depletion.
 *
 * Count adjustments are excluded (they are derived from the counts that
 * already bound the period). Manual adjustments are listed separately and do
 * not count as explained usage, so an adjustment cannot quietly erase
 * variance.
 *
 * Nothing here attributes variance to a person. Shared stock and shared
 * shifts do not establish individual responsibility.
 */
import { Decimal, ZERO, pct } from "./decimal";
import { issue, type Issue } from "./issues";
import type { Movement } from "./inventory";

export interface CountObservation {
  qtyBase: Decimal;
  /** UTC instant the count was taken. */
  countedAt: string;
  approximate: boolean;
  uncertaintyBase: Decimal;
}

export interface VarianceInput {
  productId: string;
  name: string;
  dimension: string;
  opening: CountObservation | null;
  closing: CountObservation | null;
  /** Movements strictly after the opening count and at or before the closing count. */
  movements: Movement[];
  /** Theoretical served usage (as purchased) from fully resolved sales in the period. */
  servedBase: Decimal;
  /** Share of period net sales that could be resolved to recipes, 0-100. */
  salesCoveragePct: Decimal | null;
  costPerBase: Decimal | null;
  /** How cost was determined, e.g. "moving average at closing count". */
  costBasis: string;
}

export type VarianceStatus =
  | "insufficient_data"
  | "incomplete"
  | "within_uncertainty"
  | "requires_review";

export interface VarianceLine {
  productId: string;
  name: string;
  dimension: string;
  status: VarianceStatus;
  opening: Decimal | null;
  closing: Decimal | null;
  receipts: Decimal;
  transfersIn: Decimal;
  transfersOut: Decimal;
  supplierReturns: Decimal;
  productionOutput: Decimal;
  eventReturns: Decimal;
  physicalDepletion: Decimal | null;
  served: Decimal;
  waste: Decimal;
  breakage: Decimal;
  productionConsumed: Decimal;
  eventDispatched: Decimal;
  accountedDepletion: Decimal;
  /** Listed for review; not part of accounted depletion. */
  manualAdjustments: Decimal;
  unexplained: Decimal | null;
  /** Unexplained usage as % of accounted depletion. */
  unexplainedPct: Decimal | null;
  unexplainedValue: Decimal | null;
  uncertaintyBase: Decimal;
  costPerBase: Decimal | null;
  costBasis: string;
  salesCoveragePct: Decimal | null;
  issues: Issue[];
  /** Plain-language, non-accusatory explanations consistent with the sign. */
  possibleExplanations: string[];
  recommendedChecks: string[];
}

export interface VarianceOptions {
  /** Unexplained usage below this % of accounted depletion is not flagged. */
  reviewThresholdPct: Decimal;
  /** Sales coverage below this % makes the line incomplete. */
  minCoveragePct: Decimal;
}

export const DEFAULT_VARIANCE_OPTIONS: VarianceOptions = { reviewThresholdPct: new Decimal(5), minCoveragePct: new Decimal(95) };

const POSITIVE_EXPLANATIONS = [
  "Pours larger than the recipe specifies",
  "Waste, spills or breakage that was not logged",
  "Sales that were not rung in, or rung under a different item",
  "Recording mistakes: a missed transfer, a receipt entered twice, a miscount",
  "Stock loss",
];
const NEGATIVE_EXPLANATIONS = [
  "Pours smaller than the recipe specifies",
  "A count that was too high at closing or too low at opening",
  "A recipe that specifies more than is actually used",
  "Receipts or transfers in that were not recorded",
];

export function computeVariance(input: VarianceInput, opts: VarianceOptions = DEFAULT_VARIANCE_OPTIONS): VarianceLine {
  const issues: Issue[] = [];
  const t = (type: Movement["type"]) => input.movements.filter((m) => m.type === type).reduce((s, m) => s.plus(m.qtyBase), ZERO);
  // Outflow movements are stored negative; report them as positive quantities.
  const receipts = t("receipt");
  const transfersIn = t("transfer_in");
  const transfersOut = t("transfer_out").negated();
  const supplierReturns = t("supplier_return").negated();
  const productionOutput = t("production_output");
  const eventReturns = t("event_return");
  const waste = t("waste").negated();
  const breakage = t("breakage").negated();
  const productionConsumed = t("production_consume").negated();
  const eventDispatched = t("event_dispatch").negated();
  const manualAdjustments = t("manual_adjustment");
  const openingBalance = t("opening_balance");
  if (!openingBalance.isZero()) issues.push(issue("reconciliation_mismatch", "Opening balances were entered inside the period; they are ignored in favour of counts"));

  const served = input.servedBase;
  const accounted = served.plus(waste).plus(breakage).plus(productionConsumed).plus(eventDispatched);
  const uncertainty = (input.opening?.uncertaintyBase ?? ZERO).plus(input.closing?.uncertaintyBase ?? ZERO);

  const base = {
    productId: input.productId,
    name: input.name,
    dimension: input.dimension,
    opening: input.opening?.qtyBase ?? null,
    closing: input.closing?.qtyBase ?? null,
    receipts,
    transfersIn,
    transfersOut,
    supplierReturns,
    productionOutput,
    eventReturns,
    served,
    waste,
    breakage,
    productionConsumed,
    eventDispatched,
    accountedDepletion: accounted,
    manualAdjustments,
    uncertaintyBase: uncertainty,
    costPerBase: input.costPerBase,
    costBasis: input.costBasis,
    salesCoveragePct: input.salesCoveragePct,
  };

  if (!input.opening || !input.closing) {
    issues.push(issue("missing_count", `Needs ${!input.opening ? "an opening" : "a closing"} count to measure physical usage`, { ref: input.productId }));
    return {
      ...base,
      status: "insufficient_data",
      physicalDepletion: null,
      unexplained: null,
      unexplainedPct: null,
      unexplainedValue: null,
      issues,
      possibleExplanations: [],
      recommendedChecks: [`Count ${input.name} at the start and end of the period`],
    };
  }
  if (Date.parse(input.closing.countedAt) <= Date.parse(input.opening.countedAt)) {
    issues.push(issue("reconciliation_mismatch", "Closing count is not after the opening count"));
  }

  const physical = input.opening.qtyBase
    .plus(receipts)
    .plus(transfersIn)
    .plus(productionOutput)
    .plus(eventReturns)
    .minus(transfersOut)
    .minus(supplierReturns)
    .minus(input.closing.qtyBase);
  const unexplained = physical.minus(accounted);
  const unexplainedPct = pct(unexplained, accounted);
  const value = input.costPerBase === null ? null : unexplained.times(input.costPerBase);

  if (input.costPerBase === null) issues.push(issue("missing_price", `${input.name} has no cost, so variance has no value`, { ref: input.productId }));
  if (input.opening.approximate || input.closing.approximate) {
    issues.push(issue("approximate_measurement", "One or both counts include estimated partial containers"));
  }
  if (!manualAdjustments.isZero()) {
    issues.push(issue("reconciliation_mismatch", "Manual adjustments were recorded in this period; they are shown for review and not treated as explained usage"));
  }
  const coverageLow = input.salesCoveragePct === null || input.salesCoveragePct.lt(opts.minCoveragePct);
  if (coverageLow) {
    issues.push(issue("unmapped_pos_item", input.salesCoveragePct === null ? "No sales were imported for this period" : `Only ${input.salesCoveragePct.toFixed(1)}% of sales could be matched to recipes`));
  }

  let status: VarianceStatus;
  if (coverageLow || input.costPerBase === null) status = "incomplete";
  else if (unexplained.abs().lte(uncertainty)) status = "within_uncertainty";
  else if (unexplainedPct !== null && unexplainedPct.abs().lt(opts.reviewThresholdPct)) status = "within_uncertainty";
  else status = "requires_review";

  const positive = unexplained.gt(0);
  const checks: string[] = [];
  if (status === "requires_review" || status === "incomplete") {
    if (coverageLow) checks.push("Map the remaining POS items and modifiers to recipes");
    checks.push(`Recount ${input.name} to confirm the closing figure`);
    if (positive) {
      checks.push("Check that all waste, spills and breakage were logged");
      checks.push("Compare the recipe specification with how the drink is actually built");
      checks.push("Look for items rung under a different button or not rung in");
    } else if (unexplained.lt(0)) {
      checks.push("Check for receipts or transfers that were not recorded");
      checks.push("Check the recipe quantities against actual builds");
    }
  }

  return {
    ...base,
    status,
    physicalDepletion: physical,
    unexplained,
    unexplainedPct,
    unexplainedValue: value,
    issues,
    possibleExplanations: status === "requires_review" ? (positive ? POSITIVE_EXPLANATIONS : NEGATIVE_EXPLANATIONS) : [],
    recommendedChecks: checks,
  };
}

// ---------- capability ----------

export interface DataAvailability {
  hasSales: boolean;
  salesAreTransactions: boolean;
  hasRecipeMappings: boolean;
  hasPurchasesOrMovements: boolean;
  hasAlignedCounts: boolean;
}

export type CapabilityLevel = "none" | "sales_only" | "theoretical_usage" | "inventory_variance";

export interface Capability {
  level: CapabilityLevel;
  available: string[];
  unavailable: { analysis: string; needs: string }[];
}

export function capability(a: DataAvailability): Capability {
  const available: string[] = [];
  const unavailable: { analysis: string; needs: string }[] = [];
  if (!a.hasSales) {
    return {
      level: "none",
      available,
      unavailable: [{ analysis: "Menu mix and revenue", needs: "Import a POS sales file" }],
    };
  }
  available.push("Menu mix and revenue");
  let level: CapabilityLevel = "sales_only";
  if (a.hasRecipeMappings) {
    available.push("Theoretical ingredient cost of sales", "Theoretical ingredient usage");
    level = "theoretical_usage";
  } else unavailable.push({ analysis: "Theoretical usage", needs: "Map POS items to recipes" });
  if (a.hasRecipeMappings && a.hasAlignedCounts && a.hasPurchasesOrMovements) {
    available.push("Inventory variance (unexplained usage)");
    level = "inventory_variance";
  } else {
    unavailable.push({
      analysis: "Inventory variance",
      needs: [!a.hasAlignedCounts && "finalized counts at the start and end of the period", !a.hasPurchasesOrMovements && "received purchases or movements in the period", !a.hasRecipeMappings && "recipe mappings"].filter(Boolean).join(", "),
    });
  }
  if (a.salesAreTransactions) available.push("Void, comp and refund patterns by time of day");
  else unavailable.push({ analysis: "Void, comp and refund patterns", needs: "Item-level transaction exports (aggregate reports lack timing)" });
  return { level, available, unavailable };
}
