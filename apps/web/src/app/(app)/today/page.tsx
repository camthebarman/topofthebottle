import { PageHeader } from "@/components/ui";
import { getContext } from "@/lib/session";

export default async function TodayPage() {
  const ctx = await getContext();
  return <PageHeader title="Today" description={ctx.location.name} />;
}
