import { randomUUID } from "node:crypto";
import { UNITS } from "@tz/domain";
import { Card, PageHeader } from "@/components/ui";
import { num } from "@/lib/format";
import { getContext, pagePerm } from "@/lib/session";
import { loadCatalog } from "@/server/catalog";
import { MovementForm, ProductionForm, TransferForm } from "../forms";
import { unitOptions } from "../units";

export const metadata = { title: "Record stock changes" };

export default async function RecordPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const sp = await searchParams;
  const app = await getContext();
  pagePerm(app, "inventory.move");
  const cat = await loadCatalog(app);
  const products = cat.products.filter((p) => !p.archived_at).map((p) => ({ id: p.id, name: p.name, dimension: p.dimension, containerLabel: p.container_size_base ? p.container_label ?? "container" : null }));
  const preps = cat.recipes
    .filter((r) => r.kind === "prep" && cat.versions.get(r.id)?.produces_product_id)
    .map((r) => {
      const v = cat.versions.get(r.id)!;
      return { id: r.id, name: r.name, yieldLabel: `${num(v.yield_qty)} ${UNITS[v.yield_unit ?? ""]?.label ?? ""}` };
    });
  const otherLocations = app.locations.filter((l) => l.id !== app.location.id).map((l) => ({ id: l.id, name: l.name }));
  return (
    <>
      <PageHeader title="Record stock changes" description="Every entry is kept. Mistakes are corrected with a reversal, never by editing history." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Waste, breakage, returns and adjustments">
          {products.length ? <MovementForm products={products} units={unitOptions} idempotencyKey={randomUUID()} defaultType={sp.type ?? "waste"} /> : <p className="text-sm text-muted">Add products first.</p>}
        </Card>
        <Card title="Batch production"><ProductionForm preps={preps} /></Card>
        <Card title="Transfer to another location"><TransferForm locations={otherLocations} products={products} units={unitOptions} /></Card>
      </div>
    </>
  );
}
