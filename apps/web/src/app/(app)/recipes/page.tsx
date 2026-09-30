import Link from "next/link";
import { d } from "@tz/domain";
import { Badge, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { money, pct } from "@/lib/format";
import { getContext } from "@/lib/session";
import { loadCatalog } from "@/server/catalog";
import { currentMenu, orgSettings, summarizeRecipe } from "@/server/menu";

export const metadata = { title: "Recipes" };

export default async function RecipesPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string; kind?: string }> }) {
  const sp = await searchParams;
  const app = await getContext();
  const [cat, menu, settings] = await Promise.all([loadCatalog(app, { includeArchived: sp.view === "archived" }), currentMenu(app), orgSettings(app)]);
  const menuByRecipe = new Map(menu.map((m) => [m.recipe_id, m]));
  const view = sp.view === "all" || sp.view === "archived" ? sp.view : "menu";
  const q = (sp.q ?? "").trim().toLowerCase();
  let recipes = cat.recipes.filter((r) => (view === "archived" ? !!r.archived_at : !r.archived_at));
  if (view === "menu") recipes = recipes.filter((r) => menuByRecipe.has(r.id));
  if (sp.kind && ["drink", "dish", "prep"].includes(sp.kind)) recipes = recipes.filter((r) => r.kind === sp.kind);
  if (q) recipes = recipes.filter((r) => r.name.toLowerCase().includes(q) || (r.category ?? "").toLowerCase().includes(q));
  const target = d(settings.target_cost_pct);

  const tab = (v: string, label: string) => (
    <Link href={`/recipes?view=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}`} aria-current={view === v ? "page" : undefined} className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium ${view === v ? "bg-accent text-accent-fg" : "bg-surface text-fg border border-border"}`}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Recipes"
        description={view === "menu" ? "Your current menu at this location. Costs use each recipe's current version." : "Your recipe book."}
        actions={app.can("recipes.edit") ? (<><LinkButton href="/recipes/library">Add a classic</LinkButton><LinkButton variant="primary" href="/recipes/new">New recipe</LinkButton></>) : null}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {tab("menu", `Current menu (${menu.length})`)}
        {tab("all", "Recipe book")}
        {tab("archived", "Archived")}
      </div>
      <form className="mb-4" role="search">
        <input type="hidden" name="view" value={view} />
        <label htmlFor="q" className="sr-only">Search recipes</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Search recipes" className="block min-h-11 w-full rounded-lg border border-border bg-surface px-3" />
      </form>
      {recipes.length === 0 ? (
        <EmptyState title={view === "menu" ? "Nothing on the current menu yet" : "No recipes found"} action={app.can("recipes.edit") ? <LinkButton href="/recipes/library">Start from a classic</LinkButton> : null}>
          {view === "menu" ? "Open a recipe and add it to the menu with a selling price." : q ? "Try a different search." : "Copy a classic or create your own."}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {recipes.map((r) => {
            const s = summarizeRecipe(cat, r.id, menuByRecipe.get(r.id) ?? null, target, settings.price_stale_days);
            return (
              <li key={r.id}>
                <Link href={`/recipes/${r.id}`} className="flex min-h-16 items-center justify-between gap-3 px-3 py-2 hover:bg-surface-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="flex flex-wrap items-center gap-1 text-sm text-muted">
                      <span className="capitalize">{r.kind}</span>
                      {r.category ? <span>· {r.category}</span> : null}
                      {menuByRecipe.has(r.id) && view !== "menu" ? <Badge tone="info">On menu</Badge> : null}
                      {!s.cost.complete ? <Badge tone="warn">Incomplete</Badge> : null}
                      {s.cost.warnings.length ? <Badge tone="warn">Stale cost</Badge> : null}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-sm tabular">
                    {app.can("costs.view") ? (
                      <>
                        <p className="font-semibold">{s.cost.complete ? money(s.cost.total) : "—"}</p>
                        <p className="text-muted">{s.metrics.costPct ? `${pct(s.metrics.costPct)} cost` : menuByRecipe.get(r.id)?.selling_price ? "" : "no price"}</p>
                      </>
                    ) : menuByRecipe.get(r.id)?.selling_price ? (
                      <p className="font-semibold">{money(menuByRecipe.get(r.id)!.selling_price)}</p>
                    ) : null}
                    {r.kind !== "prep" ? <p className="text-muted">{s.raw.complete ? `${s.raw.servings} avail.` : ""}</p> : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
