import { getContext } from "@/lib/session";
import { log } from "@/lib/log";

// Tables exported for an organization. Everything is read through the member's
// own session, so row-level security bounds what is included.
const TABLES: [string, string][] = [
  ["organizations", "id"], ["locations", "id"], ["memberships", "user_id"], ["org_settings", "org_id"],
  ["suppliers", "id"], ["products", "id"], ["product_conversions", "id"], ["supplier_items", "id"], ["product_costs", "id"],
  ["ingredients", "id"], ["ingredient_mappings", "id"], ["recipes", "id"], ["recipe_versions", "id"], ["recipe_components", "id"], ["menu_items", "id"],
  ["inventory_areas", "id"], ["location_products", "product_id"], ["stock_movements", "id"], ["stock_movement_costs", "movement_id"],
  ["count_sessions", "id"], ["count_lines", "id"], ["transfers", "id"], ["production_runs", "id"],
  ["documents", "id"], ["invoices", "id"], ["invoice_lines", "id"], ["invoice_extractions", "id"], ["receivings", "id"], ["receiving_lines", "id"],
  ["pos_mapping_profiles", "id"], ["pos_imports", "id"], ["sales_lines", "id"], ["pos_item_mappings", "id"], ["modifier_mappings", "id"],
  ["barbook_entries", "id"], ["barbook_revisions", "id"], ["barbook_acks", "entry_id"],
  ["staff_profiles", "id"], ["schedule_weeks", "id"], ["shifts", "id"], ["schedule_publications", "id"],
  ["bev_events", "id"], ["bev_event_recipes", "id"], ["bev_event_quotes", "id"],
  ["analysis_runs", "id"], ["analysis_explanations", "id"], ["audit_events", "id"], ["subscriptions", "id"],
];

export async function GET() {
  const app = await getContext();
  if (!app.can("data.export")) return new Response("Forbidden", { status: 403 });
  const orgId = app.org.orgId;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`{"format":"table-zero-bar-export","version":1,"exported_at":${JSON.stringify(new Date().toISOString())},"organization_id":${JSON.stringify(orgId)},"tables":{`));
        for (const [ti, [table, key]] of TABLES.entries()) {
          controller.enqueue(encoder.encode(`${ti ? "," : ""}${JSON.stringify(table)}:[`));
          let first = true;
          for (let from = 0; ; from += 1000) {
            const q = app.supabase.from(table).select("*").order(key).range(from, from + 999);
            const { data, error } = table === "organizations" ? await q.eq("id", orgId) : await q.eq("org_id", orgId);
            if (error) throw new Error(`${table}: ${error.message}`);
            for (const row of data ?? []) {
              controller.enqueue(encoder.encode(`${first ? "" : ","}${JSON.stringify(row)}`));
              first = false;
            }
            if (!data || data.length < 1000) break;
          }
          controller.enqueue(encoder.encode("]"));
        }
        controller.enqueue(encoder.encode("}}"));
        controller.close();
      } catch (e) {
        log("error", "export.failed", { orgId, error: e instanceof Error ? e.message : String(e) });
        controller.error(e);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="table-zero-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
