"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { d, explodeRecipe, toBase, UNITS } from "@tz/domain";
import { z } from "zod";
import { action, must, zOptionalNumber, zRequired, zUuid } from "@/lib/action";
import { fromDbError, UserError } from "@/lib/errors";
import { getContext, requirePerm } from "@/lib/session";
import { loadCatalog } from "@/server/catalog";

const CATEGORIES = ["spirit", "liqueur", "wine", "beer", "mixer", "juice", "syrup", "garnish", "prep", "food", "consumable", "other"] as const;

const productSchema = z.object({
  productId: z.union([zUuid, z.literal("")]),
  version: z.string().optional(),
  name: zRequired(160),
  category: z.enum(CATEGORIES),
  dimension: z.enum(["volume", "mass", "count"]),
  containerQty: zOptionalNumber,
  containerUnit: z.string().optional(),
  containerLabel: z.string().trim().max(40).optional(),
  fullWeightG: zOptionalNumber,
  emptyWeightG: zOptionalNumber,
  usableYieldPct: zOptionalNumber,
  countMethod: z.enum(["full_units", "tenths", "weight", "measured"]),
  parQty: zOptionalNumber,
});

export const saveProduct = action(productSchema, async (input) => {
  const app = await getContext();
  requirePerm(app, "catalog.edit");
  let containerBase: string | null = null;
  if (input.containerQty !== null) {
    const unit = UNITS[input.containerUnit ?? ""];
    if (!unit || unit.dimension !== input.dimension) throw new UserError("Container size must use a unit that matches how the product is measured.");
    containerBase = d(input.containerQty).times(unit.toBase).toFixed();
    if (d(containerBase).lte(0)) throw new UserError("Container size must be above zero.");
  }
  if (input.usableYieldPct !== null && (Number(input.usableYieldPct) <= 0 || Number(input.usableYieldPct) > 100)) {
    throw new UserError("Usable yield must be above 0% and at most 100%. Leave it blank for 100%.");
  }
  if (input.countMethod === "weight" && (input.fullWeightG === null || input.emptyWeightG === null)) {
    throw new UserError("Scale counting needs the full and empty container weights.");
  }
  const row = {
    org_id: app.org.orgId,
    name: input.name,
    category: input.category,
    dimension: input.dimension,
    container_size_base: containerBase,
    container_label: input.containerLabel || null,
    full_weight_g: input.fullWeightG,
    empty_weight_g: input.emptyWeightG,
    usable_yield_pct: input.usableYieldPct,
    default_count_method: input.countMethod,
  };
  let productId = input.productId;
  if (productId) {
    const res = await app.supabase.from("products").update({ ...row, version: Number(input.version) }).eq("id", productId).eq("org_id", app.org.orgId).select("id");
    if (res.error) throw fromDbError(res.error);
    if (!res.data?.length) throw new UserError("Product not found.", "not_found");
  } else {
    productId = (must(await app.supabase.from("products").insert(row).select("id").single()) as { id: string }).id;
  }
  if (input.parQty !== null) {
    const par = d(input.parQty).times(containerBase ? d(containerBase) : 1);
    const res = await app.supabase.from("location_products").upsert({ org_id: app.org.orgId, location_id: app.location.id, product_id: productId, par_base: par.toFixed() });
    if (res.error) throw fromDbError(res.error);
  }
  revalidatePath("/inventory");
  redirect(`/inventory/products/${productId}?saved=1`);
});

export const addCost = action(
  z.object({ productId: zUuid, amount: z.string().trim().regex(/^\d+(\.\d+)?$/, "Enter a price"), perQty: z.string().trim().regex(/^\d+(\.\d+)?$/, "Enter a quantity"), perUnit: z.string(), locationOnly: z.string().optional() }),
  async (input) => {
    const app = await getContext();
    requirePerm(app, "catalog.edit");
    requirePerm(app, "costs.view");
    const product = must(await app.supabase.from("products").select("dimension, name").eq("id", input.productId).single()) as { dimension: "volume" | "mass" | "count"; name: string };
    const conv = toBase(input.perQty, input.perUnit, product.dimension);
    if (!conv.ok) throw new UserError(conv.issue.message);
    if (conv.value.lte(0)) throw new UserError("Quantity must be above zero.");
    const costPerBase = d(input.amount).div(conv.value);
    const res = await app.supabase.from("product_costs").insert({
      org_id: app.org.orgId,
      product_id: input.productId,
      location_id: input.locationOnly ? app.location.id : null,
      cost_per_base: costPerBase.toDecimalPlaces(8).toFixed(),
      source: "manual",
      created_by: app.user.id,
    });
    if (res.error) throw fromDbError(res.error);
    revalidatePath(`/inventory/products/${input.productId}`);
    return { status: "success", message: "Cost recorded. Earlier costs are kept for history." };
  },
);

export const addConversion = action(
  z.object({ productId: zUuid, fromQty: z.string().regex(/^\d+(\.\d+)?$/), fromUnit: z.string(), toQty: z.string().regex(/^\d+(\.\d+)?$/), toUnit: z.string(), note: z.string().trim().max(200).optional() }),
  async (input) => {
    const app = await getContext();
    requirePerm(app, "catalog.edit");
    const a = UNITS[input.fromUnit];
    const b = UNITS[input.toUnit];
    if (!a || !b) throw new UserError("Unknown unit.");
    if (a.dimension === b.dimension) throw new UserError("A conversion bridges two different kinds of measure (e.g. each to mL, or g to mL).");
    const res = await app.supabase.from("product_conversions").insert({ org_id: app.org.orgId, product_id: input.productId, from_qty: input.fromQty, from_unit: input.fromUnit, to_qty: input.toQty, to_unit: input.toUnit, note: input.note || null });
    if (res.error) throw fromDbError(res.error);
    revalidatePath(`/inventory/products/${input.productId}`);
    return { status: "success", message: "Conversion added" };
  },
);

export const saveSupplier = action(z.object({ name: zRequired(160), contact: z.string().trim().max(300).optional() }), async (input) => {
  const app = await getContext();
  requirePerm(app, "catalog.edit");
  const res = await app.supabase.from("suppliers").insert({ org_id: app.org.orgId, name: input.name, contact: input.contact || null });
  if (res.error) throw fromDbError(res.error);
  revalidatePath("/inventory/suppliers");
  return { status: "success", message: "Supplier added" };
});

export const addSupplierItem = action(
  z.object({ productId: zUuid, supplierId: zUuid, sku: z.string().trim().max(80).optional(), unitsPerPack: z.string().regex(/^\d+(\.\d+)?$/, "Enter a number"), unitQty: z.string().regex(/^\d+(\.\d+)?$/, "Enter a number"), unitUnit: z.string(), packLabel: z.string().trim().max(60).optional() }),
  async (input) => {
    const app = await getContext();
    requirePerm(app, "catalog.edit");
    const product = must(await app.supabase.from("products").select("dimension").eq("id", input.productId).single()) as { dimension: "volume" | "mass" | "count" };
    const conv = toBase(input.unitQty, input.unitUnit, product.dimension);
    if (!conv.ok) throw new UserError(conv.issue.message);
    const res = await app.supabase.from("supplier_items").insert({
      org_id: app.org.orgId,
      supplier_id: input.supplierId,
      product_id: input.productId,
      supplier_sku: input.sku || null,
      units_per_pack: input.unitsPerPack,
      unit_size_base: conv.value.toFixed(),
      pack_label: input.packLabel || null,
    });
    if (res.error) throw fromDbError(res.error);
    revalidatePath(`/inventory/products/${input.productId}`);
    return { status: "success", message: "Pack size added" };
  },
);

// ---------- counts ----------

export const startCount = action(z.object({ name: z.string().trim().max(80).optional() }), async ({ name }) => {
  const app = await getContext();
  requirePerm(app, "inventory.count");
  const row = must(await app.supabase.from("count_sessions").insert({ org_id: app.org.orgId, location_id: app.location.id, name: name || null, started_by: app.user.id, counted_at: new Date().toISOString() }).select("id").single()) as { id: string };
  redirect(`/inventory/counts/${row.id}`);
});

export const saveCountLine = action(
  z.object({
    sessionId: zUuid,
    productId: zUuid,
    areaId: z.union([zUuid, z.literal("")]).optional(),
    method: z.enum(["full_units", "tenths", "weight", "measured"]),
    fullUnits: zOptionalNumber,
    tenths: zOptionalNumber,
    grossWeightG: zOptionalNumber,
    measuredQty: zOptionalNumber,
    measuredUnit: z.string().optional(),
  }),
  async (input) => {
    const app = await getContext();
    requirePerm(app, "inventory.count");
    let measuredBase: string | null = null;
    if (input.method === "measured") {
      const product = must(await app.supabase.from("products").select("dimension").eq("id", input.productId).single()) as { dimension: "volume" | "mass" | "count" };
      const conv = toBase(input.measuredQty ?? "0", input.measuredUnit ?? "ml", product.dimension);
      if (!conv.ok) throw new UserError(conv.issue.message);
      measuredBase = conv.value.toFixed();
    }
    const { error } = await app.supabase.rpc("upsert_count_line", {
      p_org: app.org.orgId,
      p_session: input.sessionId,
      p_product: input.productId,
      p_area: input.areaId || null,
      p_method: input.method,
      p_full_units: input.fullUnits ?? "0",
      p_tenths: input.method === "tenths" ? (input.tenths ?? "0") : null,
      p_gross_weight_g: input.method === "weight" ? input.grossWeightG : null,
      p_measured_base: measuredBase,
    });
    if (error) throw fromDbError(error);
    revalidatePath(`/inventory/counts/${input.sessionId}`);
    return { status: "success", message: "Counted" };
  },
);

export const deleteCountLine = action(z.object({ lineId: zUuid, sessionId: zUuid }), async ({ lineId, sessionId }) => {
  const app = await getContext();
  requirePerm(app, "inventory.count");
  const { error } = await app.supabase.rpc("delete_count_line", { p_org: app.org.orgId, p_line: lineId });
  if (error) throw fromDbError(error);
  revalidatePath(`/inventory/counts/${sessionId}`);
  return { status: "success", message: "Removed" };
});

export const finalizeCount = action(z.object({ sessionId: zUuid, version: z.string().regex(/^\d+$/) }), async ({ sessionId, version }) => {
  const app = await getContext();
  requirePerm(app, "inventory.finalize");
  const { error } = await app.supabase.rpc("finalize_count", { p_org: app.org.orgId, p_session: sessionId, p_expected_version: Number(version) });
  if (error) throw fromDbError(error);
  revalidatePath("/inventory");
  redirect(`/inventory/counts/${sessionId}?finalized=1`);
});

export const voidCount = action(z.object({ sessionId: zUuid, version: z.string().regex(/^\d+$/) }), async ({ sessionId, version }) => {
  const app = await getContext();
  requirePerm(app, "inventory.count");
  const res = await app.supabase.from("count_sessions").update({ status: "void", version: Number(version) }).eq("id", sessionId).eq("status", "draft").select("id");
  if (res.error) throw fromDbError(res.error);
  if (!res.data?.length) throw new UserError("Only draft counts can be discarded.");
  redirect("/inventory/counts");
});

// ---------- movements ----------

const MOVEMENT_KINDS = ["waste", "breakage", "manual_adjustment", "opening_balance", "supplier_return"] as const;

export const recordMovement = action(
  z.object({
    productId: zUuid,
    type: z.enum(MOVEMENT_KINDS),
    qty: z.string().trim().regex(/^-?\d+(\.\d+)?$/, "Enter a quantity"),
    unit: z.string(),
    direction: z.enum(["in", "out"]).optional(),
    reason: z.string().trim().max(500).optional(),
    occurredAt: z.string().optional(),
    idempotencyKey: z.uuid(),
  }),
  async (input) => {
    const app = await getContext();
    requirePerm(app, "inventory.move");
    const product = must(await app.supabase.from("products").select("dimension, container_size_base").eq("id", input.productId).single()) as { dimension: "volume" | "mass" | "count"; container_size_base: string | null };
    let base;
    if (input.unit === "container") {
      if (!product.container_size_base) throw new UserError("This product has no container size.");
      base = d(input.qty).times(product.container_size_base);
    } else {
      const conv = toBase(input.qty, input.unit, product.dimension);
      if (!conv.ok) throw new UserError(conv.issue.message);
      base = conv.value;
    }
    if (base.isZero()) throw new UserError("Quantity must not be zero.");
    const abs = base.abs();
    const signed = input.type === "manual_adjustment" ? (input.direction === "in" ? abs : abs.negated()) : input.type === "opening_balance" ? abs : abs.negated();
    if (input.type === "manual_adjustment" && !input.reason) throw new UserError("Give a reason for the adjustment.");
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) throw new UserError("Invalid date.");
    const { error } = await app.supabase.rpc("record_movement", {
      p_org: app.org.orgId,
      p_location: app.location.id,
      p_product: input.productId,
      p_type: input.type,
      p_qty_base: signed.toFixed(),
      p_occurred_at: occurredAt.toISOString(),
      p_reason: input.reason || null,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw fromDbError(error);
    revalidatePath("/inventory");
    return { status: "success", message: "Recorded" };
  },
);

export const reverseMovement = action(z.object({ movementId: zUuid, reason: zRequired(500), productId: zUuid.optional() }), async ({ movementId, reason, productId }) => {
  const app = await getContext();
  requirePerm(app, "inventory.move");
  const { error } = await app.supabase.rpc("reverse_movement", { p_org: app.org.orgId, p_movement: movementId, p_reason: reason });
  if (error) throw fromDbError(error);
  revalidatePath("/inventory/history");
  if (productId) revalidatePath(`/inventory/products/${productId}`);
  return { status: "success", message: "Reversed. The original entry is kept." };
});

export const postTransfer = action(
  z.object({ toLocationId: zUuid, productId: zUuid, qty: z.string().regex(/^\d+(\.\d+)?$/, "Enter a quantity"), unit: z.string(), note: z.string().trim().max(300).optional() }),
  async (input) => {
    const app = await getContext();
    requirePerm(app, "inventory.move");
    if (input.toLocationId === app.location.id) throw new UserError("Choose a different location.");
    const product = must(await app.supabase.from("products").select("dimension, container_size_base").eq("id", input.productId).single()) as { dimension: "volume" | "mass" | "count"; container_size_base: string | null };
    const base = input.unit === "container" ? (product.container_size_base ? d(input.qty).times(product.container_size_base) : null) : (() => { const c = toBase(input.qty, input.unit, product.dimension); return c.ok ? c.value : null; })();
    if (!base || base.lte(0)) throw new UserError("Invalid quantity or unit for this product.");
    const { error } = await app.supabase.rpc("post_transfer", { p_org: app.org.orgId, p_from: app.location.id, p_to: input.toLocationId, p_lines: [{ product_id: input.productId, qty_base: base.toFixed() }], p_note: input.note || null, p_occurred_at: new Date().toISOString() });
    if (error) throw fromDbError(error);
    revalidatePath("/inventory");
    return { status: "success", message: "Transfer recorded at both locations" };
  },
);

export const recordProduction = action(z.object({ recipeId: zUuid, batches: z.string().regex(/^\d+(\.\d+)?$/, "Enter a number of batches"), note: z.string().trim().max(300).optional() }), async (input) => {
  const app = await getContext();
  requirePerm(app, "inventory.move");
  const cat = await loadCatalog(app);
  const recipe = cat.ctx.recipes.get(input.recipeId);
  const version = cat.versions.get(input.recipeId);
  if (!recipe || !version?.produces_product_id) throw new UserError("This recipe is not set up to produce a stocked batch.");
  const output = cat.productById.get(version.produces_product_id);
  if (!output) throw new UserError("The output product was not found.");
  const batches = d(input.batches);
  if (batches.lte(0)) throw new UserError("Batches must be above zero.");
  // Consumption of this batch's own components; nested preps held in stock are drawn from stock.
  const direct = { ...cat.ctx, prepForProduct: new Map([...(cat.ctx.prepForProduct ?? [])].filter(([pid]) => pid !== output.id)) };
  const exp = explodeRecipe(direct, input.recipeId, batches, "prepared");
  if (!exp.complete) throw new UserError(`Recipe is incomplete: ${exp.issues[0]?.message ?? "check the recipe"}`);
  let outBase;
  if ("servings" in recipe.yield) throw new UserError("Batches must have a measured yield.");
  else {
    const conv = toBase(recipe.yield.qty, recipe.yield.unit, output.dimension);
    if (!conv.ok) throw new UserError(conv.issue.message);
    outBase = conv.value.times(batches);
  }
  const consumed = [...exp.demand.values()].filter((x) => x.productId !== output.id).map((x) => ({ product_id: x.productId, qty_base: (x.asPurchasedBase ?? x.usableBase).toFixed(6) }));
  const { error } = await app.supabase.rpc("record_production", {
    p_org: app.org.orgId,
    p_location: app.location.id,
    p_recipe_version: version.id,
    p_output_qty_base: outBase.toFixed(6),
    p_consumed: consumed,
    p_note: input.note || null,
    p_produced_at: new Date().toISOString(),
  });
  if (error) throw fromDbError(error);
  revalidatePath("/inventory");
  return { status: "success", message: `Recorded ${input.batches} batch(es) of ${recipe.name}` };
});
