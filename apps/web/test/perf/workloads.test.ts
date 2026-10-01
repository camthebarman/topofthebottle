/**
 * Representative workloads against the local stack. Results are printed and
 * recorded by hand in docs/performance.md with the environment they ran on.
 * Run: pnpm test:perf  (needs `supabase db reset` seed loaded)
 */
import { randomUUID } from "node:crypto";
import { d, theoreticalUsage, type NormalizedSale } from "@tz/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { admin, as, demoIds, localEnv } from "../integration/setup";

let ids: Awaited<ReturnType<typeof demoIds>>;
const results: Record<string, unknown> = {};

beforeAll(async () => {
  const e = localEnv();
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: e.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: e.NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: e.SUPABASE_SERVICE_ROLE_KEY });
  ids = await demoIds();
});

async function ensureDocument(kind: "pos_export", body: string) {
  const a = admin();
  const id = randomUUID();
  const path = `org/${ids.org}/${kind}/${id}.csv`;
  const up = await a.storage.from("documents").upload(path, new Blob([body], { type: "text/csv" }), { contentType: "text/csv" });
  if (up.error) throw up.error;
  const { data: owner } = await a.from("memberships").select("user_id").eq("org_id", ids.org).eq("role", "owner").single();
  await a.from("documents").insert({ id, org_id: ids.org, location_id: ids.loc, kind, storage_path: path, filename: "perf.csv", mime_type: "text/csv", size_bytes: body.length, sha256: "0".repeat(63) + "1", uploaded_by: owner!.user_id });
  return { id, owner: owner!.user_id as string };
}

describe("performance workloads", () => {
  it("50,000-row CSV import through the job pipeline", async () => {
    const header = "Location,Order Id,Order #,Sent Date,Order Date,Check Id,Server,Table,Item Selection Id,Item Id,Master Id,SKU,Menu Item,Sales Category,Gross Price,Discnt,Net Price,Qty,Tax,Void?";
    const items = ["Negroni", "Daiquiri", "Margarita", "Old Fashioned", "Martini", "Draft Lager", "House Red"];
    const rows = [header];
    const tag = randomUUID().slice(0, 8);
    for (let i = 0; i < 50_000; i++) {
      const day = 1 + (i % 28);
      const hh = 17 + (i % 7);
      rows.push(`Main,${tag}-${Math.floor(i / 3)},${i},8/${day}/2026 ${hh - 12}:${String(i % 60).padStart(2, "0")} PM,,C,Someone,1,${tag}-S${i},I-${i % items.length},M,,${items[i % items.length]},Bar,12.00,0.00,12.00,1,0.96,${i % 97 === 0 ? "true" : "false"}`);
    }
    const csv = rows.join("\r\n");
    const { id: docId, owner } = await ensureDocument("pos_export", csv);
    const { PRESETS } = await import("@tz/domain");
    const preset = PRESETS.find((p) => p.id === "toast-item-selection")!;
    const a = admin();
    const { data: imp } = await a.from("pos_imports").insert({ org_id: ids.org, location_id: ids.loc, document_id: docId, kind: "transactions", profile: { ...preset, delimiter: "," }, status: "validating", created_by: owner, stats: {} }).select("id").single();
    const { enqueue, runJobs } = await import("@/server/jobs");
    await enqueue(ids.org, "pos_import_validate", { importId: imp!.id }, { createdBy: owner, timeoutSeconds: 600 });
    const t0 = Date.now();
    await runJobs({ maxMs: 600_000, kinds: ["pos_import_validate"] });
    const validateMs = Date.now() - t0;
    const { data: after } = await a.from("pos_imports").select("status, stats, error").eq("id", imp!.id).single();
    expect(after!.status).toBe("needs_review");
    expect((after!.stats as { accepted: number }).accepted).toBe(50_000);
    await a.from("pos_imports").update({ status: "committing" }).eq("id", imp!.id);
    await enqueue(ids.org, "pos_import_commit", { importId: imp!.id }, { createdBy: owner, timeoutSeconds: 600 });
    const t1 = Date.now();
    await runJobs({ maxMs: 600_000, kinds: ["pos_import_commit"] });
    const commitMs = Date.now() - t1;
    const { data: done } = await a.from("pos_imports").select("status, stats").eq("id", imp!.id).single();
    expect(done!.status).toBe("committed");
    expect((done!.stats as { inserted: number }).inserted).toBe(50_000);
    results.import50k = { rows: 50_000, bytes: csv.length, validateMs, commitMs };
    console.log("import50k " + JSON.stringify(results.import50k));
  }, 900_000);

  it("100,000+ normalized sales rows: aggregation and usage", async () => {
    const a = admin();
    const { data: imp } = await a.from("pos_imports").select("id").eq("org_id", ids.org).eq("status", "committed").limit(1).single();
    // Top up to more than 100k lines with SQL-generated rows attributed to that import.
    const { count: before } = await a.from("sales_lines").select("id", { head: true, count: "exact" }).eq("org_id", ids.org);
    const need = Math.max(0, 100_000 - (before ?? 0));
    for (let i = 0; i < need; i += 5000) {
      const batch = Array.from({ length: Math.min(5000, need - i) }, (_, k) => {
        const n = i + k;
        return { org_id: ids.org, location_id: ids.loc, import_id: imp!.id, row_number: n, business_date: `2026-07-${String(1 + (n % 28)).padStart(2, "0")}`, business_date_end: `2026-07-${String(1 + (n % 28)).padStart(2, "0")}`, occurred_at: new Date(Date.UTC(2026, 6, 1 + (n % 28), 23, n % 60)).toISOString(), item_key: `id:I-${n % 40}`, item_name: `Item ${n % 40}`, modifiers: n % 11 === 0 ? ["Double"] : [], quantity: 1, gross_sales: 12, net_sales: 12, kind: "sale", dedupe_key: `perf:${randomUUID()}` };
      });
      const { error } = await a.from("sales_lines").insert(batch);
      if (error) throw error;
    }
    const { count } = await a.from("sales_lines").select("id", { head: true, count: "exact" }).eq("org_id", ids.org);
    expect(count).toBeGreaterThanOrEqual(100_000);

    const owner = await as("owner@demo.test");
    const t0 = Date.now();
    const groups: { business_date: string; item_key: string; item_name: string; modifiers: string[]; kind: string; quantity: string; net_sales: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await owner.rpc("sales_summary", { p_org: ids.org, p_location: ids.loc, p_from: "2026-01-01T00:00:00Z", p_to: "2026-12-31T00:00:00Z", p_from_date: "2026-01-01", p_to_date: "2026-12-31" }).range(from, from + 999);
      if (error) throw error;
      groups.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    const summaryMs = Date.now() - t0;
    const t1 = Date.now();
    const sales: NormalizedSale[] = groups.map((g) => ({ rowNumber: 0, businessDate: g.business_date, businessDateEnd: g.business_date, occurredAt: null, transactionId: null, lineId: null, parentLineId: null, itemKey: g.item_key, itemName: g.item_name, category: null, modifiers: g.modifiers, quantity: d(g.quantity), grossSales: null, netSales: d(g.net_sales ?? 0), discount: null, kind: g.kind as NormalizedSale["kind"], voidPrepared: null, staffRef: null, dedupeKey: "" }));
    const ctx = { products: new Map(), recipes: new Map(), ingredientMap: new Map() };
    const u = theoreticalUsage(sales, { contextFor: () => ctx, itemMapping: () => null, modifierMapping: () => null });
    const usageMs = Date.now() - t1;
    const totalLines = groups.reduce((s, g) => s + Number(g.quantity), 0);
    expect(u.lines).toBe(groups.length);
    results.sales100k = { salesLines: count, groups: groups.length, quantityCovered: totalLines, summaryMs, usageMs };
    console.log("sales100k " + JSON.stringify(results.sales100k));
  }, 900_000);

  it("concurrent staff counting and conflicting edits", async () => {
    const users = await Promise.all(["owner@demo.test", "manager@demo.test", "bartender@demo.test"].map(as));
    const { data: session } = await users[2]!.from("count_sessions").insert({ org_id: ids.org, location_id: ids.loc }).select("id").single();
    const { data: products } = await users[0]!.from("products").select("id").eq("org_id", ids.org).not("container_size_base", "is", null).limit(12);
    const t0 = Date.now();
    const writes = products!.flatMap((p, i) => users.map((c, j) => c.rpc("upsert_count_line", { p_org: ids.org, p_session: session!.id, p_product: p.id, p_area: null, p_method: "full_units", p_full_units: i + j, p_tenths: null, p_gross_weight_g: null, p_measured_base: null })));
    const res = await Promise.all(writes);
    const ms = Date.now() - t0;
    expect(res.every((r) => !r.error)).toBe(true);
    // Same product and area: last write wins per line; exactly one line per product.
    const { count } = await users[0]!.from("count_lines").select("id", { head: true, count: "exact" }).eq("session_id", session!.id);
    expect(count).toBe(products!.length);
    // Two managers finalizing the same version: exactly one succeeds.
    const fin = await Promise.all([users[0]!.rpc("finalize_count", { p_org: ids.org, p_session: session!.id, p_expected_version: 1 }), users[1]!.rpc("finalize_count", { p_org: ids.org, p_session: session!.id, p_expected_version: 1 })]);
    expect(fin.filter((f) => !f.error).length).toBe(1);
    results.concurrency = { parallelWrites: writes.length, ms, finalizeWinners: 1 };
    console.log("concurrency", results.concurrency);
  });
});
