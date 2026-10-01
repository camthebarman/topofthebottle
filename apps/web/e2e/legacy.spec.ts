import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, shot, signInSeeded } from "./helpers";

// Uses the seeded demo owner (supabase/seed.sql).
test("legacy import lists everything it does not import", async ({ page }) => {
  await signInSeeded(page, "owner@demo.test");
  const tag = Date.now().toString(36);
  const state = {
    ingredients: [
      { id: "g", name: `Old Gin ${tag}`, baseUnit: "floz", purchaseUnit: "bottle750", purchaseQty: 1, purchaseCost: 25, onHandQty: { a: 50.72, b: 25.36 } },
      { id: "s", name: `Old Sugar ${tag}`, baseUnit: "ozwt", purchaseUnit: "lb", purchaseQty: 1, purchaseCost: 1, onHandQty: 32 },
    ],
    preps: [{ id: "p", name: `Old Syrup ${tag}`, baseUnit: "floz", yieldQty: 16, components: [{ ingredientId: "s", qty: 8 }] }],
    recipes: [{ id: "r", name: `Old Gimlet ${tag}`, components: [{ ingredientId: "g", qty: 2 }, { ingredientId: "p", qty: 0.75 }], menuPrice: 11 }],
    batches: [{ id: "b1" }, { id: "b2" }, { id: "b3" }],
    transfers: [{ id: "t1" }],
    settings: { nextTransferNo: 1043 },
  };
  await page.goto("/settings/import");
  await page.getByLabel(/Export file/).setInputFiles({ name: "clayton-bar.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(state)) });
  await page.getByRole("button", { name: /Preview/ }).click();
  await expect(page.getByText(/batches: 3 record\(s\): Prepared batches are not imported/)).toBeVisible();
  await expect(page.getByText(/transfers: 1 record\(s\)/)).toBeVisible();
  await expect(page.getByText(/Settings not imported \(nextTransferNo\)/)).toBeVisible();
  await expect(page.getByText(/Stock was split across 2 places/)).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText(/Imported 2 products and 2 recipes/)).toBeVisible();
  await shot(page, "13-legacy-import");
  await expectNoHorizontalScroll(page);
  await page.goto(`/recipes?view=all&q=${encodeURIComponent(`Old Gimlet ${tag}`)}`);
  await page.getByRole("link", { name: new RegExp(`Old Gimlet ${tag}`) }).click();
  await expect(page.getByText("Cost per serving")).toBeVisible();
});
