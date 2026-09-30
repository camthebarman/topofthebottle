"use server";

import { revalidatePath } from "next/cache";
import { addDays, copyWeek, diffPublications, findOverlaps, resolveShift, type ShiftInput, validateShift, weekStart } from "@tz/domain";
import { z } from "zod";
import { action, must, zUuid } from "@/lib/action";
import { fromDbError, UserError } from "@/lib/errors";
import { type AppContext, getContext, requirePerm } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/server/notify";

const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const zTime = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");

/** Get or create the week at the active location; verifies the caller may schedule there. */
async function ensureWeek(app: AppContext, anyDate: string): Promise<{ id: string; status: string; version: number; published_version: number }> {
  requirePerm(app, "schedule.publish");
  const ws = weekStart(anyDate);
  const found = await app.supabase.from("schedule_weeks").select("id, status, version, published_version").eq("location_id", app.location.id).eq("week_start", ws).maybeSingle();
  if (found.data) return found.data;
  const ins = await app.supabase.from("schedule_weeks").insert({ org_id: app.org.orgId, location_id: app.location.id, week_start: ws }).select("id, status, version, published_version").single();
  if (ins.error) throw fromDbError(ins.error);
  return ins.data;
}

async function markChanged(weekId: string) {
  await createAdminClient().from("schedule_weeks").update({ has_unpublished_changes: true }).eq("id", weekId).eq("status", "published");
}

export const addShift = action(
  z.object({ date: zDate, staffId: z.string().optional(), role: z.string().trim().min(1, "Role is required").max(60), start: zTime, end: zTime, notes: z.string().trim().max(500).optional() }),
  async (i) => {
    const app = await getContext();
    const week = await ensureWeek(app, i.date);
    const staffId = i.staffId && /^[0-9a-f-]{36}$/.test(i.staffId) ? i.staffId : null;
    if (staffId) {
      const s = await app.supabase.from("staff_profiles").select("id").eq("id", staffId).eq("org_id", app.org.orgId).maybeSingle();
      if (!s.data) throw new UserError("Unknown staff member.");
    }
    const input: ShiftInput = { id: "new", staffId, role: i.role, date: i.date, start: i.start, end: i.end, notes: i.notes ?? null };
    const errors = validateShift(input, app.location.timezone);
    if (errors.length) throw new UserError(errors.join(" "));
    const r = resolveShift(input, app.location.timezone);
    const { error } = await createAdminClient().from("shifts").insert({ org_id: app.org.orgId, week_id: week.id, staff_id: staffId, role: i.role, shift_date: i.date, start_time: i.start, end_time: i.end, starts_at: r.startsAt.toISOString(), ends_at: r.endsAt.toISOString(), notes: i.notes || null });
    if (error) throw fromDbError(error);
    await markChanged(week.id);
    revalidatePath("/schedule");
    return { status: "success", message: `Shift added${r.overnight ? " (runs past midnight)" : ""}` };
  },
);

export const deleteShift = action(z.object({ shiftId: zUuid }), async ({ shiftId }) => {
  const app = await getContext();
  requirePerm(app, "schedule.publish");
  // RLS: schedulers can read shifts only in weeks at locations they schedule.
  const { data: s } = await app.supabase.from("shifts").select("id, week_id").eq("id", shiftId).maybeSingle();
  if (!s) throw new UserError("Shift not found.", "not_found");
  const { error } = await createAdminClient().from("shifts").delete().eq("id", shiftId);
  if (error) throw fromDbError(error);
  await markChanged(s.week_id);
  revalidatePath("/schedule");
  return { status: "success", message: "Shift removed" };
});

export const copyPreviousWeek = action(z.object({ week: zDate }), async ({ week }) => {
  const app = await getContext();
  const target = await ensureWeek(app, week);
  const prevStart = addDays(weekStart(week), -7);
  const { data: prev } = await app.supabase.from("schedule_weeks").select("id").eq("location_id", app.location.id).eq("week_start", prevStart).maybeSingle();
  if (!prev) throw new UserError("There is no schedule for the previous week.");
  const shifts = must(await app.supabase.from("shifts").select("staff_id, role, shift_date, start_time, end_time, notes").eq("week_id", prev.id)) as { staff_id: string | null; role: string; shift_date: string; start_time: string; end_time: string; notes: string | null }[];
  if (!shifts.length) throw new UserError("The previous week has no shifts.");
  const copies = copyWeek(shifts.map((s, n) => ({ id: String(n), staffId: s.staff_id, role: s.role, date: s.shift_date, start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5), notes: s.notes })), 1, (s) => s.id);
  const rows = copies.map((c) => {
    // Local times are kept; UTC instants are recomputed, so a DST change between weeks is handled.
    const r = resolveShift(c, app.location.timezone);
    return { org_id: app.org.orgId, week_id: target.id, staff_id: c.staffId, role: c.role, shift_date: c.date, start_time: c.start, end_time: c.end, starts_at: r.startsAt.toISOString(), ends_at: r.endsAt.toISOString(), notes: c.notes ?? null };
  });
  const { error } = await createAdminClient().from("shifts").insert(rows);
  if (error) throw fromDbError(error);
  await markChanged(target.id);
  revalidatePath("/schedule");
  return { status: "success", message: `Copied ${rows.length} shift(s)` };
});

export const publishWeek = action(z.object({ week: zDate, version: z.string().regex(/^\d+$/) }), async ({ week, version }) => {
  const app = await getContext();
  const w = await ensureWeek(app, week);
  const shifts = must(await app.supabase.from("shifts").select("id, staff_id, role, shift_date, start_time, end_time, notes").eq("week_id", w.id).order("shift_date")) as { id: string; staff_id: string | null; role: string; shift_date: string; start_time: string; end_time: string; notes: string | null }[];
  const inputs: ShiftInput[] = shifts.map((s) => ({ id: s.id, staffId: s.staff_id, role: s.role, date: s.shift_date, start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5), notes: s.notes }));
  const overlaps = findOverlaps(inputs.map((s) => resolveShift(s, app.location.timezone)));
  if (overlaps.length) throw new UserError(`${overlaps.length} overlapping assignment(s). Fix them before publishing.`);
  const admin = createAdminClient();
  const { data: prevPub } = await admin.from("schedule_publications").select("shifts").eq("week_id", w.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const snapshot = inputs.map((s) => ({ id: s.id, staff_id: s.staffId, role: s.role, shift_date: s.date, start: s.start, end: s.end, notes: s.notes }));
  const nextVersion = w.published_version + 1;
  const res = await app.supabase.from("schedule_weeks").update({ status: "published", published_version: nextVersion, published_at: new Date().toISOString(), has_unpublished_changes: false, version: Number(version) }).eq("id", w.id).select("id");
  if (res.error) throw fromDbError(res.error);
  const { error } = await admin.from("schedule_publications").insert({ org_id: app.org.orgId, week_id: w.id, version: nextVersion, shifts: snapshot, published_by: app.user.id });
  if (error) throw fromDbError(error);

  // Tell each affected person about their own changes.
  const previous = ((prevPub?.shifts ?? []) as { id: string; staff_id: string | null; role: string; shift_date: string; start: string; end: string; notes: string | null }[]).map((s) => ({ id: s.id, staffId: s.staff_id, role: s.role, date: s.shift_date, start: s.start, end: s.end, notes: s.notes }));
  const changes = diffPublications(previous, inputs);
  const staffIds = [...new Set(changes.flatMap((c) => c.staffIds))];
  if (staffIds.length) {
    const { data: profiles } = await app.supabase.from("staff_profiles").select("user_id").in("id", staffIds).not("user_id", "is", null);
    await notify(app.org.orgId, (profiles ?? []).map((p: { user_id: string }) => p.user_id), {
      kind: "schedule.published",
      title: nextVersion === 1 ? `Schedule for week of ${weekStart(week)} is out` : `Your shifts changed for week of ${weekStart(week)}`,
      link: `/schedule?week=${weekStart(week)}`,
    });
  }
  revalidatePath("/schedule");
  return { status: "success", message: `Published (version ${nextVersion})` };
});

export const addStaff = action(z.object({ displayName: z.string().trim().min(1, "Name is required").max(80), defaultRole: z.string().trim().max(60).optional(), userId: z.string().optional() }), async (i) => {
  const app = await getContext();
  requirePerm(app, "schedule.publish");
  const userId = i.userId && /^[0-9a-f-]{36}$/.test(i.userId) ? i.userId : null;
  const res = await app.supabase.from("staff_profiles").insert({ org_id: app.org.orgId, display_name: i.displayName, default_role: i.defaultRole || null, user_id: userId });
  if (res.error) throw fromDbError(res.error);
  revalidatePath("/schedule");
  return { status: "success", message: "Staff added" };
});
