import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, as, demoIds } from "./setup";

async function stock(org: string, loc: string, product: string): Promise<number> {
  const { data } = await admin().from("stock_movements").select("qty_base").eq("org_id", org).eq("location_id", loc).eq("product_id", product);
  return (data ?? []).reduce((a, r) => a + Number(r.qty_base), 0);
}

async function costNow(c: Awaited<ReturnType<typeof as>>, org: string, loc: string, product: string, at = new Date().toISOString()): Promise<number | null> {
  const { data, error } = await c.rpc("product_costs_as_of", { p_org: org, p_location: loc, p_as_of: at });
  if (error) throw error;
  const row = (data as { product_id: string; cost_per_base: string }[]).find((r) => r.product_id === product);
  return row ? Number(row.cost_per_base) : null;
}

describe("invoice reversal and correction", () => {
  it("reverses receipts and costs without rewriting earlier reports, then starts a correction", async () => {
    const ids = await demoIds();
    const owner = await as("owner@demo.test");
    const bartender = await as("bartender@demo.test");
    const supplier = (await admin().from("suppliers").select("id").eq("org_id", ids.org).limit(1).single()).data!.id as string;

    const costBefore = await costNow(owner, ids.org, ids.loc, ids.product);
    const stockBefore = await stock(ids.org, ids.loc, ids.product);

    const { data: inv } = await admin().from("invoices").insert({ org_id: ids.org, location_id: ids.loc, supplier_id: supplier, invoice_number: `REV-${randomUUID().slice(0, 6)}`, invoice_date: new Date().toISOString().slice(0, 10), total: 180, status: "needs_review" }).select("id, version").single();
    const { data: line } = await admin().from("invoice_lines").insert({ org_id: ids.org, invoice_id: inv!.id, position: 1, description: "Campari 6x750ml", product_id: ids.product, quantity: 1, units_per_pack: 6, unit_size_base: 750, line_total: 180, match_status: "confirmed" }).select("id").single();

    const approve = await owner.rpc("approve_invoice", { p_org: ids.org, p_invoice: inv!.id, p_expected_version: inv!.version, p_line_costs: [{ invoice_line_id: line!.id, product_id: ids.product, cost_per_base: "0.04" }], p_update_costs: true });
    expect(approve.error).toBeNull();
    const recv = await owner.rpc("receive_invoice", { p_org: ids.org, p_invoice: inv!.id, p_received_at: new Date().toISOString(), p_lines: [{ invoice_line_id: line!.id, received_quantity: 1, received_base: 4500, extended_cost: 180 }], p_notes: null, p_idempotency_key: randomUUID() });
    expect(recv.error).toBeNull();
    expect(await stock(ids.org, ids.loc, ids.product)).toBeCloseTo(stockBefore + 4500);
    expect(await costNow(owner, ids.org, ids.loc, ids.product)).toBeCloseTo(0.04);

    const beforeReversal = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    const version = (await admin().from("invoices").select("version").eq("id", inv!.id).single()).data!.version as number;

    const denied = await bartender.rpc("reverse_invoice", { p_org: ids.org, p_invoice: inv!.id, p_expected_version: version, p_reason: "wrong", p_reverse_receipts: true });
    expect(denied.error).not.toBeNull();
    const noReason = await owner.rpc("reverse_invoice", { p_org: ids.org, p_invoice: inv!.id, p_expected_version: version, p_reason: " ", p_reverse_receipts: true });
    expect(noReason.error?.message).toMatch(/reason/);

    const rev = await owner.rpc("reverse_invoice", { p_org: ids.org, p_invoice: inv!.id, p_expected_version: version, p_reason: "Billed the wrong bar", p_reverse_receipts: true });
    expect(rev.error).toBeNull();
    expect(rev.data).toBe(1);

    // Stock is back; the receipt and its reversal both remain in the ledger.
    expect(await stock(ids.org, ids.loc, ids.product)).toBeCloseTo(stockBefore);
    // Current cost falls back; a report as of before the reversal still sees the invoice cost.
    expect(await costNow(owner, ids.org, ids.loc, ids.product)).toBeCloseTo(costBefore!);
    expect(await costNow(owner, ids.org, ids.loc, ids.product, beforeReversal)).toBeCloseTo(0.04);

    const again = await owner.rpc("reverse_invoice", { p_org: ids.org, p_invoice: inv!.id, p_expected_version: version + 1, p_reason: "again", p_reverse_receipts: true });
    expect(again.error?.message).toMatch(/Only approved invoices/);
    const edit = await owner.from("invoices").update({ total: 1 }).eq("id", inv!.id).select("id");
    expect(edit.data ?? []).toHaveLength(0);

    const corr = await owner.rpc("create_corrected_invoice", { p_org: ids.org, p_invoice: inv!.id });
    expect(corr.error).toBeNull();
    const { data: fresh } = await owner.from("invoices").select("status, corrects_invoice_id, invoice_lines(match_status)").eq("id", corr.data as string).single();
    expect(fresh).toMatchObject({ status: "needs_review", corrects_invoice_id: inv!.id });
    expect((fresh!.invoice_lines as { match_status: string }[]).map((l) => l.match_status)).toEqual(["suggested"]);
    const twice = await owner.rpc("create_corrected_invoice", { p_org: ids.org, p_invoice: inv!.id });
    expect(twice.error).not.toBeNull();

    const audit = await admin().from("audit_events").select("action").eq("entity_id", inv!.id).eq("action", "invoice.reversed");
    expect(audit.data).toHaveLength(1);
  });
});
