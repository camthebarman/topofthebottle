import Link from "next/link";
import { addDays, businessDate, d } from "@tz/domain";
import { Badge, Card, LinkButton, Notice, PageHeader, Stat } from "@/components/ui";
import { dateLabel, money, pct } from "@/lib/format";
import { getContext } from "@/lib/session";
import { loadCatalog } from "@/server/catalog";
import { currentMenu, orgSettings, summarizeRecipe } from "@/server/menu";

export const metadata = { title: "Today" };

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const sp = await searchParams;
  const app = await getContext();
  const today = businessDate(new Date(), app.location.timezone, app.location.businessDayCutoff);
  const [cat, menu, settings, tasks, acks, ackNeeded, shifts, invoices, imports] = await Promise.all([
    loadCatalog(app),
    currentMenu(app),
    orgSettings(app),
    app.supabase.from("barbook_entries").select("id, title, priority, due_date, assigned_to").eq("location_id", app.location.id).eq("status", "open").eq("is_task", true).order("due_date", { ascending: true, nullsFirst: false }).limit(6),
    app.supabase.from("barbook_acks").select("entry_id").eq("user_id", app.user.id),
    app.supabase.from("barbook_entries").select("id, title").eq("location_id", app.location.id).eq("requires_ack", true).gte("business_date", addDays(today, -14)).limit(20),
    app.supabase.rpc("my_published_shifts", { p_org: app.org.orgId, p_from: today, p_to: today }),
    app.can("invoices.upload") ? app.supabase.from("invoices").select("id, status, receiving_status").eq("location_id", app.location.id).or("status.in.(needs_review,extraction_failed),and(status.eq.approved,receiving_status.in.(not_received,partial))").limit(50) : Promise.resolve({ data: [] }),
    app.can("imports.manage") ? app.supabase.from("pos_imports").select("id").eq("location_id", app.location.id).in("status", ["uploaded", "needs_review"]).limit(50) : Promise.resolve({ data: [] }),
  ]);
  const acked = new Set((acks.data ?? []).map((a: { entry_id: string }) => a.entry_id));
  const toAck = (ackNeeded.data ?? []).filter((e: { id: string }) => !acked.has(e.id)) as { id: string; title: string }[];
  const target = d(settings.target_cost_pct);
  const menuRows = menu.map((m) => ({ m, name: cat.recipeById.get(m.recipe_id)?.name ?? "?", s: summarizeRecipe(cat, m.recipe_id, m, target, settings.price_stale_days) }));
  const low = menuRows.filter((r) => r.s.raw.complete && (r.s.raw.servings ?? 0) <= 5 || (!r.s.raw.complete && r.s.raw.upperBound !== null && r.s.raw.upperBound <= 5));
  const incomplete = menuRows.filter((r) => !r.s.cost.complete);
  const costed = menuRows.filter((r) => r.s.metrics.costPct);
  const avgCost = costed.length ? costed.reduce((a, r) => a.plus(r.s.metrics.costPct!), d(0)).div(costed.length) : null;
  const myShift = ((shifts.data ?? []) as { shift: { start: string; end: string; role: string } }[])[0]?.shift;
  const empty = !cat.products.length && !cat.recipes.length;

  return (
    <>
      <PageHeader title="Today" description={`${app.location.name} · business day ${dateLabel(today)}`} />
      <div className="space-y-4">
        {sp.welcome || empty ? (
          <Card title="Getting started">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li><Link className="text-accent underline" href="/inventory/products/new">Add the products you stock</Link> with a cost.</li>
              <li><Link className="text-accent underline" href="/recipes/library">Copy a few classics</Link> or write your own recipes, and map their ingredients.</li>
              <li>Put recipes on the menu with a selling price.</li>
              <li><Link className="text-accent underline" href="/inventory/counts">Count your stock</Link>, then upload invoices and POS sales.</li>
              <li><Link className="text-accent underline" href="/settings/members">Invite your team.</Link></li>
            </ol>
          </Card>
        ) : null}
        {myShift ? <Notice tone="info">You work today: {myShift.start}–{myShift.end} · {myShift.role}</Notice> : null}
        {toAck.length ? <Notice tone="warn" title="Please read">{toAck.map((e) => <p key={e.id}><Link className="underline" href={`/barbook/${e.id}`}>{e.title}</Link></p>)}</Notice> : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="On the menu" value={menu.length} hint={incomplete.length ? `${incomplete.length} with incomplete cost` : undefined} tone={incomplete.length ? "warn" : undefined} />
          {app.can("costs.view") ? <Stat label="Avg ingredient cost" value={avgCost ? pct(avgCost) : "—"} hint={`target ${settings.target_cost_pct}% · ${costed.length} priced`} /> : null}
          <Stat label="Running low" value={low.length} hint="≤ 5 servings from stock" tone={low.length ? "warn" : undefined} />
          <Stat label="Open tasks" value={(tasks.data ?? []).length} />
        </div>

        {low.length ? (
          <Card title="Running low">
            <ul className="divide-y divide-border text-sm">
              {low.map((r) => <li key={r.m.id} className="flex justify-between py-1.5"><Link className="underline" href={`/recipes/${r.m.recipe_id}`}>{r.name}</Link><span>{r.s.raw.complete ? `${r.s.raw.servings} left` : `≤ ${r.s.raw.upperBound} (incomplete)`}</span></li>)}
            </ul>
          </Card>
        ) : null}

        <Card title="Open tasks" actions={<LinkButton href="/barbook">Bar Book</LinkButton>}>
          {(tasks.data ?? []).length ? (
            <ul className="divide-y divide-border text-sm">
              {(tasks.data as { id: string; title: string; priority: string; due_date: string | null; assigned_to: string | null }[]).map((t) => (
                <li key={t.id} className="flex justify-between gap-2 py-1.5"><Link className="underline" href={`/barbook/${t.id}`}>{t.priority === "high" ? "⚑ " : ""}{t.title}</Link>{t.assigned_to === app.user.id ? <Badge tone="info">yours</Badge> : t.due_date ? <span className="text-muted">{dateLabel(t.due_date)}</span> : null}</li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Nothing open.</p>}
        </Card>

        {(invoices.data ?? []).length || (imports.data ?? []).length ? (
          <Card title="Waiting on you">
            <ul className="space-y-1 text-sm">
              {(invoices.data ?? []).length ? <li><Link className="underline" href="/inventory/invoices">{(invoices.data ?? []).length} invoice(s) to review or receive</Link></li> : null}
              {(imports.data ?? []).length ? <li><Link className="underline" href="/imports">{(imports.data ?? []).length} POS import(s) to review</Link></li> : null}
            </ul>
          </Card>
        ) : null}

        {app.can("costs.view") && menuRows.length ? (
          <Card title="Menu costing" actions={<LinkButton href="/recipes">All</LinkButton>}>
            <ul className="divide-y divide-border text-sm">
              {menuRows.slice(0, 12).map((r) => (
                <li key={r.m.id} className="flex justify-between gap-2 py-1.5">
                  <Link className="underline" href={`/recipes/${r.m.recipe_id}`}>{r.name}</Link>
                  <span className="tabular">{r.s.cost.complete ? `${money(r.s.cost.total)} · ${pct(r.s.metrics.costPct)}` : <Badge tone="warn">incomplete</Badge>}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
