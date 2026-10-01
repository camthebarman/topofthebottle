import { UserError } from "@/lib/errors";

/**
 * Public demo mode (DEMO_MODE=1). Everyone shares the same seeded accounts, so actions that
 * could lock others out, send email, create accounts or touch billing are turned off.
 * The database is rebuilt nightly by scripts/demo-reset.ts.
 */
export const isDemo = (): boolean => process.env.DEMO_MODE === "1";

export const DEMO_ACCOUNTS = [
  { email: "owner@demo.tablezero.test", role: "Owner", note: "Everything, including costs and settings" },
  { email: "manager@demo.tablezero.test", role: "Manager", note: "Runs the bar: invoices, counts, imports, schedule" },
  { email: "bartender@demo.tablezero.test", role: "Bartender", note: "Specs, counts and the Bar Book; no costs" },
  { email: "viewer@demo.tablezero.test", role: "Read-only", note: "Reports and costs, no changes" },
] as const;

export function demoPassword(): string | null {
  return isDemo() ? (process.env.DEMO_PASSWORD ?? null) : null;
}

/** Refuse an action that is unsafe on a shared public demo. */
export function notInDemo(what: string): void {
  if (isDemo()) throw new UserError(`${what} is turned off in the demo, because everyone shares these accounts.`, "forbidden");
}
