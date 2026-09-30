import { describe, expect, it } from "vitest";
import { consumables, largestRemainder, planEventDemand, planIngredients, quote } from "../src/catering";
import type { CostingContext, ProductInfo, RecipeVersion } from "../src/costing";
import { d } from "../src/decimal";
import { balances, countAdjustments, countToBase, type Movement, reversalOf, suggestedOrderPacks, unitCost, validateMovement } from "../src/inventory";
import { findDuplicates, landedCosts, normalizeInvoiceNumber, receivingDifferences, reconcileInvoice } from "../src/invoice";
import { copyWeek, diffPublications, findOverlaps, resolveShift, validateShift } from "../src/schedule";
import { businessDate, businessDayBounds, localToUtc } from "../src/time";
import { theoreticalUsage } from "../src/usage";
import type { NormalizedSale } from "../src/pos";

const NY = "America/New_York";

describe("time zones and business days", () => {
  it("uses the cutoff to assign late-night instants", () => {
    expect(businessDate(new Date("2026-09-15T06:30:00Z"), NY, "04:00")).toBe("2026-09-14"); // 02:30 EDT
    expect(businessDate(new Date("2026-09-15T08:30:00Z"), NY, "04:00")).toBe("2026-09-15"); // 04:30 EDT
  });

  it("business day spanning fall-back is 25 hours long", () => {
    const b = businessDayBounds("2026-10-31", NY, "04:00");
    expect((b.end.getTime() - b.start.getTime()) / 3_600_000).toBe(25);
  });

  it("moves a nonexistent spring-forward time past the gap and resolves ambiguous times", () => {
    expect(localToUtc("2026-03-08", "02:30", NY).toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(localToUtc("2026-11-01", "01:30", NY, "earlier").toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(localToUtc("2026-11-01", "01:30", NY, "later").toISOString()).toBe("2026-11-01T06:30:00.000Z");
  });
});

describe("schedule", () => {
  it("handles an overnight shift across fall-back with its real length", () => {
    const s = resolveShift({ id: "s", staffId: "a", role: "Bartender", date: "2026-10-31", start: "20:00", end: "03:00" }, NY);
    expect(s.overnight).toBe(true);
    expect(s.minutes).toBe(8 * 60);
  });

  it("detects overlapping assignments, including overnight into next day", () => {
    const shifts = [
      { id: "1", staffId: "a", role: "Bar", date: "2026-09-18", start: "20:00", end: "02:00" },
      { id: "2", staffId: "a", role: "Bar", date: "2026-09-19", start: "01:00", end: "05:00" },
      { id: "3", staffId: "b", role: "Bar", date: "2026-09-19", start: "01:00", end: "05:00" },
      { id: "4", staffId: "a", role: "Bar", date: "2026-09-19", start: "18:00", end: "23:00" },
    ].map((s) => resolveShift(s, NY));
    expect(findOverlaps(shifts)).toEqual([{ staffId: "a", a: "1", b: "2" }]);
  });

  it("validates shift inputs", () => {
    expect(validateShift({ id: "x", staffId: null, role: "", date: "2026-09-19", start: "10:00", end: "10:00" }, NY)).toContain("Role is required");
    expect(validateShift({ id: "x", staffId: null, role: "Bar", date: "2026-09-19", start: "10:00", end: "10:00" }, NY)).toContain("Start and end cannot be the same time");
  });

  it("copies a week forward and diffs publications per person", () => {
    const week = [{ id: "1", staffId: "a", role: "Bar", date: "2026-09-14", start: "17:00", end: "01:00" }];
    const next = copyWeek(week, 1, (s) => `${s.id}-n`);
    expect(next[0]).toMatchObject({ id: "1-n", date: "2026-09-21", start: "17:00" });
    const changes = diffPublications(week, [{ ...week[0]!, staffId: "b" }, { id: "2", staffId: "c", role: "Barback", date: "2026-09-15", start: "18:00", end: "23:00" }]);
    expect(changes).toEqual([
      { kind: "changed", shiftId: "1", staffIds: ["a", "b"] },
      { kind: "added", shiftId: "2", staffIds: ["c"] },
    ]);
  });
});

describe("inventory ledger", () => {
  const m = (id: string, type: Movement["type"], qty: string, at: string, cost?: string): Movement => ({ id, productId: "gin", type, qtyBase: d(qty), occurredAt: at, extendedCost: cost ? d(cost) : null });

  it("reverses without rewriting history and reproduces past balances", () => {
    const r1 = m("r1", "receipt", "9000", "2026-09-01T12:00:00Z", "180");
    const rev = reversalOf(r1, "rev1", "2026-09-03T12:00:00Z", "entered twice");
    const all = [m("o", "opening_balance", "1500", "2026-08-31T12:00:00Z"), r1, rev];
    expect(validateMovement(rev)).toEqual([]);
    expect(balances(all, "2026-09-02T00:00:00Z").get("gin")?.toString()).toBe("10500");
    expect(balances(all).get("gin")?.toString()).toBe("1500");
    expect(() => reversalOf(rev, "x", "2026-09-04T00:00:00Z", "")).toThrow();
  });

  it("enforces movement signs and reasons", () => {
    expect(validateMovement(m("w", "waste", "100", "2026-09-01T00:00:00Z"))[0]?.message).toMatch(/negative/);
    expect(validateMovement(m("a", "manual_adjustment", "-5", "2026-09-01T00:00:00Z"))[0]?.message).toMatch(/reason/);
  });

  it("computes moving-average and last cost", () => {
    const ms = [m("1", "receipt", "1000", "2026-09-01T00:00:00Z", "20"), m("2", "waste", "-500", "2026-09-02T00:00:00Z"), m("3", "receipt", "500", "2026-09-03T00:00:00Z", "15")];
    expect(unitCost(ms, "moving_average")?.toString()).toBe("0.025");
    expect(unitCost(ms, "last_cost")?.toString()).toBe("0.03");
    expect(unitCost(ms, "moving_average", "2026-09-02T00:00:00Z")?.toString()).toBe("0.02");
  });

  it("ignores the price of a receipt that was later reversed", () => {
    const r1 = m("1", "receipt", "1000", "2026-09-01T00:00:00Z", "20");
    const bad = m("2", "receipt", "1000", "2026-09-02T00:00:00Z", "90");
    const rev = reversalOf(bad, "3", "2026-09-03T00:00:00Z", "wrong price, entered twice");
    expect(unitCost([r1, bad, rev], "moving_average")?.toString()).toBe("0.02");
    expect(unitCost([r1, bad, rev], "last_cost")?.toString()).toBe("0.02");
    expect(unitCost([r1, bad, rev], "moving_average", "2026-09-02T12:00:00Z")?.toString()).toBe("0.055");
  });

  it("counts partial bottles and marks estimates as approximate", () => {
    const bottle = { sizeBase: d(750), fullWeightG: d(1250), emptyWeightG: d(500) };
    const tenths = countToBase({ method: "tenths", fullUnits: 2, tenths: 4 }, bottle);
    expect(tenths.qtyBase?.toString()).toBe("1800");
    expect(tenths.approximate).toBe(true);
    expect(tenths.uncertaintyBase.toString()).toBe("37.5");
    const weight = countToBase({ method: "weight", fullUnits: 0, grossWeightG: 875 }, bottle);
    expect(weight.qtyBase?.toString()).toBe("375");
    expect(countToBase({ method: "full_units", fullUnits: 3 }, bottle)).toMatchObject({ approximate: false });
    expect(countToBase({ method: "weight", grossWeightG: 100 }, bottle).qtyBase).toBeNull();
    expect(countToBase({ method: "tenths", tenths: 4 }, null).qtyBase).toBeNull();
  });

  it("reports uncounted products instead of zeroing them", () => {
    const { adjustments, uncounted } = countAdjustments(
      [{ productId: "gin", countedBase: d(700), approximate: false }, { productId: "gin", countedBase: d(100), approximate: false }],
      new Map([["gin", d(1000)], ["rum", d(500)]]),
      ["gin", "rum"],
    );
    expect(adjustments).toEqual([{ productId: "gin", qtyBase: d(-200), countedBase: d(800), bookBase: d(1000) }]);
    expect(uncounted).toEqual(["rum"]);
  });

  it("suggests whole packs to reach par", () => {
    expect(suggestedOrderPacks(d(9000), d(2000), d(750 * 6)).packs).toBe(2);
    expect(suggestedOrderPacks(d(9000), null, d(4500)).packs).toBeNull();
  });
});

describe("invoices", () => {
  const lines = [
    { description: "Gin 12x750", quantity: 2, unitPrice: "180.00", lineTotal: "360.00", unitsPerPack: 12, unitSizeBase: 750 },
    { description: "Tonic 24x200", quantity: 1, unitPrice: "30.00", discount: "5", lineTotal: "25.00", unitsPerPack: 24, unitSizeBase: 200, depositPerPack: "1.20" },
  ];
  const totals = { subtotal: "385.00", freight: "15.00", deposits: "1.20", tax: "0", discount: "0", total: "401.20", isCreditNote: false };

  it("reconciles lines and totals", () => {
    const r = reconcileInvoice(lines, totals);
    expect(r.balanced).toBe(true);
    const bad = reconcileInvoice([{ ...lines[0]!, lineTotal: "350.00" }, lines[1]!], totals);
    expect(bad.balanced).toBe(false);
    expect(bad.messages[0]).toMatch(/Line 1/);
  });

  it("allocates freight by value and excludes deposits from product cost", () => {
    const [gin, tonic] = landedCosts(lines, totals);
    // Values: gin 360, tonic 25 - 1.20 deposit = 23.80. Freight 15 split by value.
    expect(gin!.extendedCost!.toFixed(4)).toBe("374.0698");
    expect(gin!.costPerBase!.times(750).toFixed(4)).toBe("15.5862");
    expect(tonic!.extendedCost!.toFixed(4)).toBe("24.7302");
  });

  it("flags credit note sign errors", () => {
    expect(reconcileInvoice([], { ...totals, subtotal: null, total: "-20", freight: null, deposits: null, tax: null, discount: null, isCreditNote: false }).messages.join()).toMatch(/credit note/);
  });

  it("finds duplicates by file hash and by normalized invoice number", () => {
    const base = { fileSha256: null, supplierId: "s1", invoiceDate: "2026-09-01", total: "100", isCreditNote: false };
    const dupes = findDuplicates({ id: "new", ...base, fileSha256: "abc", invoiceNumber: "INV-00123" }, [
      { id: "a", ...base, fileSha256: "abc", invoiceNumber: "x" },
      { id: "b", ...base, invoiceNumber: "123" },
      { id: "c", ...base, invoiceNumber: "123", isCreditNote: true, total: "-5", invoiceDate: "2026-09-02" },
    ]);
    expect(dupes).toEqual([{ id: "a", reason: "same_file" }, { id: "b", reason: "same_supplier_invoice_number" }]);
    expect(normalizeInvoiceNumber("Invoice #000123")).toBe("123");
  });

  it("reports received quantities that differ from billed", () => {
    expect(receivingDifferences([{ invoiceQuantity: 2, receivedQuantity: 2 }, { invoiceQuantity: 3, receivedQuantity: 2 }, { invoiceQuantity: 1, receivedQuantity: null }]).map((x) => x.index)).toEqual([1, 2]);
  });
});

function product(id: string, extra: Partial<ProductInfo> = {}): ProductInfo {
  return { id, name: id, dimension: "volume", costPerBase: d("0.02"), onHandBase: d(0), ...extra };
}

describe("catering", () => {
  it("largest remainder preserves totals", () => {
    expect(largestRemainder(10, [d(1), d(1), d(1)])).toEqual([4, 3, 3]);
    expect(largestRemainder(7, [d(50), d(25), d(25), d(0)]).reduce((a, b) => a + b)).toBe(7);
  });

  it("allocates demand so categories and recipes reconcile", () => {
    const plan = planEventDemand(
      { guests: 120, participationPct: 85, durationHours: 4, firstHourDrinks: 2, laterHourDrinks: 1, contingencyPct: 10, mix: { cocktail: 50, beer: 25, wine: 20, non_alcoholic: 5 } },
      [
        { recipeId: "marg", category: "cocktail", sharePct: 60 },
        { recipeId: "gt", category: "cocktail", sharePct: 40 },
      ],
    );
    // 120 x 0.85 x (2 + 3) = 510 expected; +10% = 561 planned.
    expect(plan.expectedDrinks.toString()).toBe("510");
    expect(plan.plannedDrinks).toBe(561);
    const catSum = Object.values(plan.byCategory).reduce((a, b) => a + b, 0);
    expect(catSum).toBe(561);
    expect(plan.byRecipe.reduce((a, r) => a + r.servings, 0)).toBe(plan.byCategory.cocktail);
    expect(plan.unassigned.beer).toBe(plan.byCategory.beer);
  });

  it("rejects mixes that do not add to 100%", () => {
    const plan = planEventDemand({ guests: 10, participationPct: 100, durationHours: 1, firstHourDrinks: 1, laterHourDrinks: 1, contingencyPct: 0, mix: { cocktail: 50, beer: 25, wine: 20, non_alcoholic: 0 } }, []);
    expect(plan.issues[0]?.message).toMatch(/95%/);
    expect(plan.plannedDrinks).toBe(0);
  });

  it("rounds purchases to whole packs after stock and prices the quote", () => {
    const ctx: CostingContext = {
      products: new Map([["tequila", product("tequila", { onHandBase: d(1000) })], ["lime", product("lime", { costPerBase: d("0.03") })]]),
      recipes: new Map<string, RecipeVersion>([["marg", { id: "m1", recipeId: "marg", name: "Margarita", kind: "drink", yield: { servings: 1 }, components: [
        { ref: { kind: "product", id: "tequila" }, qty: 60, unit: "ml" },
        { ref: { kind: "product", id: "lime" }, qty: 30, unit: "ml" },
      ] }]]),
      ingredientMap: new Map(),
    };
    const plan = planIngredients(ctx, [{ recipeId: "marg", servings: 100 }], new Map([["tequila", { packBase: d(750), packCost: d(22) }], ["lime", { packBase: d(946), packCost: d(9) }]]), true);
    const teq = plan.lines.find((l) => l.productId === "tequila")!;
    expect(teq.requiredBase.toString()).toBe("6000");
    expect(teq.toBuyBase.toString()).toBe("5000");
    expect(teq.packs).toBe(7);
    expect(plan.ingredientCost?.toString()).toBe("210");
    const q = quote(plan.ingredientCost, ["150"], { kind: "margin", pct: 40 });
    expect(q.price?.toString()).toBe("600");
    expect(quote(plan.ingredientCost, ["150"], { kind: "markup", pct: 40 }).price?.toString()).toBe("504");
    expect(consumables(d(100), { ...planEventDemand({ guests: 100, participationPct: 100, durationHours: 1, firstHourDrinks: 1, laterHourDrinks: 0, contingencyPct: 0, mix: { cocktail: 100, beer: 0, wine: 0, non_alcoholic: 0 } }, []) }, { iceLbPerParticipant: 1, chillIceLbPerBottleDrink: 0, cupsPerDrink: 1, napkinsPerDrink: 2 }).napkins.toString()).toBe("200");
  });
});

describe("theoretical usage from sales", () => {
  const ctx: CostingContext = {
    products: new Map([["gin", product("gin")], ["gin2", product("gin2", { name: "Premium gin" })], ["campari", product("campari")]]),
    recipes: new Map<string, RecipeVersion>([["negroni", { id: "n1", recipeId: "negroni", name: "Negroni", kind: "drink", yield: { servings: 1 }, components: [
      { ref: { kind: "product", id: "gin" }, qty: 30, unit: "ml" },
      { ref: { kind: "product", id: "campari" }, qty: 30, unit: "ml" },
    ] }]]),
    ingredientMap: new Map(),
  };
  const sale = (extra: Partial<NormalizedSale>): NormalizedSale => ({
    rowNumber: 1, businessDate: "2026-09-14", businessDateEnd: "2026-09-14", occurredAt: null, transactionId: null, lineId: null, parentLineId: null,
    itemKey: "name:negroni", itemName: "Negroni", category: null, modifiers: [], quantity: d(1), grossSales: d(12), netSales: d(12), discount: null,
    kind: "sale", voidPrepared: null, staffRef: null, dedupeKey: "k", ...extra,
  });
  const deps = {
    contextFor: () => ctx,
    itemMapping: (k: string) => (k === "name:negroni" ? { itemKey: k, recipeId: "negroni" } : null),
    modifierMapping: (m: string) =>
      m === "double" ? { modifierKey: m, actions: [{ kind: "scale" as const, factor: 2 }] }
      : m === "premium gin" ? { modifierKey: m, actions: [{ kind: "substitute" as const, from: { kind: "product" as const, id: "gin" }, to: { kind: "product" as const, id: "gin2" } }] }
      : null,
  };

  it("applies doubles and substitutions, and excludes unmapped modifiers", () => {
    const u = theoreticalUsage([
      sale({ quantity: d(3) }),
      sale({ modifiers: ["Double"] }),
      sale({ modifiers: ["Premium Gin"] }),
      sale({ modifiers: ["Mystery"] }),
      sale({ itemKey: "name:unknown", itemName: "Unknown", netSales: d(9) }),
      sale({ kind: "comp", netSales: d(0) }),
      sale({ kind: "void" }),
    ], deps);
    // gin: 3x30 + 2x30 (double) + comp 30 = 180; premium gin 30; campari: 3x30 + 60 + 30 + 30 = 210
    expect(u.byProduct.get("gin")?.asPurchasedBase.toString()).toBe("180");
    expect(u.byProduct.get("gin2")?.asPurchasedBase.toString()).toBe("30");
    expect(u.byProduct.get("campari")?.asPurchasedBase.toString()).toBe("210");
    expect(u.unresolved.map((x) => x.reason)).toEqual(['Modifier "mystery" is not mapped', "POS item is not mapped to a recipe"]);
    expect(u.lines).toBe(7);
    expect(u.linesResolved).toBe(5);
    expect(u.issues.map((i) => i.code).sort()).toEqual(["unmapped_modifier", "unmapped_pos_item"]);
  });
});
