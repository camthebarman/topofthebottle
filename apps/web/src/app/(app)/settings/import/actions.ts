"use server";

import { randomUUID } from "node:crypto";
import { type LegacyException, type LegacyPlan, planLegacyImport } from "@tz/domain";
import { z } from "zod";
import { action } from "@/lib/action";
import { UserError } from "@/lib/errors";
import { getContext, requirePerm } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

const input = z.object({ json: z.string().min(2, "Choose a file").max(900_000, "File is too large for one import; split it by location") });

function parse(json: string): LegacyPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new UserError("That file is not valid JSON.");
  }
  // The old tools stored one key per module; accept either a bare state or a wrapper.
  const state = raw && typeof raw === "object" && "state" in (raw as object) ? (raw as { state: unknown }).state : raw;
  return planLegacyImport(state, "browser export");
}

export interface PreviewData {
  counts: LegacyPlan["counts"];
  products: number;
  recipes: number;
  exceptions: LegacyException[];
}

export const previewLegacy = action(input, async ({ json }) => {
  const app = await getContext();
  requirePerm(app, "settings.manage");
  const plan = parse(json);
  return { status: "success" as const, message: "Preview ready. Nothing has been saved.", data: { counts: plan.counts, products: plan.products.length, recipes: plan.recipes.length, exceptions: plan.exceptions } satisfies PreviewData };
});

export const applyLegacy = action(input, async ({ json }) => {
  const app = await getContext();
  for (const p of ["settings.manage", "catalog.edit", "recipes.edit", "inventory.move"]) requirePerm(app, p);
  const plan = parse(json); // re-planned here; the browser preview is not trusted
  const exceptions = [...plan.exceptions];
  const sb = app.supabase;
  const { data: existing } = await sb.from("products").select("name").eq("org_id", app.org.orgId);
  const taken = new Set((existing ?? []).map((p: { name: string }) => p.name.toLowerCase()));
  const productIds = new Map<string, string>();
  const when = new Date().toISOString();
  for (const p of plan.products) {
    if (taken.has(p.name.toLowerCase())) {
      exceptions.push({ kind: "ingredient", sourceId: p.sourceId, name: p.name, reason: "A product with this name already exists; not duplicated" });
      continue;
    }
    const category = ["spirit", "liqueur", "wine", "beer", "mixer", "juice", "syrup", "garnish", "prep", "food", "consumable"].includes(p.category) ? p.category : "other";
    const { data, error } = await sb.from("products").insert({ org_id: app.org.orgId, name: p.name, category, dimension: p.dimension, usable_yield_pct: p.usableYieldPct?.toFixed() ?? null, default_count_method: "measured" }).select("id").single();
    if (error || !data) {
      exceptions.push({ kind: "ingredient", sourceId: p.sourceId, name: p.name, reason: `Could not be created: ${error?.message ?? "unknown"}` });
      continue;
    }
    productIds.set(p.sourceId, data.id);
    if (p.costPerBase) await sb.from("product_costs").insert({ org_id: app.org.orgId, product_id: data.id, cost_per_base: p.costPerBase.toDecimalPlaces(8).toFixed(), source: "manual", created_by: app.user.id });
    if (p.parBase) await sb.from("location_products").upsert({ org_id: app.org.orgId, location_id: app.location.id, product_id: data.id, par_base: p.parBase.toFixed() });
    if (p.onHandBase && p.onHandBase.gt(0)) {
      const { error: mErr } = await sb.rpc("record_movement", { p_org: app.org.orgId, p_location: app.location.id, p_product: data.id, p_type: "opening_balance", p_qty_base: p.onHandBase.toFixed(6), p_occurred_at: when, p_reason: "Imported from earlier tool", p_idempotency_key: randomUUID() });
      if (mErr) exceptions.push({ kind: "ingredient", sourceId: p.sourceId, name: p.name, reason: `Stock not recorded: ${mErr.message}` });
    }
  }
  // Preps first so drinks can reference them.
  const recipeIds = new Map<string, string>();
  const ordered = [...plan.recipes.filter((r) => r.kind === "prep"), ...plan.recipes.filter((r) => r.kind !== "prep")];
  for (const r of ordered) {
    const comps = r.components.map((c) => (c.productSourceId ? { product_id: productIds.get(c.productSourceId), qty: c.qty, unit: c.unit } : { sub_recipe_id: recipeIds.get(c.recipeSourceId!), qty: c.qty, unit: c.unit }));
    if (comps.some((c) => !("product_id" in c ? c.product_id : c.sub_recipe_id))) {
      exceptions.push({ kind: "recipe", sourceId: r.sourceId, name: r.name, reason: "An ingredient it uses was not created; recipe not imported" });
      continue;
    }
    const { data, error } = await sb.rpc("save_recipe_version", {
      p_org: app.org.orgId, p_recipe: null, p_name: r.name, p_kind: r.kind, p_category: "Imported",
      p_yield_servings: r.yieldServings, p_yield_qty: r.yieldQty, p_yield_unit: r.yieldUnit, p_produces_product: null,
      p_details: { notes: "Imported from an earlier tool. Check quantities against your current spec." }, p_components: comps, p_expected_current_version: null, p_template_id: null,
    });
    if (error || !data) {
      exceptions.push({ kind: "recipe", sourceId: r.sourceId, name: r.name, reason: `Could not be created: ${error?.message ?? "unknown"}` });
      continue;
    }
    recipeIds.set(r.sourceId, data as string);
    if (r.menuPrice && r.kind !== "prep") await sb.rpc("set_menu_item", { p_org: app.org.orgId, p_location: app.location.id, p_recipe: data, p_price: r.menuPrice.toFixed(2), p_target: null, p_section: "Imported", p_on_menu: true });
  }
  await createAdminClient().from("audit_events").insert({ org_id: app.org.orgId, actor_id: app.user.id, action: "legacy.imported", entity_type: "organization", entity_id: app.org.orgId, data: { products: productIds.size, recipes: recipeIds.size, exceptions: exceptions.length, counts: plan.counts } });
  return { status: "success" as const, message: `Imported ${productIds.size} products and ${recipeIds.size} recipes. ${exceptions.length} item(s) were not imported; they are listed below.`, data: { counts: plan.counts, products: productIds.size, recipes: recipeIds.size, exceptions } satisfies PreviewData };
});
