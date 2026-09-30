"use client";

import { useState } from "react";
import { ActionForm, ConfirmSubmit, fieldErrors, SubmitButton } from "@/components/forms";
import { Checkbox, Field, Select } from "@/components/ui";
import { mapIngredient, setArchived, setMenu } from "../actions";

export function MenuForm({ recipeId, onMenu, price, targetPct, section }: { recipeId: string; onMenu: boolean; price: string; targetPct: string; section: string }) {
  const [checked, setChecked] = useState(onMenu);
  return (
    <ActionForm action={setMenu}>
      {(s) => (
        <>
          <input type="hidden" name="recipeId" value={recipeId} />
          <input type="hidden" name="onMenu" value={checked ? "true" : "false"} />
          <Checkbox label="On the current menu" name="onMenuToggle" checked={checked} onChange={(e) => setChecked(e.currentTarget.checked)} hint="The dashboard and menu costing use the current menu. History keeps earlier menus." />
          {checked ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Selling price" name="price" inputMode="decimal" defaultValue={price} errors={fieldErrors(s, "price")} />
              <Field label="Target cost %" name="targetPct" inputMode="decimal" defaultValue={targetPct} placeholder="Default" errors={fieldErrors(s, "targetPct")} />
              <Field label="Menu section" name="section" defaultValue={section} />
            </div>
          ) : (
            <>
              <input type="hidden" name="price" value="" />
              <input type="hidden" name="targetPct" value="" />
            </>
          )}
          <SubmitButton>Save menu</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function MapIngredientForm({ recipeId, ingredientId, ingredientName, products }: { recipeId: string; ingredientId: string; ingredientName: string; products: { id: string; name: string; dimension: string }[] }) {
  return (
    <ActionForm action={mapIngredient} className="rounded-lg border border-border p-3">
      <input type="hidden" name="ingredientId" value={ingredientId} />
      <input type="hidden" name="recipeId" value={recipeId} />
      <Select label={`${ingredientName} is stocked as`} name="productId" id={`productId-${ingredientId}`} required defaultValue="">
        <option value="" disabled>Choose a product…</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>{p.name} ({p.dimension})</option>
        ))}
      </Select>
      <SubmitButton variant="secondary">Map</SubmitButton>
    </ActionForm>
  );
}

export function ArchiveForm({ recipeId, archived }: { recipeId: string; archived: boolean }) {
  return (
    <ActionForm action={setArchived}>
      <input type="hidden" name="recipeId" value={recipeId} />
      <input type="hidden" name="archived" value={archived ? "false" : "true"} />
      {archived ? (
        <SubmitButton variant="secondary">Restore recipe</SubmitButton>
      ) : (
        <ConfirmSubmit message="Archive this recipe? It leaves the current menu. Past sales still use it." variant="secondary">
          Archive recipe
        </ConfirmSubmit>
      )}
    </ActionForm>
  );
}
