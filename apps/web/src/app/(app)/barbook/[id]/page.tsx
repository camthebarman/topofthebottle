import { notFound } from "next/navigation";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { dateLabel } from "@/lib/format";
import { getContext } from "@/lib/session";
import { AckForm, EntryForm, ResolveForm } from "../forms";
import { memberNames } from "../members";

export default async function EntryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const app = await getContext();
  const { data: e } = await app.supabase.from("barbook_entries").select("*").eq("id", id).maybeSingle();
  if (!e) notFound();
  const [acks, revisions, names] = await Promise.all([
    app.supabase.from("barbook_acks").select("user_id, acked_at").eq("entry_id", id),
    app.supabase.from("barbook_revisions").select("id, editor_id, previous, created_at").eq("entry_id", id).order("created_at", { ascending: false }).limit(20),
    memberNames(app),
  ]);
  const nameOf = (u: string | null) => (u ? names.find((n) => n.id === u)?.name ?? "Former member" : "—");
  const ackRows = (acks.data ?? []) as { user_id: string; acked_at: string }[];
  const mine = ackRows.some((a) => a.user_id === app.user.id);
  const canEdit = e.author_id === app.user.id || app.can("barbook.manage");
  const canResolve = canEdit || e.assigned_to === app.user.id;
  return (
    <>
      <PageHeader title={e.title} description={<>{e.category} · {dateLabel(e.business_date)} · by {nameOf(e.author_id)} {e.visibility === "managers" ? <Badge tone="info">managers only</Badge> : null} {e.is_task ? <Badge tone={e.status === "open" ? "warn" : "ok"}>{e.status}</Badge> : null}</>} />
      <div className="space-y-4">
        {sp.saved ? <Notice tone="ok" role="status">Saved.</Notice> : null}
        <Card>
          <p className="whitespace-pre-line">{e.body || <span className="text-muted">No details.</span>}</p>
          {e.assigned_to ? <p className="mt-3 text-sm">Assigned to {nameOf(e.assigned_to)}{e.due_date ? `, due ${dateLabel(e.due_date)}` : ""}</p> : null}
          {e.status === "resolved" ? <p className="mt-2 text-sm text-ok">Resolved by {nameOf(e.resolved_by)} {dateLabel(e.resolved_at, app.location.timezone)}{e.resolution ? `: ${e.resolution}` : ""}</p> : null}
        </Card>
        {e.requires_ack ? (
          <Card title={`Acknowledged by ${ackRows.length}`}>
            <ul className="mb-3 text-sm">{ackRows.map((a) => <li key={a.user_id}>{nameOf(a.user_id)} · {dateLabel(a.acked_at, app.location.timezone)}</li>)}</ul>
            {!mine && app.can("barbook.write") ? <AckForm entryId={id} /> : mine ? <p className="text-sm text-ok">You acknowledged this.</p> : null}
          </Card>
        ) : null}
        {e.is_task && canResolve ? <Card title="Follow-up"><ResolveForm entryId={id} version={e.version} resolved={e.status === "resolved"} /></Card> : null}
        {canEdit ? (
          <details className="rounded-xl border border-border bg-surface p-4">
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">Edit</summary>
            <EntryForm members={names} canManage={app.can("barbook.manage")} initial={{ entryId: id, version: String(e.version), category: e.category, priority: e.priority, title: e.title, body: e.body, visibility: e.visibility, isTask: e.is_task, assignedTo: e.assigned_to ?? "", dueDate: e.due_date ?? "", requiresAck: e.requires_ack }} />
          </details>
        ) : null}
        {(revisions.data ?? []).length ? (
          <Card title="Edit history">
            <ul className="space-y-2 text-sm">
              {(revisions.data as { id: number; editor_id: string | null; previous: { title: string; body: string; status: string }; created_at: string }[]).map((r) => (
                <li key={r.id} className="rounded border border-border p-2">
                  <p className="text-xs text-muted">{dateLabel(r.created_at, app.location.timezone)} · changed by {nameOf(r.editor_id)}. Before:</p>
                  <p className="font-medium">{r.previous.title} <span className="text-xs text-muted">({r.previous.status})</span></p>
                  <p className="whitespace-pre-line text-muted">{r.previous.body}</p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
