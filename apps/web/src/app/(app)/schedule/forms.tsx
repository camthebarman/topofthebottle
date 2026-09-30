"use client";

import { ActionForm, ConfirmSubmit, fieldErrors, SubmitButton } from "@/components/forms";
import { Field, Select } from "@/components/ui";
import { addShift, addStaff, copyPreviousWeek, deleteShift, publishWeek } from "./actions";

export function ShiftForm({ days, staff }: { days: { date: string; label: string }[]; staff: { id: string; name: string; role: string | null }[] }) {
  return (
    <ActionForm action={addShift} successMessage="Shift added">
      {(s) => (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Select label="Day" name="date">{days.map((d) => (<option key={d.date} value={d.date}>{d.label}</option>))}</Select>
            <Select label="Who" name="staffId" defaultValue="">
              <option value="">Open shift</option>
              {staff.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </Select>
            <Field label="Role" name="role" defaultValue="Bartender" errors={fieldErrors(s, "role")} />
            <Field label="Start" name="start" type="time" defaultValue="17:00" errors={fieldErrors(s, "start")} />
            <Field label="End" name="end" type="time" defaultValue="01:00" hint="Earlier than start = ends next day." errors={fieldErrors(s, "end")} />
            <Field label="Notes" name="notes" />
          </div>
          <SubmitButton>Add shift</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function DeleteShift({ shiftId }: { shiftId: string }) {
  return (
    <ActionForm action={deleteShift} className="space-y-0">
      <input type="hidden" name="shiftId" value={shiftId} />
      <ConfirmSubmit variant="secondary" message="Remove this shift?">Remove</ConfirmSubmit>
    </ActionForm>
  );
}

export function CopyWeekForm({ week }: { week: string }) {
  return (
    <ActionForm action={copyPreviousWeek}>
      <input type="hidden" name="week" value={week} />
      <SubmitButton variant="secondary" pendingText="Copying…">Copy last week</SubmitButton>
    </ActionForm>
  );
}

export function PublishForm({ week, version, republish, overlaps }: { week: string; version: number; republish: boolean; overlaps: number }) {
  return (
    <ActionForm action={publishWeek}>
      <input type="hidden" name="week" value={week} />
      <input type="hidden" name="version" value={version} />
      {overlaps ? <p className="text-sm text-danger">{overlaps} overlapping assignment(s) must be fixed first.</p> : null}
      <ConfirmSubmit variant="primary" message={republish ? "Publish the changes? Staff whose shifts changed get a notice." : "Publish this week? Your team will see it."}>{republish ? "Publish changes" : "Publish week"}</ConfirmSubmit>
    </ActionForm>
  );
}

export function StaffForm({ members }: { members: { id: string; name: string }[] }) {
  return (
    <ActionForm action={addStaff} resetOnSuccess>
      {(s) => (
        <>
          <Field label="Name" name="displayName" errors={fieldErrors(s, "displayName")} />
          <Field label="Usual role" name="defaultRole" placeholder="Bartender" />
          <Select label="Linked account (optional)" name="userId" defaultValue="" hint="Linked staff see their own shifts and get notices.">
            <option value="">No account</option>
            {members.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}
          </Select>
          <SubmitButton variant="secondary">Add staff</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
