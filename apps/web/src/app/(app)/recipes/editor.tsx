"use client";

import { useState } from "react";
import { ActionForm, fieldErrors, SubmitButton } from "@/components/forms";
import { Button, Field, Select, TextArea } from "@/components/ui";
import { saveRecipe } from "./actions";

type Dim = "volume" | "mass" | "count";
export interface Option {
  value: string;
  label: string;
  dimension: Dim | "servings";
}

export interface UnitOption {
  id: string;
  label: string;
  dimension: Dim;
}

interface Row {
  key: number;
  ref: string;
  newName: string;
  newDimension: Dim;
  qty: string;
  unit: string;
  yieldPct: string;
}

export interface EditorInitial {
  recipeId: string;
  expectedVersion: string;
  name: string;
  kind: "drink" | "dish" | "prep";
  category: string;
  yieldMode: "servings" | "quantity";
  yieldServings: string;
  yieldQty: string;
  yieldUnit: string;
  producesProductId: string;
  glassware: string;
  method: string;
  garnish: string;
  batchInstructions: string;
  notes: string;
  rows: Omit<Row, "key">[];
}

const DEFAULT_UNIT: Record<Dim, string> = { volume: "ml", mass: "g", count: "each" };

export function RecipeEditor({ initial, ingredients, products, preps, units, prepProducts }: { initial: EditorInitial; ingredients: Option[]; products: Option[]; preps: Option[]; units: UnitOption[]; prepProducts: { id: string; name: string }[] }) {
  const [kind, setKind] = useState(initial.kind);
  const [yieldMode, setYieldMode] = useState(initial.yieldMode);
  const [rows, setRows] = useState<Row[]>(() => (initial.rows.length ? initial.rows : [{ ref: "", newName: "", newDimension: "volume" as Dim, qty: "", unit: "ml", yieldPct: "" }]).map((r, i) => ({ ...r, key: i })));
  const [nextKey, setNextKey] = useState(rows.length);
  const all = [...ingredients, ...products, ...preps];
  const dimOf = (r: Row): Dim | "servings" | null => (r.ref === "new" ? r.newDimension : (all.find((o) => o.value === r.ref)?.dimension ?? null));
  const unitsFor = (dim: Dim | "servings" | null) => (dim === "servings" ? units.filter((u) => u.id === "each") : dim ? units.filter((u) => u.dimension === dim) : units);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        const dim = dimOf(next);
        const allowed = unitsFor(dim).map((u) => u.id);
        if (!allowed.includes(next.unit)) next.unit = dim === "servings" ? "each" : dim ? DEFAULT_UNIT[dim] : next.unit;
        return next;
      }),
    );
  const add = () => {
    setRows((rs) => [...rs, { key: nextKey, ref: "", newName: "", newDimension: "volume", qty: "", unit: "ml", yieldPct: "" }]);
    setNextKey((k) => k + 1);
  };
  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  const move = (key: number, dir: -1 | 1) =>
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key);
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    });

  const serialized = JSON.stringify(rows.map(({ ref, newName, newDimension, qty, unit, yieldPct }) => ({ ref: ref || "missing", ...(ref === "new" ? { newName, newDimension } : {}), qty, unit, yieldPct })));

  return (
    <ActionForm action={saveRecipe} successMessage="Saved">
      {(s) => (
        <>
          <input type="hidden" name="recipeId" value={initial.recipeId} />
          <input type="hidden" name="expectedVersion" value={initial.expectedVersion} />
          <input type="hidden" name="components" value={serialized} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" name="name" defaultValue={initial.name} required errors={fieldErrors(s, "name")} />
            <Field label="Category" name="category" defaultValue={initial.category} placeholder="Stirred, Shaken, Syrup…" />
            <Select label="Type" name="kind" value={kind} onChange={(e) => { const k = e.currentTarget.value as EditorInitial["kind"]; setKind(k); if (k === "prep") setYieldMode("quantity"); }} disabled={!!initial.recipeId}>
              <option value="drink">Drink</option>
              <option value="dish">Food dish</option>
              <option value="prep">Preparation (syrup, juice, infusion, batch)</option>
            </Select>
            {initial.recipeId ? <input type="hidden" name="kind" value={kind} /> : null}
            <Select label="Yield" name="yieldMode" value={yieldMode} onChange={(e) => setYieldMode(e.currentTarget.value as "servings" | "quantity")}>
              <option value="servings">Servings per batch</option>
              <option value="quantity">Measured quantity (e.g. 1 L of syrup)</option>
            </Select>
            {yieldMode === "servings" ? (
              <Field label="Servings per batch" name="yieldServings" inputMode="decimal" defaultValue={initial.yieldServings || "1"} errors={fieldErrors(s, "yieldServings")} />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Batch yield" name="yieldQty" inputMode="decimal" defaultValue={initial.yieldQty} errors={fieldErrors(s, "yieldQty")} hint="Measure a real batch." />
                <Select label="Unit" name="yieldUnit" defaultValue={initial.yieldUnit || "ml"}>
                  {units.map((u) => (<option key={u.id} value={u.id}>{u.label}</option>))}
                </Select>
              </div>
            )}
            {kind === "prep" ? (
              <Select label="Stocked as (optional)" name="producesProductId" defaultValue={initial.producesProductId} hint="Link a product to count and batch this prep as stock.">
                <option value="">Not stocked (made to order)</option>
                {prepProducts.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </Select>
            ) : null}
          </div>

          <fieldset className="space-y-3">
            <legend className="text-lg font-semibold">Ingredients</legend>
            {rows.map((r, idx) => {
              const dim = dimOf(r);
              return (
                <div key={r.key} className="rounded-lg border border-border p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_7rem_8rem]">
                    <div>
                      <label className="text-sm font-medium" htmlFor={`ref-${r.key}`}>Ingredient {idx + 1}</label>
                      <select id={`ref-${r.key}`} className="block min-h-11 w-full rounded-lg border border-border bg-surface px-2" value={r.ref} onChange={(e) => update(r.key, { ref: e.currentTarget.value })}>
                        <option value="">Choose…</option>
                        <option value="new">+ New generic ingredient</option>
                        {ingredients.length ? <optgroup label="Generic ingredients">{ingredients.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}</optgroup> : null}
                        {preps.length ? <optgroup label="House preparations">{preps.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}</optgroup> : null}
                        {products.length ? <optgroup label="Specific products">{products.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}</optgroup> : null}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium" htmlFor={`qty-${r.key}`}>Qty</label>
                      <input id={`qty-${r.key}`} inputMode="decimal" className="block min-h-11 w-full rounded-lg border border-border bg-surface px-2" value={r.qty} onChange={(e) => update(r.key, { qty: e.currentTarget.value })} />
                    </div>
                    <div>
                      <label className="text-sm font-medium" htmlFor={`unit-${r.key}`}>Unit</label>
                      <select id={`unit-${r.key}`} className="block min-h-11 w-full rounded-lg border border-border bg-surface px-2" value={r.unit} onChange={(e) => update(r.key, { unit: e.currentTarget.value })}>
                        {unitsFor(dim).map((u) => (<option key={u.id} value={u.id}>{u.label}</option>))}
                      </select>
                    </div>
                  </div>
                  {r.ref === "new" ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className="text-sm font-medium" htmlFor={`new-${r.key}`}>New ingredient name</label>
                        <input id={`new-${r.key}`} className="block min-h-11 w-full rounded-lg border border-border bg-surface px-2" value={r.newName} onChange={(e) => update(r.key, { newName: e.currentTarget.value })} />
                      </div>
                      <div>
                        <label className="text-sm font-medium" htmlFor={`dim-${r.key}`}>Measured by</label>
                        <select id={`dim-${r.key}`} className="block min-h-11 w-full rounded-lg border border-border bg-surface px-2" value={r.newDimension} onChange={(e) => update(r.key, { newDimension: e.currentTarget.value as Dim })}>
                          <option value="volume">Volume</option>
                          <option value="mass">Weight</option>
                          <option value="count">Count</option>
                        </select>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    {kind !== "drink" ? (
                      <div className="w-40">
                        <label className="text-sm font-medium" htmlFor={`y-${r.key}`}>Usable yield % (trim)</label>
                        <input id={`y-${r.key}`} inputMode="decimal" placeholder="Product default" className="block min-h-11 w-full rounded-lg border border-border bg-surface px-2" value={r.yieldPct} onChange={(e) => update(r.key, { yieldPct: e.currentTarget.value })} />
                      </div>
                    ) : null}
                    <Button variant="ghost" onClick={() => move(r.key, -1)} aria-label={`Move ingredient ${idx + 1} up`}>↑</Button>
                    <Button variant="ghost" onClick={() => move(r.key, 1)} aria-label={`Move ingredient ${idx + 1} down`}>↓</Button>
                    <Button variant="ghost" onClick={() => remove(r.key)} aria-label={`Remove ingredient ${idx + 1}`}>Remove</Button>
                  </div>
                </div>
              );
            })}
            <Button variant="secondary" onClick={add}>Add ingredient</Button>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Glassware" name="glassware" defaultValue={initial.glassware} />
            <Field label="Garnish" name="garnish" defaultValue={initial.garnish} />
          </div>
          <TextArea label="Method" name="method" defaultValue={initial.method} />
          <TextArea label="Batch instructions" name="batchInstructions" defaultValue={initial.batchInstructions} />
          <TextArea label="Operational notes" name="notes" defaultValue={initial.notes} />
          <SubmitButton pendingText="Saving version…">{initial.recipeId ? "Save new version" : "Create recipe"}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
