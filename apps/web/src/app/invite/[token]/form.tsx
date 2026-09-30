"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { acceptInvite } from "./actions";

export function AcceptInviteForm({ token }: { token: string }) {
  return (
    <ActionForm action={acceptInvite}>
      <input type="hidden" name="token" value={token} />
      <Field label="Your name (shown to your team)" name="displayName" autoComplete="name" />
      <SubmitButton className="w-full" pendingText="Joining…">Accept invitation</SubmitButton>
    </ActionForm>
  );
}
