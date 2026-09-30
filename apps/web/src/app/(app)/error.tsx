"use client";

import { Button, EmptyState } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState title="Something went wrong" action={<Button onClick={() => reset()}>Try again</Button>}>
      Nothing was changed. If it keeps happening, share this reference with support: {error.digest ?? "n/a"}
    </EmptyState>
  );
}
