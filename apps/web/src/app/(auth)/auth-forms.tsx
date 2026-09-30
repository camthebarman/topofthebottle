"use client";

import { ActionForm, fieldErrors, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { sendMagicLink, signIn, signUp } from "./actions";

export function SignInForm({ next }: { next?: string }) {
  return (
    <ActionForm action={signIn} successMessage="Signed in">
      {(s) => (
        <>
          <input type="hidden" name="next" value={next ?? ""} />
          <Field label="Email" name="email" type="email" autoComplete="email" required errors={fieldErrors(s, "email")} />
          <Field label="Password" name="password" type="password" autoComplete="current-password" required errors={fieldErrors(s, "password")} />
          <SubmitButton className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function MagicLinkForm({ next }: { next?: string }) {
  return (
    <ActionForm action={sendMagicLink}>
      {(s) => (
        <>
          <input type="hidden" name="next" value={next ?? ""} />
          <Field label="Email" name="email" type="email" autoComplete="email" required errors={fieldErrors(s, "email")} />
          <SubmitButton variant="secondary" className="w-full" pendingText="Sending…">Email me a sign-in link</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function SignUpForm({ next }: { next?: string }) {
  return (
    <ActionForm action={signUp}>
      {(s) => (
        <>
          <input type="hidden" name="next" value={next ?? ""} />
          <Field label="Email" name="email" type="email" autoComplete="email" required errors={fieldErrors(s, "email")} />
          <Field label="Password" name="password" type="password" autoComplete="new-password" minLength={10} required hint="At least 10 characters." errors={fieldErrors(s, "password")} />
          <SubmitButton className="w-full" pendingText="Creating account…">Create account</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
