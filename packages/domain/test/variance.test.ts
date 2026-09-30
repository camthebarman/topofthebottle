import { describe, expect, it } from "vitest";
import { d } from "../src/decimal";
import type { Movement } from "../src/inventory";
import { capability, computeVariance, type VarianceInput } from "../src/variance";

function mv(type: Movement["type"], qty: string, extra: Partial<Movement> = {}): Movement {
  return { id: `${type}-${qty}`, productId: "gin", type, qtyBase: d(qty), occurredAt: "2026-09-10T20:00:00Z", ...extra };
}

/**
 * Auditable fixture from the specification:
 * opening 10,000 mL; receipts 5,000 mL; closing 8,000 mL; no transfers or returns.
 * Physical depletion 7,000 mL. 100 drinks x 60 mL = 6,000 mL served. Waste 500 mL.
 * Unexplained +500 mL; at $0.02/mL that is $10.
 */
const fixture: VarianceInput = {
  productId: "gin",
  name: "House gin",
  dimension: "volume",
  opening: { qtyBase: d(10000), countedAt: "2026-09-01T09:00:00Z", approximate: false, uncertaintyBase: d(0) },
  closing: { qtyBase: d(8000), countedAt: "2026-09-15T09:00:00Z", approximate: false, uncertaintyBase: d(0) },
  movements: [mv("receipt", "5000"), mv("waste", "-500")],
  servedBase: d(100).times(60),
  salesCoveragePct: d(100),
  costPerBase: d("0.02"),
  costBasis: "Moving average at closing count",
};

describe("auditable variance fixture", () => {
  const v = computeVariance(fixture);

  it("computes physical depletion of 7,000 mL", () => {
    expect(v.physicalDepletion?.toString()).toBe("7000");
  });

  it("computes accounted depletion of 6,500 mL (6,000 served + 500 waste)", () => {
    expect(v.served.toString()).toBe("6000");
    expect(v.waste.toString()).toBe("500");
    expect(v.accountedDepletion.toString()).toBe("6500");
  });

  it("reports +500 mL unexplained usage valued at $10", () => {
    expect(v.unexplained?.toString()).toBe("500");
    expect(v.unexplainedValue?.toString()).toBe("10");
    expect(v.unexplainedPct?.toFixed(2)).toBe("7.69");
    expect(v.status).toBe("requires_review");
  });

  it("does not call it proof of theft or overpouring", () => {
    const text = JSON.stringify(v).toLowerCase();
    expect(text).not.toMatch(/theft|thief|steal|stole|proof|proves|fraud/);
    expect(v.possibleExplanations.length).toBeGreaterThan(1);
    expect(v.possibleExplanations.join(" ")).toMatch(/not logged/);
  });
});

describe("variance edge cases", () => {
  it("is insufficient without a closing count", () => {
    const v = computeVariance({ ...fixture, closing: null });
    expect(v.status).toBe("insufficient_data");
    expect(v.unexplained).toBeNull();
    expect(v.recommendedChecks[0]).toMatch(/Count/);
  });

  it("is incomplete when sales coverage is low", () => {
    const v = computeVariance({ ...fixture, salesCoveragePct: d(80) });
    expect(v.status).toBe("incomplete");
    expect(v.unexplained?.toString()).toBe("500");
  });

  it("treats a variance within count uncertainty as within uncertainty", () => {
    const v = computeVariance({
      ...fixture,
      opening: { ...fixture.opening!, approximate: true, uncertaintyBase: d(300) },
      closing: { ...fixture.closing!, approximate: true, uncertaintyBase: d(300) },
    });
    expect(v.status).toBe("within_uncertainty");
    expect(v.issues.some((i) => i.code === "approximate_measurement")).toBe(true);
  });

  it("manual adjustments do not erase variance", () => {
    const v = computeVariance({ ...fixture, movements: [...fixture.movements, mv("manual_adjustment", "-500", { reason: "write-off" })] });
    expect(v.unexplained?.toString()).toBe("500");
    expect(v.manualAdjustments.toString()).toBe("-500");
    expect(v.issues.some((i) => /Manual adjustments/.test(i.message))).toBe(true);
  });

  it("counts production as consumption without double counting the output", () => {
    // Lemon juice: 2,000 opening, production consumed 1,500 into sour mix, closing 500.
    const v = computeVariance({
      ...fixture,
      opening: { ...fixture.opening!, qtyBase: d(2000) },
      closing: { ...fixture.closing!, qtyBase: d(500) },
      movements: [mv("production_consume", "-1500")],
      servedBase: d(0),
    });
    expect(v.physicalDepletion?.toString()).toBe("1500");
    expect(v.unexplained?.toString()).toBe("0");
  });

  it("handles transfers and supplier returns in physical depletion", () => {
    const v = computeVariance({
      ...fixture,
      movements: [mv("receipt", "5000"), mv("waste", "-500"), mv("transfer_out", "-1000"), mv("transfer_in", "200"), mv("supplier_return", "-700")],
    });
    // 10000 + 5000 + 200 - 1000 - 700 - 8000 = 5500
    expect(v.physicalDepletion?.toString()).toBe("5500");
    expect(v.unexplained?.toString()).toBe("-1000");
    expect(v.possibleExplanations.join(" ")).toMatch(/smaller/);
  });
});

describe("capability levels", () => {
  it("limits conclusions to available data", () => {
    expect(capability({ hasSales: false, salesAreTransactions: false, hasRecipeMappings: false, hasPurchasesOrMovements: false, hasAlignedCounts: false }).level).toBe("none");
    const salesOnly = capability({ hasSales: true, salesAreTransactions: false, hasRecipeMappings: false, hasPurchasesOrMovements: true, hasAlignedCounts: true });
    expect(salesOnly.level).toBe("sales_only");
    expect(salesOnly.unavailable.map((u) => u.analysis)).toContain("Inventory variance");
    expect(capability({ hasSales: true, salesAreTransactions: true, hasRecipeMappings: true, hasPurchasesOrMovements: true, hasAlignedCounts: true }).level).toBe("inventory_variance");
  });
});
