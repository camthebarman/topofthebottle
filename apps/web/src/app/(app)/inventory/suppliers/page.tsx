import { Card, EmptyState, PageHeader } from "@/components/ui";
import { must } from "@/lib/action";
import { getContext } from "@/lib/session";
import { SupplierForm } from "../forms";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const app = await getContext();
  const suppliers = must(await app.supabase.from("suppliers").select("id, name, contact").eq("org_id", app.org.orgId).is("archived_at", null).order("name").limit(500)) as { id: string; name: string; contact: string | null }[];
  return (
    <>
      <PageHeader title="Suppliers" />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Your suppliers">
          {suppliers.length ? (
            <ul className="divide-y divide-border">
              {suppliers.map((s) => (<li key={s.id} className="py-2"><p className="font-medium">{s.name}</p>{s.contact ? <p className="text-sm text-muted">{s.contact}</p> : null}</li>))}
            </ul>
          ) : <EmptyState title="No suppliers yet" />}
        </Card>
        {app.can("catalog.edit") ? <Card title="Add supplier"><SupplierForm /></Card> : null}
      </div>
    </>
  );
}
