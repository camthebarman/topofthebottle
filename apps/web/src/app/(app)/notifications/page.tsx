import Link from "next/link";
import { revalidatePath } from "next/cache";
import { EmptyState, PageHeader } from "@/components/ui";
import { dateLabel } from "@/lib/format";
import { getContext } from "@/lib/session";

export const metadata = { title: "Alerts" };

async function markAllRead() {
  "use server";
  const app = await getContext();
  await app.supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", app.user.id).eq("org_id", app.org.orgId).is("read_at", null);
  revalidatePath("/notifications");
}

export default async function NotificationsPage() {
  const app = await getContext();
  const { data } = await app.supabase.from("notifications").select("id, title, body, link, read_at, created_at").eq("org_id", app.org.orgId).order("created_at", { ascending: false }).limit(50);
  const rows = (data ?? []) as { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }[];
  return (
    <>
      <PageHeader title="Alerts" actions={rows.some((r) => !r.read_at) ? <form action={markAllRead}><button type="submit" className="min-h-11 rounded-lg border border-border px-4">Mark all read</button></form> : null} />
      {rows.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {rows.map((n) => (
            <li key={n.id} className="px-3 py-2">
              {n.link ? <Link className={`font-medium underline ${n.read_at ? "text-muted" : ""}`} href={n.link}>{n.title}</Link> : <p className="font-medium">{n.title}</p>}
              {n.body ? <p className="text-sm text-muted">{n.body}</p> : null}
              <p className="text-xs text-muted">{dateLabel(n.created_at, app.location.timezone)}</p>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="No alerts" />}
    </>
  );
}
