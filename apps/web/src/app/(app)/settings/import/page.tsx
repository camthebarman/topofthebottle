import { Card, PageHeader } from "@/components/ui";
import { getContext, pagePerm } from "@/lib/session";
import { LegacyImport } from "./form";

export const metadata = { title: "Import from earlier tools" };

export default async function LegacyImportPage() {
  const app = await getContext();
  pagePerm(app, "settings.manage");
  return (
    <>
      <PageHeader title="Import from earlier tools" description={`Brings products, costs, stock, preps and recipes into ${app.location.name}. Anything that cannot be imported is listed with the reason; nothing is dropped silently.`} />
      <Card><LegacyImport /></Card>
    </>
  );
}
