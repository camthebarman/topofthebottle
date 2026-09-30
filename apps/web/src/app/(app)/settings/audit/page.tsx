import { PageHeader, Pagination } from "@/components/ui";
import { dateLabel } from "@/lib/format";
import { getContext, pagePerm } from "@/lib/session";

export const metadata = { title: "Audit log" };
const PAGE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const app = await getContext();
  pagePerm(app, "audit.view");
  const [{ data }, { data: members }] = await Promise.all([
    app.supabase.from("audit_events").select("id, actor_id, action, entity_type, entity_id, data, created_at").eq("org_id", app.org.orgId).order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE),
    app.supabase.from("memberships").select("user_id, display_name").eq("org_id", app.org.orgId),
  ]);
  const names = new Map((members ?? []).map((m: { user_id: string; display_name: string | null }) => [m.user_id, m.display_name ?? "member"]));
  const rows = (data ?? []) as { id: number; actor_id: string | null; action: string; entity_type: string; data: Record<string, unknown>; created_at: string }[];
  return (
    <>
      <PageHeader title="Audit log" description="Recorded by the database. It cannot be edited or deleted from the app." />
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface text-sm">
        {rows.slice(0, PAGE).map((r) => (
          <li key={r.id} className="px-3 py-2">
            <p className="font-medium">{r.action}</p>
            <p className="text-xs text-muted">{dateLabel(r.created_at, app.location.timezone)} · {r.actor_id ? names.get(r.actor_id) ?? "former member" : "system"} · {r.entity_type}</p>
          </li>
        ))}
      </ul>
      <Pagination page={page} hasMore={rows.length > PAGE} makeHref={(p) => `/settings/audit?page=${p}`} />
    </>
  );
}
