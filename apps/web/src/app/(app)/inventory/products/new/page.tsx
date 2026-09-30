import { Card, PageHeader } from "@/components/ui";
import { getContext, requirePerm } from "@/lib/session";
import { ProductForm } from "../../forms";
import { unitOptions } from "../../units";

export const metadata = { title: "Add product" };

export default async function NewProductPage() {
  const app = await getContext();
  requirePerm(app, "catalog.edit");
  return (
    <>
      <PageHeader title="Add product" />
      <Card>
        <ProductForm units={unitOptions} initial={{ productId: "", version: "", name: "", category: "spirit", dimension: "volume", containerQty: "750", containerUnit: "ml", containerLabel: "bottle", fullWeightG: "", emptyWeightG: "", usableYieldPct: "", countMethod: "tenths", parQty: "" }} />
      </Card>
    </>
  );
}
