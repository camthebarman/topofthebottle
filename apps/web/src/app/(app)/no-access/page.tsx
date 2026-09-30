import { EmptyState, LinkButton } from "@/components/ui";

const LABELS: Record<string, string> = {
  "costs.view": "see costs", "catalog.edit": "edit products", "recipes.edit": "edit recipes", "menu.edit": "change the menu",
  "inventory.move": "record stock changes", "invoices.upload": "work with invoices", "imports.manage": "import sales",
  "insights.view": "see Insights", "schedule.publish": "edit the schedule", "events.manage": "plan events",
  "members.manage": "manage the team", "billing.manage": "manage billing", "data.export": "export data", "audit.view": "read the audit log",
};

export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const { need } = await searchParams;
  return (
    <EmptyState title="Not available with your role" action={<LinkButton href="/today">Back to Today</LinkButton>}>
      {need && LABELS[need] ? `Your role cannot ${LABELS[need]}. Ask an owner or manager if you need it.` : "Ask an owner or manager if you need access."}
    </EmptyState>
  );
}
