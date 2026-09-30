import { notFound } from "next/navigation";
import { d, UNITS } from "@tz/domain";
import { Badge, Card, DataList, LinkButton, Notice, PageHeader } from "@/components/ui";
import { must } from "@/lib/action";
import { dateLabel, money, num, pct, qty } from "@/lib/format";
import { getContext } from "@/lib/session";
import { loadCatalog } from "@/server/catalog";
import { currentMenu, orgSettings, summarizeRecipe } from "@/server/menu";
import { ArchiveForm, MapIngredientForm, MenuForm } from "./forms";

export default async function RecipePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const app = await getContext();
  const [cat, menu, settings] = await Promise.all([loadCatalog(app, { includeArchived: true }), currentMenu(app), orgSettings(app)]);
  const recipe = cat.recipeById.get(id);
  if (!recipe) notFound();
  const version = cat.versions.get(id);
  const comps = version ? (cat.components.get(version.id) ?? []).sort((a, b) => a.position - b.position) : [];
  const menuItem = menu.find((m) => m.recipe_id === id) ?? null;
  const s = summarizeRecipe(cat, id, menuItem, d(settings.target_cost_pct), settings.price_stale_days);
  const history = must(await app.supabase.from("recipe_versions").select("id, version, created_at").eq("recipe_id", id).order("version", { ascending: false }).limit(20)) as { id: string; version: number; created_at: string }[];
  const canCost = app.can("costs.view");
  const unmapped = s.cost.issues.filter((i) => i.code === "missing_mapping");
  const products = cat.products.filter((p) => !p.archived_at).map((p) => ({ id: p.id, name: p.name, dimension: p.dimension }));
  const ingName = (iid: string) => cat.ingredients.find((i) => i.id === iid)?.name ?? "Unknown ingredient";

  const compLabel = (c: (typeof comps)[number]) => {
    if (c.sub_recipe_id) return { name: cat.recipeById.get(c.sub_recipe_id)?.name ?? "Missing recipe", note: "House recipe" };
    if (c.product_id) return { name: cat.productById.get(c.product_id)?.name ?? "Missing product", note: "Product" };
    const mapped = cat.ingredientMap.get(c.ingredient_id!);
    return { name: ingName(c.ingredient_id!), note: mapped ? `→ ${cat.productById.get(mapped)?.name ?? "?"}` : "Not mapped to a product" };
  };

  const isMenuRecipe = recipe.kind !== "prep";
  return (
    <>
      <PageHeader
        title={recipe.name}
        description={<span className="capitalize">{recipe.kind}{recipe.category ? ` · ${recipe.category}` : ""}{version ? ` · version ${version.version}` : ""}{recipe.archived_at ? " · archived" : ""}</span>}
        actions={app.can("recipes.edit") ? <LinkButton href={`/recipes/${id}/edit`}>Edit</LinkButton> : null}
      />
      <div className="space-y-4">
        {sp.saved ? <Notice tone="ok" role="status">Saved as a new version. Earlier versions are kept for history.</Notice> : null}
        {sp.copied ? <Notice tone="ok" role="status">Copied into your recipe book. Map each ingredient to a product you stock to see costs and availability.</Notice> : null}

        {canCost ? (
          <Card title="Ingredient cost">
            {s.cost.complete ? (
              <DataList
                items={[
                  { label: isMenuRecipe ? "Cost per serving" : "Cost per batch", value: money(s.cost.total) },
                  ...(isMenuRecipe
                    ? [
                        { label: "Selling price", value: menuItem?.selling_price ? money(menuItem.selling_price) : "Not on menu" },
                        { label: "Ingredient cost %", value: pct(s.metrics.costPct) },
                        { label: "Ingredient margin", value: s.metrics.ingredientMargin ? `${money(s.metrics.ingredientMargin)} (${pct(s.metrics.ingredientMarginPct)})` : "—" },
                        { label: `Price at ${num(menuItem?.target_cost_pct ?? settings.target_cost_pct)}% target`, value: money(s.metrics.targetPrice) },
                      ]
                    : []),
                  { label: "Oldest cost used", value: s.cost.oldestCostAsOf ? dateLabel(s.cost.oldestCostAsOf) : "—" },
                ]}
              />
            ) : (
              <Notice tone="warn" title="Cost is incomplete">
                <p>Some ingredients cannot be priced yet, so no total is shown. Known ingredients so far add up to {money(s.cost.knownSubtotal)} — this is not the full cost.</p>
              </Notice>
            )}
            {isMenuRecipe ? <p className="mt-2 text-xs text-muted">Ingredient margin is selling price minus ingredient cost. It is not operating profit: labour, rent and other costs are not included.</p> : null}
            {s.cost.warnings.length ? (
              <ul className="mt-3 space-y-1 text-sm text-warn">
                {s.cost.warnings.map((w) => (<li key={w.message}>{w.message}</li>))}
              </ul>
            ) : null}
          </Card>
        ) : null}

        {s.cost.issues.length ? (
          <Card title="Needs attention">
            <ul className="space-y-3 text-sm">
              {s.cost.issues.map((i) => (
                <li key={`${i.code}${i.ref}${i.message}`} className="rounded-lg border border-border p-3">
                  <p>{i.message}</p>
                  {i.path?.length ? <p className="text-xs text-muted">In {i.path.join(" → ")}</p> : null}
                  {i.code === "missing_price" && app.can("catalog.edit") ? <p className="mt-1"><a className="text-accent underline" href={`/inventory/products/${i.ref}`}>Set a cost</a></p> : null}
                </li>
              ))}
            </ul>
            {unmapped.length && app.can("recipes.edit") ? (
              <div className="mt-4 space-y-3">
                <h3 className="font-semibold">Map ingredients at {app.location.name}</h3>
                {unmapped.map((u) => (
                  <MapIngredientForm key={u.ref} recipeId={id} ingredientId={u.ref!} ingredientName={ingName(u.ref!)} products={products} />
                ))}
                {!products.length ? <p className="text-sm text-muted">Add products first under Inventory → Products.</p> : null}
              </div>
            ) : null}
          </Card>
        ) : null}

        {isMenuRecipe ? (
          <Card title="Available now">
            <DataList
              items={[
                { label: "From raw ingredients", value: s.raw.complete ? `${s.raw.servings} servings` : s.raw.upperBound !== null ? `At most ${s.raw.upperBound} (incomplete)` : "Unknown" },
                { label: "Using batched preps in stock", value: s.prepared.complete ? `${s.prepared.servings} servings` : s.prepared.upperBound !== null ? `At most ${s.prepared.upperBound} (incomplete)` : "Unknown" },
                { label: "Runs out first", value: s.raw.limitingProductIds.map((pid) => cat.productById.get(pid)?.name).join(", ") || "—" },
              ]}
            />
            <p className="mt-2 text-xs text-muted">Based on book stock (last count plus recorded movements), not a live measurement.{s.raw.approximate ? " Includes estimated partial bottles." : ""} The two figures are alternatives, not a sum.</p>
          </Card>
        ) : null}

        <Card title="Build">
          {version ? (
            <>
              <p className="mb-2 text-sm text-muted">
                Yield: {version.yield_servings ? `${num(version.yield_servings)} serving${Number(version.yield_servings) === 1 ? "" : "s"}` : `${num(version.yield_qty)} ${UNITS[version.yield_unit ?? ""]?.label ?? version.yield_unit}`}
              </p>
              <ul className="divide-y divide-border">
                {comps.map((c) => {
                  const l = compLabel(c);
                  return (
                    <li key={c.position} className="flex items-baseline justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="font-medium">{l.name}</p>
                        <p className={`text-xs ${l.note.startsWith("Not mapped") ? "text-warn" : "text-muted"}`}>{l.note}{c.yield_pct ? ` · ${num(c.yield_pct)}% usable` : ""}</p>
                      </div>
                      <p className="tabular shrink-0">{num(c.qty, 3)} {UNITS[c.unit]?.label ?? c.unit}{UNITS[c.unit]?.approximate ? "*" : ""}</p>
                    </li>
                  );
                })}
              </ul>
              {comps.some((c) => UNITS[c.unit]?.approximate) ? <p className="mt-1 text-xs text-muted">* Conventional measure (dash, barspoon); costed at a nominal size.</p> : null}
              <DataList
                items={[
                  { label: "Glassware", value: version.glassware || "—" },
                  { label: "Garnish", value: version.garnish || "—" },
                ]}
              />
              {version.method ? <p className="mt-3 whitespace-pre-line text-sm">{version.method}</p> : null}
              {version.batch_instructions ? (<><h3 className="mt-3 font-semibold">Batch instructions</h3><p className="whitespace-pre-line text-sm">{version.batch_instructions}</p></>) : null}
              {version.notes ? <p className="mt-3 whitespace-pre-line text-xs text-muted">{version.notes}</p> : null}
            </>
          ) : (
            <p className="text-sm text-muted">No version saved.</p>
          )}
        </Card>

        {canCost && s.cost.lines.length ? (
          <Card title="Cost by product">
            <ul className="divide-y divide-border text-sm">
              {s.cost.lines.map((l) => {
                const p = cat.productById.get(l.productId);
                return (
                  <li key={l.productId} className="flex justify-between gap-3 py-2">
                    <span>{l.name} <span className="text-muted">({p ? qty(l.asPurchasedBase, p.dimension) : "—"})</span></span>
                    <span className="tabular">{l.cost ? money(l.cost) : <Badge tone="warn">no cost</Badge>}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}

        {isMenuRecipe && app.can("menu.edit") && !recipe.archived_at ? (
          <Card title={`Menu at ${app.location.name}`}>
            <MenuForm recipeId={id} onMenu={!!menuItem} price={menuItem?.selling_price ?? ""} targetPct={menuItem?.target_cost_pct ?? ""} section={menuItem?.menu_section ?? ""} />
          </Card>
        ) : null}

        <Card title="Version history">
          <ul className="text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex justify-between py-1">
                <span>Version {h.version}</span>
                <span className="text-muted">{dateLabel(h.created_at, app.location.timezone)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Versions never change once saved. Sales analysis uses the version in effect on each business date.</p>
        </Card>

        {app.can("recipes.edit") ? <ArchiveForm recipeId={id} archived={!!recipe.archived_at} /> : null}
      </div>
    </>
  );
}
