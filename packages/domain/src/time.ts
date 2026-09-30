/**
 * Time zones and business days.
 *
 * Instants are stored in UTC. A location has an IANA time zone and a
 * business-day cutoff: a 01:30 sale at a bar with a 04:00 cutoff belongs to
 * the previous business date. Local wall-clock times are converted with the
 * platform's time-zone database, so daylight-saving transitions are handled:
 * a nonexistent local time (spring forward) moves forward past the gap, and
 * an ambiguous one (fall back) resolves to the earlier instant by default.
 */

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function localParts(instant: Date, tz: string): LocalParts {
  const parts = Object.fromEntries(formatter(tz).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset of `tz` from UTC at `instant`, in minutes (e.g. -240 for EDT). */
export function offsetMinutes(instant: Date, tz: string): number {
  const p = localParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

function parseDate(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Invalid date "${date}", expected YYYY-MM-DD`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function parseTime(time: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new RangeError(`Invalid time "${time}", expected HH:MM`);
  return [Number(m[1]), Number(m[2])];
}

export type AmbiguityPolicy = "earlier" | "later";

/** Convert a local wall-clock date and time in `tz` to a UTC instant. */
export function localToUtc(date: string, time: string, tz: string, ambiguous: AmbiguityPolicy = "earlier"): Date {
  const [y, mo, da] = parseDate(date);
  const [h, mi] = parseTime(time);
  const wall = Date.UTC(y, mo - 1, da, h, mi);
  // Candidate offsets: those in effect a day either side cover any transition.
  const offsets = new Set([offsetMinutes(new Date(wall - 86_400_000), tz), offsetMinutes(new Date(wall), tz), offsetMinutes(new Date(wall + 86_400_000), tz)]);
  const matches: number[] = [];
  for (const off of offsets) {
    const candidate = wall - off * 60_000;
    const p = localParts(new Date(candidate), tz);
    if (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall) matches.push(candidate);
  }
  if (matches.length) {
    matches.sort((a, b) => a - b);
    return new Date(ambiguous === "earlier" ? matches[0]! : matches[matches.length - 1]!);
  }
  // Nonexistent (spring-forward gap): use the pre-transition offset, which lands after the gap.
  const before = offsetMinutes(new Date(wall - 86_400_000), tz);
  return new Date(wall - before * 60_000);
}

export function formatDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return formatDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Day of week for a calendar date, 0 = Sunday. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Business date for an instant, given the location's time zone and cutoff (HH:MM). */
export function businessDate(instant: Date, tz: string, cutoff = "04:00"): string {
  const [ch, cm] = parseTime(cutoff);
  const p = localParts(instant, tz);
  const minutes = p.hour * 60 + p.minute;
  const date = formatDate(p.year, p.month, p.day);
  return minutes < ch * 60 + cm ? addDays(date, -1) : date;
}

/** UTC half-open interval [start, end) covered by a business date. */
export function businessDayBounds(date: string, tz: string, cutoff = "04:00"): { start: Date; end: Date } {
  return { start: localToUtc(date, cutoff, tz), end: localToUtc(addDays(date, 1), cutoff, tz) };
}

/** Monday of the week containing `date` (ISO weeks). */
export function weekStart(date: string): string {
  const dow = dayOfWeek(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}
