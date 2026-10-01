import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectSaved, shot, signInSeeded } from "./helpers";


// Uses the seeded demo organization (supabase/seed.sql): two locations, a Simple syrup prep, opening stock.

test("waste, reversal, batch production and transfer between locations", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await signInSeeded(page, "owner@demo.test");

  // Link the Simple syrup prep to its stocked product so it can be batched.
  await page.goto("/recipes?view=all&kind=prep&q=Simple");
  await page.getByRole("link", { name: /Simple syrup \(1:1\)/ }).first().click();
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Stocked as (optional)").selectOption({ label: "Simple syrup (house)" });
  await page.getByRole("button", { name: "Save new version" }).click();
  await page.waitForURL(/saved=1/);

  await page.goto("/inventory/record");
  await expectNoHorizontalScroll(page);

  const waste = page.locator("form").filter({ has: page.getByLabel("Type") });
  await waste.getByLabel("Type").selectOption("waste");
  await waste.getByLabel("Product").selectOption({ label: "House London Dry Gin" });
  await waste.getByLabel("Quantity").fill("60");
  await waste.getByLabel("Unit").selectOption("ml");
  await waste.getByLabel("Note").fill("Dropped a pour");
  await waste.getByRole("button", { name: "Record" }).click();
  await expectSaved(page, "Recorded");

  const batch = page.locator("form").filter({ has: page.getByLabel("Preparation") });
  await batch.getByLabel("Preparation").selectOption({ index: 0 });
  await batch.getByLabel("Batches made").fill("2");
  await batch.getByRole("button", { name: "Record batch" }).click();
  await expectSaved(page, /Recorded 2 batch/);

  const transfer = page.locator("form").filter({ has: page.getByLabel("To location") });
  await transfer.getByLabel("To location").selectOption({ label: "Rooftop" });
  await transfer.getByLabel("Product").selectOption({ label: "House Bourbon" });
  await transfer.getByLabel("Quantity").fill("1");
  await transfer.getByLabel("Unit").selectOption("container");
  await transfer.getByRole("button", { name: "Record transfer" }).click();
  await expectSaved(page, "Transfer recorded at both locations");
  await shot(page, "14-stock-changes");

  // Reverse the waste entry from the product history; the original stays.
  await page.goto("/inventory/products");
  await page.getByRole("link", { name: /House London Dry Gin/ }).first().click();
  const row = page.locator("li").filter({ hasText: /waste/i }).filter({ has: page.getByRole("button", { name: "Reverse…" }) }).first();
  await row.getByRole("button", { name: "Reverse…" }).click();
  await page.getByLabel("Why reverse it?").fill("Entered on the wrong product");
  await page.getByRole("button", { name: "Reverse entry" }).click();
  await page.waitForURL(/reversed=1/);
  await expect(page.getByRole("status").filter({ hasText: "Entry reversed" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("two people editing the same product: the second save is refused, not silently overwritten", async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  await signInSeeded(a, "owner@demo.test");
  await signInSeeded(b, "manager@demo.test");
  await a.goto("/inventory/products");
  await a.getByRole("link", { name: /Campari/ }).first().click();
  await a.waitForURL(/\/inventory\/products\/[0-9a-f-]{36}/);
  const url = a.url();
  await b.goto(url);

  await a.getByLabel("Container name").fill("bottle (A)");
  await a.getByRole("button", { name: "Save product" }).click();
  await a.waitForURL(/saved=1/);

  await b.getByLabel("Container name").fill("bottle (B)");
  await b.getByRole("button", { name: "Save product" }).click();
  await expect(b.getByRole("alert").filter({ hasText: /Someone else changed this|changed/ }).first()).toBeVisible();

  await b.reload();
  await expect(b.getByLabel("Container name")).toHaveValue("bottle (A)");
});
