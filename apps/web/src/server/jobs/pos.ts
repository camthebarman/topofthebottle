import "server-only";
import {
  attachModifierRows,
  CsvLimitError,
  CsvParser,
  decodeBytes,
  finalizeDedupeKeys,
  type MappingProfile,
  type NormalizedSale,
  normalizeRow,
  summarize,
  validateProfile,
} from "@tz/domain";
import { fetchAll } from "@/lib/fetch-all";
import { type JobContext, PermanentJobError } from "./queue";

interface ImportRow {
  id: string;
  org_id: string;
  location_id: string;
  document_id: string;
  kind: "transactions" | "aggregate";
  profile: MappingProfile & { delimiter?: string };
  report_start: string | null;
  report_end: string | null;
  overlap_policy: "reject" | "replace";
  status: string;
}

const BATCH = 1000;

export async function validatePosImport(ctx: JobContext): Promise<Record<string, unknown>> {
  const { admin, job } = ctx;
  const importId = String(job.payload.importId);
  const { data: imp } = await admin.from("pos_imports").select("*").eq("id", importId).eq("org_id", job.org_id).single();
  if (!imp) throw new PermanentJobError("Import not found");
  const row = imp as ImportRow;
  const [{ data: loc }, { data: doc }] = await Promise.all([
    admin.from("locations").select("timezone, business_day_cutoff").eq("id", row.location_id).single(),
    admin.from("documents").select("storage_path").eq("id", row.document_id).single(),
  ]);
  if (!loc || !doc) throw new PermanentJobError("Location or document missing");
  const dl = await admin.storage.from("documents").download(doc.storage_path);
  if (dl.error || !dl.data) throw new Error("Could not read the uploaded file");
  const { text, encoding } = decodeBytes(new Uint8Array(await dl.data.arrayBuffer()));

  // Restart cleanly if a previous attempt was interrupted.
  await admin.from("pos_import_rows").delete().eq("import_id", importId);

  const profile = row.profile;
  const tctx = {
    timeZone: loc.timezone as string,
    businessDayCutoff: String(loc.business_day_cutoff).slice(0, 5),
    ...(row.report_start ? { reportStart: row.report_start } : {}),
    ...(row.report_end ? { reportEnd: row.report_end } : {}),
  };
  let headers: string[] | null = null;
  const accepted: NormalizedSale[] = [];
  const quarantined: { row_number: number; reasons: string[]; source: Record<string, string> }[] = [];
  const warningsByRow = new Map<number, string[]>();
  let rowsRead = 0;
  const mappedHeaders = new Set(Object.values(profile.columns).filter(Boolean) as string[]);

  const parser = new CsvParser(profile.delimiter ?? ",", (fields, line) => {
    if (!headers) {
      headers = fields.map((h) => h.trim());
      const errs = validateProfile(profile, headers);
      if (errs.length) throw new PermanentJobError(errs.join("; "));
      return;
    }
    rowsRead++;
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => (rec[h] = fields[i] ?? ""));
    if (fields.length !== headers.length) {
      quarantined.push({ row_number: line, reasons: [`Row has ${fields.length} columns; the header has ${headers.length}`], source: pick(rec, mappedHeaders) });
      return;
    }
    const r = normalizeRow(rec, line, profile, tctx);
    if (r.ok) {
      accepted.push(r.sale);
      if (r.warnings.length) warningsByRow.set(line, r.warnings);
    } else quarantined.push({ row_number: line, reasons: r.reasons, source: pick(rec, mappedHeaders) });
  });
  try {
    // Feed in chunks so a large file never needs a second full copy.
    for (let i = 0; i < text.length; i += 1 << 20) parser.push(text.slice(i, i + (1 << 20)));
    parser.end();
  } catch (e) {
    if (e instanceof CsvLimitError) throw new PermanentJobError(e.message);
    throw e;
  }
  if (!headers) throw new PermanentJobError("The file is empty");
  await ctx.progress(30);
  await ctx.checkCancelled();

  const { sales, orphans } = attachModifierRows(accepted);
  const all = [...sales, ...orphans]; // orphans attach to items from earlier imports at commit
  finalizeDedupeKeys(all);

  // Duplicates: within the file, then against committed sales.
  const outcome = new Map<NormalizedSale, "accepted" | "duplicate_in_file" | "duplicate_existing">();
  const seen = new Set<string>();
  for (const s of all) {
    if (seen.has(s.dedupeKey)) outcome.set(s, "duplicate_in_file");
    else {
      seen.add(s.dedupeKey);
      outcome.set(s, "accepted");
    }
  }
  const itemRows = all.filter((s) => !s.parentLineId && outcome.get(s) === "accepted");
  for (let i = 0; i < itemRows.length; i += BATCH) {
    const chunk = itemRows.slice(i, i + BATCH);
    const { data } = await admin.rpc("existing_sale_keys", { p_org: row.org_id, p_location: row.location_id, p_keys: chunk.map((s) => s.dedupeKey) });
    const existing = new Set((data ?? []) as string[]);
    for (const s of chunk) if (existing.has(s.dedupeKey)) outcome.set(s, "duplicate_existing");
  }
  await ctx.progress(45);

  // Stage every row with its outcome.
  const staged = [
    ...all.map((s) => ({ org_id: row.org_id, import_id: importId, row_number: s.rowNumber, outcome: outcome.get(s)!, reasons: outcome.get(s) === "accepted" ? [] : [outcome.get(s) === "duplicate_in_file" ? "Same line appears earlier in this file" : "Already imported"], warnings: warningsByRow.get(s.rowNumber) ?? [], normalized: s, source: null })),
    ...quarantined.map((q) => ({ org_id: row.org_id, import_id: importId, row_number: q.row_number, outcome: "quarantined", reasons: q.reasons, warnings: [], normalized: null, source: q.source })),
  ];
  for (let i = 0; i < staged.length; i += BATCH) {
    const { error } = await admin.from("pos_import_rows").insert(staged.slice(i, i + BATCH));
    if (error) throw new Error(`Staging failed: ${error.message}`);
    await ctx.progress(45 + (50 * (i + BATCH)) / Math.max(staged.length, 1));
    await ctx.checkCancelled();
  }

  // Coverage against current item mappings (remapping later does not require re-import).
  const acceptedSales = all.filter((s) => outcome.get(s) === "accepted");
  const summary = summarize(acceptedSales, rowsRead, quarantined.length);
  const maps = await fetchAll((a, b) => admin.from("pos_item_mappings").select("item_key").eq("location_id", row.location_id).is("effective_to", null).order("item_key").range(a, b));
  const mappedKeys = new Set((maps as { item_key: string }[]).map((m) => m.item_key));
  const items = new Map<string, { name: string; qty: number; net: number; mapped: boolean }>();
  for (const s of acceptedSales) {
    if (s.parentLineId) continue;
    const it = items.get(s.itemKey) ?? { name: s.itemName, qty: 0, net: 0, mapped: mappedKeys.has(s.itemKey) };
    it.qty += s.quantity.toNumber();
    it.net += s.kind === "void" || s.kind === "refund" ? 0 : (s.netSales ?? s.grossSales)?.toNumber() ?? 0;
    items.set(s.itemKey, it);
  }
  let overlaps: unknown[] = [];
  if (row.kind === "aggregate" && summary.dateRange) {
    await admin.from("pos_imports").update({ date_start: summary.dateRange.start, date_end: summary.dateRange.end }).eq("id", importId);
    const { data } = await admin.rpc("overlapping_imports", { p_import: importId });
    overlaps = data ?? [];
  }
  const duplicates = { in_file: [...outcome.values()].filter((o) => o === "duplicate_in_file").length, existing: [...outcome.values()].filter((o) => o === "duplicate_existing").length };
  const stats = {
    encoding,
    rows_read: rowsRead,
    accepted: acceptedSales.length,
    quarantined: quarantined.length,
    duplicates,
    by_kind: summary.byKind,
    quantity: summary.quantity.toFixed(),
    gross_sales: summary.grossSales.toFixed(2),
    net_sales: summary.netSales.toFixed(2),
    date_range: summary.dateRange,
    items: [...items.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.net - a.net).slice(0, 500),
    distinct_items: items.size,
    unmapped_items: [...items.values()].filter((i) => !i.mapped).length,
    modifier_rows_for_earlier_imports: orphans.length,
    overlaps,
  };
  await admin
    .from("pos_imports")
    .update({ status: "needs_review", stats, date_start: summary.dateRange?.start ?? null, date_end: summary.dateRange?.end ?? null, encoding, error: null })
    .eq("id", importId);
  return { accepted: acceptedSales.length, quarantined: quarantined.length };
}

function pick(rec: Record<string, string>, keys: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (k in rec) out[k] = (rec[k] ?? "").slice(0, 200);
  return out;
}

export async function commitPosImport(ctx: JobContext): Promise<Record<string, unknown>> {
  const { admin, job } = ctx;
  const importId = String(job.payload.importId);
  const { data, error } = await admin.rpc("commit_pos_import", { p_import: importId, p_actor: job.created_by });
  if (error) {
    if (error.code === "22023") throw new PermanentJobError(error.message);
    throw new Error(error.message);
  }
  return data as Record<string, unknown>;
}
