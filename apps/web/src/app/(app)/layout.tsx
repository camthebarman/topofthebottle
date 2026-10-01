import Link from "next/link";
import { SignOutButton } from "@/components/drafts";
import { BottomNav, SideNav } from "@/components/shell/nav";
import { buttonClass } from "@/components/ui";
import { getContext } from "@/lib/session";
import { signOut } from "../(auth)/actions";
import { switchContext } from "./context-actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const { count } = await ctx.supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null).eq("org_id", ctx.org.orgId);
  const options: { value: string; label: string }[] = [];
  for (const m of ctx.memberships) {
    if (m.orgId === ctx.org.orgId) for (const l of ctx.locations) options.push({ value: `${m.orgId}:${l.id}`, label: `${m.orgName} · ${l.name}` });
  }
  const others = ctx.memberships.filter((m) => m.orgId !== ctx.org.orgId);

  return (
    <div className="mx-auto flex min-h-dvh max-w-7xl gap-6 px-4 pb-24 pt-3 lg:px-6 lg:pb-8">
      <aside className="hidden w-56 shrink-0 lg:block print:hidden">
        <Link href="/today" className="mb-6 block px-3 pt-2 text-sm font-semibold uppercase tracking-widest text-accent">Table Zero Bar</Link>
        <SideNav />
      </aside>
      <div className="min-w-0 flex-1">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 print:hidden">
          <form action={switchContext} className="flex min-w-0 items-center gap-2">
            <label htmlFor="ctx-switch" className="sr-only">Organization and location</label>
            <select id="ctx-switch" name="target" defaultValue={`${ctx.org.orgId}:${ctx.location.id}`} className="min-h-11 max-w-[14rem] truncate rounded-lg border border-border bg-surface px-2 text-sm sm:max-w-xs">
              {options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
              {others.map((m) => (
                <option key={m.orgId} value={`${m.orgId}:00000000-0000-0000-0000-000000000000`}>{m.orgName}</option>
              ))}
            </select>
            <button type="submit" className={buttonClass("secondary", "min-h-11 px-3 text-sm")}>Switch</button>
          </form>
          <div className="flex items-center gap-1">
            <Link href="/notifications" className={buttonClass("ghost", "px-3 text-sm")} aria-label={`Notifications${count ? `, ${count} unread` : ""}`}>
              Alerts{count ? <span className="rounded-full bg-accent px-1.5 text-xs text-accent-fg">{count}</span> : null}
            </Link>
            <SignOutButton action={signOut} />
          </div>
        </header>
        {ctx.entitlement === "read_only" ? <p role="status" className="mb-3 rounded-lg border border-warn/50 bg-warn/10 p-2 text-sm">Subscription ended: read-only. <Link className="underline" href="/settings/billing">Billing</Link> · <Link className="underline" href="/settings/data">Export data</Link></p> : null}
        {ctx.entitlement === "grace" ? <p role="status" className="mb-3 rounded-lg border border-warn/50 bg-warn/10 p-2 text-sm">Payment needs attention. <Link className="underline" href="/settings/billing">Billing</Link></p> : null}
        <main id="main">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
