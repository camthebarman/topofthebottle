import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { admin, as, demoIds } from "../test/integration/setup";
import { expectNoHorizontalScroll, shot, signInSeeded } from "./helpers";

test("reverse an approved, received invoice and start a correction", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  // Arrange an approved and received invoice through the same database functions the app uses.
  const ids = await demoIds();
  const owner = await as("owner@demo.test");
  const supplier = (await admin().from("suppliers").select("id").eq("org_id", ids.org).limit(1).single()).data!.id as string;
  const number = `E2E-${randomUUID().slice(0, 6)}`;
  const { data: inv } = await admin().from("invoices").insert({ org_id: ids.org, location_id: ids.loc, supplier_id: supplier, invoice_number: number, invoice_date: new Date().toISOString().slice(0, 10), total: 180, status: "needs_review" }).select("id, version").single();
  const { data: line } = await admin().from("invoice_lines").insert({ org_id: ids.org, invoice_id: inv!.id, position: 1, description: "Campari 6x750ml", product_id: ids.product, quantity: 1, units_per_pack: 6, unit_size_base: 750, line_total: 180, match_status: "confirmed" }).select("id").single();
  expect((await owner.rpc("approve_invoice", { p_org: ids.org, p_invoice: inv!.id, p_expected_version: inv!.version, p_line_costs: [{ invoice_line_id: line!.id, product_id: ids.product, cost_per_base: "0.04" }], p_update_costs: true })).error).toBeNull();
  expect((await owner.rpc("receive_invoice", { p_org: ids.org, p_invoice: inv!.id, p_received_at: new Date().toISOString(), p_lines: [{ invoice_line_id: line!.id, received_quantity: 1, received_base: 4500, extended_cost: 180 }], p_notes: null, p_idempotency_key: randomUUID() })).error).toBeNull();

  await signInSeeded(page, "owner@demo.test");

  await page.goto(`/inventory/invoices/${inv!.id}`);
  await page.getByRole("button", { name: "Reverse this invoice…" }).click();
  await page.getByLabel("Why reverse it?").fill("Approved with the wrong supplier");
  await expect(page.getByLabel(/Also take the received stock back out \(1 receipt line\)/)).toBeChecked();
  await page.getByRole("button", { name: "Reverse invoice" }).click();
  await page.waitForURL(/reversed=1/);
  await expect(page.getByRole("status").filter({ hasText: "Invoice reversed" })).toBeVisible();
  await expect(page.getByText("Approved with the wrong supplier")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, "15-invoice-reversed");

  await page.getByRole("button", { name: "Start a corrected invoice" }).click();
  await page.waitForURL((u) => /\/inventory\/invoices\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.endsWith(inv!.id));
  await expect(page.getByText("This corrects an earlier invoice.")).toBeVisible();
  await expect(page.getByText("Possible duplicate")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});
