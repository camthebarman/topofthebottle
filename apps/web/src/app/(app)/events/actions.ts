"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { d, toBase } from "@tz/domain";
import { z } from "zod";
import { action, must, zUuid } from "@/lib/action";
import { fromDbError, UserError } from "@/lib/errors";
import { getContext, requirePerm } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { type EventRow, eventPlan, serializable } from "@/server/events";

const num = (max: number) => z.string().trim().regex(/^\d+(\.\d+)?$/, "Enter a number").refine((s) => Number(s) <= max, `At most ${max}`);

const eventSchema = z.object({
  eventId: z.union([zUuid, z.literal("")]),
  version: z.string().optional(),
  name: z.string().trim().min(1, "Name the event").max(160),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  startTime: z.string().regex(/^(\d{2}:\d{2})?$/).optional(),
  durationHours: num(24),
  guests: z.string().regex(/^\d+$/, "Whole number of guests"),
  participationPct: num(100),
  firstHourDrinks: num(20),
  laterHourDrinks: num(20),
  contingencyPct: num(100),
  mixCocktail: num(100),
  mixBeer: num(100),
  mixWine: num(100),
  mixNa: num(100),
  iceLb: num(20),
  chillIceLb: num(5),
  cupsPerDrink: num(5),
  napkinsPerDrink: num(10),
  otherCosts: z.string().max(5000).optional(),
  quoteMode: z.enum(["markup", "margin"]),
  quotePct: num(1000),
  notes: z.string().max(5000).optional(),
});

function parseOtherCosts(text: string | undefined): { label: string; amount: string }[] {
  if (!text?.trim()) return [];
  return text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 30).map((l) => {
    const m = /^(.*?)[,:]\s*\$?(\d+(?:\.\d+)?)$/.exec(l);
    if (!m) throw new UserError(`Other costs: use “label: amount” on each line (“${l.slice(0, 40)}”).`);
    return { label: m[1]!.trim().slice(0, 80) || "Cost", amount: m[2]! };
  });
}

export const saveEvent = action(eventSchema, async (i) => {
  const app = await getContext();
  requirePerm(app, "events.manage");
  const mixTotal = [i.mixCocktail, i.mixBeer, i.mixWine, i.mixNa].reduce((a, b) => a.plus(b), d(0));
  if (!mixTotal.eq(100)) throw new UserError(`Drink mix adds up to ${mixTotal.toFixed()}%; it must be 100%.`);
  const row = {
    name: i.name,
    event_date: i.eventDate,
    start_time: i.startTime || null,
    duration_hours: i.durationHours,
    guests: Number(i.guests),
    participation_pct: i.participationPct,
    first_hour_drinks: i.firstHourDrinks,
    later_hour_drinks: i.laterHourDrinks,
    contingency_pct: i.contingencyPct,
    mix: { cocktail: i.mixCocktail, beer: i.mixBeer, wine: i.mixWine, non_alcoholic: i.mixNa },
    consumables: { iceLbPerParticipant: i.iceLb, chillIceLbPerBottleDrink: i.chillIceLb, cupsPerDrink: i.cupsPerDrink, napkinsPerDrink: i.napkinsPerDrink },
    other_costs: parseOtherCosts(i.otherCosts),
    quote_mode: i.quoteMode,
    quote_pct: i.quotePct,
    notes: i.notes || null,
  };
  let id = i.eventId;
  if (id) {
    const res = await app.supabase.from("bev_events").update({ ...row, version: Number(i.version) }).eq("id", id).select("id");
    if (res.error) throw fromDbError(res.error);
    if (!res.data?.length) throw new UserError("Event not found.", "not_found");
  } else {
    id = (must(await app.supabase.from("bev_events").insert({ ...row, org_id: app.org.orgId, location_id: app.location.id, created_by: app.user.id }).select("id").single()) as { id: string }).id;
  }
  revalidatePath(`/events/${id}`);
  redirect(`/events/${id}?saved=1`);
});

export const setEventRecipe = action(
  z.object({ eventId: zUuid, recipeId: zUuid, category: z.enum(["cocktail", "beer", "wine", "non_alcoholic"]), sharePct: num(100), remove: z.string().optional() }),
  async (i) => {
    const app = await getContext();
    requirePerm(app, "events.manage");
    const { data: ev } = await app.supabase.from("bev_events").select("id").eq("id", i.eventId).maybeSingle();
    if (!ev) throw new UserError("Event not found.", "not_found");
    if (i.remove === "1") {
      const r = await app.supabase.from("bev_event_recipes").delete().eq("event_id", i.eventId).eq("recipe_id", i.recipeId);
      if (r.error) throw fromDbError(r.error);
    } else {
      if (Number(i.sharePct) <= 0) throw new UserError("Share must be above 0%.");
      const r = await app.supabase.from("bev_event_recipes").upsert({ org_id: app.org.orgId, event_id: i.eventId, recipe_id: i.recipeId, category: i.category, share_pct: i.sharePct }, { onConflict: "event_id,recipe_id" });
      if (r.error) throw fromDbError(r.error);
    }
    revalidatePath(`/events/${i.eventId}`);
    return { status: "success", message: i.remove === "1" ? "Removed" : "Saved" };
  },
);

export const freezeQuote = action(z.object({ eventId: zUuid, version: z.string().regex(/^\d+$/) }), async ({ eventId, version }) => {
  const app = await getContext();
  requirePerm(app, "events.manage");
  requirePerm(app, "costs.view");
  const ev = must(await app.supabase.from("bev_events").select("*").eq("id", eventId).single()) as EventRow;
  const plan = await eventPlan(app, ev, false);
  if (plan.demand.issues.length) throw new UserError(plan.demand.issues[0]!.message);
  if (plan.quote.price === null) throw new UserError(plan.quote.issues[0]?.message ?? "The quote cannot be calculated yet.");
  const { data: last } = await app.supabase.from("bev_event_quotes").select("version").eq("event_id", eventId).order("version", { ascending: false }).limit(1);
  const nextVersion = ((last?.[0]?.version as number | undefined) ?? 0) + 1;
  const snapshot = serializable({
    frozenAt: new Date().toISOString(),
    assumptions: plan.assumptions,
    consumableAssumptions: ev.consumables,
    demand: plan.demand,
    ingredients: plan.ingredients.lines,
    ingredientCost: plan.quote.ingredientCost,
    otherCosts: ev.other_costs,
    totalCost: plan.quote.totalCost,
    mode: plan.quote.mode,
    price: plan.quote.price?.toDecimalPlaces(2),
    costBasis: "Current product costs at the time of quoting",
  });
  const { error } = await createAdminClient().from("bev_event_quotes").insert({ org_id: app.org.orgId, event_id: eventId, version: nextVersion, snapshot, created_by: app.user.id });
  if (error) throw fromDbError(error);
  const res = await app.supabase.from("bev_events").update({ status: "quoted", version: Number(version) }).eq("id", eventId).select("id");
  if (res.error) throw fromDbError(res.error);
  revalidatePath(`/events/${eventId}`);
  return { status: "success", message: `Quote v${nextVersion} saved. Later cost changes will not alter it.` };
});

export const setEventStatus = action(z.object({ eventId: zUuid, version: z.string().regex(/^\d+$/), status: z.enum(["draft", "confirmed", "completed", "cancelled"]) }), async (i) => {
  const app = await getContext();
  requirePerm(app, "events.manage");
  const res = await app.supabase.from("bev_events").update({ status: i.status, version: Number(i.version) }).eq("id", i.eventId).select("id");
  if (res.error) throw fromDbError(res.error);
  revalidatePath(`/events/${i.eventId}`);
  return { status: "success", message: `Marked ${i.status}` };
});

/** Explicit stock action: send stock to, or bring it back from, the event. Plans never move stock. */
export const eventStock = action(
  z.object({ eventId: zUuid, productId: zUuid, direction: z.enum(["dispatch", "return"]), qty: z.string().regex(/^\d+(\.\d+)?$/, "Enter a quantity"), unit: z.string(), idempotencyKey: z.uuid() }),
  async (i) => {
    const app = await getContext();
    requirePerm(app, "events.manage");
    requirePerm(app, "inventory.move");
    const { data: ev } = await app.supabase.from("bev_events").select("name").eq("id", i.eventId).maybeSingle();
    if (!ev) throw new UserError("Event not found.", "not_found");
    const p = must(await app.supabase.from("products").select("dimension, container_size_base").eq("id", i.productId).single()) as { dimension: "volume" | "mass" | "count"; container_size_base: string | null };
    let base;
    if (i.unit === "container") {
      if (!p.container_size_base) throw new UserError("This product has no container size.");
      base = d(i.qty).times(p.container_size_base);
    } else {
      const c = toBase(i.qty, i.unit, p.dimension);
      if (!c.ok) throw new UserError(c.issue.message);
      base = c.value;
    }
    if (base.lte(0)) throw new UserError("Quantity must be above zero.");
    const { error } = await app.supabase.rpc("record_movement", {
      p_org: app.org.orgId,
      p_location: app.location.id,
      p_product: i.productId,
      p_type: i.direction === "dispatch" ? "event_dispatch" : "event_return",
      p_qty_base: (i.direction === "dispatch" ? base.negated() : base).toFixed(),
      p_occurred_at: new Date().toISOString(),
      p_reason: `Event: ${ev.name}`,
      p_idempotency_key: i.idempotencyKey,
    });
    if (error) throw fromDbError(error);
    revalidatePath(`/events/${i.eventId}`);
    return { status: "success", message: i.direction === "dispatch" ? "Sent to event" : "Returned to stock" };
  },
);
