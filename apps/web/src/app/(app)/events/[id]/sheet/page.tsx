import { notFound } from "next/navigation";
import { UNITS } from "@tz/domain";
import { dateLabel, num, qty } from "@/lib/format";
import { getContext, pagePerm } from "@/lib/session";
import { type EventRow, eventPlan } from "@/server/events";
import { PrintButton } from "./print-button";

export default async function SheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const app = await getContext();
  pagePerm(app, "events.manage");
  const { data } = await app.supabase.from("bev_events").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const ev = data as EventRow;
  const plan = await eventPlan(app, ev, true);
  return (
    <article className="mx-auto max-w-3xl space-y-6 bg-white p-4 text-black print:p-0">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{ev.name}</h1>
          <p>{dateLabel(ev.event_date)}{ev.start_time ? ` · ${ev.start_time.slice(0, 5)}` : ""} · {ev.guests} guests · {plan.demand.plannedDrinks} drinks planned</p>
        </div>
        <PrintButton />
      </header>
      <section>
        <h2 className="border-b border-black text-lg font-bold">Prep by drink</h2>
        <table className="w-full text-sm">
          <thead><tr><th className="text-left">Drink</th><th className="text-right">Servings</th><th className="text-left pl-3">Build per serving</th></tr></thead>
          <tbody>
            {plan.demand.byRecipe.map((r) => {
              const rv = plan.cat.ctx.recipes.get(r.recipeId);
              return (
                <tr key={r.recipeId} className="align-top border-b border-gray-300">
                  <td className="py-1">{rv?.name}</td>
                  <td className="py-1 text-right">{r.servings}</td>
                  <td className="py-1 pl-3">{rv?.components.map((c) => `${num(c.qty)} ${UNITS[c.unit]?.label ?? c.unit} ${c.ref.kind === "ingredient" ? plan.cat.ingredients.find((i) => i.id === c.ref.id)?.name : c.ref.kind === "product" ? plan.cat.productById.get(c.ref.id)?.name : plan.cat.recipeById.get(c.ref.id)?.name}`).join(", ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section>
        <h2 className="border-b border-black text-lg font-bold">Packing list</h2>
        <table className="w-full text-sm">
          <thead><tr><th className="text-left">☐</th><th className="text-left">Item</th><th className="text-right">Needed</th><th className="text-right">Buy</th></tr></thead>
          <tbody>
            {plan.ingredients.lines.map((l) => {
              const p = plan.cat.productById.get(l.productId);
              return <tr key={l.productId} className="border-b border-gray-300"><td>☐</td><td>{l.name}</td><td className="text-right">{p ? qty(l.requiredBase, p.dimension, p.container_size_base, p.container_label) : ""}</td><td className="text-right">{l.packs ? `${l.packs} × ${plan.packLabels.get(l.productId) ?? "pack"}` : "from stock"}</td></tr>;
            })}
            <tr className="border-b border-gray-300"><td>☐</td><td>Ice</td><td className="text-right">{plan.consumables.iceLb.toFixed()} lb</td><td /></tr>
            <tr className="border-b border-gray-300"><td>☐</td><td>Cups</td><td className="text-right">{plan.consumables.cups.toFixed()}</td><td /></tr>
            <tr className="border-b border-gray-300"><td>☐</td><td>Napkins</td><td className="text-right">{plan.consumables.napkins.toFixed()}</td><td /></tr>
          </tbody>
        </table>
      </section>
      <p className="text-xs">Quantities come from planning assumptions ({num(ev.participation_pct)}% drinking, {num(ev.first_hour_drinks)} drinks first hour, {num(ev.later_hour_drinks)} per later hour, +{num(ev.contingency_pct)}% contingency).</p>
    </article>
  );
}
