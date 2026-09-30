import "server-only";
import { UNITS } from "@tz/domain";
import type { Catalog } from "@/server/catalog";
import type { Option, UnitOption } from "./editor";

export function editorOptions(cat: Catalog, excludeRecipeId?: string) {
  const ingredients: Option[] = cat.ingredients.map((i) => ({ value: `i:${i.id}`, label: i.name, dimension: i.dimension }));
  const products: Option[] = cat.products.filter((p) => !p.archived_at).map((p) => ({ value: `p:${p.id}`, label: p.name, dimension: p.dimension }));
  const preps: Option[] = cat.recipes
    .filter((r) => r.id !== excludeRecipeId && !r.archived_at && (r.kind === "prep" || r.kind === "dish"))
    .map((r) => {
      const v = cat.versions.get(r.id);
      const dim = v?.yield_unit ? (UNITS[v.yield_unit]?.dimension ?? "volume") : "servings";
      return { value: `r:${r.id}`, label: r.name, dimension: dim } as Option;
    });
  const units: UnitOption[] = Object.values(UNITS).map((u) => ({ id: u.id, label: u.label, dimension: u.dimension }));
  const prepProducts = cat.products.filter((p) => !p.archived_at).map((p) => ({ id: p.id, name: p.name }));
  return { ingredients, products, preps, units, prepProducts };
}
