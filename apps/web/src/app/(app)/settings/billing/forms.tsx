"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { openPortal, startCheckout } from "./actions";

export function CheckoutButton({ locations }: { locations: number }) {
  return (
    <ActionForm action={startCheckout}>
      <SubmitButton pendingText="Opening Stripe…">Subscribe for {locations} location{locations === 1 ? "" : "s"}</SubmitButton>
    </ActionForm>
  );
}

export function PortalButton() {
  return (
    <ActionForm action={openPortal}>
      <SubmitButton variant="secondary" pendingText="Opening Stripe…">Manage billing</SubmitButton>
    </ActionForm>
  );
}
