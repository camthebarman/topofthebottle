/**
 * Bar schedule rules.
 *
 * Shifts are entered as a local date plus local start and end times. An end
 * time at or before the start time means the shift runs past midnight. UTC
 * instants are derived from the location's time zone so an overnight shift
 * across a daylight-saving change has its real length.
 */
import { addDays, localToUtc } from "./time";

export interface ShiftInput {
  id: string;
  staffId: string | null;
  role: string;
  /** Local date the shift starts on, YYYY-MM-DD. */
  date: string;
  start: string;
  end: string;
  notes?: string | null;
}

export interface ResolvedShift extends ShiftInput {
  startsAt: Date;
  endsAt: Date;
  overnight: boolean;
  minutes: number;
}

export function resolveShift(s: ShiftInput, tz: string): ResolvedShift {
  const overnight = s.end <= s.start;
  const startsAt = localToUtc(s.date, s.start, tz);
  const endsAt = localToUtc(overnight ? addDays(s.date, 1) : s.date, s.end, tz, "later");
  return { ...s, startsAt, endsAt, overnight, minutes: Math.round((endsAt.getTime() - startsAt.getTime()) / 60000) };
}

export interface Overlap {
  staffId: string;
  a: string;
  b: string;
}

/** Pairs of shifts assigned to the same person that overlap in time. */
export function findOverlaps(shifts: ResolvedShift[]): Overlap[] {
  const byStaff = new Map<string, ResolvedShift[]>();
  for (const s of shifts) {
    if (!s.staffId) continue;
    const list = byStaff.get(s.staffId) ?? [];
    list.push(s);
    byStaff.set(s.staffId, list);
  }
  const out: Overlap[] = [];
  for (const [staffId, list] of byStaff) {
    list.sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[j]!.startsAt.getTime() >= list[i]!.endsAt.getTime()) break;
        out.push({ staffId, a: list[i]!.id, b: list[j]!.id });
      }
    }
  }
  return out;
}

export function validateShift(s: ShiftInput, tz: string): string[] {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) errors.push("Date must be YYYY-MM-DD");
  if (!/^\d{1,2}:\d{2}$/.test(s.start) || !/^\d{1,2}:\d{2}$/.test(s.end)) errors.push("Times must be HH:MM");
  if (!s.role.trim()) errors.push("Role is required");
  if (errors.length) return errors;
  if (s.start === s.end) errors.push("Start and end cannot be the same time");
  const r = resolveShift(s, tz);
  if (r.minutes > 16 * 60) errors.push("Shift is longer than 16 hours");
  return errors;
}

/** Copy a week's shifts forward by whole weeks, preserving local times. */
export function copyWeek(shifts: ShiftInput[], weeks: number, newId: (s: ShiftInput) => string): ShiftInput[] {
  return shifts.map((s) => ({ ...s, id: newId(s), date: addDays(s.date, 7 * weeks) }));
}

export type ShiftChange = { kind: "added" | "removed" | "changed"; shiftId: string; staffIds: string[] };

/**
 * Differences between two published versions, keyed by shift id, so each
 * affected person can be notified about their own changes.
 */
export function diffPublications(prev: ShiftInput[], next: ShiftInput[]): ShiftChange[] {
  const before = new Map(prev.map((s) => [s.id, s]));
  const after = new Map(next.map((s) => [s.id, s]));
  const out: ShiftChange[] = [];
  const staff = (...xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  for (const [id, s] of after) {
    const old = before.get(id);
    if (!old) out.push({ kind: "added", shiftId: id, staffIds: staff(s.staffId) });
    else if (old.staffId !== s.staffId || old.date !== s.date || old.start !== s.start || old.end !== s.end || old.role !== s.role || (old.notes ?? "") !== (s.notes ?? "")) {
      out.push({ kind: "changed", shiftId: id, staffIds: staff(old.staffId, s.staffId) });
    }
  }
  for (const [id, s] of before) if (!after.has(id)) out.push({ kind: "removed", shiftId: id, staffIds: staff(s.staffId) });
  return out;
}
