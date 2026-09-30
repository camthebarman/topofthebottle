import "server-only";
import { decodeBytes, detectDelimiter, findDuplicates, parseCsv, parseNumber, toBase } from "@tz/domain";
import { AiRefusedError, AiUnavailableError, aiMode, extractInvoice, type InvoiceCandidate } from "@/server/ai/provider";
import type { AdminClient } from "@/lib/supabase/admin";
import { type JobContext, type JobRow, PermanentJobError } from "./queue";

/** Read a CSV invoice without AI: one line item per row. */
export function csvInvoice(text: string): InvoiceCandidate {
  const rows = parseCsv(text, detectDelimiter(text.slice(0, 20000)));
  const [header, ...body] = rows;
  if (!header) throw new PermanentJobError("The CSV is empty");
  const h = header.map((x) => x.trim().toLowerCase());
  const col = (...names: RegExp[]) => h.findIndex((x) => names.some((n) => n.test(x)));
  const iDesc = col(/desc/, /^item/, /product/, /name/);
  const iQty = col(/^qty/, /quantity/, /^cases?$/);
  const iPrice = col(/unit.?price/, /^price/, /cost/);
  const iTotal = col(/^(line.?)?total/, /amount/, /extended/, /ext/);
  const iSku = col(/sku/, /item.?(no|#|code)/, /^code/);
  const iPack = col(/pack/, /per.?case/, /units/);
  if (iDesc < 0 || iQty < 0) throw new PermanentJobError("The CSV needs a description and a quantity column");
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const num = (s: string) => {
    const v = parseNumber(s);
    return v === null ? null : v.toFixed();
  };
  const lines = body
    .filter((r) => cell(r, iDesc) && num(cell(r, iQty)) !== null)
    .slice(0, 200)
    .map((r) => ({
      description: cell(r, iDesc).slice(0, 500),
      supplier_sku: cell(r, iSku) || null,
      quantity: num(cell(r, iQty))!,
      purchase_unit: null,
      units_per_pack: num(cell(r, iPack)),
      unit_size: null,
      unit_size_unit: null,
      unit_price: num(cell(r, iPrice)),
      discount: null,
      line_total: num(cell(r, iTotal)),
      deposit_per_pack: null,
      confidence: "high" as const,
    }));
  return { supplier_name: null, invoice_number: null, invoice_date: null, due_date: null, is_credit_note: false, currency: "USD", subtotal: null, freight: null, deposits: null, tax: null, discount: null, total: null, lines, notes: "Read from CSV columns. Header fields are not in the file; enter them." };
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !/^\d+(ml|l|cl|oz)?$/.test(t)));
}

export async function extractInvoiceJob(ctx: JobContext): Promise<Record<string, unknown>> {
  const { admin, job } = ctx;
  const invoiceId = String(job.payload.invoiceId);
  const { data: inv } = await admin.from("invoices").select("*").eq("id", invoiceId).eq("org_id", job.org_id).single();
  if (!inv) throw new PermanentJobError("Invoice not found");
  const { data: doc } = await admin.from("documents").select("storage_path, mime_type, filename").eq("id", inv.document_id).single();
  if (!doc) throw new PermanentJobError("Document not found");
  const { data: settings } = await admin.from("org_settings").select("ai_invoice_opt_in").eq("org_id", job.org_id).single();

  const dl = await admin.storage.from("documents").download(doc.storage_path);
  if (dl.error || !dl.data) throw new Error("Could not read the document");
  const bytes = new Uint8Array(await dl.data.arrayBuffer());

  const { data: attemptRows } = await admin.from("invoice_extractions").select("attempt").eq("invoice_id", invoiceId).order("attempt", { ascending: false }).limit(1);
  const attempt = ((attemptRows?.[0]?.attempt as number | undefined) ?? 0) + 1;

  let candidate: InvoiceCandidate;
  let provider = "csv";
  let model: string | null = null;
  let method: "csv" | "vision" | "manual" = "csv";
  let usage: { in: number | null; out: number | null } = { in: null, out: null };
  try {
    if (doc.mime_type === "text/csv") {
      candidate = csvInvoice(decodeBytes(bytes).text);
    } else {
      method = "vision";
      if (aiMode() === "anthropic" && !settings?.ai_invoice_opt_in) {
        throw new AiUnavailableError("Automatic invoice reading is off for this organization. Turn it on in Settings, or enter the invoice by hand.");
      }
      if (aiMode() === "anthropic") {
        const { data: ok } = await admin.rpc("consume_allowance", { p_org: job.org_id, p_metric: "invoice_extraction", p_amount: 1 });
        if (!ok) throw new AiUnavailableError("This month's invoice reading allowance is used up. Enter the invoice by hand.");
      }
      const r = await extractInvoice({ bytes, mimeType: doc.mime_type, filename: doc.filename });
      candidate = r.output;
      provider = r.provider;
      model = r.model;
      usage = { in: r.inputTokens, out: r.outputTokens };
    }
  } catch (e) {
    if (e instanceof AiUnavailableError || e instanceof AiRefusedError || e instanceof PermanentJobError) {
      await admin.from("invoice_extractions").insert({ org_id: job.org_id, invoice_id: invoiceId, attempt, provider: aiMode(), method, status: "failed", error: e.message });
      await admin.from("invoices").update({ status: "needs_review", review_notes: e.message }).eq("id", invoiceId);
      return { manual: true, reason: e.message };
    }
    throw e;
  }

  const { data: ext, error: extErr } = await admin
    .from("invoice_extractions")
    .insert({ org_id: job.org_id, invoice_id: invoiceId, attempt, provider, model, method, status: "succeeded", output: candidate, input_tokens: usage.in, output_tokens: usage.out })
    .select("id")
    .single();
  if (extErr) throw new Error(extErr.message);

  // Supplier: only an exact name match is filled in; anything else is left for the reviewer.
  let supplierId = inv.supplier_id as string | null;
  if (!supplierId && candidate.supplier_name) {
    const { data: s } = await admin.from("suppliers").select("id").eq("org_id", job.org_id).ilike("name", candidate.supplier_name.replace(/[%_\\]/g, "\\$&")).is("archived_at", null).maybeSingle();
    supplierId = (s?.id as string | undefined) ?? null;
  }

  // Product suggestions: supplier SKU first, then name similarity. Never confirmed automatically.
  const [{ data: items }, { data: products }] = await Promise.all([
    supplierId ? admin.from("supplier_items").select("id, product_id, supplier_sku, units_per_pack, unit_size_base").eq("supplier_id", supplierId) : Promise.resolve({ data: [] }),
    admin.from("products").select("id, name, dimension").eq("org_id", job.org_id).is("archived_at", null).limit(5000),
  ]);
  const productList = (products ?? []) as { id: string; name: string; dimension: "volume" | "mass" | "count" }[];
  const productTokens = productList.map((p) => ({ p, t: tokens(p.name) }));

  const lines = candidate.lines.map((l, i) => {
    let productId: string | null = null;
    let supplierItemId: string | null = null;
    let note: string | null = null;
    let unitsPerPack = l.units_per_pack;
    let unitSizeBase: string | null = null;
    const bySku = l.supplier_sku ? (items ?? []).find((x: { supplier_sku: string | null }) => x.supplier_sku && x.supplier_sku.toLowerCase() === l.supplier_sku!.toLowerCase()) : undefined;
    if (bySku) {
      productId = bySku.product_id;
      supplierItemId = bySku.id;
      unitsPerPack = String(bySku.units_per_pack);
      unitSizeBase = String(bySku.unit_size_base);
      note = "Suggested from supplier SKU";
    } else {
      const lt = tokens(l.description);
      let best: { id: string; score: number; name: string } | null = null;
      for (const { p, t } of productTokens) {
        const overlap = [...lt].filter((x) => t.has(x)).length;
        const score = overlap / Math.max(t.size, 1);
        if (overlap >= 1 && score >= 0.5 && (!best || score > best.score)) best = { id: p.id, score, name: p.name };
      }
      if (best) {
        productId = best.id;
        note = `Suggested by name similarity to "${best.name}"; check it`;
      }
    }
    if (!unitSizeBase && l.unit_size && l.unit_size_unit && productId) {
      const p = productList.find((x) => x.id === productId);
      const conv = p ? toBase(l.unit_size, l.unit_size_unit, p.dimension) : null;
      if (conv?.ok) unitSizeBase = conv.value.toFixed();
    }
    return {
      org_id: job.org_id,
      invoice_id: invoiceId,
      position: i + 1,
      description: l.description,
      supplier_sku: l.supplier_sku,
      product_id: productId,
      supplier_item_id: supplierItemId,
      quantity: l.quantity,
      purchase_unit: l.purchase_unit,
      units_per_pack: unitsPerPack ?? "1",
      unit_size_base: unitSizeBase,
      unit_price: l.unit_price,
      discount: l.discount,
      line_total: l.line_total,
      deposit_per_pack: l.deposit_per_pack,
      match_status: productId ? "suggested" : "unmatched",
      match_note: note,
      confidence: l.confidence,
      source_extraction_id: ext.id,
    };
  });

  // Replace lines only if nobody has edited them yet.
  const { count: edited } = await admin.from("invoice_lines").select("id", { count: "exact", head: true }).eq("invoice_id", invoiceId).not("edited_by", "is", null);
  if (!edited) {
    await admin.from("invoice_lines").delete().eq("invoice_id", invoiceId);
    if (lines.length) {
      const { error } = await admin.from("invoice_lines").insert(lines);
      if (error) throw new Error(error.message);
    }
  }

  const fill = <T,>(current: T | null, next: T | null) => (current ?? next ?? null);
  await admin
    .from("invoices")
    .update({
      status: "needs_review",
      supplier_id: supplierId,
      supplier_name_raw: fill(inv.supplier_name_raw, candidate.supplier_name),
      invoice_number: fill(inv.invoice_number, candidate.invoice_number),
      invoice_date: fill(inv.invoice_date, candidate.invoice_date),
      due_date: fill(inv.due_date, candidate.due_date),
      is_credit_note: inv.is_credit_note || candidate.is_credit_note,
      currency: candidate.currency ?? inv.currency,
      subtotal: fill(inv.subtotal, candidate.subtotal),
      freight: fill(inv.freight, candidate.freight),
      deposits: fill(inv.deposits, candidate.deposits),
      tax: fill(inv.tax, candidate.tax),
      discount: fill(inv.discount, candidate.discount),
      total: fill(inv.total, candidate.total),
      review_notes: candidate.notes,
      version: inv.version,
    })
    .eq("id", invoiceId);
  await flagDuplicates(admin, job.org_id, invoiceId);
  return { lines: lines.length, provider };
}

/** Mark likely duplicates for review; never blocks or deletes anything. */
export async function flagDuplicates(admin: AdminClient, orgId: string, invoiceId: string): Promise<void> {
  const { data: me } = await admin.from("invoices").select("id, supplier_id, invoice_number, invoice_date, total, is_credit_note, documents(sha256)").eq("id", invoiceId).single();
  if (!me) return;
  const sha = (me.documents as unknown as { sha256: string } | null)?.sha256 ?? null;
  const cols = "id, supplier_id, invoice_number, invoice_date, total, is_credit_note, documents(sha256)";
  const [bySupplier, byFile] = await Promise.all([
    me.supplier_id ? admin.from("invoices").select(cols).eq("org_id", orgId).eq("supplier_id", me.supplier_id).neq("id", invoiceId).neq("status", "rejected").limit(1000) : Promise.resolve({ data: [] }),
    sha ? admin.from("invoices").select(`${cols.replace("documents(sha256)", "documents!inner(sha256)")}`).eq("org_id", orgId).eq("documents.sha256", sha).neq("id", invoiceId).neq("status", "rejected").limit(50) : Promise.resolve({ data: [] }),
  ]);
  const others = [...(byFile.data ?? []), ...(bySupplier.data ?? [])];
  const toCand = (x: typeof me) => ({
    id: x.id as string,
    fileSha256: ((x.documents as unknown as { sha256: string } | null)?.sha256 ?? null),
    supplierId: x.supplier_id as string | null,
    invoiceNumber: x.invoice_number as string | null,
    invoiceDate: x.invoice_date as string | null,
    total: x.total === null ? null : String(x.total),
    isCreditNote: x.is_credit_note as boolean,
  });
  const matches = findDuplicates(toCand(me), (others as (typeof me)[]).map(toCand));
  await admin.from("invoices").update({ duplicate_of_id: matches[0]?.id ?? null }).eq("id", invoiceId);
}

export async function markExtractionFailed(admin: AdminClient, job: JobRow, message: string): Promise<void> {
  await admin.from("invoices").update({ status: "extraction_failed", review_notes: `Automatic reading failed: ${message.slice(0, 300)}. Enter the invoice by hand.` }).eq("id", String(job.payload.invoiceId));
}
