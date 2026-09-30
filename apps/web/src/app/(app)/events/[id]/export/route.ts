import { NextResponse } from "next/server";
import { fromBase, toCsv } from "@tz/domain";
import { getContext } from "@/lib/session";
import { type EventRow, eventPlan } from "@/server/events";

// Purchase list as CSV. Cells are neutralized against spreadsheet formula injection.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = await getContext();
  if (!app.can("events.manage") || !/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data } = await app.supabase.from("bev_events").select("*").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  const plan = await eventPlan(app, data as EventRow, true);
  const rows = plan.ingredients.lines.map((l) => {
    const p = plan.cat.productById.get(l.productId);
    const unit = p?.dimension === "mass" ? "g" : p?.dimension === "count" ? "each" : "ml";
    return [l.name, fromBase(l.requiredBase, unit).toDecimalPlaces(1).toFixed(), fromBase(l.toBuyBase, unit).toDecimalPlaces(1).toFixed(), unit, l.packs ?? "", plan.packLabels.get(l.productId) ?? "", app.can("costs.view") ? (l.purchaseCost?.toFixed(2) ?? "") : ""];
  });
  const csv = toCsv(["Item", "Needed", "To buy", "Unit", "Packs", "Pack", "Estimated cost"], rows);
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="event-${id.slice(0, 8)}-purchase-list.csv"`, "Cache-Control": "private, no-store" } });
}
