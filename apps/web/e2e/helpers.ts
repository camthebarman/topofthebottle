import { expect, type Page } from "@playwright/test";

export const PASSWORD = "correct horse battery staple";

export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
}

export async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
}

export async function signIn(page: Page, email: string, next?: string): Promise<void> {
  await page.goto(`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.getByLabel("Email").first().fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** No page-level horizontal scrolling at phone widths. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `page ${page.url()} scrolls horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
}

export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.SCREENSHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/** Wait for an ActionForm to report success. */
export async function expectSaved(page: Page, text: string | RegExp = /Saved|Recorded|Counted|Mapped|Menu updated|added|Cost recorded/): Promise<void> {
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: text }).first()).toBeVisible();
}
