"use client";

import { useState } from "react";
import { ActionForm, fieldErrors, SubmitButton } from "@/components/forms";
import { Checkbox, Field, Select, TextArea } from "@/components/ui";
import { acknowledge, saveEntry, setResolved } from "./actions";

export interface EntryInitial {
  entryId: string;
  version: string;
  category: string;
  priority: string;
  title: string;
  body: string;
  visibility: string;
  isTask: boolean;
  assignedTo: string;
  dueDate: string;
  requiresAck: boolean;
}

export const BLANK_ENTRY: EntryInitial = { entryId: "", version: "", category: "handoff", priority: "normal", title: "", body: "", visibility: "all", isTask: false, assignedTo: "", dueDate: "", requiresAck: false };

export function EntryForm({ initial, members, canManage }: { initial: EntryInitial; members: { id: string; name: string }[]; canManage: boolean }) {
  const [isTask, setIsTask] = useState(initial.isTask);
  return (
    <ActionForm action={saveEntry}>
      {(s) => (
        <>
          <input type="hidden" name="entryId" value={initial.entryId} />
          <input type="hidden" name="version" value={initial.version} />
          <Field label="Title" name="title" defaultValue={initial.title} required errors={fieldErrors(s, "title")} />
          <TextArea label="Details" name="body" defaultValue={initial.body} hint="Keep guest names and personal details out of the bar book." />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Select label="Category" name="category" defaultValue={initial.category}>
              <option value="handoff">Shift handoff</option>
              <option value="shortage">Shortage / 86</option>
              <option value="prep">Prep needed</option>
              <option value="equipment">Equipment</option>
              <option value="event">Event</option>
              <option value="announcement">Announcement</option>
              <option value="other">Other</option>
            </Select>
            <Select label="Priority" name="priority" defaultValue={initial.priority}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </Select>
            <Select label="Who can see it" name="visibility" defaultValue={initial.visibility} disabled={!canManage}>
              <option value="all">Whole team</option>
              {canManage ? <option value="managers">Managers only</option> : null}
            </Select>
            {!canManage ? <input type="hidden" name="visibility" value="all" /> : null}
          </div>
          <Checkbox label="This is a task to follow up" name="isTask" checked={isTask} onChange={(e) => setIsTask(e.currentTarget.checked)} />
          {isTask ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Assign to" name="assignedTo" defaultValue={initial.assignedTo}>
                <option value="">Nobody yet</option>
                {members.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}
              </Select>
              <Field label="Due" name="dueDate" type="date" defaultValue={initial.dueDate} />
            </div>
          ) : null}
          <Checkbox label="Ask everyone to acknowledge" name="requiresAck" defaultChecked={initial.requiresAck} />
          <SubmitButton>{initial.entryId ? "Save changes" : "Post"}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ResolveForm({ entryId, version, resolved }: { entryId: string; version: number; resolved: boolean }) {
  return (
    <ActionForm action={setResolved}>
      <input type="hidden" name="entryId" value={entryId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="resolved" value={resolved ? "false" : "true"} />
      {!resolved ? <Field label="Resolution (optional)" name="resolution" /> : null}
      <SubmitButton variant={resolved ? "secondary" : "primary"}>{resolved ? "Reopen" : "Mark resolved"}</SubmitButton>
    </ActionForm>
  );
}

export function AckForm({ entryId }: { entryId: string }) {
  return (
    <ActionForm action={acknowledge}>
      <input type="hidden" name="entryId" value={entryId} />
      <SubmitButton pendingText="…">I&apos;ve read this</SubmitButton>
    </ActionForm>
  );
}
