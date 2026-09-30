"use client";

import { ActionForm, fieldErrors, SubmitButton } from "@/components/forms";
import { Field, Select } from "@/components/ui";
import { createOrganization } from "./actions";

export function OnboardingForm({ zones }: { zones: string[] }) {
  const guess = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/New_York";
  return (
    <ActionForm action={createOrganization}>
      {(s) => (
        <>
          <Field label="Business name" name="orgName" required errors={fieldErrors(s, "orgName")} />
          <Field label="First location" name="locationName" defaultValue="Main bar" required errors={fieldErrors(s, "locationName")} />
          <Select label="Time zone" name="timezone" defaultValue={zones.includes(guess) ? guess : "America/New_York"} hint="Used for business days, schedules and sales dates." errors={fieldErrors(s, "timezone")}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace("_", " ")}
              </option>
            ))}
          </Select>
          <Field label="Your name" name="displayName" autoComplete="name" errors={fieldErrors(s, "displayName")} />
          <SubmitButton className="w-full" pendingText="Creating…">Create</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
