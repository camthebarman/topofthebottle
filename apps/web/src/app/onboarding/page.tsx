import { Card } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { OnboardingForm } from "./form";

export const metadata = { title: "Set up your bar" };

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Toronto", "America/Vancouver", "Europe/London", "Europe/Dublin", "Australia/Sydney"];

export default async function OnboardingPage() {
  await requireUser();
  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-10">
      <h1 className="mb-2 text-2xl font-semibold">Set up your bar</h1>
      <p className="mb-6 text-sm text-muted">Create your organization and first location. You can add more locations and invite your team afterwards.</p>
      <Card>
        <OnboardingForm zones={ZONES} />
      </Card>
    </main>
  );
}
