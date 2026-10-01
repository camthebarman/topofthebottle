import { describe, expect, it } from "vitest";
import { planLegacyImport } from "../src/legacy";

// Shaped like Clayton's pre-redesign state: batches, transfers and settings present.
const clayton = {
  version: 3,
  ingredients: [
    { id: "gin", name: "Gin", baseUnit: "floz", purchaseUnit: "bottle750", purchaseQty: 1, purchaseCost: 25.36, onHandQty: { loc_kitchen: 50.72, loc_boat: 25.36 }, parQty: 76.08, category: "Spirit" },
    { id: "lime", name: "Limes", baseUnit: "each", purchaseUnit: "each", purchaseQty: 1, purchaseCost: 0.4, onHandQty: 30, yieldPct: 0 },
    { id: "sugar", name: "Sugar", baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 4, purchaseCost: 3.2, onHandQty: 64 },
    { id: "bad", baseUnit: "floz" },
  ],
  preps: [
    { id: "syrup", name: "Simple syrup", baseUnit: "floz", yieldQty: 32, components: [{ ingredientId: "sugar", qty: 16 }] },
    { id: "zero", name: "Broken prep", baseUnit: "floz", yieldQty: 0, components: [] },
  ],
  recipes: [
    { id: "gimlet", name: "Gimlet", components: [{ ingredientId: "gin", qty: 2 }, { ingredientId: "syrup", qty: 0.5 }], menuPrice: 12 },
    { id: "ghost", name: "Ghost drink", components: [{ ingredientId: "missing", qty: 1 }] },
  ],
  batches: [{ id: "b1" }, { id: "b2" }],
  transfers: [{ id: "t1" }],
  settings: { nextTransferNo: 1043, defaultTargetPourCostPct: 20 },
};

describe("legacy import plan (defect 5: nothing silently deleted)", () => {
  const plan = planLegacyImport(clayton, "clayton");

  it("reports batches, transfers and settings as explicit exceptions with counts", () => {
    expect(plan.counts.batches).toEqual({ found: 2, imported: 0 });
    expect(plan.counts.transfers).toEqual({ found: 1, imported: 0 });
    expect(plan.counts.settings).toEqual({ found: 2, imported: 0 });
    const kinds = plan.exceptions.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["batches", "transfers", "settings"]));
  });

  it("accounts for every ingredient, prep and recipe", () => {
    for (const k of ["ingredients", "preps", "recipes"]) {
      const c = plan.counts[k]!;
      const excepted = new Set(plan.exceptions.filter((e) => e.kind === k.replace(/s$/, "") && e.sourceId !== undefined).map((e) => e.sourceId ?? e.name));
      expect(c.imported + excepted.size, k).toBeGreaterThanOrEqual(c.found);
    }
  });

  it("converts units exactly and sums per-location stock with a note", () => {
    const gin = plan.products.find((p) => p.sourceId === "gin")!;
    expect(gin.dimension).toBe("volume");
    // 76.08 US fl oz (the old tool rounded a 750 mL bottle to 25.36 fl oz), converted exactly.
    expect(gin.onHandBase!.toFixed(2)).toBe("2249.95");
    expect(gin.costPerBase!.times(750).toFixed(2)).toBe("25.36");
    expect(plan.exceptions.some((e) => e.sourceId === "gin" && /split across 2 places/.test(e.reason))).toBe(true);
    const sugar = plan.products.find((p) => p.sourceId === "sugar")!;
    expect(sugar.dimension).toBe("mass");
    expect(sugar.costPerBase!.times(453.59237).toFixed(2)).toBe("0.80");
  });

  it("reports zero yields instead of treating them as full yield or free", () => {
    expect(plan.products.find((p) => p.sourceId === "lime")!.usableYieldPct).toBeNull();
    expect(plan.exceptions.some((e) => e.sourceId === "lime" && /yield/.test(e.reason))).toBe(true);
    expect(plan.recipes.find((r) => r.sourceId === "zero")).toBeUndefined();
    expect(plan.exceptions.some((e) => e.sourceId === "zero" && /yield/.test(e.reason))).toBe(true);
  });

  it("reports recipes with missing references rather than importing partial recipes", () => {
    expect(plan.recipes.find((r) => r.sourceId === "ghost")).toBeUndefined();
    expect(plan.exceptions.some((e) => e.sourceId === "ghost" && /not in the file/.test(e.reason))).toBe(true);
    const gimlet = plan.recipes.find((r) => r.sourceId === "gimlet")!;
    expect(gimlet.components).toEqual([
      { productSourceId: "gin", recipeSourceId: null, qty: "2", unit: "fl_oz" },
      { productSourceId: null, recipeSourceId: "syrup", qty: "0.5", unit: "fl_oz" },
    ]);
  });

  it("rejects non-object input explicitly", () => {
    expect(planLegacyImport([1, 2]).exceptions[0]?.reason).toMatch(/Not a JSON object/);
  });
});
