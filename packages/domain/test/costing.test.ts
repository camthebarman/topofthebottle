import { describe, expect, it } from "vitest";
import {
  availableServings,
  type CostingContext,
  costPerServing,
  explodeServings,
  menuMetrics,
  prepCostPerBase,
  type ProductInfo,
  type RecipeVersion,
} from "../src/costing";
import { d } from "../src/decimal";

function product(p: Partial<ProductInfo> & { id: string }): ProductInfo {
  return { name: p.id, dimension: "volume", costPerBase: d("0.02"), costAsOf: "2026-09-01", onHandBase: d(0), ...p };
}

function ctx(products: ProductInfo[], recipes: RecipeVersion[], ingredientMap: Record<string, string> = {}): CostingContext {
  return {
    products: new Map(products.map((p) => [p.id, p])),
    recipes: new Map(recipes.map((r) => [r.recipeId, r])),
    ingredientMap: new Map(Object.entries(ingredientMap)),
  };
}

function drink(recipeId: string, components: RecipeVersion["components"], extra: Partial<RecipeVersion> = {}): RecipeVersion {
  return { id: `${recipeId}@1`, recipeId, name: recipeId, kind: "drink", components, yield: { servings: 1 }, ...extra };
}

describe("reported defect 1: duplicate ingredients", () => {
  it("ten stock units with the same ingredient listed twice at one unit each yields five servings", () => {
    const c = ctx(
      [product({ id: "cherry", dimension: "count", onHandBase: d(10), costPerBase: d("0.10") })],
      [
        drink("dup", [
          { ref: { kind: "product", id: "cherry" }, qty: 1, unit: "each" },
          { ref: { kind: "product", id: "cherry" }, qty: 1, unit: "each" },
        ]),
      ],
    );
    const a = availableServings(c, "dup");
    expect(a.complete).toBe(true);
    expect(a.servings).toBe(5);
    expect(costPerServing(c, "dup").total?.toString()).toBe("0.2");
  });

  it("aggregates an ingredient shared directly and through a nested prep", () => {
    // Sugar used directly (10 g) and inside a syrup (500 g sugar per 1000 mL; drink uses 20 mL -> 10 g).
    const c = ctx(
      [
        product({ id: "sugar", dimension: "mass", onHandBase: d(200), costPerBase: d("0.002") }),
        product({ id: "water", dimension: "volume", onHandBase: d(100000), costPerBase: d(0) }),
      ],
      [
        { id: "syrup@1", recipeId: "syrup", name: "Simple syrup", kind: "prep", yield: { qty: 1000, unit: "ml" }, components: [
          { ref: { kind: "product", id: "sugar" }, qty: 500, unit: "g" },
          { ref: { kind: "product", id: "water" }, qty: 700, unit: "ml" },
        ] },
        drink("d", [
          { ref: { kind: "product", id: "sugar" }, qty: 10, unit: "g" },
          { ref: { kind: "recipe", id: "syrup" }, qty: 20, unit: "ml" },
        ]),
      ],
    );
    const exp = explodeServings(c, "d", 1);
    expect(exp.demand.get("sugar")?.usableBase.toString()).toBe("20");
    expect(availableServings(c, "d").servings).toBe(10);
  });
});

describe("reported defect 2: unresolved ingredients", () => {
  it("returns an explicit incomplete result instead of a partial total", () => {
    const c = ctx(
      [product({ id: "gin", onHandBase: d(750) })],
      [drink("m", [
        { ref: { kind: "product", id: "gin" }, qty: 60, unit: "ml" },
        { ref: { kind: "ingredient", id: "vermouth" }, qty: 15, unit: "ml" },
      ])],
    );
    const cost = costPerServing(c, "m");
    expect(cost.complete).toBe(false);
    expect(cost.total).toBeNull();
    expect(cost.knownSubtotal.toString()).toBe("1.2");
    expect(cost.issues.map((i) => i.code)).toContain("missing_mapping");
    const a = availableServings(c, "m");
    expect(a.complete).toBe(false);
    expect(a.servings).toBeNull();
    expect(a.upperBound).toBe(12);
  });

  it("flags a missing price rather than treating it as free", () => {
    const c = ctx([product({ id: "gin", costPerBase: null })], [drink("m", [{ ref: { kind: "product", id: "gin" }, qty: 60, unit: "ml" }])]);
    const cost = costPerServing(c, "m");
    expect(cost.total).toBeNull();
    expect(cost.issues[0]?.code).toBe("missing_price");
  });

  it("flags a missing recipe reference", () => {
    const c = ctx([], [drink("m", [{ ref: { kind: "recipe", id: "ghost" }, qty: 1, unit: "ml" }])]);
    expect(costPerServing(c, "m").issues[0]?.code).toBe("missing_component");
  });
});

describe("reported defect 3: zero yield", () => {
  it("rejects zero usable yield instead of treating it as full yield", () => {
    const c = ctx(
      [product({ id: "lime", dimension: "count", usableYieldPct: d(0), onHandBase: d(50) })],
      [drink("x", [{ ref: { kind: "product", id: "lime" }, qty: 1, unit: "each" }])],
    );
    const cost = costPerServing(c, "x");
    expect(cost.complete).toBe(false);
    expect(cost.issues[0]?.code).toBe("invalid_yield");
    expect(availableServings(c, "x").servings).toBeNull();
  });

  it("rejects yield above 100% and zero-yield preps", () => {
    const c = ctx(
      [product({ id: "a", usableYieldPct: d(120) })],
      [
        drink("x", [{ ref: { kind: "product", id: "a" }, qty: 1, unit: "ml" }]),
        { id: "p@1", recipeId: "p", name: "p", kind: "prep", yield: { qty: 0, unit: "ml" }, components: [] },
        drink("y", [{ ref: { kind: "recipe", id: "p" }, qty: 10, unit: "ml" }]),
      ],
    );
    expect(costPerServing(c, "x").issues[0]?.code).toBe("invalid_yield");
    expect(costPerServing(c, "y").issues[0]?.code).toBe("invalid_yield");
    expect(prepCostPerBase(c, "p").costPerBase).toBeNull();
  });

  it("applies trim yield: 80% usable romaine costs 1.25x per usable gram", () => {
    const c = ctx(
      [product({ id: "romaine", dimension: "mass", usableYieldPct: d(80), costPerBase: d("0.004") })],
      [{ ...drink("salad", [{ ref: { kind: "product", id: "romaine" }, qty: 100, unit: "g" }]), kind: "dish" }],
    );
    expect(costPerServing(c, "salad").total?.toString()).toBe("0.5");
  });
});

describe("units and cycles", () => {
  it("never converts weight to volume without a product conversion", () => {
    const c = ctx([product({ id: "honey", dimension: "volume" })], [drink("x", [{ ref: { kind: "product", id: "honey" }, qty: 10, unit: "g" }])]);
    expect(costPerServing(c, "x").issues[0]?.code).toBe("missing_conversion");
  });

  it("uses a product-specific conversion when present", () => {
    const c = ctx(
      [product({ id: "honey", dimension: "volume", costPerBase: d("0.03"), conversions: [{ fromQty: 1, fromUnit: "l", toQty: 1420, toUnit: "g" }] })],
      [drink("x", [{ ref: { kind: "product", id: "honey" }, qty: 14.2, unit: "g" }])],
    );
    expect(costPerServing(c, "x").total?.toString()).toBe("0.3");
  });

  it("distinguishes US fluid ounces from weight ounces", () => {
    const c = ctx([product({ id: "gin", costPerBase: d(1) })], [drink("a", [{ ref: { kind: "product", id: "gin" }, qty: 1, unit: "fl_oz" }]), drink("b", [{ ref: { kind: "product", id: "gin" }, qty: 1, unit: "oz_wt" }])]);
    expect(costPerServing(c, "a").total?.toString()).toBe("29.5735295625");
    expect(costPerServing(c, "b").issues[0]?.code).toBe("missing_conversion");
  });

  it("detects a cycle between preps", () => {
    const c = ctx(
      [],
      [
        { id: "a@1", recipeId: "a", name: "A", kind: "prep", yield: { qty: 100, unit: "ml" }, components: [{ ref: { kind: "recipe", id: "b" }, qty: 10, unit: "ml" }] },
        { id: "b@1", recipeId: "b", name: "B", kind: "prep", yield: { qty: 100, unit: "ml" }, components: [{ ref: { kind: "recipe", id: "a" }, qty: 10, unit: "ml" }] },
        drink("d", [{ ref: { kind: "recipe", id: "a" }, qty: 10, unit: "ml" }]),
      ],
    );
    const r = costPerServing(c, "d");
    expect(r.complete).toBe(false);
    expect(r.issues.some((i) => i.code === "cycle")).toBe(true);
  });

  it("keeps decimal precision: 3 x 0.1 fl oz priced at 0.1/mL", () => {
    const c = ctx([product({ id: "x", costPerBase: d("0.1") })], [drink("d", [{ ref: { kind: "product", id: "x" }, qty: "0.1", unit: "ml" }, { ref: { kind: "product", id: "x" }, qty: "0.2", unit: "ml" }])]);
    expect(costPerServing(c, "d").total?.toString()).toBe("0.03");
  });
});

describe("prepared vs raw availability", () => {
  const products = [
    product({ id: "lemon", dimension: "volume", onHandBase: d(0), costPerBase: d("0.01") }),
    product({ id: "sugar", dimension: "mass", onHandBase: d(1000), costPerBase: d("0.002") }),
    product({ id: "sour_mix", dimension: "volume", onHandBase: d(300), costPerBase: d("0.015") }),
    product({ id: "whiskey", dimension: "volume", onHandBase: d(3000), costPerBase: d("0.04") }),
  ];
  const recipes: RecipeVersion[] = [
    { id: "sm@1", recipeId: "sm", name: "Sour mix", kind: "prep", producesProductId: "sour_mix", yield: { qty: 1000, unit: "ml" }, components: [
      { ref: { kind: "product", id: "lemon" }, qty: 600, unit: "ml" },
      { ref: { kind: "product", id: "sugar" }, qty: 400, unit: "g" },
    ] },
    drink("ws", [
      { ref: { kind: "product", id: "whiskey" }, qty: 60, unit: "ml" },
      { ref: { kind: "recipe", id: "sm" }, qty: 30, unit: "ml" },
    ]),
  ];
  const c = ctx(products, recipes);

  it("raw mode ignores batched stock and is limited by lemons", () => {
    const a = availableServings(c, "ws", "raw");
    expect(a.servings).toBe(0);
    expect(a.limitingProductIds).toEqual(["lemon"]);
  });

  it("prepared mode draws the batch from stock and does not also count its ingredients", () => {
    const a = availableServings(c, "ws", "prepared");
    expect(a.servings).toBe(10);
    const exp = explodeServings(c, "ws", 1, "prepared");
    expect(exp.demand.has("lemon")).toBe(false);
    expect(exp.demand.has("sugar")).toBe(false);
  });
});

describe("menu metrics", () => {
  it("computes cost %, ingredient margin and target price", () => {
    const c = ctx([product({ id: "gin", costPerBase: d("0.04") })], [drink("d", [{ ref: { kind: "product", id: "gin" }, qty: 60, unit: "ml" }])]);
    const m = menuMetrics(costPerServing(c, "d"), d(12), d(20));
    expect(m.cost?.toString()).toBe("2.4");
    expect(m.costPct?.toString()).toBe("20");
    expect(m.ingredientMargin?.toString()).toBe("9.6");
    expect(m.ingredientMarginPct?.toString()).toBe("80");
    expect(m.targetPrice?.toString()).toBe("12");
  });

  it("returns null metrics for incomplete cost or zero price", () => {
    const c = ctx([product({ id: "gin", costPerBase: null })], [drink("d", [{ ref: { kind: "product", id: "gin" }, qty: 60, unit: "ml" }])]);
    const m = menuMetrics(costPerServing(c, "d"), d(0), d(20));
    expect(m.costPct).toBeNull();
    expect(m.complete).toBe(false);
  });

  it("warns on stale prices without making the result incomplete", () => {
    const c = ctx([product({ id: "gin", costAsOf: "2026-01-01" })], [drink("d", [{ ref: { kind: "product", id: "gin" }, qty: 60, unit: "ml" }])]);
    const r = costPerServing(c, "d", { asOf: "2026-09-30", maxPriceAgeDays: 90 });
    expect(r.complete).toBe(true);
    expect(r.warnings[0]?.code).toBe("stale_price");
  });
});

describe("house-made products mapped from generic ingredients", () => {
  const products = [
    product({ id: "sugar", dimension: "mass", onHandBase: d(1000), costPerBase: d("0.002") }),
    product({ id: "water", onHandBase: d(100000), costPerBase: d(0) }),
    product({ id: "syrup_stock", name: "House simple syrup", onHandBase: d(100), costPerBase: null }),
    product({ id: "rye", onHandBase: d(600), costPerBase: d("0.05") }),
  ];
  const recipes: RecipeVersion[] = [
    { id: "ss@1", recipeId: "ss", name: "Simple syrup", kind: "prep", producesProductId: "syrup_stock", yield: { qty: 1000, unit: "ml" }, components: [
      { ref: { kind: "product", id: "sugar" }, qty: 500, unit: "g" },
      { ref: { kind: "product", id: "water" }, qty: 500, unit: "ml" },
    ] },
    drink("of", [
      { ref: { kind: "ingredient", id: "rye_whiskey" }, qty: 60, unit: "ml" },
      { ref: { kind: "ingredient", id: "simple_syrup" }, qty: 10, unit: "ml" },
    ]),
  ];
  const c: CostingContext = {
    ...ctx(products, recipes, { rye_whiskey: "rye", simple_syrup: "syrup_stock" }),
    prepForProduct: new Map([["syrup_stock", "ss"]]),
  };

  it("costs a house product through its prep recipe in raw mode", () => {
    // 60 mL rye at 0.05 = 3.00; 10 mL syrup = 5 g sugar at 0.002 = 0.01
    expect(costPerServing(c, "of").total?.toString()).toBe("3.01");
  });

  it("draws the house product from stock in prepared mode", () => {
    expect(availableServings(c, "of", "prepared").servings).toBe(10);
    expect(availableServings(c, "of", "raw").servings).toBe(10);
    expect(costPerServing(c, "of", { mode: "prepared" }).issues[0]?.code).toBe("missing_price");
  });
});
