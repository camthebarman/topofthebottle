"use client";

import { useState } from "react";
import { ActionForm, fieldErrors, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { startTotp, verifyTotp } from "./actions";

export function TotpSetup() {
  const [enrol, setEnrol] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  if (!enrol) {
    return (
      <ActionForm<{ factorId: string; qr: string; secret: string }> action={startTotp} onSuccess={(s) => s.status === "success" && s.data && setEnrol(s.data)}>
        <SubmitButton pendingText="Starting…">Set up an authenticator app</SubmitButton>
      </ActionForm>
    );
  }
  return (
    <div className="space-y-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={enrol.qr} alt="QR code for your authenticator app" className="size-48 rounded bg-white p-2" />
      <p className="text-sm">Can&apos;t scan? Enter this key: <span className="break-all font-mono">{enrol.secret}</span></p>
      <ActionForm action={verifyTotp}>
        {(s) => (
          <>
            <input type="hidden" name="factorId" value={enrol.factorId} />
            <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" errors={fieldErrors(s, "code")} />
            <SubmitButton>Turn on</SubmitButton>
          </>
        )}
      </ActionForm>
    </div>
  );
}
