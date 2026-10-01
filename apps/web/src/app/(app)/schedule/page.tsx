import Link from "next/link";
import { addDays, businessDate, dayOfWeek, findOverlaps, resolveShift, weekStart } from "@tz/domain";
import { Badge, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { dateLabel } from "@/lib/format";
import { getContext } from "@/lib/session";
import { memberNames } from "../barbook/members";
import { CopyWeekForm, DeleteShift, PublishForm, ShiftForm, StaffForm } from "./forms";

export const metadata = { title: "Schedule" };

interface Shift { id: string; staff_id: string | null; role: string; shift_date: string; start: string; end: string; notes: string | null }

function hours(start: string, end: string) {
  return end <= start ? `${start}–${end} (+1)` : `${start}–${end}`;
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  const app = await getContext();
  const today = businessDate(new Date(), app.location.timezone, app.location.businessDayCutoff);
  const ws = weekStart(sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const scheduler = app.can("schedule.publish");
  const [weekRes, staffRes, members, mine] = await Promise.all([
    app.supabase.from("schedule_weeks").select("id, status, version, published_version, published_at, has_unpublished_changes").eq("location_id", app.location.id).eq("week_start", ws).maybeSingle(),
    app.supabase.from("staff_profiles").select("id, display_name, default_role, user_id").eq("org_id", app.org.orgId).eq("active", true).order("display_name"),
    scheduler ? memberNames(app) : Promise.resolve([]),
    app.supabase.rpc("my_published_shifts", { p_org: app.org.orgId, p_from: ws, p_to: addDays(ws, 6) }),
  ]);
  const week = weekRes.data;
  const staff = (staffRes.data ?? []) as { id: string; display_name: string; default_role: string | null; user_id: string | null }[];
  const staffName = (id: string | null) => (id ? staff.find((s) => s.id === id)?.display_name ?? "Former staff" : "Open shift");

  let shifts: Shift[] = [];
  let source: "draft" | "published" | "none" = "none";
  if (week && scheduler) {
    const { data } = await app.supabase.from("shifts").select("id, staff_id, role, shift_date, start_time, end_time, notes").eq("week_id", week.id).order("shift_date").order("start_time");
    shifts = (data ?? []).map((s: { id: string; staff_id: string | null; role: string; shift_date: string; start_time: string; end_time: string; notes: string | null }) => ({ id: s.id, staff_id: s.staff_id, role: s.role, shift_date: s.shift_date, start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5), notes: s.notes }));
    source = "draft";
  } else if (week && app.can("schedule.view_team")) {
    const { data } = await app.supabase.from("schedule_publications").select("shifts").eq("week_id", week.id).order("version", { ascending: false }).limit(1).maybeSingle();
    shifts = ((data?.shifts ?? []) as Shift[]).sort((a, b) => (a.shift_date + a.start).localeCompare(b.shift_date + b.start));
    source = data ? "published" : "none";
  }
  const overlaps = findOverlaps(shifts.map((s) => resolveShift({ id: s.id, staffId: s.staff_id, role: s.role, date: s.shift_date, start: s.start, end: s.end }, app.location.timezone)));
  const overlapIds = new Set(overlaps.flatMap((o) => [o.a, o.b]));
  const myShifts = ((mine.data ?? []) as { shift: Shift }[]).map((m) => m.shift);

  return (
    <>
      <PageHeader title="Schedule" description={`${app.location.name} · week of ${dateLabel(ws)}`} />
      <nav aria-label="Weeks" className="mb-4 flex justify-between gap-2">
        <Link className="min-h-11 rounded-lg border border-border px-3 py-2" href={`/schedule?week=${addDays(ws, -7)}`}>← Previous</Link>
        <Link className="min-h-11 rounded-lg border border-border px-3 py-2" href="/schedule">This week</Link>
        <Link className="min-h-11 rounded-lg border border-border px-3 py-2" href={`/schedule?week=${addDays(ws, 7)}`}>Next →</Link>
      </nav>
      <div className="space-y-4">
        {myShifts.length ? (
          <Card title="Your shifts">
            <ul className="text-sm">{myShifts.map((s) => <li key={s.id} className="py-1">{dateLabel(s.shift_date)} · {hours(s.start, s.end)} · {s.role}</li>)}</ul>
          </Card>
        ) : null}
        {scheduler ? (
          <Card title="Week status">
            <p className="mb-3 text-sm">
              {!week ? "No schedule yet." : week.status === "draft" ? <Badge tone="warn">Draft — not visible to staff</Badge> : <><Badge tone="ok">Published v{week.published_version}</Badge> {week.has_unpublished_changes ? <Badge tone="warn">unpublished changes</Badge> : null}</>}
            </p>
            <div className="flex flex-wrap gap-2">
              <CopyWeekForm week={ws} />
              {week && (week.status === "draft" || week.has_unpublished_changes) ? <PublishForm week={ws} version={week.version} republish={week.status === "published"} overlaps={overlaps.length} /> : null}
            </div>
          </Card>
        ) : null}
        {overlaps.length ? <Notice tone="danger" role="alert" title="Overlapping assignments">{overlaps.map((o) => <p key={o.a + o.b}>{staffName(o.staffId)} is booked twice at the same time.</p>)}</Notice> : null}

        {source === "none" && !scheduler ? <EmptyState title="No published schedule for this week" /> : null}
        {days.map((d) => {
          const dayShifts = shifts.filter((s) => s.shift_date === d);
          if (!dayShifts.length && !scheduler) return null;
          return (
            <Card key={d} title={<span>{dateLabel(d)}{d === today ? " · today" : ""}</span>}>
              {dayShifts.length ? (
                <ul className="divide-y divide-border">
                  {dayShifts.map((s) => (
                    <li key={s.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${overlapIds.has(s.id) ? "text-danger" : ""}`}>
                      <div>
                        <p className="font-medium">{staffName(s.staff_id)}</p>
                        <p className="text-sm text-muted">{s.role} · {hours(s.start, s.end)}{s.notes ? ` · ${s.notes}` : ""}</p>
                      </div>
                      {scheduler && source === "draft" ? <DeleteShift shiftId={s.id} /> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">No shifts.</p>}
            </Card>
          );
        })}
        {scheduler ? (
          <>
            <Card title="Add a shift"><ShiftForm days={days.map((d) => ({ date: d, label: `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayOfWeek(d)]} ${d}` }))} staff={staff.map((s) => ({ id: s.id, name: s.display_name, role: s.default_role }))} /></Card>
            <Card title={`Staff (${staff.length})`}>
              <ul className="mb-3 text-sm">{staff.map((s) => <li key={s.id}>{s.display_name}{s.default_role ? ` · ${s.default_role}` : ""}{s.user_id ? " · has account" : ""}</li>)}</ul>
              <StaffForm members={members} />
            </Card>
          </>
        ) : null}
        <p className="text-xs text-muted">Times are local to {app.location.timezone}. Payroll, time clock and labour-law rules are not part of this schedule.</p>
      </div>
    </>
  );
}
