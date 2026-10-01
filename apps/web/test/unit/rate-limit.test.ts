import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }) }));
const { clientIp, hit, limit } = await import("@/lib/rate-limit");

describe("rate limiter", () => {
  afterEach(() => vi.useRealTimers());

  it("allows up to the limit in a window, then refuses, then resets", () => {
    vi.useFakeTimers();
    const key = `t:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(hit(key, 3, 60_000)).toBe(true);
    expect(hit(key, 3, 60_000)).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(hit(key, 3, 60_000)).toBe(true);
  });

  it("keeps keys independent and reports a user-facing error", async () => {
    const id = String(Math.random());
    for (let i = 0; i < 2; i++) await limit("sign-in", id, 2, 60_000);
    await expect(limit("sign-in", id, 2, 60_000)).rejects.toThrow(/Too many attempts/);
    await expect(limit("sign-in", `${id}-other`, 2, 60_000)).resolves.toBeUndefined();
  });

  it("takes the address our proxy appended, not a client-supplied one", async () => {
    expect(await clientIp()).toBe("10.0.0.1");
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(await clientIp()).toBe("203.0.113.9");
    delete process.env.TRUSTED_PROXY_HOPS;
  });
});
