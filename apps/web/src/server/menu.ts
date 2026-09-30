import "server-only";
import { availableServings, costPerServing, d, type Decimal, menuMetrics, type Availability, type CostResult, type MenuMetrics } from "@tz/domain";
import { must } from "@/lib/action";
import type { AppContext } from "@/lib/session";
import type { Catalog } from "./catalog";

export interface MenuItemRow {
  id: string;
  recipe_id: string;
  selling_price: string | null;
  target_cost_pct: string | null;
  menu_section: string | null;
  effective_from: string;
}

export async function currentMenu(app: AppContext): Promise<MenuItemRow[]> {
  return must(
    await app.supabase
      .from("menu_items")
      .select("id, recipe_id, selling_price, target_cost_pct, menu_section, effective_from")
      .eq("org_id", app.org.orgId)
      .eq("location_id", app.location.id)
      .is("effective_to", null)
      .limit(1000),
  ) as MenuItemRow[];
}

export async function orgSettings(app: AppContext) {
  return must(await app.supabase.from("org_settings").select("*").eq("org_id", app.org.orgId).single()) as {
    target_cost_pct: string;
    price_stale_days: number;
    valuation_method: "moving_average" | "last_cost";
    freight_policy: "exclude" | "allocate_by_value";
    tax_policy: "exclude" | "allocate_by_value";
    variance_review_pct: string;
    min_sales_coverage_pct: string;
    void_prepared_consumes: boolean;
    comp_consumes: boolean;
    ai_insights_opt_in: boolean;
    ai_invoice_opt_in: boolean;
  };
}

export interface RecipeSummary {
  cost: CostResult;
  metrics: MenuMetrics;
  raw: Availability;
  prepared: Availability;
  menu: MenuItemRow | null;
}

export function summarizeRecipe(cat: Catalog, recipeId: string, menu: MenuItemRow | null, defaultTarget: Decimal, staleDays: number): RecipeSummary {
  const cost = costPerServing(cat.ctx, recipeId, { asOf: cat.asOf.slice(0, 10), maxPriceAgeDays: staleDays });
  const price = menu?.selling_price ? d(menu.selling_price) : null;
  const target = menu?.target_cost_pct ? d(menu.target_cost_pct) : defaultTarget;
  return {
    cost,
    metrics: menuMetrics(cost, price, target),
    raw: availableServings(cat.ctx, recipeId, "raw"),
    prepared: availableServings(cat.ctx, recipeId, "prepared"),
    menu,
  };
}
