import { Card } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { StepUpForm } from "./form";

export const metadata = { title: "Two-factor check" };

export default async function MfaPage() {
  await requireUser();
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-10">
      <Card title="Enter your authenticator code"><StepUpForm /></Card>
    </main>
  );
}
