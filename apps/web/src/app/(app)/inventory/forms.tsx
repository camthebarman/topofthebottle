"use client";

import { useState } from "react";
import { ActionForm, ConfirmSubmit, fieldErrors, SubmitButton } from "@/components/forms";
import { Checkbox, Field, Select, TextArea } from "@/components/ui";
import {
  addConversion,
  addCost,
  addSupplierItem,
  deleteCountLine,
  finalizeCount,
  postTransfer,
  recordMovement,
  recordProduction,
  reverseMovement,
  saveCountLine,
  saveProduct,
  saveSupplier,
  startCount,
  voidCount,
} from "./actions";

type Dim = "volume" | "mass" | "count";
export interface UnitOpt {
  id: string;
  label: string;
  dimension: Dim;
}

const CATEGORIES = ["spirit", "liqueur", "wine", "beer", "mixer", "juice", "syrup", "garnish", "prep", "food", "consumable", "other"];

export interface ProductInitial {
  productId: string;
  version: string;
  name: string;
  category: string;
  dimension: Dim;
  containerQty: string;
  containerUnit: string;
  containerLabel: string;
  fullWeightG: string;
  emptyWeightG: string;
  usableYieldPct: string;
  countMethod: string;
  parQty: string;
}

export function ProductForm({ initial, units }: { initial: ProductInitial; units: UnitOpt[] }) {
  const [dim, setDim] = useState<Dim>(initial.dimension);
  const [method, setMethod] = useState(initial.countMethod);
  const dimUnits = units.filter((u) => u.dimension === dim);
  return (
    <ActionForm action={saveProduct}>
      {(s) => (
        <>
          <input type="hidden" name="productId" value={initial.productId} />
          <input type="hidden" name="version" value={initial.version} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" name="name" defaultValue={initial.name} required errors={fieldErrors(s, "name")} />
            <Select label="Category" name="category" defaultValue={initial.category}>
              {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
            </Select>
            <Select label="Measured by" name="dimension" value={dim} onChange={(e) => setDim(e.currentTarget.value as Dim)} hint="Volume and weight are never converted without a product-specific conversion.">
              <option value="volume">Volume (mL, L, fl oz)</option>
              <option value="mass">Weight (g, kg, oz, lb)</option>
              <option value="count">Count (each)</option>
            </Select>
            <Select label="Default count method" name="countMethod" value={method} onChange={(e) => setMethod(e.currentTarget.value)}>
              <option value="tenths">Full containers + tenths of the open one (estimate)</option>
              <option value="weight">Full containers + scale weight of the open one</option>
              <option value="full_units">Full containers only</option>
              <option value="measured">Measured quantity</option>
            </Select>
          </div>
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-1 text-sm font-semibold">Container (what you count)</legend>
            <Field label="Size" name="containerQty" inputMode="decimal" defaultValue={initial.containerQty} placeholder="750" errors={fieldErrors(s, "containerQty")} />
            <Select label="Unit" name="containerUnit" defaultValue={initial.containerUnit || dimUnits[0]?.id}>
              {dimUnits.map((u) => (<option key={u.id} value={u.id}>{u.label}</option>))}
            </Select>
            <Field label="Container name" name="containerLabel" defaultValue={initial.containerLabel} placeholder="bottle, can, bag" />
          </fieldset>
          {method === "weight" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full container weight (g)" name="fullWeightG" inputMode="decimal" defaultValue={initial.fullWeightG} />
              <Field label="Empty container weight (g)" name="emptyWeightG" inputMode="decimal" defaultValue={initial.emptyWeightG} />
            </div>
          ) : (
            <>
              <input type="hidden" name="fullWeightG" value={initial.fullWeightG} />
              <input type="hidden" name="emptyWeightG" value={initial.emptyWeightG} />
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Usable yield %" name="usableYieldPct" inputMode="decimal" defaultValue={initial.usableYieldPct} placeholder="100" hint="For produce and trim. Blank means 100%." errors={fieldErrors(s, "usableYieldPct")} />
            <Field label="Par (containers) at this location" name="parQty" inputMode="decimal" defaultValue={initial.parQty} hint="Used for suggested orders." />
          </div>
          <SubmitButton>{initial.productId ? "Save product" : "Add product"}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function CostForm({ productId, units }: { productId: string; units: UnitOpt[] }) {
  return (
    <ActionForm action={addCost} resetOnSuccess>
      {(s) => (
        <>
          <input type="hidden" name="productId" value={productId} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Field label="Price" name="amount" inputMode="decimal" errors={fieldErrors(s, "amount")} />
            <Field label="Per quantity" name="perQty" inputMode="decimal" defaultValue="1" errors={fieldErrors(s, "perQty")} />
            <Select label="Unit" name="perUnit">
              {units.map((u) => (<option key={u.id} value={u.id}>{u.label}</option>))}
            </Select>
          </div>
          <Checkbox label="Only at this location" name="locationOnly" value="1" />
          <SubmitButton variant="secondary">Record cost</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ConversionForm({ productId, units }: { productId: string; units: UnitOpt[] }) {
  return (
    <ActionForm action={addConversion} resetOnSuccess>
      <input type="hidden" name="productId" value={productId} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Qty" name="fromQty" inputMode="decimal" defaultValue="1" />
        <Select label="Unit" name="fromUnit">{units.map((u) => (<option key={u.id} value={u.id}>{u.label}</option>))}</Select>
        <Field label="equals qty" name="toQty" inputMode="decimal" />
        <Select label="Unit" name="toUnit" defaultValue="ml">{units.map((u) => (<option key={u.id} value={u.id}>{u.label}</option>))}</Select>
      </div>
      <Field label="Note" name="note" placeholder="e.g. measured juice yield, Sept 2026" />
      <SubmitButton variant="secondary">Add conversion</SubmitButton>
    </ActionForm>
  );
}

export function SupplierItemForm({ productId, suppliers, units }: { productId: string; suppliers: { id: string; name: string }[]; units: UnitOpt[] }) {
  if (!suppliers.length) return <p className="text-sm text-muted">Add a supplier first.</p>;
  return (
    <ActionForm action={addSupplierItem} resetOnSuccess>
      {(s) => (
        <>
          <input type="hidden" name="productId" value={productId} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Select label="Supplier" name="supplierId">{suppliers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</Select>
            <Field label="Supplier SKU" name="sku" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Units per pack" name="unitsPerPack" inputMode="decimal" defaultValue="12" errors={fieldErrors(s, "unitsPerPack")} />
            <Field label="Unit size" name="unitQty" inputMode="decimal" defaultValue="750" errors={fieldErrors(s, "unitQty")} />
            <Select label="Unit" name="unitUnit">{units.map((u) => (<option key={u.id} value={u.id}>{u.label}</option>))}</Select>
          </div>
          <Field label="Pack name" name="packLabel" placeholder="case of 12" />
          <SubmitButton variant="secondary">Add pack size</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function SupplierForm() {
  return (
    <ActionForm action={saveSupplier} resetOnSuccess>
      {(s) => (
        <>
          <Field label="Supplier name" name="name" required errors={fieldErrors(s, "name")} />
          <Field label="Contact (rep, phone or email)" name="contact" />
          <SubmitButton>Add supplier</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function StartCountForm() {
  return (
    <ActionForm action={startCount}>
      <Field label="Name (optional)" name="name" placeholder="Monday close" />
      <SubmitButton>Start a count</SubmitButton>
    </ActionForm>
  );
}

export function CountLineForm({ sessionId, product, areas, units, current }: {
  sessionId: string;
  product: { id: string; name: string; dimension: Dim; method: string; containerLabel: string | null; hasContainer: boolean };
  areas: { id: string; name: string }[];
  units: UnitOpt[];
  current?: { method: string; fullUnits: string; tenths: string; grossWeightG: string };
}) {
  const [method, setMethod] = useState(current?.method ?? (product.hasContainer ? product.method : "measured"));
  return (
    <ActionForm action={saveCountLine} successMessage="Counted">
      {(s) => (
        <>
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="productId" value={product.id} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {areas.length ? (
              <Select label="Area" name="areaId" defaultValue="">
                <option value="">Whole location</option>
                {areas.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
              </Select>
            ) : null}
            <Select label="Method" name="method" value={method} onChange={(e) => setMethod(e.currentTarget.value)}>
              {product.hasContainer ? <option value="tenths">Tenths (estimate)</option> : null}
              {product.hasContainer ? <option value="weight">Scale</option> : null}
              {product.hasContainer ? <option value="full_units">Full only</option> : null}
              <option value="measured">Measured</option>
            </Select>
            {method !== "measured" || product.hasContainer ? (
              <Field label={`Full ${product.containerLabel ?? "containers"}`} name="fullUnits" inputMode="decimal" defaultValue={current?.fullUnits ?? ""} errors={fieldErrors(s, "fullUnits")} />
            ) : null}
            {method === "tenths" ? <Field label="Open one (0–10 tenths)" name="tenths" inputMode="decimal" defaultValue={current?.tenths ?? ""} errors={fieldErrors(s, "tenths")} /> : null}
            {method === "weight" ? <Field label="Open one on scale (g)" name="grossWeightG" inputMode="decimal" defaultValue={current?.grossWeightG ?? ""} /> : null}
            {method === "measured" ? (
              <>
                <Field label="Measured qty" name="measuredQty" inputMode="decimal" />
                <Select label="Unit" name="measuredUnit">{units.filter((u) => u.dimension === product.dimension).map((u) => (<option key={u.id} value={u.id}>{u.label}</option>))}</Select>
              </>
            ) : null}
          </div>
          <SubmitButton variant="secondary" pendingText="Saving…">Save count</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function DeleteCountLineForm({ lineId, sessionId }: { lineId: string; sessionId: string }) {
  return (
    <ActionForm action={deleteCountLine} className="space-y-0">
      <input type="hidden" name="lineId" value={lineId} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <SubmitButton variant="ghost" pendingText="…">Remove</SubmitButton>
    </ActionForm>
  );
}

export function FinalizeCountForm({ sessionId, version, uncounted }: { sessionId: string; version: number; uncounted: number }) {
  return (
    <ActionForm action={finalizeCount}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="version" value={version} />
      <ConfirmSubmit variant="primary" message={`Finalize this count? The book will be adjusted to match what was counted.${uncounted ? ` ${uncounted} stocked products were not counted and will keep their book quantity.` : ""}`}>
        Finalize count
      </ConfirmSubmit>
    </ActionForm>
  );
}

export function VoidCountForm({ sessionId, version }: { sessionId: string; version: number }) {
  return (
    <ActionForm action={voidCount}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="version" value={version} />
      <ConfirmSubmit variant="secondary" message="Discard this draft count? Nothing will be posted.">Discard draft</ConfirmSubmit>
    </ActionForm>
  );
}

export function MovementForm({ products, units, idempotencyKey, defaultType }: { products: { id: string; name: string; dimension: Dim; containerLabel: string | null }[]; units: UnitOpt[]; idempotencyKey: string; defaultType: string }) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [type, setType] = useState(defaultType);
  const product = products.find((p) => p.id === productId);
  return (
    <ActionForm action={recordMovement} resetOnSuccess successMessage="Recorded">
      {(s) => (
        <>
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <Select label="Type" name="type" value={type} onChange={(e) => setType(e.currentTarget.value)}>
            <option value="waste">Waste or spill</option>
            <option value="breakage">Breakage</option>
            <option value="supplier_return">Return to supplier</option>
            <option value="manual_adjustment">Adjustment (needs a reason)</option>
            <option value="opening_balance">Opening balance (starting stock)</option>
          </Select>
          <Select label="Product" name="productId" value={productId} onChange={(e) => setProductId(e.currentTarget.value)}>
            {products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Quantity" name="qty" inputMode="decimal" required errors={fieldErrors(s, "qty")} />
            <Select label="Unit" name="unit">
              {product?.containerLabel ? <option value="container">{product.containerLabel}</option> : null}
              {units.filter((u) => u.dimension === product?.dimension).map((u) => (<option key={u.id} value={u.id}>{u.label}</option>))}
            </Select>
          </div>
          {type === "manual_adjustment" ? (
            <Select label="Direction" name="direction" defaultValue="out">
              <option value="out">Remove stock</option>
              <option value="in">Add stock</option>
            </Select>
          ) : null}
          <TextArea label={type === "manual_adjustment" ? "Reason (required)" : "Note"} name="reason" />
          <p className="text-xs text-muted">Adjustments are shown separately in Insights and do not count as explained usage.</p>
          <SubmitButton>Record</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ReverseForm({ movementId, productId }: { movementId: string; productId?: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="text-sm text-accent underline min-h-11" onClick={() => setOpen(true)}>Reverse…</button>;
  return (
    <ActionForm action={reverseMovement} className="space-y-2">
      <input type="hidden" name="movementId" value={movementId} />
      {productId ? <input type="hidden" name="productId" value={productId} /> : null}
      <Field label="Why reverse it?" name="reason" required />
      <ConfirmSubmit message="Reverse this entry? A new entry cancels it; the original stays in the history.">Reverse entry</ConfirmSubmit>
    </ActionForm>
  );
}

export function TransferForm({ locations, products, units }: { locations: { id: string; name: string }[]; products: { id: string; name: string; dimension: Dim; containerLabel: string | null }[]; units: UnitOpt[] }) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const product = products.find((p) => p.id === productId);
  if (!locations.length) return <p className="text-sm text-muted">Add another location to transfer stock.</p>;
  return (
    <ActionForm action={postTransfer} resetOnSuccess>
      {(s) => (
        <>
          <Select label="To location" name="toLocationId">{locations.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}</Select>
          <Select label="Product" name="productId" value={productId} onChange={(e) => setProductId(e.currentTarget.value)}>{products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</Select>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Quantity" name="qty" inputMode="decimal" errors={fieldErrors(s, "qty")} />
            <Select label="Unit" name="unit">
              {product?.containerLabel ? <option value="container">{product.containerLabel}</option> : null}
              {units.filter((u) => u.dimension === product?.dimension).map((u) => (<option key={u.id} value={u.id}>{u.label}</option>))}
            </Select>
          </div>
          <Field label="Note" name="note" />
          <SubmitButton>Record transfer</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ProductionForm({ preps }: { preps: { id: string; name: string; yieldLabel: string }[] }) {
  if (!preps.length) return <p className="text-sm text-muted">No preparations are linked to a stocked product yet. Edit a prep recipe and choose “Stocked as”.</p>;
  return (
    <ActionForm action={recordProduction} resetOnSuccess>
      {(s) => (
        <>
          <Select label="Preparation" name="recipeId">{preps.map((p) => (<option key={p.id} value={p.id}>{p.name} ({p.yieldLabel} per batch)</option>))}</Select>
          <Field label="Batches made" name="batches" inputMode="decimal" defaultValue="1" errors={fieldErrors(s, "batches")} />
          <Field label="Note" name="note" />
          <p className="text-xs text-muted">Consumes the recipe&apos;s ingredients and adds the batch to stock in one step.</p>
          <SubmitButton>Record batch</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
