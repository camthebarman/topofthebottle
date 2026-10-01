import { afterEach, describe, expect, it } from "vitest";
import { demoPassword, isDemo, notInDemo } from "@/lib/demo";

describe("demo mode", () => {
  afterEach(() => {
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_PASSWORD;
  });

  it("is off unless DEMO_MODE=1, and then refuses unsafe actions", () => {
    expect(isDemo()).toBe(false);
    expect(() => notInDemo("Inviting people")).not.toThrow();
    process.env.DEMO_MODE = "1";
    expect(isDemo()).toBe(true);
    expect(() => notInDemo("Inviting people")).toThrow(/Inviting people is turned off in the demo/);
  });

  it("only reveals the demo password in demo mode", () => {
    process.env.DEMO_PASSWORD = "shown-to-visitors";
    expect(demoPassword()).toBeNull();
    process.env.DEMO_MODE = "1";
    expect(demoPassword()).toBe("shown-to-visitors");
  });
});
