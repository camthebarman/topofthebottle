import { Badge, Card, PageHeader } from "@/components/ui";
import { dateLabel } from "@/lib/format";
import { getContext, pagePerm } from "@/lib/session";
import { InviteForm, MemberForm, RevokeInviteForm } from "../forms";

export const metadata = { title: "Team" };

export default async function MembersPage() {
  const app = await getContext();
  pagePerm(app, "members.manage");
  const [members, invites] = await Promise.all([
    app.supabase.from("memberships").select("user_id, role, status, display_name, location_ids, created_at").eq("org_id", app.org.orgId).order("created_at"),
    app.supabase.from("invitations").select("id, email, role, expires_at, accepted_at, revoked_at, created_at").eq("org_id", app.org.orgId).is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false }),
  ]);
  const isOwner = app.org.role === "owner";
  return (
    <>
      <PageHeader title="Team" description="Everyone with access to this organization." />
      <div className="space-y-4">
        <Card title="Invite someone"><InviteForm canInviteOwner={isOwner} /></Card>
        {(invites.data ?? []).length ? (
          <Card title="Pending invitations">
            <ul className="divide-y divide-border">
              {(invites.data as { id: string; email: string; role: string; expires_at: string }[]).map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{i.email} · {i.role}<span className="block text-xs text-muted">expires {dateLabel(i.expires_at, app.location.timezone)}</span></span>
                  <RevokeInviteForm id={i.id} />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        <Card title="Members">
          <ul className="space-y-3">
            {(members.data as { user_id: string; role: string; status: string; display_name: string | null; location_ids: string[] | null }[]).map((m) => (
              <li key={m.user_id} className="rounded-lg border border-border p-3">
                <p className="font-medium">{m.display_name || "Unnamed"} {m.user_id === app.user.id ? <Badge>you</Badge> : null} <Badge tone={m.status === "active" ? "ok" : "neutral"}>{m.status}</Badge></p>
                <p className="mb-2 text-sm text-muted">{m.role}{m.location_ids ? " · limited locations" : " · all locations"}</p>
                {m.user_id !== app.user.id && m.status === "active" ? <MemberForm userId={m.user_id} role={m.role} restricted={!!m.location_ids} canOwner={isOwner} /> : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
