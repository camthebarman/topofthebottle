"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { d, type InvoiceLineInput, landedCosts, toBase } from "@tz/domain";
import { z } from "zod";
import { action, must, zOptionalNumber, zUuid } from "@/lib/action";
import { fromDbError, UserError } from "@/lib/errors";
import { localInputToUtc } from "@/lib/local-time";
import { getContext, requirePerm } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue, kick } from "@/server/jobs";
import { flagDuplicates } from "@/server/jobs/invoice";
import { orgSettings } from "@/server/menu";

const zDate = z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Use YYYY-MM-DD").transform((s) => s || null);

export const saveHeader = action(
  z.object({
    invoiceId: zUuid,
    version: z.string().regex(/^\d+$/),
    supplierId: z.string().optional(),
    newSupplier: z.string().trim().max(160).optional(),
    invoiceNumber: z.string().trim().max(80).optional(),
    invoiceDate: zDate,
    dueDate: zDate,
    isCreditNote: z.string().optional(),
    correctsInvoiceId: z.string().optional(),
    subtotal: zOptionalNumber,
    freight: zOptionalNumber,
    deposits: zOptionalNumber,
    tax: zOptionalNumber,
    discount: zOptionalNumber,
    total: zOptionalNumber,
  }),
  async (i) => {
    const app = await getContext();
    requirePerm(app, "invoices.upload");
    let supplierId = i.supplierId && /^[0-9a-f-]{36}$/.test(i.supplierId) ? i.supplierId : null;
    if (!supplierId && i.newSupplier) {
      requirePerm(app, "catalog.edit");
      supplierId = (must(await app.supabase.from("suppliers").insert({ org_id: app.org.orgId, name: i.newSupplier }).select("id").single()) as { id: string }).id;
    }
    const res = await app.supabase
      .from("invoices")
      .update({
        supplier_id: supplierId,
        invoice_number: i.invoiceNumber || null,
        invoice_date: i.invoiceDate,
        due_date: i.dueDate,
        is_credit_note: i.isCreditNote === "on",
        corrects_invoice_id: i.correctsInvoiceId && /^[0-9a-f-]{36}$/.test(i.correctsInvoiceId) ? i.correctsInvoiceId : null,
        subtotal: i.subtotal,
        freight: i.freight,
        deposits: i.deposits,
        tax: i.tax,
        discount: i.discount,
        total: i.total,
        status: "needs_review",
        version: Number(i.version),
      })
      .eq("id", i.invoiceId)
      .select("id");
    if (res.error) throw fromDbError(res.error);
    if (!res.data?.length) throw new UserError("This invoice can no longer be edited.");
    await flagDuplicates(createAdminClient(), app.org.orgId, i.invoiceId);
    revalidatePath(`/inventory/invoices/${i.invoiceId}`);
    return { status: "success", message: "Invoice details saved" };
  },
);

const lineSchema = z.object({
  invoiceId: zUuid,
  lineId: z.union([zUuid, z.literal("")]),
  description: z.string().trim().min(1, "Required").max(500),
  quantity: z.string().trim().regex(/^-?\d+(\.\d+)?$/, "Enter a quantity"),
  productId: z.string().optional(),
  unitsPerPack: z.string().trim().regex(/^\d+(\.\d+)?$/, "Enter a number"),
  unitSizeQty: zOptionalNumber,
  unitSizeUnit: z.string().optional(),
  unitPrice: zOptionalNumber,
  discount: zOptionalNumber,
  lineTotal: zOptionalNumber,
  depositPerPack: zOptionalNumber,
  decision: z.enum(["confirm", "not_stock", "save"]),
});

export const saveLine = action(lineSchema, async (i) => {
  const app = await getContext();
  requirePerm(app, "invoices.upload");
  const productId = i.productId && /^[0-9a-f-]{36}$/.test(i.productId) ? i.productId : null;
  let unitSizeBase: string | null = null;
  if (productId && i.unitSizeQty) {
    const p = must(await app.supabase.from("products").select("dimension").eq("id", productId).single()) as { dimension: "volume" | "mass" | "count" };
    const conv = toBase(i.unitSizeQty, i.unitSizeUnit ?? "", p.dimension);
    if (!conv.ok) throw new UserError(`Unit size: ${conv.issue.message}`);
    unitSizeBase = conv.value.toFixed();
  }
  if (i.decision === "confirm" && (!productId || !unitSizeBase)) throw new UserError("To confirm a stock line, choose the product and the size of one unit (e.g. 750 mL).");
  const row = {
    org_id: app.org.orgId,
    invoice_id: i.invoiceId,
    description: i.description,
    quantity: i.quantity,
    product_id: i.decision === "not_stock" ? null : productId,
    units_per_pack: i.unitsPerPack,
    unit_size_base: unitSizeBase,
    unit_price: i.unitPrice,
    discount: i.discount,
    line_total: i.lineTotal,
    deposit_per_pack: i.depositPerPack,
    match_status: i.decision === "confirm" ? "confirmed" : i.decision === "not_stock" ? "not_stock" : productId ? "suggested" : "unmatched",
    match_note: i.decision === "confirm" ? "Confirmed by reviewer" : i.decision === "not_stock" ? "Not a stock item" : null,
    edited_by: app.user.id,
    edited_at: new Date().toISOString(),
  };
  let res;
  if (i.lineId) res = await app.supabase.from("invoice_lines").update(row).eq("id", i.lineId).eq("invoice_id", i.invoiceId).select("id");
  else {
    const { data: max } = await app.supabase.from("invoice_lines").select("position").eq("invoice_id", i.invoiceId).order("position", { ascending: false }).limit(1);
    res = await app.supabase.from("invoice_lines").insert({ ...row, position: ((max?.[0]?.position as number | undefined) ?? 0) + 1 }).select("id");
  }
  if (res.error) throw fromDbError(res.error);
  if (!res.data?.length) throw new UserError("This invoice can no longer be edited.");
  revalidatePath(`/inventory/invoices/${i.invoiceId}`);
  return { status: "success", message: i.decision === "confirm" ? "Line confirmed" : "Line saved" };
});

export const deleteLine = action(z.object({ invoiceId: zUuid, lineId: zUuid }), async ({ invoiceId, lineId }) => {
  const app = await getContext();
  requirePerm(app, "invoices.upload");
  const res = await app.supabase.from("invoice_lines").delete().eq("id", lineId).eq("invoice_id", invoiceId).select("id");
  if (res.error) throw fromDbError(res.error);
  revalidatePath(`/inventory/invoices/${invoiceId}`);
  return { status: "success", message: "Line removed" };
});

async function loadForPosting(invoiceId: string) {
  const app = await getContext();
  const inv = must(await app.supabase.from("invoices").select("*").eq("id", invoiceId).single()) as Record<string, string | null> & { version: number; is_credit_note: boolean; status: string };
  const lines = must(await app.supabase.from("invoice_lines").select("*").eq("invoice_id", invoiceId).order("position")) as Record<string, string | null>[];
  const settings = await orgSettings(app);
  const inputs: InvoiceLineInput[] = lines.map((l) => ({
    description: l.description ?? "",
    quantity: l.quantity ?? "0",
    unitPrice: l.unit_price,
    discount: l.discount,
    lineTotal: l.line_total,
    unitsPerPack: l.units_per_pack ?? "1",
    unitSizeBase: l.unit_size_base,
    depositPerPack: l.deposit_per_pack,
  }));
  const totals = { subtotal: inv.subtotal, freight: inv.freight, deposits: inv.deposits, tax: inv.tax, discount: inv.discount, total: inv.total, isCreditNote: inv.is_credit_note };
  const costs = landedCosts(inputs, totals, { freight: settings.freight_policy, tax: settings.tax_policy, invoiceDiscount: "allocate_by_value" });
  return { app, inv, lines, costs };
}

export const approveInvoice = action(
  z.object({ invoiceId: zUuid, version: z.string().regex(/^\d+$/), updateCosts: z.string().optional(), duplicateOverride: z.string().trim().max(300).optional() }),
  async (i) => {
    const { app, lines, costs } = await loadForPosting(i.invoiceId);
    requirePerm(app, "invoices.approve");
    const lineCosts = lines
      .map((l, idx) => ({ invoice_line_id: l.id, product_id: l.product_id, cost_per_base: costs[idx]?.costPerBase?.toDecimalPlaces(8).toFixed() ?? null, status: l.match_status }))
      .filter((l) => l.status === "confirmed" && l.product_id && l.cost_per_base);
    const { error } = await app.supabase.rpc("approve_invoice", {
      p_org: app.org.orgId,
      p_invoice: i.invoiceId,
      p_expected_version: Number(i.version),
      p_line_costs: lineCosts,
      p_update_costs: i.updateCosts === "on",
      p_duplicate_override: i.duplicateOverride || null,
    });
    if (error) throw fromDbError(error);
    redirect(`/inventory/invoices/${i.invoiceId}?approved=1`);
  },
);

export const receiveInvoice = action(z.object({ invoiceId: zUuid, idempotencyKey: z.uuid(), notes: z.string().trim().max(500).optional(), receivedAt: z.string().optional(), received: z.string().max(100_000) }), async (i) => {
  const { app, lines, costs } = await loadForPosting(i.invoiceId);
  const receivedAt = localInputToUtc(i.receivedAt, app.location.timezone);
  requirePerm(app, "invoices.approve");
  let received: Record<string, string>;
  try {
    received = z.record(z.string(), z.string().regex(/^\d*(\.\d+)?$/)).parse(JSON.parse(i.received));
  } catch {
    throw new UserError("Received quantities must be numbers.");
  }
  const payload = [];
  for (const [idx, l] of lines.entries()) {
    if (l.match_status !== "confirmed" || !l.product_id) continue;
    const q = received[l.id!];
    if (q === undefined || q === "") continue;
    const qty = d(q);
    const billed = d(l.quantity ?? "0");
    const base = qty.times(l.units_per_pack ?? "1").times(l.unit_size_base ?? "0");
    const ext = costs[idx]?.extendedCost;
    payload.push({
      invoice_line_id: l.id,
      received_quantity: qty.toFixed(),
      received_base: base.toFixed(6),
      // Cost follows what arrived, at the billed unit cost.
      extended_cost: ext && !billed.isZero() ? ext.times(qty).div(billed).toFixed(6) : null,
    });
  }
  if (!payload.some((p) => d(p.received_base).gt(0))) throw new UserError("Enter at least one received quantity.");
  const { error } = await app.supabase.rpc("receive_invoice", { p_org: app.org.orgId, p_invoice: i.invoiceId, p_received_at: receivedAt.toISOString(), p_lines: payload, p_notes: i.notes || null, p_idempotency_key: i.idempotencyKey });
  if (error) throw fromDbError(error);
  revalidatePath("/inventory");
  redirect(`/inventory/invoices/${i.invoiceId}?received=1`);
});

export const rejectInvoice = action(z.object({ invoiceId: zUuid, version: z.string().regex(/^\d+$/), reason: z.string().trim().min(1, "Give a reason").max(500) }), async (i) => {
  const app = await getContext();
  requirePerm(app, "invoices.upload");
  const res = await app.supabase.from("invoices").update({ status: "rejected", review_notes: i.reason, version: Number(i.version) }).eq("id", i.invoiceId).select("id");
  if (res.error) throw fromDbError(res.error);
  if (!res.data?.length) throw new UserError("This invoice can no longer be changed.");
  redirect("/inventory/invoices");
});

export const retryExtraction = action(z.object({ invoiceId: zUuid }), async ({ invoiceId }) => {
  const app = await getContext();
  requirePerm(app, "invoices.upload");
  const { data } = await app.supabase.from("invoices").select("status").eq("id", invoiceId).single();
  if (!data || !["needs_review", "extraction_failed", "uploaded"].includes(data.status)) throw new UserError("This invoice cannot be re-read now.");
  await createAdminClient().from("invoices").update({ status: "extracting" }).eq("id", invoiceId);
  await enqueue(app.org.orgId, "invoice_extract", { invoiceId }, { createdBy: app.user.id, idempotencyKey: `${invoiceId}:${Date.now()}`, timeoutSeconds: 180 });
  kick(["invoice_extract"]);
  revalidatePath(`/inventory/invoices/${invoiceId}`);
  return { status: "success", message: "Reading again…" };
});
