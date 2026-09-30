"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { UNITS } from "@tz/domain";
import { z } from "zod";
import { action, must, zOptionalNumber, zRequired, zUuid } from "@/lib/action";
import { fromDbError, UserError } from "@/lib/errors";
import { getContext, requirePerm } from "@/lib/session";

export const copyTemplate = action(z.object({ templateId: z.string().regex(/^[a-z0-9-]{1,60}$/) }), async ({ templateId }) => {
  const app = await getContext();
  requirePerm(app, "recipes.edit");
  const { data, error } = await app.supabase.rpc("copy_recipe_template", { p_org: app.org.orgId, p_template: templateId, p_name: null });
  if (error) throw fromDbError(error);
  redirect(`/recipes/${data}?copied=1`);
});

const componentSchema = z.object({
  ref: z.string().regex(/^(i|p|r):[0-9a-f-]{36}$|^new$/, "Choose an ingredient for every row"),
  newName: z.string().trim().max(160).optional(),
  newDimension: z.enum(["volume", "mass", "count"]).optional(),
  qty: z.string().trim().regex(/^(\d+\.?\d*|\.\d+)$/, "Quantity must be a number"),
  unit: z.string().refine((u) => u in UNITS, "Unknown unit"),
  yieldPct: z.string().trim().optional(),
  label: z.string().trim().max(160).optional(),
});

const recipeSchema = z.object({
  recipeId: z.union([zUuid, z.literal("")]),
  expectedVersion: z.string().optional(),
  name: zRequired(160),
  kind: z.enum(["drink", "dish", "prep"]),
  category: z.string().trim().max(60).optional(),
  yieldMode: z.enum(["servings", "quantity"]),
  yieldServings: zOptionalNumber,
  yieldQty: zOptionalNumber,
  yieldUnit: z.string().optional(),
  producesProductId: z.union([zUuid, z.literal("")]).optional(),
  glassware: z.string().trim().max(120).optional(),
  method: z.string().trim().max(4000).optional(),
  garnish: z.string().trim().max(200).optional(),
  batchInstructions: z.string().trim().max(4000).optional(),
  notes: z.string().trim().max(4000).optional(),
  components: z.string().max(200_000),
});

export const saveRecipe = action(recipeSchema, async (input) => {
  const app = await getContext();
  requirePerm(app, "recipes.edit");
  let comps: z.infer<typeof componentSchema>[];
  try {
    comps = z.array(componentSchema).max(60).parse(JSON.parse(input.components));
  } catch (e) {
    throw new UserError(e instanceof z.ZodError ? (e.issues[0]?.message ?? "Check the ingredients") : "Check the ingredients");
  }
  if (!comps.length) throw new UserError("Add at least one ingredient.");
  if (input.yieldMode === "servings" && (!input.yieldServings || Number(input.yieldServings) <= 0)) throw new UserError("Servings per batch must be more than zero.");
  if (input.yieldMode === "quantity" && (!input.yieldQty || Number(input.yieldQty) <= 0 || !input.yieldUnit || !(input.yieldUnit in UNITS))) {
    throw new UserError("Batch yield must be a quantity above zero with a unit.");
  }

  const payload = [];
  for (const c of comps) {
    let entry: Record<string, unknown>;
    if (c.ref === "new") {
      if (!c.newName || !c.newDimension) throw new UserError("Name the new ingredient and choose how it is measured.");
      const existing = await app.supabase.from("ingredients").select("id").eq("org_id", app.org.orgId).ilike("name", c.newName.replace(/[%_\\]/g, "\\$&")).maybeSingle();
      let id = (existing.data as { id: string } | null)?.id;
      if (!id) id = (must(await app.supabase.from("ingredients").insert({ org_id: app.org.orgId, name: c.newName, dimension: c.newDimension }).select("id").single()) as { id: string }).id;
      entry = { ingredient_id: id };
    } else {
      const [kind, id] = c.ref.split(":");
      entry = kind === "i" ? { ingredient_id: id } : kind === "p" ? { product_id: id } : { sub_recipe_id: id };
    }
    const y = c.yieldPct?.trim();
    if (y && (!/^\d+(\.\d+)?$/.test(y) || Number(y) <= 0 || Number(y) > 100)) throw new UserError("Usable yield must be above 0% and at most 100%.");
    payload.push({ ...entry, qty: c.qty, unit: c.unit, yield_pct: y || null, label: c.label || null });
  }

  const { data, error } = await app.supabase.rpc("save_recipe_version", {
    p_org: app.org.orgId,
    p_recipe: input.recipeId || null,
    p_name: input.name,
    p_kind: input.kind,
    p_category: input.category || null,
    p_yield_servings: input.yieldMode === "servings" ? input.yieldServings : null,
    p_yield_qty: input.yieldMode === "quantity" ? input.yieldQty : null,
    p_yield_unit: input.yieldMode === "quantity" ? input.yieldUnit : null,
    p_produces_product: input.kind === "prep" && input.producesProductId ? input.producesProductId : null,
    p_details: {
      glassware: input.glassware || null,
      method: input.method || null,
      garnish: input.garnish || null,
      batch_instructions: input.batchInstructions || null,
      notes: input.notes || null,
    },
    p_components: payload,
    p_expected_current_version: input.expectedVersion || null,
    p_template_id: null,
  });
  if (error) throw fromDbError(error);
  revalidatePath("/recipes");
  redirect(`/recipes/${data}?saved=1`);
});

export const setMenu = action(
  z.object({
    recipeId: zUuid,
    onMenu: z.enum(["true", "false"]),
    price: zOptionalNumber,
    targetPct: zOptionalNumber,
    section: z.string().trim().max(60).optional(),
  }),
  async (input) => {
    const app = await getContext();
    requirePerm(app, "menu.edit");
    const onMenu = input.onMenu === "true";
    if (onMenu && (input.price === null || Number(input.price) < 0)) throw new UserError("Enter a selling price.");
    if (input.targetPct !== null && (Number(input.targetPct) <= 0 || Number(input.targetPct) >= 100)) throw new UserError("Target cost % must be between 0 and 100.");
    const { error } = await app.supabase.rpc("set_menu_item", {
      p_org: app.org.orgId,
      p_location: app.location.id,
      p_recipe: input.recipeId,
      p_price: input.price,
      p_target: input.targetPct,
      p_section: input.section || null,
      p_on_menu: onMenu,
    });
    if (error) throw fromDbError(error);
    revalidatePath("/recipes");
    revalidatePath(`/recipes/${input.recipeId}`);
    return { status: "success", message: onMenu ? "Menu updated" : "Removed from the current menu" };
  },
);

export const mapIngredient = action(z.object({ ingredientId: zUuid, productId: zUuid, recipeId: zUuid.optional() }), async (input) => {
  const app = await getContext();
  requirePerm(app, "recipes.edit");
  const { error } = await app.supabase.rpc("map_ingredient", { p_org: app.org.orgId, p_location: app.location.id, p_ingredient: input.ingredientId, p_product: input.productId });
  if (error) throw fromDbError(error);
  if (input.recipeId) revalidatePath(`/recipes/${input.recipeId}`);
  revalidatePath("/recipes");
  return { status: "success", message: "Mapped" };
});

export const setArchived = action(z.object({ recipeId: zUuid, archived: z.enum(["true", "false"]) }), async ({ recipeId, archived }) => {
  const app = await getContext();
  requirePerm(app, "recipes.edit");
  const res = await app.supabase
    .from("recipes")
    .update({ archived_at: archived === "true" ? new Date().toISOString() : null })
    .eq("id", recipeId)
    .eq("org_id", app.org.orgId)
    .select("id");
  if (res.error) throw fromDbError(res.error);
  if (!res.data?.length) throw new UserError("Recipe not found.", "not_found");
  if (archived === "true") {
    // Retiring a recipe takes it off the current menu; history is kept.
    await app.supabase.rpc("set_menu_item", { p_org: app.org.orgId, p_location: app.location.id, p_recipe: recipeId, p_price: null, p_target: null, p_section: null, p_on_menu: false });
  }
  revalidatePath("/recipes");
  return { status: "success", message: archived === "true" ? "Archived" : "Restored" };
});
