import { Card, PageHeader } from "@/components/ui";
import { getContext, pagePerm } from "@/lib/session";
import { loadCatalog } from "@/server/catalog";
import { RecipeEditor } from "../editor";
import { editorOptions } from "../editor-data";

export const metadata = { title: "New recipe" };

export default async function NewRecipePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const sp = await searchParams;
  const app = await getContext();
  pagePerm(app, "recipes.edit");
  const cat = await loadCatalog(app);
  const kind = sp.kind === "prep" || sp.kind === "dish" ? sp.kind : "drink";
  return (
    <>
      <PageHeader title="New recipe" description="Drinks, food dishes and house preparations all use the same costing." />
      <Card>
        <RecipeEditor
          {...editorOptions(cat)}
          initial={{ recipeId: "", expectedVersion: "", name: "", kind, category: "", yieldMode: kind === "prep" ? "quantity" : "servings", yieldServings: "1", yieldQty: "", yieldUnit: "ml", producesProductId: "", glassware: "", method: "", garnish: "", batchInstructions: "", notes: "", rows: [] }}
        />
      </Card>
    </>
  );
}
