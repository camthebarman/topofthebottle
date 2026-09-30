"use client";

import { useState } from "react";
import { ActionForm, ConfirmSubmit, fieldErrors, SubmitButton } from "@/components/forms";
import { Checkbox, Field, Select } from "@/components/ui";
import { addArea, addLocation, cancelDeletion, invite, requestDeletion, revokeInvite, saveOrgSettings, updateLocation, updateMember } from "./actions";

export interface SettingsInitial {
  orgName: string;
  target_cost_pct: string;
  price_stale_days: number;
  valuation_method: string;
  freight_policy: string;
  tax_policy: string;
  variance_review_pct: string;
  min_sales_coverage_pct: string;
  void_prepared_consumes: boolean;
  comp_consumes: boolean;
  ai_insights_opt_in: boolean;
  ai_invoice_opt_in: boolean;
}

export function SettingsForm({ s: v, aiAvailable }: { s: SettingsInitial; aiAvailable: boolean }) {
  return (
    <ActionForm action={saveOrgSettings}>
      {(s) => (
        <>
          <Field label="Organization name" name="orgName" defaultValue={v.orgName} errors={fieldErrors(s, "orgName")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Target ingredient cost %" name="targetCostPct" inputMode="decimal" defaultValue={v.target_cost_pct} />
            <Field label="Warn when a cost is older than (days)" name="priceStaleDays" inputMode="numeric" defaultValue={String(v.price_stale_days)} />
            <Select label="Inventory valuation" name="valuationMethod" defaultValue={v.valuation_method}>
              <option value="moving_average">Moving average of receipts</option>
              <option value="last_cost">Last receipt cost</option>
            </Select>
            <Select label="Invoice freight" name="freightPolicy" defaultValue={v.freight_policy}>
              <option value="allocate_by_value">Spread into product cost by value</option>
              <option value="exclude">Leave out of product cost</option>
            </Select>
            <Select label="Invoice tax" name="taxPolicy" defaultValue={v.tax_policy}>
              <option value="exclude">Leave out (recoverable tax)</option>
              <option value="allocate_by_value">Include in product cost by value</option>
            </Select>
            <Field label="Flag variance above (% of accounted usage)" name="varianceReviewPct" inputMode="decimal" defaultValue={v.variance_review_pct} />
            <Field label="Minimum sales matched to recipes (%)" name="minSalesCoveragePct" inputMode="decimal" defaultValue={v.min_sales_coverage_pct} />
          </div>
          <Checkbox label="Voids marked as already made count as poured" name="voidPreparedConsumes" defaultChecked={v.void_prepared_consumes} />
          <Checkbox label="Comped drinks count as poured" name="compConsumes" defaultChecked={v.comp_consumes} />
          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold">AI features (off by default)</legend>
            {!aiAvailable ? <p className="text-sm text-muted">No AI provider is configured on this server, so these have no effect.</p> : null}
            <Checkbox label="Read uploaded invoice PDFs and photos automatically" name="aiInvoices" defaultChecked={v.ai_invoice_opt_in} hint="Sends the uploaded document to the AI provider. You still review and approve every line." />
            <Checkbox label="Offer AI explanations in Insights" name="aiInsights" defaultChecked={v.ai_insights_opt_in} hint="Sends computed figures and product names only; no staff, guest or note data." />
          </fieldset>
          <SubmitButton>Save settings</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function LocationForm({ zones, initial }: { zones: string[]; initial?: { id: string; name: string; timezone: string; cutoff: string } }) {
  const k = initial?.id ?? "new";
  return (
    <ActionForm action={initial ? updateLocation : addLocation} resetOnSuccess={!initial}>
      {initial ? <input type="hidden" name="locationId" value={initial.id} /> : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Name" name="name" id={`loc-name-${k}`} defaultValue={initial?.name} />
        <Select label="Time zone" name="timezone" id={`loc-tz-${k}`} defaultValue={initial?.timezone ?? "America/New_York"}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</Select>
        <Field label="Business day ends at" name="cutoff" id={`loc-cut-${k}`} type="time" defaultValue={initial?.cutoff ?? "04:00"} hint="Sales before this time belong to the previous day." />
      </div>
      <SubmitButton variant="secondary">{initial ? "Save location" : "Add location"}</SubmitButton>
    </ActionForm>
  );
}

export function AreaForm() {
  return (
    <ActionForm action={addArea} resetOnSuccess>
      <Field label="New storage area" name="name" placeholder="Back bar, walk-in, well" />
      <SubmitButton variant="secondary">Add area</SubmitButton>
    </ActionForm>
  );
}

export function InviteForm({ canInviteOwner }: { canInviteOwner: boolean }) {
  const [link, setLink] = useState<string | null>(null);
  return (
    <>
      <ActionForm<{ link: string }> action={invite} resetOnSuccess onSuccess={(st) => st.status === "success" && st.data && setLink(st.data.link)}>
        {(s) => (
          <>
            <Field label="Email" name="email" type="email" errors={fieldErrors(s, "email")} />
            <Select label="Role" name="role" defaultValue="bartender" hint="Bartenders count stock, write in the bar book and see the schedule. Managers do everything except billing and data export. Read-only sees reports.">
              <option value="bartender">Bartender</option>
              <option value="manager">Manager</option>
              <option value="read_only">Read-only</option>
              {canInviteOwner ? <option value="owner">Owner</option> : null}
            </Select>
            <Checkbox label="Only this location" name="thisLocationOnly" />
            <SubmitButton>Create invitation</SubmitButton>
          </>
        )}
      </ActionForm>
      {link ? (
        <div className="mt-3 rounded-lg border border-ok p-3 text-sm" role="status">
          <p className="font-medium">Send this link to them. It is shown only once and expires in 7 days.</p>
          <p className="mt-1 break-all font-mono text-xs">{link}</p>
        </div>
      ) : null}
    </>
  );
}

export function RevokeInviteForm({ id }: { id: string }) {
  return (
    <ActionForm action={revokeInvite} className="space-y-0">
      <input type="hidden" name="invitationId" value={id} />
      <ConfirmSubmit variant="secondary" message="Revoke this invitation?">Revoke</ConfirmSubmit>
    </ActionForm>
  );
}

export function MemberForm({ userId, role, restricted, canOwner }: { userId: string; role: string; restricted: boolean; canOwner: boolean }) {
  return (
    <ActionForm action={updateMember} className="space-y-2">
      <input type="hidden" name="userId" value={userId} />
      <div className="grid grid-cols-2 gap-2">
        <Select label="Role" name="role" id={`role-${userId}`} defaultValue={role}>
          <option value="bartender">Bartender</option>
          <option value="manager">Manager</option>
          <option value="read_only">Read-only</option>
          {canOwner || role === "owner" ? <option value="owner">Owner</option> : null}
        </Select>
        <Select label="Access" name="status" id={`status-${userId}`} defaultValue="active">
          <option value="active">Active</option>
          <option value="revoked">Remove access</option>
        </Select>
      </div>
      <Checkbox label="Only this location" name="thisLocationOnly" id={`loc-${userId}`} defaultChecked={restricted} />
      <SubmitButton variant="secondary">Save</SubmitButton>
    </ActionForm>
  );
}

export function DeletionForm({ orgName }: { orgName: string }) {
  return (
    <ActionForm action={requestDeletion}>
      <Field label={`Type “${orgName}” to schedule deletion`} name="confirm" />
      <ConfirmSubmit message="Schedule permanent deletion of this organization in 30 days?">Schedule deletion</ConfirmSubmit>
    </ActionForm>
  );
}

export function CancelDeletionForm({ id }: { id: string }) {
  return (
    <ActionForm action={cancelDeletion}>
      <input type="hidden" name="requestId" value={id} />
      <SubmitButton variant="secondary">Cancel deletion</SubmitButton>
    </ActionForm>
  );
}
