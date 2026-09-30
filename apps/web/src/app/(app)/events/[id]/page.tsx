import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DRINK_CATEGORIES, UNITS } from "@tz/domain";
import { Badge, Card, DataList, LinkButton, Notice, PageHeader } from "@/components/ui";
import { must } from "@/lib/action";
import { dateLabel, money, num, qty } from "@/lib/format";
import { getContext, pagePerm } from "@/lib/session";
import { type EventRow, eventPlan } from "@/server/events";
import { EventForm, EventStockForm, FreezeQuoteForm, RecipeShareForm, StatusForm } from "../forms";

const CAT_LABEL: Record<string, string> = { cocktail: "Cocktails", beer: "Beer", wine: "Wine", non_alcoholic: "Non-alcoholic" };

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; stock?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const app = await getContext();
  pagePerm(app, "events.manage");
  const { data } = await app.supabase.from("bev_events").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const ev = data as EventRow;
  const useStock = sp.stock === "1";
  const plan = await eventPlan(app, ev, useStock);
  const quotes = must(await app.supabase.from("bev_event_quotes").select("version, created_at, snapshot").eq("event_id", id).order("version", { ascending: false }).limit(5)) as { version: number; created_at: string; snapshot: { price: string } }[];
  const recipes = plan.cat.recipes.filter((r) => r.kind !== "prep").map((r) => ({ id: r.id, name: r.name }));
  const canCost = app.can("costs.view");

  return (
    <>
      <PageHeader title={ev.name} description={<>{dateLabel(ev.event_date)}{ev.start_time ? ` · ${ev.start_time.slice(0, 5)}` : ""} · {ev.guests} guests · <Badge>{ev.status}</Badge></>} actions={<LinkButton href={`/events/${id}/sheet`}>Prep & packing sheet</LinkButton>} />
      <div className="space-y-4">
        {sp.saved ? <Notice tone="ok" role="status">Saved and recalculated.</Notice> : null}
        {plan.demand.issues.length ? <Notice tone="warn" title="Check the assumptions">{plan.demand.issues.map((i) => <p key={i.message}>{i.message}</p>)}</Notice> : null}

        <Card title="Drinks">
          <DataList items={[
            { label: "Expected (before contingency)", value: `${num(plan.demand.expectedDrinks, 1)} drinks` },
            { label: `Planned (+${num(ev.contingency_pct)}%)`, value: `${plan.demand.plannedDrinks} drinks` },
            ...DRINK_CATEGORIES.map((c) => ({ label: CAT_LABEL[c]!, value: `${plan.demand.byCategory[c]}${plan.demand.unassigned[c] ? " (no recipe chosen)" : ""}` })),
          ]} />
          <p className="mt-2 text-xs text-muted">Planning assumptions, not a prediction of what guests will drink. Totals by category and recipe always add up to the planned total.</p>
        </Card>

        <Card title="Menu for this event">
          <ul className="space-y-3">
            {plan.choices.map((c) => {
              const r = plan.demand.byRecipe.find((x) => x.recipeId === c.recipe_id);
              return (
                <li key={c.id} className="rounded-lg border border-border p-3">
                  <p className="font-medium">{plan.cat.recipeById.get(c.recipe_id)?.name} <span className="text-sm text-muted">· {r?.servings ?? 0} servings</span></p>
                  <RecipeShareForm eventId={id} recipes={recipes} current={{ recipeId: c.recipe_id, category: c.category, sharePct: String(Number(c.share_pct)) }} />
                </li>
              );
            })}
          </ul>
          {recipes.length ? <div className="mt-3"><RecipeShareForm eventId={id} recipes={recipes} /></div> : <p className="text-sm text-muted">Add recipes to your recipe book first.</p>}
        </Card>

        <Card title="Ingredients to source" actions={<Link className="min-h-11 py-2 text-sm text-accent underline" href={`/events/${id}?stock=${useStock ? "0" : "1"}`}>{useStock ? "Ignore current stock" : "Use current stock"}</Link>}>
          {plan.ingredients.lines.length ? (
            <ul className="divide-y divide-border text-sm">
              {plan.ingredients.lines.map((l) => {
                const p = plan.cat.productById.get(l.productId);
                return (
                  <li key={l.productId} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>{l.name}<span className="block text-xs text-muted">Needs {p ? qty(l.requiredBase, p.dimension) : num(l.requiredBase)}{useStock && l.onHandBase ? ` · in stock ${p ? qty(l.onHandBase, p.dimension) : ""}` : ""}</span></span>
                    <span className="tabular text-right">{l.packs !== null ? `${l.packs} × ${plan.packLabels.get(l.productId) ?? "pack"}` : "pack size unknown"}{canCost && l.purchaseCost ? <span className="block text-xs text-muted">{money(l.purchaseCost)}</span> : null}</span>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-sm text-muted">Choose recipes to see ingredients.</p>}
          {plan.ingredients.issues.length ? <ul className="mt-2 text-sm text-warn">{[...new Set(plan.ingredients.issues.map((i) => i.message))].map((m) => <li key={m}>{m}</li>)}</ul> : null}
          <p className="mt-2 text-xs text-muted">Beer and wine without a chosen recipe are not included; add them as recipes (e.g. “House lager, 12 oz”) to plan them.</p>
        </Card>

        <Card title="Ice and consumables">
          <DataList items={[
            { label: "Ice", value: `${plan.consumables.iceLb.toFixed()} lb` },
            { label: "Cups", value: plan.consumables.cups.toFixed() },
            { label: "Napkins", value: plan.consumables.napkins.toFixed() },
          ]} />
          <p className="mt-2 text-xs text-muted">From the assumptions above: {ev.consumables.iceLbPerParticipant} lb ice per drinker plus {ev.consumables.chillIceLbPerBottleDrink} lb per bottled drink for chilling.</p>
        </Card>

        {canCost ? (
          <Card title="Cost and quote estimate">
            <DataList items={[
              { label: "Ingredient cost (servings)", value: plan.quote.ingredientCost ? money(plan.quote.ingredientCost) : "Incomplete" },
              { label: "Purchase cost (whole packs)", value: money(plan.ingredients.lines.reduce((a, l) => a + (l.purchaseCost?.toNumber() ?? 0), 0)) },
              ...ev.other_costs.map((o) => ({ label: o.label, value: money(o.amount) })),
              { label: "Total estimated cost", value: plan.quote.totalCost ? money(plan.quote.totalCost) : "—" },
              { label: ev.quote_mode === "margin" ? `Price at ${num(ev.quote_pct)}% margin` : `Price at ${num(ev.quote_pct)}% markup`, value: plan.quote.price ? money(plan.quote.price) : "—" },
            ]} />
            <p className="mt-2 text-xs text-muted">An estimate for pricing, separate from the purchase list. Unused whole packs stay in stock. Quote snapshots freeze these numbers.</p>
            <div className="mt-3"><FreezeQuoteForm eventId={id} version={ev.version} /></div>
            {quotes.length ? <ul className="mt-3 text-sm">{quotes.map((q) => <li key={q.version}>Quote v{q.version} · {dateLabel(q.created_at, app.location.timezone)} · {money(q.snapshot.price)}</li>)}</ul> : null}
          </Card>
        ) : null}

        {app.can("inventory.move") ? (
          <Card title="Stock for this event">
            <p className="mb-2 text-sm text-muted">Record what actually leaves for the event and what comes back. Only these entries change stock.</p>
            <EventStockForm eventId={id} idempotencyKey={randomUUID()} products={plan.ingredients.lines.map((l) => ({ id: l.productId, name: l.name, containerLabel: plan.cat.productById.get(l.productId)?.container_label ?? null, dimension: plan.cat.productById.get(l.productId)?.dimension ?? "volume" }))} units={Object.values(UNITS).map((u) => ({ id: u.id, label: u.label, dimension: u.dimension }))} />
          </Card>
        ) : null}

        <Card title="Status"><StatusForm eventId={id} version={ev.version} status={ev.status} /></Card>

        <details className="rounded-xl border border-border bg-surface p-4">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">Edit assumptions</summary>
          <EventForm initial={{ eventId: id, version: String(ev.version), name: ev.name, eventDate: ev.event_date, startTime: ev.start_time?.slice(0, 5) ?? "", durationHours: String(Number(ev.duration_hours)), guests: String(ev.guests), participationPct: String(Number(ev.participation_pct)), firstHourDrinks: String(Number(ev.first_hour_drinks)), laterHourDrinks: String(Number(ev.later_hour_drinks)), contingencyPct: String(Number(ev.contingency_pct)), mix: { cocktail: String(ev.mix.cocktail), beer: String(ev.mix.beer), wine: String(ev.mix.wine), non_alcoholic: String(ev.mix.non_alcoholic) }, consumables: { iceLbPerParticipant: ev.consumables.iceLbPerParticipant ?? "1.5", chillIceLbPerBottleDrink: ev.consumables.chillIceLbPerBottleDrink ?? "0.25", cupsPerDrink: ev.consumables.cupsPerDrink ?? "1.2", napkinsPerDrink: ev.consumables.napkinsPerDrink ?? "1.5" }, otherCosts: ev.other_costs.map((o) => `${o.label}: ${o.amount}`).join("\n"), quoteMode: ev.quote_mode, quotePct: String(Number(ev.quote_pct)), notes: ev.notes ?? "" }} />
        </details>
        <a className="inline-block min-h-11 text-accent underline" href={`/events/${id}/export`}>Download purchase list (CSV)</a>
      </div>
    </>
  );
}
