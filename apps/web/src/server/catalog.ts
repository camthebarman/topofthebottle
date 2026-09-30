import "server-only";
import {
  type CostingContext,
  d,
  type Decimal,
  type Dimension,
  type ProductConversion,
  type ProductInfo,
  type RecipeComponent,
  type RecipeVersion,
  tryDecimal,
} from "@tz/domain";
import { must } from "@/lib/action";
import { fetchAll } from "@/lib/fetch-all";
import type { AppContext } from "@/lib/session";

export interface ProductRow {
  id: string;
  name: string;
  category: string;
  dimension: Dimension;
  container_size_base: string | null;
  container_label: string | null;
  full_weight_g: string | null;
  empty_weight_g: string | null;
  usable_yield_pct: string | null;
  default_count_method: string;
  is_prep_output: boolean;
  archived_at: string | null;
  version: number;
}

export interface RecipeRow {
  id: string;
  name: string;
  kind: "drink" | "dish" | "prep";
  category: string | null;
  current_version_id: string | null;
  archived_at: string | null;
  template_id: string | null;
}

export interface VersionRow {
  id: string;
  recipe_id: string;
  version: number;
  yield_servings: string | null;
  yield_qty: string | null;
  yield_unit: string | null;
  produces_product_id: string | null;
  glassware: string | null;
  method: string | null;
  garnish: string | null;
  batch_instructions: string | null;
  notes: string | null;
  effective_from: string;
  created_at: string;
}

export interface ComponentRow {
  recipe_version_id: string;
  position: number;
  product_id: string | null;
  ingredient_id: string | null;
  sub_recipe_id: string | null;
  qty: string;
  unit: string;
  yield_pct: string | null;
  label: string | null;
}

export interface Catalog {
  products: ProductRow[];
  productById: Map<string, ProductRow>;
  ingredients: { id: string; name: string; dimension: Dimension }[];
  recipes: RecipeRow[];
  recipeById: Map<string, RecipeRow>;
  versions: Map<string, VersionRow>;
  components: Map<string, ComponentRow[]>;
  ingredientMap: Map<string, string>;
  costs: Map<string, { costPerBase: Decimal; effectiveAt: string; source: string }>;
  onHand: Map<string, Decimal>;
  ctx: CostingContext;
  canSeeCosts: boolean;
  asOf: string;
}

const PRODUCT_COLS = "id, name, category, dimension, container_size_base, container_label, full_weight_g, empty_weight_g, usable_yield_pct, default_count_method, is_prep_output, archived_at, version";

export function toRecipeVersion(recipe: RecipeRow, v: VersionRow, comps: ComponentRow[]): RecipeVersion {
  const components: RecipeComponent[] = comps
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      ref: c.sub_recipe_id ? { kind: "recipe", id: c.sub_recipe_id } : c.ingredient_id ? { kind: "ingredient", id: c.ingredient_id } : { kind: "product", id: c.product_id! },
      qty: c.qty,
      unit: c.unit,
      yieldPct: c.yield_pct,
      ...(c.label ? { label: c.label } : {}),
    }));
  return {
    id: v.id,
    recipeId: recipe.id,
    name: recipe.name,
    kind: recipe.kind,
    components,
    yield: v.yield_servings ? { servings: v.yield_servings } : { qty: v.yield_qty ?? "0", unit: v.yield_unit ?? "ml" },
    producesProductId: v.produces_product_id,
  };
}

/**
 * Everything costing needs for one location, as of an instant (default now).
 * Costs are only loaded when the member may see them; RLS enforces this too.
 */
export async function loadCatalog(app: AppContext, opts: { asOf?: string; includeArchived?: boolean } = {}): Promise<Catalog> {
  const { supabase, org, location } = app;
  const asOf = opts.asOf ?? new Date().toISOString();
  const canSeeCosts = app.can("costs.view");
  const historical = !!opts.asOf;

  const [productsRes, ingredientsRes, recipesRes, convRes, mapRes, balRes, costRes, versionsRes] = await Promise.all([
    fetchAll((a, b) => supabase.from("products").select(PRODUCT_COLS).eq("org_id", org.orgId).order("name").order("id").range(a, b)),
    fetchAll((a, b) => supabase.from("ingredients").select("id, name, dimension").eq("org_id", org.orgId).order("name").order("id").range(a, b)),
    fetchAll((a, b) => supabase.from("recipes").select("id, name, kind, category, current_version_id, archived_at, template_id").eq("org_id", org.orgId).order("name").order("id").range(a, b)),
    fetchAll((a, b) => supabase.from("product_conversions").select("product_id, from_qty, from_unit, to_qty, to_unit").eq("org_id", org.orgId).order("id").range(a, b)),
    fetchAll((a, b) =>
      supabase
        .from("ingredient_mappings")
        .select("ingredient_id, product_id, effective_from, effective_to")
        .eq("org_id", org.orgId)
        .eq("location_id", location.id)
        .lte("effective_from", asOf)
        .or(`effective_to.is.null,effective_to.gt.${asOf}`)
        .order("id")
        .range(a, b),
    ),
    fetchAll((a, b) => supabase.rpc("book_balances", { p_org: org.orgId, p_location: location.id, p_as_of: asOf }).order("product_id").range(a, b)),
    canSeeCosts ? fetchAll((a, b) => supabase.rpc("product_costs_as_of", { p_org: org.orgId, p_location: location.id, p_as_of: asOf }).order("product_id").range(a, b)) : Promise.resolve([]),
    historical ? fetchAll((a, b) => supabase.rpc("recipe_versions_as_of", { p_org: org.orgId, p_as_of: asOf }).order("id").range(a, b)) : Promise.resolve(null),
  ]);

  const products = productsRes as ProductRow[];
  const ingredients = ingredientsRes as Catalog["ingredients"];
  const recipes = (recipesRes as RecipeRow[]).filter((r) => opts.includeArchived || !r.archived_at);
  const conversions = new Map<string, ProductConversion[]>();
  for (const c of convRes as { product_id: string; from_qty: string; from_unit: string; to_qty: string; to_unit: string }[]) {
    const list = conversions.get(c.product_id) ?? [];
    list.push({ fromQty: c.from_qty, fromUnit: c.from_unit, toQty: c.to_qty, toUnit: c.to_unit });
    conversions.set(c.product_id, list);
  }
  const ingredientMap = new Map<string, string>((mapRes as { ingredient_id: string; product_id: string }[]).map((m) => [m.ingredient_id, m.product_id]));
  const onHand = new Map<string, Decimal>((balRes as { product_id: string; qty_base: string }[]).map((b) => [b.product_id, d(b.qty_base)]));
  const costs = new Map<string, { costPerBase: Decimal; effectiveAt: string; source: string }>();
  for (const c of costRes as { product_id: string; cost_per_base: string; effective_at: string; source: string }[]) {
    costs.set(c.product_id, { costPerBase: d(c.cost_per_base), effectiveAt: c.effective_at, source: c.source });
  }

  // Versions: current pointers for "now", or the as-of set for history.
  let versionRows: VersionRow[];
  if (historical) versionRows = versionsRes as VersionRow[];
  else {
    const ids = recipes.map((r) => r.current_version_id).filter((x): x is string => !!x);
    versionRows = [];
    for (let i = 0; i < ids.length; i += 200) versionRows.push(...(must(await supabase.from("recipe_versions").select("*").in("id", ids.slice(i, i + 200))) as VersionRow[]));
  }
  const versions = new Map<string, VersionRow>(versionRows.map((v) => [v.recipe_id, v]));
  const versionIds = versionRows.map((v) => v.id);
  const components = new Map<string, ComponentRow[]>();
  for (let i = 0; i < versionIds.length; i += 150) {
    const chunk = versionIds.slice(i, i + 150);
    const rows = (await fetchAll((a, b) => supabase.from("recipe_components").select("id, recipe_version_id, position, product_id, ingredient_id, sub_recipe_id, qty, unit, yield_pct, label").in("recipe_version_id", chunk).order("id").range(a, b))) as ComponentRow[];
    for (const r of rows) {
      const list = components.get(r.recipe_version_id) ?? [];
      list.push(r);
      components.set(r.recipe_version_id, list);
    }
  }

  const productInfo = new Map<string, ProductInfo>();
  for (const p of products) {
    const cost = costs.get(p.id);
    productInfo.set(p.id, {
      id: p.id,
      name: p.name,
      dimension: p.dimension,
      costPerBase: canSeeCosts ? (cost?.costPerBase ?? null) : null,
      costAsOf: cost?.effectiveAt.slice(0, 10) ?? null,
      usableYieldPct: tryDecimal(p.usable_yield_pct),
      conversions: conversions.get(p.id) ?? [],
      onHandBase: onHand.get(p.id) ?? d(0),
    });
  }
  const recipeVersions = new Map<string, RecipeVersion>();
  const prepForProduct = new Map<string, string>();
  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  for (const [recipeId, v] of versions) {
    const r = recipeById.get(recipeId);
    if (!r) continue;
    recipeVersions.set(recipeId, toRecipeVersion(r, v, components.get(v.id) ?? []));
    if (v.produces_product_id) prepForProduct.set(v.produces_product_id, recipeId);
  }

  return {
    products,
    productById: new Map(products.map((p) => [p.id, p])),
    ingredients,
    recipes,
    recipeById,
    versions,
    components,
    ingredientMap,
    costs,
    onHand,
    canSeeCosts,
    asOf,
    ctx: {
      products: productInfo,
      recipes: recipeVersions,
      ingredientMap,
      ingredientNames: new Map(ingredients.map((i) => [i.id, i.name])),
      prepForProduct,
    },
  };
}
