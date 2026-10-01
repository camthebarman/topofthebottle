"use client";

import { useState } from "react";
import { ActionForm, ConfirmSubmit, fieldErrors, SubmitButton } from "@/components/forms";
import { Checkbox, Field, Select, TextArea } from "@/components/ui";
import { approveInvoice, deleteLine, receiveInvoice, rejectInvoice, retryExtraction, reverseInvoice, saveHeader, saveLine, startCorrection } from "../actions";

interface HeaderInitial {
  supplierId: string;
  supplierRaw: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  isCreditNote: boolean;
  subtotal: string;
  freight: string;
  deposits: string;
  tax: string;
  discount: string;
  total: string;
}

export function HeaderForm({ invoiceId, version, suppliers, initial, canAddSupplier }: { invoiceId: string; version: number; suppliers: { id: string; name: string }[]; initial: HeaderInitial; canAddSupplier: boolean }) {
  const [supplierId, setSupplierId] = useState(initial.supplierId);
  return (
    <ActionForm action={saveHeader}>
      {(s) => (
        <>
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <input type="hidden" name="version" value={version} />
          <Select label="Supplier" name="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.currentTarget.value)} hint={initial.supplierRaw && !initial.supplierId ? `Read from document: “${initial.supplierRaw}”` : undefined}>
            <option value="">{canAddSupplier ? "New supplier…" : "Choose…"}</option>
            {suppliers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
          </Select>
          {!supplierId && canAddSupplier ? <Field label="New supplier name" name="newSupplier" defaultValue={initial.supplierRaw} /> : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Invoice number" name="invoiceNumber" defaultValue={initial.invoiceNumber} />
            <Field label="Invoice date" name="invoiceDate" type="date" defaultValue={initial.invoiceDate} errors={fieldErrors(s, "invoiceDate")} />
            <Field label="Due date" name="dueDate" type="date" defaultValue={initial.dueDate} errors={fieldErrors(s, "dueDate")} />
          </div>
          <Checkbox label="This is a credit note" name="isCreditNote" defaultChecked={initial.isCreditNote} hint="Credit notes and returns use negative totals." />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(["subtotal", "freight", "deposits", "tax", "discount", "total"] as const).map((k) => (
              <Field key={k} label={k[0]!.toUpperCase() + k.slice(1)} name={k} inputMode="decimal" defaultValue={initial[k]} errors={fieldErrors(s, k)} />
            ))}
          </div>
          <SubmitButton variant="secondary">Save details</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

interface LineInitial {
  lineId: string;
  description: string;
  quantity: string;
  productId: string;
  unitsPerPack: string;
  unitSizeQty: string;
  unitSizeUnit: string;
  unitPrice: string;
  discount: string;
  lineTotal: string;
  depositPerPack: string;
}

export function LineForm({ invoiceId, products, units, initial }: { invoiceId: string; products: { id: string; name: string; dimension: string }[]; units: { id: string; label: string; dimension: string }[]; initial: LineInitial }) {
  const [productId, setProductId] = useState(initial.productId);
  const dim = products.find((p) => p.id === productId)?.dimension;
  const k = initial.lineId || "new";
  return (
    <>
      <ActionForm action={saveLine} successMessage="Saved">
        {(s) => (
          <>
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <input type="hidden" name="lineId" value={initial.lineId} />
            <Field label="Description" name="description" id={`description-${k}`} defaultValue={initial.description} errors={fieldErrors(s, "description")} />
            <Select label="Product" name="productId" id={`productId-${k}`} value={productId} onChange={(e) => setProductId(e.currentTarget.value)}>
              <option value="">Not matched</option>
              {products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </Select>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Field label="Qty billed" name="quantity" id={`quantity-${k}`} inputMode="decimal" defaultValue={initial.quantity} errors={fieldErrors(s, "quantity")} />
              <Field label="Units per pack" name="unitsPerPack" id={`unitsPerPack-${k}`} inputMode="decimal" defaultValue={initial.unitsPerPack} hint="12 for a case of 12" errors={fieldErrors(s, "unitsPerPack")} />
              <Field label="Unit size" name="unitSizeQty" id={`unitSizeQty-${k}`} inputMode="decimal" defaultValue={initial.unitSizeQty} />
              <Select label="Size unit" name="unitSizeUnit" id={`unitSizeUnit-${k}`} defaultValue={initial.unitSizeUnit}>
                {units.filter((u) => !dim || u.dimension === dim).map((u) => (<option key={u.id} value={u.id}>{u.label}</option>))}
              </Select>
              <Field label="Unit price" name="unitPrice" id={`unitPrice-${k}`} inputMode="decimal" defaultValue={initial.unitPrice} />
              <Field label="Line discount" name="discount" id={`discount-${k}`} inputMode="decimal" defaultValue={initial.discount} />
              <Field label="Line total" name="lineTotal" id={`lineTotal-${k}`} inputMode="decimal" defaultValue={initial.lineTotal} />
              <Field label="Deposit / pack" name="depositPerPack" id={`depositPerPack-${k}`} inputMode="decimal" defaultValue={initial.depositPerPack} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" name="decision" value="confirm" className="min-h-11 rounded-lg bg-accent px-4 font-medium text-accent-fg">Confirm line</button>
              <button type="submit" name="decision" value="not_stock" className="min-h-11 rounded-lg border border-border px-4">Not stock</button>
              <button type="submit" name="decision" value="save" className="min-h-11 rounded-lg px-4 text-accent underline">Save only</button>
            </div>
          </>
        )}
      </ActionForm>
      {initial.lineId ? (
        <ActionForm action={deleteLine} className="mt-1 space-y-0">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <input type="hidden" name="lineId" value={initial.lineId} />
          <ConfirmSubmit variant="secondary" message="Remove this line?">Remove line</ConfirmSubmit>
        </ActionForm>
      ) : null}
    </>
  );
}

export function ApproveForm({ invoiceId, version, duplicate, unresolved, balanced, isCreditNote }: { invoiceId: string; version: number; duplicate: boolean; unresolved: number; balanced: boolean; isCreditNote: boolean }) {
  return (
    <ActionForm action={approveInvoice}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="version" value={version} />
      {!balanced ? <p className="text-sm text-warn">Totals do not reconcile. Approve only if the invoice itself is like that.</p> : null}
      {unresolved ? <p className="text-sm text-danger">{unresolved} line(s) still need a decision before approval.</p> : null}
      {!isCreditNote ? <Checkbox label="Update product costs from this invoice" name="updateCosts" defaultChecked hint="Adds new cost history from the invoice date. Past reports keep the costs that applied then." /> : null}
      {duplicate ? <TextArea label="Why is this not a duplicate?" name="duplicateOverride" required /> : null}
      <ConfirmSubmit variant="primary" message="Approve this invoice? This records the purchase. Stock changes only when you confirm receiving.">Approve invoice</ConfirmSubmit>
    </ActionForm>
  );
}

export function ReceiveForm({ invoiceId, idempotencyKey, lines }: { invoiceId: string; idempotencyKey: string; lines: { id: string; description: string; billed: string; already: number; unit: string }[] }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(Math.max(0, Number(l.billed) - l.already))])));
  return (
    <ActionForm action={receiveInvoice}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="received" value={JSON.stringify(values)} />
      {lines.map((l) => (
        <div key={l.id} className="grid grid-cols-[1fr_7rem] items-end gap-2">
          <p className="text-sm">{l.description}<span className="block text-xs text-muted">Billed {l.billed} {l.unit}{l.already ? ` · already received ${l.already}` : ""}</span></p>
          <div>
            <label htmlFor={`rec-${l.id}`} className="text-sm font-medium">Received</label>
            <input id={`rec-${l.id}`} inputMode="decimal" className="block min-h-11 w-full rounded-lg border border-border bg-surface px-2" value={values[l.id] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [l.id]: e.currentTarget.value }))} />
          </div>
        </div>
      ))}
      <Field label="Received at (optional)" name="receivedAt" type="datetime-local" hint="Blank means now." />
      <Field label="Notes (damage, shorts)" name="notes" />
      <SubmitButton>Receive into stock</SubmitButton>
    </ActionForm>
  );
}

export function RejectForm({ invoiceId, version }: { invoiceId: string; version: number }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="min-h-11 rounded-lg border border-border px-4" onClick={() => setOpen(true)}>Reject…</button>;
  return (
    <ActionForm action={rejectInvoice} className="w-full rounded-lg border border-border p-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="version" value={version} />
      <Field label="Reason" name="reason" required />
      <ConfirmSubmit message="Reject this invoice? It will not be posted.">Reject invoice</ConfirmSubmit>
    </ActionForm>
  );
}

export function RetryForm({ invoiceId }: { invoiceId: string }) {
  return (
    <ActionForm action={retryExtraction} className="space-y-0">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <SubmitButton variant="secondary" pendingText="Queuing…">Read again</SubmitButton>
    </ActionForm>
  );
}

export function ReverseInvoiceForm({ invoiceId, version, receivedLines }: { invoiceId: string; version: number; receivedLines: number }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="min-h-11 rounded-lg border border-border px-4" onClick={() => setOpen(true)}>Reverse this invoice…</button>;
  return (
    <ActionForm action={reverseInvoice} className="space-y-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="version" value={version} />
      <p className="text-sm text-muted">Use this when the invoice was approved by mistake or with wrong figures. Costs it recorded stop applying from now; reports for earlier dates stay as they were. Nothing is deleted.</p>
      <Field label="Why reverse it?" name="reason" required />
      {receivedLines ? (
        <Checkbox label={`Also take the received stock back out (${receivedLines} receipt line${receivedLines === 1 ? "" : "s"})`} name="reverseReceipts" value="1" defaultChecked hint="Leave unticked if the goods really arrived and only the paperwork was wrong." />
      ) : null}
      <ConfirmSubmit message="Reverse this invoice? It will be kept in history, marked reversed.">Reverse invoice</ConfirmSubmit>
    </ActionForm>
  );
}

export function CorrectionForm({ invoiceId }: { invoiceId: string }) {
  return (
    <ActionForm action={startCorrection}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <SubmitButton variant="secondary" pendingText="Creating…">Start a corrected invoice</SubmitButton>
    </ActionForm>
  );
}
