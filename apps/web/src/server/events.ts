import "server-only";
import { consumables, d, type Decimal, DRINK_CATEGORIES, type DrinkCategory, type EventAssumptions, type PackInfo, planEventDemand, planIngredients, quote } from "@tz/domain";
import type { AppContext } from "@/lib/session";
import { loadCatalog } from "./catalog";

export interface EventRow {
  id: string;
  name: string;
  event_date: string;
  start_time: string | null;
  duration_hours: string;
  guests: number;
  participation_pct: string;
  first_hour_drinks: string;
  later_hour_drinks: string;
  contingency_pct: string;
  mix: Record<DrinkCategory, string | number>;
  consumables: Record<string, string>;
  other_costs: { label: string; amount: string }[];
  quote_mode: "markup" | "margin";
  quote_pct: string;
  status: string;
  notes: string | null;
  version: number;
}

export async function eventPlan(app: AppContext, ev: EventRow, useStock: boolean) {
  const [cat, choicesRes, itemsRes] = await Promise.all([
    loadCatalog(app),
    app.supabase.from("bev_event_recipes").select("id, recipe_id, category, share_pct").eq("event_id", ev.id),
    app.supabase.from("supplier_items").select("product_id, units_per_pack, unit_size_base, pack_label").eq("org_id", app.org.orgId),
  ]);
  const choices = (choicesRes.data ?? []) as { id: string; recipe_id: string; category: DrinkCategory; share_pct: string }[];
  const assumptions: EventAssumptions = {
    guests: ev.guests,
    participationPct: ev.participation_pct,
    durationHours: ev.duration_hours,
    firstHourDrinks: ev.first_hour_drinks,
    laterHourDrinks: ev.later_hour_drinks,
    contingencyPct: ev.contingency_pct,
    mix: Object.fromEntries(DRINK_CATEGORIES.map((c) => [c, String(ev.mix[c] ?? 0)])) as Record<DrinkCategory, string>,
  };
  const demand = planEventDemand(assumptions, choices.map((c) => ({ recipeId: c.recipe_id, category: c.category, sharePct: c.share_pct })));
  const packs = new Map<string, PackInfo>();
  const packLabels = new Map<string, string | null>();
  for (const i of (itemsRes.data ?? []) as { product_id: string; units_per_pack: string; unit_size_base: string; pack_label: string | null }[]) {
    if (packs.has(i.product_id)) continue;
    const base = d(i.units_per_pack).times(i.unit_size_base);
    const cpb = cat.canSeeCosts ? (cat.costs.get(i.product_id)?.costPerBase ?? null) : null;
    packs.set(i.product_id, { packBase: base, packCost: cpb ? cpb.times(base).toDecimalPlaces(2) : null });
    packLabels.set(i.product_id, i.pack_label);
  }
  // Products without a supplier pack fall back to their counting container.
  for (const p of cat.products) {
    if (!packs.has(p.id) && p.container_size_base) {
      const base = d(p.container_size_base);
      const cpb = cat.canSeeCosts ? (cat.costs.get(p.id)?.costPerBase ?? null) : null;
      packs.set(p.id, { packBase: base, packCost: cpb ? cpb.times(base).toDecimalPlaces(2) : null });
      packLabels.set(p.id, p.container_label);
    }
  }
  const ingredients = planIngredients(cat.ctx, demand.byRecipe, packs, useStock);
  const participants = d(ev.guests).times(ev.participation_pct).div(100);
  const cons = consumables(participants, demand, {
    iceLbPerParticipant: ev.consumables.iceLbPerParticipant ?? "1.5",
    chillIceLbPerBottleDrink: ev.consumables.chillIceLbPerBottleDrink ?? "0.25",
    cupsPerDrink: ev.consumables.cupsPerDrink ?? "1.2",
    napkinsPerDrink: ev.consumables.napkinsPerDrink ?? "1.5",
  });
  const q = quote(cat.canSeeCosts ? ingredients.ingredientCost : null, ev.other_costs.map((o) => o.amount), { kind: ev.quote_mode, pct: ev.quote_pct });
  return { cat, choices, assumptions, demand, ingredients, consumables: cons, quote: q, packLabels };
}

export function serializable(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (x instanceof Map ? Object.fromEntries(x) : x)));
}

export type Plan = Awaited<ReturnType<typeof eventPlan>>;
export type { Decimal };
