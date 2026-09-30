import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { dateLabel } from "@/lib/format";
import { getContext } from "@/lib/session";
import { BLANK_ENTRY, EntryForm } from "./forms";
import { memberNames } from "./members";

export const metadata = { title: "Bar Book" };

interface Entry { id: string; title: string; category: string; priority: string; business_date: string; status: string; is_task: boolean; visibility: string; requires_ack: boolean; due_date: string | null; assigned_to: string | null; created_at: string }
const COLS = "id, title, category, priority, business_date, status, is_task, visibility, requires_ack, due_date, assigned_to, created_at";

function Row({ e, names, acked, me }: { e: Entry; names: Map<string, string>; acked: Set<string>; me: string }) {
  return (
    <li>
      <Link href={`/barbook/${e.id}`} className="block min-h-14 px-3 py-2 hover:bg-surface-2">
        <p className="font-medium">{e.priority === "high" ? "⚑ " : ""}{e.title}</p>
        <p className="flex flex-wrap items-center gap-1 text-sm text-muted">
          <span>{e.category}</span> · <span>{dateLabel(e.business_date)}</span>
          {e.is_task ? <Badge tone={e.status === "open" ? "warn" : "ok"}>{e.status === "open" ? "open task" : "resolved"}</Badge> : null}
          {e.assigned_to ? <span>· {e.assigned_to === me ? "assigned to you" : names.get(e.assigned_to) ?? "assigned"}</span> : null}
          {e.due_date ? <span>· due {dateLabel(e.due_date)}</span> : null}
          {e.visibility === "managers" ? <Badge tone="info">managers</Badge> : null}
          {e.requires_ack && !acked.has(e.id) ? <Badge tone="warn">please acknowledge</Badge> : null}
        </p>
      </Link>
    </li>
  );
}

export default async function BarBookPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const app = await getContext();
  const q = (sp.q ?? "").trim();
  let recentQ = app.supabase.from("barbook_entries").select(COLS).eq("location_id", app.location.id).order("business_date", { ascending: false }).order("created_at", { ascending: false }).limit(40);
  if (q) recentQ = recentQ.textSearch("search", q, { type: "websearch", config: "english" });
  const [open, recent, acks, names] = await Promise.all([
    app.supabase.from("barbook_entries").select(COLS).eq("location_id", app.location.id).eq("status", "open").eq("is_task", true).order("due_date", { ascending: true, nullsFirst: false }).limit(50),
    recentQ,
    app.supabase.from("barbook_acks").select("entry_id").eq("user_id", app.user.id),
    memberNames(app),
  ]);
  const acked = new Set((acks.data ?? []).map((a: { entry_id: string }) => a.entry_id));
  const nameMap = new Map(names.map((n) => [n.id, n.name]));
  const openRows = (open.data ?? []) as Entry[];
  const recentRows = ((recent.data ?? []) as Entry[]).filter((e) => q || !(e.is_task && e.status === "open"));
  return (
    <>
      <PageHeader title="Bar Book" description="Handoffs, shortages and follow-ups for the team. Open tasks carry forward until resolved." />
      <div className="space-y-4">
        {app.can("barbook.write") ? (
          <details className="rounded-xl border border-border bg-surface p-4">
            <summary className="min-h-11 cursor-pointer py-2 text-lg font-semibold">Write an entry</summary>
            <div className="mt-3"><EntryForm initial={BLANK_ENTRY} members={names} canManage={app.can("barbook.manage")} draftScope={`${app.user.id}:${app.org.orgId}:${app.location.id}`} /></div>
          </details>
        ) : null}
        <form role="search">
          <label htmlFor="q" className="sr-only">Search the bar book</label>
          <input id="q" name="q" defaultValue={q} placeholder="Search the bar book" className="block min-h-11 w-full rounded-lg border border-border bg-surface px-3" />
        </form>
        {!q ? (
          <Card title={`Open tasks (${openRows.length})`}>
            {openRows.length ? <ul className="-mx-3 divide-y divide-border">{openRows.map((e) => <Row key={e.id} e={e} names={nameMap} acked={acked} me={app.user.id} />)}</ul> : <p className="text-sm text-muted">Nothing open.</p>}
          </Card>
        ) : null}
        <Card title={q ? `Results for “${q}”` : "Recent"}>
          {recentRows.length ? <ul className="-mx-3 divide-y divide-border">{recentRows.map((e) => <Row key={e.id} e={e} names={nameMap} acked={acked} me={app.user.id} />)}</ul> : <EmptyState title={q ? "No matches" : "No entries yet"} />}
        </Card>
      </div>
    </>
  );
}
