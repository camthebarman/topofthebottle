import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { signIn, signUp, uniqueEmail } from "./helpers";

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret. */
function totp(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test("an enrolled second factor is required for pages, actions and API routes", async ({ page }) => {
  const email = uniqueEmail("mfa");
  await signUp(page, email);
  await page.waitForURL(/onboarding/);
  await page.getByLabel("Business name").fill("Second Factor Bar");
  await page.getByLabel("Your name").fill("Owner Two");
  await page.getByRole("button", { name: /Create/ }).click();
  await page.waitForURL(/today/);

  await page.goto("/settings/security");
  await page.getByRole("button", { name: "Set up an authenticator app" }).click();
  const secret = (await page.locator(".font-mono").first().textContent())!.trim();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.locator('[aria-live="polite"]').first()).not.toBeEmpty();

  // A new password-only session is aal1.
  await page.context().clearCookies();
  await signIn(page, email);
  await page.waitForURL(/\/mfa/);
  await page.goto("/inventory");
  await expect(page).toHaveURL(/\/mfa/);
  const api = await page.request.get("/api/export", { maxRedirects: 0 });
  expect(api.status(), "export must not be served before the second factor").not.toBe(200);

  await page.getByLabel(/code/i).fill(totp(secret));
  await page.getByRole("button", { name: /Verify|Continue/ }).click();
  await page.waitForURL(/today/);
  const ok = await page.request.get("/api/export", { maxRedirects: 0 });
  expect(ok.status()).toBe(200);
});
