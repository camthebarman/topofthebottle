import { Card, PageHeader } from "@/components/ui";
import { must } from "@/lib/action";
import { getContext, requirePerm } from "@/lib/session";
import { CopyTemplateButton } from "./copy-button";

export const metadata = { title: "Classic recipes" };

interface Template {
  id: string;
  name: string;
  kind: string;
  category: string;
  glassware: string | null;
  method: string;
  garnish: string | null;
  components: { ingredient: string; qty: number; unit: string }[];
  provenance: string;
}

export default async function LibraryPage() {
  const app = await getContext();
  requirePerm(app, "recipes.edit");
  const templates = must(await app.supabase.from("recipe_templates").select("*").order("kind").order("name")) as Template[];
  return (
    <>
      <PageHeader title="Classic starting points" description="Copy a classic into your recipe book, then adjust it to your house spec. These are editable starting points, not authoritative specifications." />
      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((t) => (
          <Card key={t.id} title={t.name} actions={<CopyTemplateButton templateId={t.id} />}>
            <p className="text-sm text-muted">{t.category}{t.glassware ? ` · ${t.glassware}` : ""}</p>
            <ul className="mt-2 text-sm">
              {t.components.map((c) => (
                <li key={c.ingredient} className="tabular">{c.qty} {c.unit.replace("_", " ")} {c.ingredient}</li>
              ))}
            </ul>
            <p className="mt-2 text-sm">{t.method}</p>
            <p className="mt-2 text-xs text-muted">{t.provenance}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
