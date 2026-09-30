"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/forms";
import { Checkbox, Field, Select } from "@/components/ui";
import { cancelImport, commitImport, mapItem, mapModifier, saveMappingAndValidate } from "./actions";

export const FIELD_LABELS: Record<string, string> = {
  business_date: "Business date",
  occurred_at: "Date and time",
  transaction_id: "Order / check id",
  line_id: "Line id",
  parent_line_id: "Parent line id (modifier rows)",
  item_id: "Item id / SKU",
  item_name: "Item name",
  category: "Category",
  modifiers: "Modifiers (in one cell)",
  quantity: "Quantity",
  gross_sales: "Gross sales",
  net_sales: "Net sales",
  discount: "Discount",
  void_flag: "Void flag",
  void_prepared_flag: "Void was prepared flag",
  comp_flag: "Comp flag",
  refund_flag: "Refund flag",
  location_ref: "Location",
};

interface Preset { id: string; name: string; columns: Record<string, string | undefined>; kind: string; dateFormat: string; headerSource: string }

export function MappingForm({ importId, headers, sensitive, profile, presets, suggested }: { importId: string; headers: string[]; sensitive: string[]; profile: { columns: Record<string, string | undefined>; kind: string; dateFormat: string; decimalSeparator: string; modifierSeparator?: string }; presets: Preset[]; suggested: string | null }) {
  const [presetId, setPresetId] = useState(suggested ?? "");
  const [cols, setCols] = useState<Record<string, string | undefined>>(profile.columns);
  const [kind, setKind] = useState(profile.kind);
  const [dateFormat, setDateFormat] = useState(profile.dateFormat);
  const preset = presets.find((p) => p.id === presetId);
  const choose = (id: string) => {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (p) {
      setCols(p.columns);
      setKind(p.kind);
      setDateFormat(p.dateFormat);
    }
  };
  const usable = headers.filter((h) => !sensitive.includes(h));
  return (
    <ActionForm action={saveMappingAndValidate}>
      <input type="hidden" name="importId" value={importId} />
      <input type="hidden" name="presetId" value={presetId} />
      {presets.length ? (
        <Select label="Format" name="presetChoice" value={presetId} onChange={(e) => choose(e.currentTarget.value)}>
          <option value="">Custom mapping</option>
          {presets.map((p) => (<option key={p.id} value={p.id}>{p.name} (not yet verified)</option>))}
        </Select>
      ) : null}
      {preset ? <p className="text-xs text-muted">{preset.headerSource}</p> : null}
      {sensitive.length ? <p className="text-sm text-muted">Not imported (personal or payment data): {sensitive.join(", ")}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Report type" name="kind" value={kind} onChange={(e) => setKind(e.currentTarget.value)} hint="Item-level exports support more analysis than summaries.">
          <option value="transactions">Item-level transactions</option>
          <option value="aggregate">Product mix summary (totals per item)</option>
        </Select>
        <Select label="Date format" name="dateFormat" value={dateFormat} onChange={(e) => setDateFormat(e.currentTarget.value)}>
          <option value="MM/DD/YYYY">MM/DD/YYYY</option>
          <option value="DD/MM/YYYY">DD/MM/YYYY</option>
          <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          <option value="ISO">ISO 8601 with time zone</option>
        </Select>
        <Select label="Decimal separator" name="decimalSeparator" defaultValue={profile.decimalSeparator}>
          <option value=".">1,234.56</option>
          <option value=",">1.234,56</option>
        </Select>
        <Field label="Modifier separator" name="modifierSeparator" defaultValue={profile.modifierSeparator ?? ";"} maxLength={3} />
      </div>
      {kind === "aggregate" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Report start" name="reportStart" type="date" hint="Needed when the file has no date column." />
          <Field label="Report end" name="reportEnd" type="date" />
          <Select label="If it overlaps an earlier report" name="overlapPolicy" defaultValue="reject">
            <option value="reject">Stop and ask me</option>
            <option value="replace">Replace the earlier report</option>
          </Select>
        </div>
      ) : <input type="hidden" name="overlapPolicy" value="reject" />}
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">Columns</legend>
        {Object.entries(FIELD_LABELS).map(([f, label]) => (
          <Select key={f} label={label} name={`col_${f}`} value={cols[f] ?? ""} onChange={(e) => { const v = e.currentTarget.value; setCols((c) => ({ ...c, [f]: v || undefined })); }}>
            <option value="">—</option>
            {usable.map((h) => (<option key={h} value={h}>{h}</option>))}
          </Select>
        ))}
      </fieldset>
      <SubmitButton pendingText="Starting…">Check the file</SubmitButton>
    </ActionForm>
  );
}

export function AutoRefresh({ everyMs = 2000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}

export function CommitForm({ importId, quarantined }: { importId: string; quarantined: number }) {
  return (
    <ActionForm action={commitImport}>
      <input type="hidden" name="importId" value={importId} />
      {quarantined ? <Checkbox label={`Import the valid rows and leave out the ${quarantined} rejected row(s)`} name="acceptPartial" hint="Rejected rows stay listed on this page with their reasons." /> : null}
      <ConfirmSubmit variant="primary" message="Import these sales? This is done in one step; duplicates are skipped.">Import sales</ConfirmSubmit>
    </ActionForm>
  );
}

export function CancelImportForm({ importId }: { importId: string }) {
  return (
    <ActionForm action={cancelImport}>
      <input type="hidden" name="importId" value={importId} />
      <ConfirmSubmit variant="secondary" message="Cancel this import? Nothing will be imported.">Cancel import</ConfirmSubmit>
    </ActionForm>
  );
}

export function MapItemForm({ itemKey, itemName, recipes, current, back }: { itemKey: string; itemName: string; recipes: { id: string; name: string }[]; current?: string; back?: string }) {
  return (
    <ActionForm action={mapItem} className="space-y-2">
      <input type="hidden" name="itemKey" value={itemKey} />
      <input type="hidden" name="itemName" value={itemName} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <Select label={itemName} name="target" id={`target-${itemKey}`} defaultValue={current ?? ""}>
          <option value="" disabled>Choose a recipe…</option>
          <option value="not_stock">Not a stock item (food, merch, fee)</option>
          {recipes.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
        </Select>
        <Field label="Servings" name="servingsPerUnit" id={`spu-${itemKey}`} inputMode="decimal" defaultValue="1" />
      </div>
      <SubmitButton variant="secondary">Map</SubmitButton>
    </ActionForm>
  );
}

export function MapModifierForm({ items, refs, units }: { items: { key: string; name: string }[]; refs: { value: string; label: string }[]; units: { id: string; label: string }[] }) {
  const [kind, setKind] = useState("ignore");
  return (
    <ActionForm action={mapModifier} resetOnSuccess>
      <Field label="Modifier name (as the POS prints it)" name="modifier" required />
      <Select label="Applies to" name="scopeItemKey" defaultValue="">
        <option value="">Every item</option>
        {items.map((i) => (<option key={i.key} value={i.key}>{i.name} only</option>))}
      </Select>
      <Select label="Effect on ingredients" name="kind" value={kind} onChange={(e) => setKind(e.currentTarget.value)}>
        <option value="ignore">No change (e.g. “rocks”, “up”)</option>
        <option value="scale">Multiply the recipe (e.g. double = 2)</option>
        <option value="add">Add an ingredient</option>
        <option value="substitute">Swap an ingredient (e.g. premium gin)</option>
      </Select>
      {kind === "scale" ? <Field label="Factor" name="factor" inputMode="decimal" defaultValue="2" /> : null}
      {kind === "add" ? (
        <div className="grid grid-cols-3 gap-2">
          <Select label="Ingredient" name="addRef">{refs.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}</Select>
          <Field label="Qty" name="addQty" inputMode="decimal" />
          <Select label="Unit" name="addUnit" defaultValue="ml">{units.map((u) => (<option key={u.id} value={u.id}>{u.label}</option>))}</Select>
        </div>
      ) : null}
      {kind === "substitute" ? (
        <div className="grid grid-cols-2 gap-2">
          <Select label="Replace" name="fromRef">{refs.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}</Select>
          <Select label="With" name="toRef">{refs.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}</Select>
        </div>
      ) : null}
      <SubmitButton>Save modifier</SubmitButton>
    </ActionForm>
  );
}
