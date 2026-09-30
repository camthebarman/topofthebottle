import { EmptyState, LinkButton, ListLink, PageHeader } from "@/components/ui";
import { must } from "@/lib/action";
import { getContext } from "@/lib/session";

export const metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; archived?: string }> }) {
  const sp = await searchParams;
  const app = await getContext();
  let query = app.supabase.from("products").select("id, name, category, dimension, container_label, archived_at").eq("org_id", app.org.orgId).order("name").limit(500);
  query = sp.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (sp.q) query = query.ilike("name", `%${sp.q.replace(/[%_\\]/g, "\\$&")}%`);
  const products = must(await query) as { id: string; name: string; category: string; dimension: string; container_label: string | null }[];
  return (
    <>
      <PageHeader title="Products" description="Everything you stock and count." actions={app.can("catalog.edit") ? <LinkButton variant="primary" href="/inventory/products/new">Add product</LinkButton> : null} />
      <form role="search" className="mb-3">
        <label htmlFor="q" className="sr-only">Search products</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Search products" className="block min-h-11 w-full rounded-lg border border-border bg-surface px-3" />
      </form>
      {products.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {products.map((p) => (<ListLink key={p.id} href={`/inventory/products/${p.id}`} title={p.name} meta={`${p.category} · ${p.dimension}${p.container_label ? ` · ${p.container_label}` : ""}`} />))}
        </ul>
      ) : (
        <EmptyState title="No products found" />
      )}
    </>
  );
}
