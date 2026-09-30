"use client";

import { ActionForm, fieldErrors, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { stepUp } from "./actions";

export function StepUpForm() {
  return (
    <ActionForm action={stepUp}>
      {(s) => (
        <>
          <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus errors={fieldErrors(s, "code")} />
          <SubmitButton>Continue</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
