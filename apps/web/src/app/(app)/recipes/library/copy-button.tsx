"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { copyTemplate } from "../actions";

export function CopyTemplateButton({ templateId }: { templateId: string }) {
  return (
    <ActionForm action={copyTemplate} className="space-y-0">
      <input type="hidden" name="templateId" value={templateId} />
      <SubmitButton variant="secondary" pendingText="Copying…">Copy</SubmitButton>
    </ActionForm>
  );
}
