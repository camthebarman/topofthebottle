import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { getContext, requirePerm } from "@/lib/session";
import { loadCatalog } from "@/server/catalog";
import { RecipeEditor } from "../../editor";
import { editorOptions } from "../../editor-data";

export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const app = await getContext();
  requirePerm(app, "recipes.edit");
  const cat = await loadCatalog(app, { includeArchived: true });
  const recipe = cat.recipeById.get(id);
  if (!recipe) notFound();
  const v = cat.versions.get(id);
  const comps = v ? (cat.components.get(v.id) ?? []).sort((a, b) => a.position - b.position) : [];
  return (
    <>
      <PageHeader title={`Edit ${recipe.name}`} description="Saving creates a new version. Past versions stay unchanged for history and sales analysis." />
      <Card>
        <RecipeEditor
          {...editorOptions(cat, id)}
          initial={{
            recipeId: id,
            expectedVersion: recipe.current_version_id ?? "",
            name: recipe.name,
            kind: recipe.kind,
            category: recipe.category ?? "",
            yieldMode: v?.yield_servings ? "servings" : "quantity",
            yieldServings: v?.yield_servings ?? "1",
            yieldQty: v?.yield_qty ?? "",
            yieldUnit: v?.yield_unit ?? "ml",
            producesProductId: v?.produces_product_id ?? "",
            glassware: v?.glassware ?? "",
            method: v?.method ?? "",
            garnish: v?.garnish ?? "",
            batchInstructions: v?.batch_instructions ?? "",
            notes: v?.notes ?? "",
            rows: comps.map((c) => ({
              ref: c.sub_recipe_id ? `r:${c.sub_recipe_id}` : c.ingredient_id ? `i:${c.ingredient_id}` : `p:${c.product_id}`,
              newName: "",
              newDimension: "volume",
              qty: String(Number(c.qty)),
              unit: c.unit,
              yieldPct: c.yield_pct ? String(Number(c.yield_pct)) : "",
            })),
          }}
        />
      </Card>
    </>
  );
}
