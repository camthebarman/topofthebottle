import { localToUtc } from "@tz/domain";
import { UserError } from "@/lib/errors";

/** Convert a datetime-local value ("2026-09-30T21:15") in the location's zone to UTC; blank means now. */
export function localInputToUtc(value: string | undefined | null, tz: string): Date {
  if (!value) return new Date();
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!m) throw new UserError("Enter a valid date and time.");
  const at = localToUtc(m[1]!, m[2]!, tz);
  if (at.getTime() > Date.now() + 5 * 60_000) throw new UserError("That time is in the future.");
  if (at.getTime() < Date.now() - 400 * 86_400_000) throw new UserError("That time is more than a year ago.");
  return at;
}
