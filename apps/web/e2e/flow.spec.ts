import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectSaved, shot, signUp, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

test("owner sets up products, recipes, menu and a count", async ({ page }) => {
  const owner = uniqueEmail("owner");
  await signUp(page, owner);
  await page.waitForURL(/onboarding/);
  await page.getByLabel("Business name").fill("The Copper Still");
  await page.getByLabel("Your name").fill("Owner One");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/today/);

  // Products: gin with a 750 mL bottle and a cost.
  for (const [name, price] of [["Beefeater Gin", "24"], ["Campari", "30"], ["Cocchi Torino", "22"]] as const) {
    await page.goto("/inventory/products/new");
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Category").selectOption(name === "Campari" ? "liqueur" : "spirit");
    await page.getByRole("button", { name: "Add product" }).click();
    await page.waitForURL(/inventory\/products\/[0-9a-f-]{36}\?saved=1/);
    await page.getByLabel("Price", { exact: true }).fill(price);
    await page.getByLabel("Per quantity").fill("750");
    await page.getByLabel("Unit", { exact: true }).first().selectOption("ml");
    await page.getByRole("button", { name: "Record cost" }).click();
    await expectSaved(page, /Cost recorded/);
  }
  await shot(page, "01-product");
  await expectNoHorizontalScroll(page);

  // Copy the classic Negroni and map its ingredients.
  await page.goto("/recipes/library");
  await expectNoHorizontalScroll(page);
  const negroni = page.locator("section").filter({ has: page.getByRole("heading", { name: "Negroni", exact: true }) });
  await negroni.getByRole("button", { name: "Copy" }).click();
  await page.waitForURL(/recipes\/[0-9a-f-]{36}\?copied=1/);
  await expect(page.getByText("Cost is incomplete")).toBeVisible();
  const maps: [string, string][] = [["London dry gin", "Beefeater Gin"], ["Campari", "Campari"], ["Sweet vermouth", "Cocchi Torino"]];
  for (const [ingredient, product] of maps) {
    const form = page.locator("form").filter({ hasText: `${ingredient} is stocked as` });
    await form.getByRole("combobox").selectOption({ label: `${product} (volume)` });
    await form.getByRole("button", { name: "Map" }).click();
    await expect(form).toHaveCount(0);
  }
  // Orange garnish is still unmapped, so cost stays incomplete: honest, not partial.
  await expect(page.getByText("Cost is incomplete")).toBeVisible();
  await expect(page.getByText(/Orange is not mapped/)).toBeVisible();
  await shot(page, "02-recipe-incomplete");

  // Edit the recipe to drop the orange garnish ingredient -> new version, complete cost.
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Remove ingredient 4" }).click();
  await page.getByRole("button", { name: "Save new version" }).click();
  await page.waitForURL(/saved=1/);
  await expect(page.getByText("Cost per serving")).toBeVisible();
  // 30 mL each: gin 24/750*30 = 0.96, Campari 1.20, vermouth 0.88 -> 3.04
  await expect(page.getByText("$3.04")).toBeVisible();
  await expect(page.getByText("Version 2", { exact: true })).toBeVisible();

  await page.getByLabel("On the current menu").check();
  await page.getByLabel("Selling price").fill("14");
  await page.getByRole("button", { name: "Save menu" }).click();
  await expectSaved(page, /Menu updated/);
  await page.reload();
  await expect(page.getByText("21.7%")).toBeVisible();
  await shot(page, "03-recipe-costed");
  await expectNoHorizontalScroll(page);

  await page.goto("/recipes");
  await expect(page.getByRole("link", { name: /Negroni/ })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Count: 2 bottles + 5 tenths of gin, then finalize.
  await page.goto("/inventory/counts");
  await page.getByRole("button", { name: "Start a count" }).click();
  await page.waitForURL(/inventory\/counts\/[0-9a-f-]{36}/);
  await page.getByPlaceholder("Find a product to count").fill("Beefeater");
  await page.keyboard.press("Enter");
  await page.getByRole("link", { name: /Beefeater Gin/ }).click();
  await page.getByLabel("Full bottle").fill("2");
  await page.getByLabel("Open one (0–10 tenths)").fill("5");
  await page.getByRole("button", { name: "Save count" }).click();
  await expectSaved(page, /Counted/);
  await expect(page.getByText("2.5 bottle ≈")).toBeVisible();
  await shot(page, "04-count");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Finalize count" }).click();
  await page.waitForURL(/finalized=1/);
  await expect(page.getByText("Count finalized. 1 product(s) were adjusted")).toBeVisible();

  await page.goto("/inventory");
  await expect(page.getByText("2.5 bottle").first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, "05-inventory");
});
