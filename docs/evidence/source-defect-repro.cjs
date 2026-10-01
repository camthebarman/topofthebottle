// Reproduces reported defects D1-D3 against the original 86d sources (read-only).
// Run from a directory containing a checkout of camthebarman/86d at 8c10bda as ./86d:  node source-defect-repro.cjs
const fs = require("fs"); const vm = require("vm");
const load = (f, name) => { const ctx = {}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(f, "utf8") + `;this.${name}=${name};`, ctx); return ctx[name]; };
const F = load("86d/js/food/calc.js", "FoodCalc");
const B = load("86d/js/bev/calc.js", "BevCalc");
const ing = { id: "i", baseUnit: "each", purchaseUnit: "each", purchaseQty: 1, purchaseCost: 1, onHandQty: 10, yieldPct: 100 };
const recipe = { portions: 1, components: [{ ingredientId: "i", qty: 1 }, { ingredientId: "i", qty: 1 }] };
console.log("D1 food maxPortions dup (expect 5):", F.maxPortions(recipe, () => ing).portions);
console.log("D1 bev maxServings dup (expect 5):", B.maxServings(recipe, () => ing, () => null).servings);
const r2 = { portions: 1, components: [{ ingredientId: "i", qty: 1 }, { ingredientId: "missing", qty: 1 }] };
console.log("D2 food recipeCost w/ missing (returns number, no flag):", F.recipeCost(r2, (id) => id === "i" ? ing : undefined));
console.log("D2 bev recipeCost w/ missing:", B.recipeCost(r2, (id) => id === "i" ? ing : undefined));
console.log("D2 food maxPortions w/ missing:", JSON.stringify(F.maxPortions(r2, (id) => id === "i" ? ing : undefined)));
console.log("D3 food yieldFactor(0%) (expect reject, got):", F.yieldFactor({ yieldPct: 0 }));
console.log("D3 bev prepCostPerUnit yield 0 (expect reject, got):", B.prepCostPerUnit({ yieldQty: 0, components: [{ ingredientId: "i", qty: 5 }] }, () => ing));
