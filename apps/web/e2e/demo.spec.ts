import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll } from "./helpers";

// Runs only against a server started with DEMO_MODE=1 after `pnpm demo:reset`:
//   DEMO_E2E=1 E2E_BASE_URL=http://localhost:3100 pnpm exec playwright test e2e/demo.spec.ts
test.skip(!process.env.DEMO_E2E, "demo server not running");

test("demo: one-tap sign-in, realistic Insights, and shared-account safeguards", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByText(/Everyone shares these accounts/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: /Sign in as Owner/ }).click();
  await page.waitForURL(/today/);
  await expect(page.getByText(/Everyone shares these accounts/)).toBeVisible();

  await page.goto("/insights");
  await expect(page.getByText("London Dry Gin").first()).toBeVisible();
  await expect(page.getByText("Requires review").first()).toBeVisible();
  await expect(page.getByText(/SALES MATCHED TO RECIPES/i)).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Things that would lock other visitors out or send email are refused.
  await page.goto("/settings/security");
  await page.getByRole("button", { name: "Set up an authenticator app" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /turned off in the demo/ })).toBeVisible();
  await page.goto("/settings/members");
  await page.getByLabel("Email").fill("someone@example.com");
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /turned off in the demo/ })).toBeVisible();
});

test("demo: the bartender sees specs but not costs or Insights", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as Bartender/ }).click();
  await page.waitForURL(/today/);
  await page.goto("/insights");
  await expect(page.getByText("Not available with your role")).toBeVisible();
  await page.goto("/recipes");
  await page.getByRole("link", { name: /Negroni/ }).first().click();
  await expect(page.getByRole("heading", { name: "Negroni" })).toBeVisible();
  await expect(page.getByText("Ingredient cost")).toHaveCount(0);
  await expect(page.getByText(/has no cost/)).toHaveCount(0);
});

test("demo: account creation is refused even if the form is reached directly", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(`visitor.${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("a-long-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /turned off in the demo/ })).toBeVisible();
});
