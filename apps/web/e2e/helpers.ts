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
  // Duplicate ids break label association for screen readers; check on every page we visit.
  const dupes = await page.evaluate(() => {
    const seen = new Map<string, number>();
    for (const el of document.querySelectorAll("[id]")) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  });
  expect(dupes, `duplicate ids on ${page.url()}`).toEqual([]);
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

/** Local date-time in New York for a datetime-local input, e.g. "2026-09-28T10:00". */
export function nyLocal(d: Date, time: string): string {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return `${date}T${time}`;
}

function usDate(d: Date): string {
  const [m, day, y] = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric" }).format(d).split("/");
  return `${m}/${day}/${y}`;
}

/**
 * A small file in the documented Toast ItemSelectionDetails.csv layout:
 * 4 Negronis sold (one comped), 1 voided before it was made, 1 row with a bad quantity,
 * plus a Server column (personal data) that must not be imported.
 */
export function toastCsv(day: Date): string {
  const d = usDate(day);
  const header = "Location,Order Id,Order #,Sent Date,Order Date,Check Id,Server,Table,Item Selection Id,Item Id,Master Id,SKU,Menu Item,Sales Category,Gross Price,Discnt,Net Price,Qty,Tax,Void?";
  const row = (sel: string, time: string, qty: string, net: string, voided: string, discount = "0.00") =>
    `Main,O-${sel},${sel},${d} ${time},${d} ${time},C-${sel},Alex Example,4,S-${sel},I-NEG,M1,,Negroni,Cocktails,14.00,${discount},${net},${qty},1.12,${voided}`;
  return [
    header,
    row("1", "8:05 PM", "1", "14.00", "false"),
    row("2", "8:40 PM", "2", "28.00", "false"),
    row("3", "9:10 PM", "1", "0.00", "false", "14.00"),
    row("4", "9:30 PM", "1", "14.00", "true"),
    row("5", "9:45 PM", "abc", "14.00", "false"),
    row("6", "10:15 PM", "1", "14.00", "false"),
  ].join("\r\n");
}
