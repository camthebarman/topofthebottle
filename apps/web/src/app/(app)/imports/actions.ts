"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { normalizeItemKey, POS_FIELDS, PRESETS, type PosField } from "@tz/domain";
import { z } from "zod";
import { action, zOptionalNumber, zUuid } from "@/lib/action";
import { fromDbError, UserError } from "@/lib/errors";
import { getContext, requirePerm } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue, kick } from "@/server/jobs";

async function loadImport(importId: string) {
  const app = await getContext();
  requirePerm(app, "imports.manage");
  // RLS: the member can read the import only if permitted at its location.
  const { data } = await app.supabase.from("pos_imports").select("id, org_id, location_id, status, profile, stats, kind").eq("id", importId).maybeSingle();
  if (!data) throw new UserError("Import not found.", "not_found");
  return { app, imp: data };
}

const mappingSchema = z.object({
  importId: zUuid,
  presetId: z.string().optional(),
  kind: z.enum(["transactions", "aggregate"]),
  dateFormat: z.enum(["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY", "ISO"]),
  decimalSeparator: z.enum([".", ","]),
  modifierSeparator: z.string().max(3).optional(),
  reportStart: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional(),
  reportEnd: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional(),
  overlapPolicy: z.enum(["reject", "replace"]),
  ...Object.fromEntries(POS_FIELDS.map((f) => [`col_${f}`, z.string().max(200).optional()])),
});

export const saveMappingAndValidate = action(mappingSchema, async (input) => {
  const { app, imp } = await loadImport(input.importId);
  if (!["uploaded", "needs_review", "failed"].includes(imp.status)) throw new UserError(`This import is ${imp.status} and cannot be re-mapped.`);
  const headers = ((imp.stats as { headers?: string[] }).headers ?? []) as string[];
  const columns: Partial<Record<PosField, string>> = {};
  const rec = input as unknown as Record<string, string | undefined>;
  for (const f of POS_FIELDS) {
    const v = rec[`col_${f}`];
    if (v) {
      if (!headers.includes(v)) throw new UserError(`Column "${v}" is not in the file.`);
      columns[f] = v;
    }
  }
  const preset = PRESETS.find((p) => p.id === input.presetId);
  // A preset keeps its label only if the mapping still matches it exactly.
  const matchesPreset = preset && JSON.stringify(preset.columns) === JSON.stringify(columns);
  if (input.kind === "aggregate" && !columns.business_date && !columns.occurred_at && (!input.reportStart || !input.reportEnd)) {
    throw new UserError("Aggregate reports without a date column need the report's start and end dates.");
  }
  if (input.reportStart && input.reportEnd && input.reportEnd < input.reportStart) throw new UserError("Report end is before its start.");
  const profile = {
    name: matchesPreset ? preset.name : "Custom mapping",
    vendor: matchesPreset ? preset.vendor : "generic",
    kind: input.kind,
    columns,
    dateFormat: input.dateFormat,
    decimalSeparator: input.decimalSeparator,
    modifierSeparator: input.modifierSeparator || ";",
    ...(matchesPreset && preset.truthyValues ? { truthyValues: preset.truthyValues } : {}),
    verified: false,
    sourceNote: matchesPreset ? preset.headerSource : "Mapped by hand",
    delimiter: (imp.profile as { delimiter?: string }).delimiter ?? ",",
  };
  const admin = createAdminClient();
  const { error } = await admin
    .from("pos_imports")
    .update({ profile, kind: input.kind, report_start: input.reportStart || null, report_end: input.reportEnd || null, overlap_policy: input.overlapPolicy, status: "validating", error: null })
    .eq("id", imp.id);
  if (error) throw fromDbError(error);
  await enqueue(imp.org_id, "pos_import_validate", { importId: imp.id }, { createdBy: app.user.id, idempotencyKey: `${imp.id}:validate:${Date.now()}`, timeoutSeconds: 600 });
  kick(["pos_import_validate"]);
  redirect(`/imports/${imp.id}`);
});

export const commitImport = action(z.object({ importId: zUuid, acceptPartial: z.string().optional() }), async ({ importId, acceptPartial }) => {
  const { app, imp } = await loadImport(importId);
  if (imp.status !== "needs_review") throw new UserError("Only a validated import can be committed.");
  const stats = imp.stats as { quarantined?: number; overlaps?: unknown[]; accepted?: number };
  if ((stats.quarantined ?? 0) > 0 && acceptPartial !== "on") throw new UserError("Some rows were rejected. Tick the box to import the rest anyway.");
  if (!stats.accepted) throw new UserError("There are no rows to import.");
  const { data: current } = await createAdminClient().from("pos_imports").select("overlap_policy").eq("id", imp.id).single();
  if (imp.kind === "aggregate" && stats.overlaps?.length && current?.overlap_policy !== "replace") {
    throw new UserError("This report overlaps an earlier report for the same dates. Choose to replace it, or cancel this import.");
  }
  const admin = createAdminClient();
  const { error } = await admin.from("pos_imports").update({ status: "committing", accept_partial: acceptPartial === "on", accepted_by: app.user.id }).eq("id", imp.id).eq("status", "needs_review");
  if (error) throw fromDbError(error);
  await enqueue(imp.org_id, "pos_import_commit", { importId: imp.id }, { createdBy: app.user.id, idempotencyKey: `${imp.id}:commit`, timeoutSeconds: 600, maxAttempts: 2 });
  kick(["pos_import_commit"]);
  redirect(`/imports/${imp.id}`);
});

export const cancelImport = action(z.object({ importId: zUuid }), async ({ importId }) => {
  const { imp } = await loadImport(importId);
  if (["committed", "committing", "superseded"].includes(imp.status)) throw new UserError("Committed imports cannot be cancelled.");
  await createAdminClient().from("pos_imports").update({ status: "cancelled" }).eq("id", imp.id);
  redirect("/imports");
});

export const mapItem = action(
  z.object({ itemKey: z.string().min(1).max(300), itemName: z.string().max(300), target: z.string(), servingsPerUnit: zOptionalNumber, back: z.string().optional() }),
  async (i) => {
    const app = await getContext();
    requirePerm(app, "imports.manage");
    const notStock = i.target === "not_stock";
    if (!notStock && !/^[0-9a-f-]{36}$/.test(i.target)) throw new UserError("Choose a recipe, or mark as not stock.");
    const today = new Date().toISOString().slice(0, 10);
    // Mappings apply from the start of history unless one existed before; remapping closes the old one.
    const { data: existing } = await app.supabase.from("pos_item_mappings").select("id, effective_from").eq("location_id", app.location.id).eq("item_key", i.itemKey).is("effective_to", null).maybeSingle();
    if (existing) {
      const close = await app.supabase.from("pos_item_mappings").update({ effective_to: today }).eq("id", existing.id);
      if (close.error) throw fromDbError(close.error);
    }
    const ins = await app.supabase.from("pos_item_mappings").insert({
      org_id: app.org.orgId,
      location_id: app.location.id,
      item_key: i.itemKey,
      item_name: i.itemName.slice(0, 300),
      recipe_id: notStock ? null : i.target,
      not_stock: notStock,
      servings_per_unit: i.servingsPerUnit ?? "1",
      effective_from: existing ? today : "2000-01-01",
      created_by: app.user.id,
    });
    if (ins.error) throw fromDbError(ins.error);
    revalidatePath("/imports/mappings");
    if (i.back && /^\/imports\/[0-9a-f-]{36}$/.test(i.back)) revalidatePath(i.back);
    return { status: "success", message: "Mapped" };
  },
);

const RECIPE_REF = z.string().regex(/^(i|p):[0-9a-f-]{36}$/);

export const mapModifier = action(
  z.object({
    modifier: z.string().min(1).max(200),
    scopeItemKey: z.string().max(300).optional(),
    kind: z.enum(["ignore", "scale", "add", "substitute"]),
    factor: zOptionalNumber,
    addRef: z.string().optional(),
    addQty: zOptionalNumber,
    addUnit: z.string().optional(),
    fromRef: z.string().optional(),
    toRef: z.string().optional(),
  }),
  async (i) => {
    const app = await getContext();
    requirePerm(app, "imports.manage");
    const ref = (s: string) => {
      const [k, id] = s.split(":");
      return { kind: k === "i" ? "ingredient" : "product", id };
    };
    let actionDef: Record<string, unknown>;
    if (i.kind === "ignore") actionDef = { kind: "ignore" };
    else if (i.kind === "scale") {
      if (!i.factor || Number(i.factor) <= 0) throw new UserError("Enter a factor above zero (2 for a double).");
      actionDef = { kind: "scale", factor: i.factor };
    } else if (i.kind === "add") {
      if (!i.addRef || !RECIPE_REF.safeParse(i.addRef).success || !i.addQty || !i.addUnit) throw new UserError("Choose what is added, how much and the unit.");
      actionDef = { kind: "add", ref: ref(i.addRef), qty: i.addQty, unit: i.addUnit };
    } else {
      if (!i.fromRef || !i.toRef || !RECIPE_REF.safeParse(i.fromRef).success || !RECIPE_REF.safeParse(i.toRef).success) throw new UserError("Choose what is replaced and its replacement.");
      actionDef = { kind: "substitute", from: ref(i.fromRef), to: ref(i.toRef) };
    }
    const key = normalizeItemKey(i.modifier);
    const scope = i.scopeItemKey || null;
    const today = new Date().toISOString().slice(0, 10);
    let q = app.supabase.from("modifier_mappings").update({ effective_to: today }).eq("location_id", app.location.id).eq("modifier_key", key).is("effective_to", null);
    q = scope ? q.eq("item_key", scope) : q.is("item_key", null);
    const close = await q.select("id");
    if (close.error) throw fromDbError(close.error);
    const ins = await app.supabase.from("modifier_mappings").insert({
      org_id: app.org.orgId,
      location_id: app.location.id,
      modifier_key: key,
      item_key: scope,
      actions: [actionDef],
      effective_from: close.data?.length ? today : "2000-01-01",
      created_by: app.user.id,
    });
    if (ins.error) throw fromDbError(ins.error);
    revalidatePath("/imports/mappings");
    return { status: "success", message: "Modifier mapped" };
  },
);
