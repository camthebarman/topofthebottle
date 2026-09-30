import { UNITS } from "@tz/domain";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { must } from "@/lib/action";
import { money, num } from "@/lib/format";
import { getContext, requirePerm } from "@/lib/session";
import { loadCatalog } from "@/server/catalog";
import { MapItemForm, MapModifierForm } from "../forms";

export const metadata = { title: "POS mappings" };

export default async function MappingsPage() {
  const app = await getContext();
  requirePerm(app, "imports.manage");
  const [cat, unmappedRes, modsRes, mapsRes, modMapsRes] = await Promise.all([
    loadCatalog(app),
    app.supabase.rpc("unmapped_sales_items", { p_org: app.org.orgId, p_location: app.location.id, p_limit: 50 }),
    app.supabase.rpc("unmapped_modifiers", { p_org: app.org.orgId, p_location: app.location.id, p_limit: 50 }),
    app.supabase.from("pos_item_mappings").select("item_key, item_name, recipe_id, not_stock, servings_per_unit, effective_from").eq("location_id", app.location.id).is("effective_to", null).order("item_name").limit(1000),
    app.supabase.from("modifier_mappings").select("modifier_key, item_key, actions").eq("location_id", app.location.id).is("effective_to", null).limit(1000),
  ]);
  const unmapped = must(unmappedRes) as { item_key: string; item_name: string; quantity: string; net_sales: string | null }[];
  const mods = must(modsRes) as { modifier_key: string; example: string; lines: number }[];
  const maps = must(mapsRes) as { item_key: string; item_name: string; recipe_id: string | null; not_stock: boolean; servings_per_unit: string }[];
  const recipes = cat.recipes.filter((r) => r.kind !== "prep").map((r) => ({ id: r.id, name: r.name }));
  const refs = [...cat.ingredients.map((i) => ({ value: `i:${i.id}`, label: i.name })), ...cat.products.filter((p) => !p.archived_at).map((p) => ({ value: `p:${p.id}`, label: `${p.name} (product)` }))];
  return (
    <>
      <PageHeader title="POS mappings" description={`How POS items and modifiers at ${app.location.name} turn into recipe usage. Changes apply to analysis immediately; past mappings are kept.`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Unmapped items (${unmapped.length})`}>
          {unmapped.length ? (
            <ul className="space-y-3">
              {unmapped.map((u) => (
                <li key={u.item_key} className="rounded-lg border border-border p-3">
                  <p className="mb-1 text-xs text-muted">{num(u.quantity)} sold · {money(u.net_sales)}</p>
                  <MapItemForm itemKey={u.item_key} itemName={u.item_name} recipes={recipes} />
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Every imported item is mapped" />}
        </Card>
        <Card title={`Unmapped modifiers (${mods.length})`}>
          {mods.length ? <ul className="mb-4 text-sm">{mods.map((m) => <li key={m.modifier_key}>“{m.example}” on {m.lines} line(s)</li>)}</ul> : <p className="mb-4 text-sm text-muted">None.</p>}
          <p className="mb-2 text-sm text-muted">A sale with an unmapped modifier is left out of usage rather than assumed to be a standard pour.</p>
          <MapModifierForm items={maps.map((m) => ({ key: m.item_key, name: m.item_name }))} refs={refs} units={Object.values(UNITS).map((u) => ({ id: u.id, label: u.label }))} />
        </Card>
        <Card title={`Mapped items (${maps.length})`} className="lg:col-span-2">
          <ul className="divide-y divide-border text-sm">
            {maps.map((m) => (
              <li key={m.item_key} className="flex justify-between gap-2 py-2">
                <span>{m.item_name}</span>
                <span className="text-muted">{m.not_stock ? "Not stock" : `${cat.recipeById.get(m.recipe_id!)?.name ?? "Archived recipe"}${Number(m.servings_per_unit) !== 1 ? ` × ${num(m.servings_per_unit)}` : ""}`}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{(modMapsRes.data ?? []).length} modifier mapping(s) in effect.</p>
        </Card>
      </div>
    </>
  );
}
