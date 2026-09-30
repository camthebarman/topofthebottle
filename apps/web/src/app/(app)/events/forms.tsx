"use client";

import { ActionForm, ConfirmSubmit, fieldErrors, SubmitButton } from "@/components/forms";
import { Field, Select, TextArea } from "@/components/ui";
import { eventStock, freezeQuote, saveEvent, setEventRecipe, setEventStatus } from "./actions";

export interface EventInitial {
  eventId: string;
  version: string;
  name: string;
  eventDate: string;
  startTime: string;
  durationHours: string;
  guests: string;
  participationPct: string;
  firstHourDrinks: string;
  laterHourDrinks: string;
  contingencyPct: string;
  mix: { cocktail: string; beer: string; wine: string; non_alcoholic: string };
  consumables: { iceLbPerParticipant: string; chillIceLbPerBottleDrink: string; cupsPerDrink: string; napkinsPerDrink: string };
  otherCosts: string;
  quoteMode: string;
  quotePct: string;
  notes: string;
}

export function EventForm({ initial }: { initial: EventInitial }) {
  return (
    <ActionForm action={saveEvent}>
      {(s) => (
        <>
          <input type="hidden" name="eventId" value={initial.eventId} />
          <input type="hidden" name="version" value={initial.version} />
          <Field label="Event name" name="name" defaultValue={initial.name} errors={fieldErrors(s, "name")} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Date" name="eventDate" type="date" defaultValue={initial.eventDate} errors={fieldErrors(s, "eventDate")} />
            <Field label="Start" name="startTime" type="time" defaultValue={initial.startTime} />
            <Field label="Hours" name="durationHours" inputMode="decimal" defaultValue={initial.durationHours} errors={fieldErrors(s, "durationHours")} />
            <Field label="Guests" name="guests" inputMode="numeric" defaultValue={initial.guests} errors={fieldErrors(s, "guests")} />
          </div>
          <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <legend className="mb-1 text-sm font-semibold">Drinking assumptions (adjust to your crowd)</legend>
            <Field label="% of guests drinking" name="participationPct" inputMode="decimal" defaultValue={initial.participationPct} errors={fieldErrors(s, "participationPct")} />
            <Field label="Drinks, first hour" name="firstHourDrinks" inputMode="decimal" defaultValue={initial.firstHourDrinks} />
            <Field label="Drinks, each later hour" name="laterHourDrinks" inputMode="decimal" defaultValue={initial.laterHourDrinks} />
            <Field label="Contingency %" name="contingencyPct" inputMode="decimal" defaultValue={initial.contingencyPct} />
          </fieldset>
          <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <legend className="mb-1 text-sm font-semibold">Drink mix (must total 100%)</legend>
            <Field label="Cocktails %" name="mixCocktail" inputMode="decimal" defaultValue={initial.mix.cocktail} />
            <Field label="Beer %" name="mixBeer" inputMode="decimal" defaultValue={initial.mix.beer} />
            <Field label="Wine %" name="mixWine" inputMode="decimal" defaultValue={initial.mix.wine} />
            <Field label="Non-alcoholic %" name="mixNa" inputMode="decimal" defaultValue={initial.mix.non_alcoholic} />
          </fieldset>
          <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <legend className="mb-1 text-sm font-semibold">Ice and consumables (assumptions)</legend>
            <Field label="Ice lb / drinker" name="iceLb" inputMode="decimal" defaultValue={initial.consumables.iceLbPerParticipant} />
            <Field label="Chill ice lb / bottle drink" name="chillIceLb" inputMode="decimal" defaultValue={initial.consumables.chillIceLbPerBottleDrink} />
            <Field label="Cups / drink" name="cupsPerDrink" inputMode="decimal" defaultValue={initial.consumables.cupsPerDrink} />
            <Field label="Napkins / drink" name="napkinsPerDrink" inputMode="decimal" defaultValue={initial.consumables.napkinsPerDrink} />
          </fieldset>
          <TextArea label="Other costs (one per line, “label: amount”)" name="otherCosts" defaultValue={initial.otherCosts} placeholder={"Two bartenders: 320\nGlass rental: 90"} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Price by" name="quoteMode" defaultValue={initial.quoteMode} hint="Markup adds to cost; margin is the share of the price that is not cost.">
              <option value="margin">Target margin %</option>
              <option value="markup">Markup on cost %</option>
            </Select>
            <Field label="Percent" name="quotePct" inputMode="decimal" defaultValue={initial.quotePct} />
          </div>
          <TextArea label="Notes" name="notes" defaultValue={initial.notes} />
          <SubmitButton>{initial.eventId ? "Save and recalculate" : "Create event"}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function RecipeShareForm({ eventId, recipes, current }: { eventId: string; recipes: { id: string; name: string }[]; current?: { recipeId: string; category: string; sharePct: string } }) {
  return (
    <ActionForm action={setEventRecipe} resetOnSuccess={!current} className="space-y-2">
      <input type="hidden" name="eventId" value={eventId} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_9rem_6rem]">
        {current ? <input type="hidden" name="recipeId" value={current.recipeId} /> : (
          <Select label="Recipe" name="recipeId" id="add-recipe">{recipes.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}</Select>
        )}
        <Select label="Category" name="category" id={`cat-${current?.recipeId ?? "new"}`} defaultValue={current?.category ?? "cocktail"}>
          <option value="cocktail">Cocktail</option>
          <option value="beer">Beer</option>
          <option value="wine">Wine</option>
          <option value="non_alcoholic">Non-alcoholic</option>
        </Select>
        <Field label="Share of category %" name="sharePct" id={`share-${current?.recipeId ?? "new"}`} inputMode="decimal" defaultValue={current?.sharePct ?? "100"} />
      </div>
      <div className="flex gap-2">
        <SubmitButton variant="secondary">{current ? "Update" : "Add"}</SubmitButton>
        {current ? <button type="submit" name="remove" value="1" className="min-h-11 px-3 text-accent underline">Remove</button> : null}
      </div>
    </ActionForm>
  );
}

export function FreezeQuoteForm({ eventId, version }: { eventId: string; version: number }) {
  return (
    <ActionForm action={freezeQuote}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="version" value={version} />
      <ConfirmSubmit variant="primary" message="Save this quote? Its assumptions and costs are frozen as a snapshot.">Save quote snapshot</ConfirmSubmit>
    </ActionForm>
  );
}

export function StatusForm({ eventId, version, status }: { eventId: string; version: number; status: string }) {
  return (
    <ActionForm action={setEventStatus}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="version" value={version} />
      <Select label="Status" name="status" defaultValue={status === "quoted" ? "confirmed" : status}>
        <option value="draft">Draft</option>
        <option value="confirmed">Confirmed</option>
        <option value="completed">Completed</option>
        <option value="cancelled">Cancelled</option>
      </Select>
      <SubmitButton variant="secondary">Update status</SubmitButton>
    </ActionForm>
  );
}

export function EventStockForm({ eventId, products, units, idempotencyKey }: { eventId: string; products: { id: string; name: string; containerLabel: string | null; dimension: string }[]; units: { id: string; label: string; dimension: string }[]; idempotencyKey: string }) {
  return (
    <ActionForm action={eventStock} resetOnSuccess>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Select label="Direction" name="direction"><option value="dispatch">Send to event</option><option value="return">Bring back unused</option></Select>
      <Select label="Product" name="productId">{products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</Select>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Quantity" name="qty" inputMode="decimal" />
        <Select label="Unit" name="unit"><option value="container">containers</option>{units.map((u) => (<option key={u.id} value={u.id}>{u.label}</option>))}</Select>
      </div>
      <SubmitButton variant="secondary">Record</SubmitButton>
    </ActionForm>
  );
}
