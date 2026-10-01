import { type Browser, expect, type Page, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectSaved, nyLocal, PASSWORD, shot, signUp, toastCsv, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

test("full flow: organization to export", async ({ page, browser }) => {
  const cspViolations: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to/.test(m.text())) cspViolations.push(m.text());
  });
  const owner = uniqueEmail("owner");
  await signUp(page, owner);
  await page.waitForURL(/onboarding/);
  await page.getByLabel("Business name").fill("The Copper Still");
  await page.getByLabel("Your name").fill("Owner One");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/today/);

  // ---------- invite a bartender ----------
  const staffEmail = uniqueEmail("bartender");
  await page.goto("/settings/members");
  await page.getByLabel("Email").fill(staffEmail);
  await page.getByLabel("Role", { exact: true }).selectOption("bartender");
  await page.getByRole("button", { name: "Create invitation" }).click();
  const inviteLink = (await page.locator("p.font-mono").innerText()).trim();
  expect(inviteLink).toMatch(/\/invite\/[0-9a-f]{48}$/);
  const staff = await acceptInvite(browser, staffEmail, new URL(inviteLink).pathname);
  await shot(page, "00-invite");

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
  const day = 86_400_000;
  await page.getByLabel("Stock as of (optional)").fill(nyLocal(new Date(Date.now() - 2 * day), "10:00"));
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

  // ---------- invoice: CSV upload, review, approve, receive ----------
  await page.goto("/inventory/invoices");
  await expectNoHorizontalScroll(page);
  await page.getByLabel("PDF, photo or CSV (max 25 MB, 50 pages)").setInputFiles({
    name: "sgws-invoice.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Description,SKU,Qty,Units per case,Unit Price,Total\nBeefeater Gin 12x750ml,BF750,1,12,288.00,288.00\nCampari 6x750ml,CMP750,1,6,180.00,180.00\nLemons case,LEM,1,1,40.00,40.00\n"),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await page.waitForURL(/inventory\/invoices\/[0-9a-f-]{36}/);
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Lines (3)")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await page.getByLabel("New supplier name").fill("Southern Glazer's");
  await page.getByLabel("Invoice number", { exact: true }).fill("INV-1001");
  await page.getByLabel("Subtotal", { exact: true }).fill("508.00");
  await page.getByLabel("Freight", { exact: true }).fill("10.00");
  await page.getByLabel("Total", { exact: true }).fill("518.00");
  await page.getByRole("button", { name: "Save details" }).click();
  await expectSaved(page, /Invoice details saved/);
  await page.reload();
  await expect(page.getByText("Lines, subtotal and total agree")).toBeVisible();

  const lineCard = (text: string) => page.locator("li").filter({ has: page.locator(`input[value="${text}"]`) });
  for (const [desc, product, pack] of [["Beefeater Gin 12x750ml", "Beefeater Gin", "12"], ["Campari 6x750ml", "Campari", "6"]] as const) {
    const card = lineCard(desc);
    await card.getByLabel("Product").selectOption({ label: product });
    await card.getByLabel("Units per pack").fill(pack);
    await card.getByLabel("Unit size").fill("750");
    await card.getByLabel("Size unit").selectOption("ml");
    await card.getByRole("button", { name: "Confirm line" }).click();
    await expect(card.getByText("Line confirmed")).toBeVisible();
  }
  await lineCard("Lemons case").getByRole("button", { name: "Not stock" }).click();
  await expect(lineCard("Lemons case").getByText("Line saved")).toBeVisible();
  await page.reload();
  await shot(page, "06-invoice-review");
  await expectNoHorizontalScroll(page);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Approve invoice" }).click();
  await expect(page.getByText("Approved. Stock has not changed yet")).toBeVisible();
  await page.getByLabel("Received at (optional)").fill(nyLocal(new Date(Date.now() - 2 * day), "12:00"));
  await page.getByRole("button", { name: "Receive into stock" }).click();
  await expect(page.getByText("Received into stock.")).toBeVisible();
  await page.goto("/inventory");
  // 2.5 bottles counted + 12 received
  await expect(page.getByText("14.5 bottle").first()).toBeVisible();

  // ---------- POS import (Toast item selection format) ----------
  await page.goto("/imports");
  await page.getByLabel("CSV export (max 25 MB)").setInputFiles({ name: "ItemSelectionDetails.csv", mimeType: "text/csv", buffer: Buffer.from(toastCsv(new Date(Date.now() - day))) });
  await page.getByRole("button", { name: "Upload" }).click();
  await page.waitForURL(/imports\/[0-9a-f-]{36}/);
  await expect(page.getByLabel("Format", { exact: true })).toHaveValue("toast-item-selection");
  await expect(page.getByText(/Not imported \(personal or payment data\)/)).toBeVisible();
  await page.getByRole("button", { name: "Check the file" }).click();
  await expect(page.getByText("What the file contains")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Line \d+: quantity "abc" is not a number/)).toBeVisible();
  const mapNegroni = page.locator("form").filter({ has: page.locator('input[name="itemName"][value="Negroni"]') });
  await mapNegroni.getByRole("combobox").first().selectOption({ label: "Negroni" });
  await mapNegroni.getByRole("button", { name: "Map" }).click();
  await expect(mapNegroni).toHaveCount(0);
  await shot(page, "07-import-review");
  await expectNoHorizontalScroll(page);
  await page.getByLabel(/Import the valid rows/).check();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Import sales" }).click();
  await expect(page.getByText("Import report")).toBeVisible({ timeout: 60_000 });
  const report = page.locator("section").filter({ hasText: "Import report" });
  await expect(report.locator("div").filter({ hasText: /^Sales lines added5$/ })).toBeVisible();
  await expect(page.getByText("Rejected (see below)")).toBeVisible();
  // Staff names from the Server column are never stored.
  await expect(page.getByText("Alex Example")).toHaveCount(0);
  await shot(page, "08-import-report");

  // ---------- closing count and variance ----------
  await page.goto("/inventory/counts");
  await page.getByLabel("Name (optional)").fill("Close");
  await page.getByRole("button", { name: "Start a count" }).click();
  await page.waitForURL(/inventory\/counts\/[0-9a-f-]{36}/);
  await page.getByPlaceholder("Find a product to count").fill("Beefeater");
  await page.keyboard.press("Enter");
  await page.getByRole("link", { name: /Beefeater Gin/ }).click();
  await page.getByLabel("Full bottle").fill("14");
  await page.getByLabel("Open one (0–10 tenths)").fill("1");
  await page.getByRole("button", { name: "Save count" }).click();
  await expectSaved(page, /Counted/);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Finalize count" }).click();
  await page.waitForURL(/finalized=1/);

  // Enable AI explanations. With E2E_AI_STUB=1 (dev server, AI_PROVIDER=stub) the stub exercises the
  // pipeline; against a production build without a key the feature must stay unavailable.
  await page.goto("/settings");
  await page.getByLabel("Offer AI explanations in Insights").check();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expectSaved(page, /Settings saved/);

  await page.goto("/insights");
  const gin = page.locator("li").filter({ has: page.getByText("Beefeater Gin", { exact: true }) });
  await expect(gin.getByText("Requires review")).toBeVisible();
  // Physical usage: 1,875 + 9,000 - 10,575 = 300 mL. Served: 5 Negronis x 30 mL = 150 mL. Unexplained +150 mL.
  await expect(gin.getByText(/Unexplained: \+150 mL \(100\.0% of accounted usage\)/)).toBeVisible();
  await gin.getByText("How this was calculated").click();
  await expect(gin.getByText("300 mL")).toBeVisible();
  const insightsText = (await page.locator("main").innerText()).toLowerCase();
  expect(insightsText).not.toMatch(/theft|thief|steal|stole|fraud/);
  await shot(page, "09-insights");
  await expectNoHorizontalScroll(page);
  if (process.env.E2E_AI_STUB === "1") {
    await page.getByRole("button", { name: "Explain with AI" }).click();
    await expect(page.getByText(/Development stub \(no AI provider\)/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Written by the development stub/)).toBeVisible();
  } else {
    await expect(page.getByRole("button", { name: "Explain with AI" })).toHaveCount(0);
  }

  // ---------- bar book handoff acknowledged by staff ----------
  await page.goto("/barbook");
  await page.getByText("Write an entry").click();
  await page.getByLabel("Title").fill("Campari low for the weekend");
  await page.getByLabel("Details").fill("One bottle left after Friday. Order placed.");
  await page.getByLabel("Category").selectOption("shortage");
  await page.getByLabel("Ask everyone to acknowledge").check();
  await page.getByRole("button", { name: "Post" }).click();
  await page.waitForURL(/barbook\/[0-9a-f-]{36}\?saved=1/);
  await staff.goto("/today");
  await staff.getByRole("link", { name: "Campari low for the weekend" }).click();
  await staff.getByRole("button", { name: "I've read this" }).click();
  await expect(staff.getByText("Acknowledged by 1")).toBeVisible();
  await shot(staff, "10-barbook-ack-staff");
  await expectNoHorizontalScroll(staff);

  // ---------- schedule: overnight shift published and seen by staff ----------
  await page.goto("/schedule");
  await page.getByLabel("Name", { exact: true }).fill("Sam Staff");
  await page.getByLabel("Linked account (optional)").selectOption({ index: 2 });
  await page.getByRole("button", { name: "Add staff" }).click();
  await expectSaved(page, /Staff added/);
  await page.reload();
  const todayLabel = await page.getByLabel("Day").locator("option").first().getAttribute("value");
  await page.getByLabel("Who").selectOption({ label: "Sam Staff" });
  await page.getByLabel("Start").fill("17:00");
  await page.getByLabel("End").fill("01:00");
  await page.getByRole("button", { name: "Add shift" }).click();
  await expectSaved(page, /runs past midnight/);
  await page.reload();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Publish week" }).click();
  await expect(page.getByText("Published v1")).toBeVisible();
  await shot(page, "11-schedule");
  await expectNoHorizontalScroll(page);
  await staff.goto(`/schedule?week=${todayLabel}`);
  await expect(staff.getByText("Your shifts")).toBeVisible();
  await expect(staff.getByText(/17:00–01:00 \(\+1\)/).first()).toBeVisible();
  await staff.goto("/notifications");
  await expect(staff.getByText(/Schedule for week of/)).toBeVisible();

  // Staff role limits.
  await staff.goto("/insights");
  await expect(staff.getByText("Not available with your role")).toBeVisible();
  const recipeUrl = new URL(page.url()).origin + (await (async () => { await page.goto("/recipes?view=all"); return (await page.getByRole("link", { name: /Negroni/ }).first().getAttribute("href"))!; })());
  await staff.goto(recipeUrl);
  await expect(staff.getByRole("heading", { name: "Negroni" })).toBeVisible();
  await expect(staff.getByText("Ingredient cost")).toHaveCount(0);

  // ---------- beverage event ----------
  await page.goto("/events");
  await page.getByText("Plan a new event").click();
  await page.getByLabel("Event name").fill("Rooftop birthday");
  await page.getByLabel("Guests", { exact: true }).fill("60");
  await page.getByLabel("Hours", { exact: true }).fill("3");
  await page.getByLabel("Cocktails %").fill("100");
  await page.getByLabel("Beer %").fill("0");
  await page.getByLabel("Wine %").fill("0");
  await page.getByLabel("Non-alcoholic %").fill("0");
  await page.getByLabel(/Other costs/).fill("Two bartenders: 320");
  await page.getByRole("button", { name: "Create event" }).click();
  await page.waitForURL(/events\/[0-9a-f-]{36}\?saved=1/);
  await page.getByLabel("Recipe").selectOption({ label: "Negroni" });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expectSaved(page, /Saved/);
  await page.reload();
  // 60 x 85% x (2 + 1 + 1) = 204 expected; +10% contingency = 225 (rounded up from 224.4).
  await expect(page.getByText("225 drinks")).toBeVisible();
  await expect(page.getByText("225 servings")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Save quote snapshot" }).click();
  await expectSaved(page, /Quote v1 saved/);
  await shot(page, "12-event");
  await expectNoHorizontalScroll(page);
  const csv = await page.request.get(`${new URL(page.url()).pathname}/export`);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("Beefeater Gin");

  // ---------- export ----------
  const res = await page.request.get("/api/export");
  expect(res.status()).toBe(200);
  const dump = await res.json();
  expect(dump.format).toBe("table-zero-bar-export");
  expect(dump.tables.sales_lines).toHaveLength(5);
  expect(dump.tables.invoices.length).toBeGreaterThanOrEqual(1);
  expect(dump.tables.audit_events.length).toBeGreaterThan(5);
  expect(JSON.stringify(dump)).not.toContain("Alex Example");
  const staffExport = await staff.request.get("/api/export");
  expect(staffExport.status()).toBe(403);
  expect(cspViolations, cspViolations.join("\n")).toEqual([]);
});

async function acceptInvite(browser: Browser, email: string, invitePath: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, baseURL: test.info().project.use.baseURL });
  const p = await ctx.newPage();
  await p.goto(`/sign-up?next=${encodeURIComponent(invitePath)}`);
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Create account" }).click();
  await p.waitForURL(new RegExp(invitePath));
  await p.getByLabel(/Your name/).fill("Sam Staff");
  await p.getByRole("button", { name: "Accept invitation" }).click();
  await p.waitForURL(/today/);
  return p;
}
