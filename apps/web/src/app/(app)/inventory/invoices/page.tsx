import { Badge, Card, EmptyState, ListLink, PageHeader, Pagination } from "@/components/ui";
import { UploadForm } from "@/components/upload";
import { must } from "@/lib/action";
import { dateLabel, money } from "@/lib/format";
import { getContext, requirePerm } from "@/lib/session";

export const metadata = { title: "Invoices" };
const PAGE = 30;

const TONE: Record<string, "ok" | "warn" | "danger" | "info" | "neutral"> = { approved: "ok", needs_review: "warn", extracting: "info", uploaded: "info", extraction_failed: "danger", rejected: "neutral" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const app = await getContext();
  requirePerm(app, "invoices.upload");
  const rows = must(
    await app.supabase
      .from("invoices")
      .select("id, invoice_number, invoice_date, total, currency, status, receiving_status, is_credit_note, duplicate_of_id, supplier_name_raw, suppliers(name), created_at")
      .eq("location_id", app.location.id)
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE, page * PAGE),
  ) as { id: string; invoice_number: string | null; invoice_date: string | null; total: string | null; currency: string; status: string; receiving_status: string; is_credit_note: boolean; duplicate_of_id: string | null; supplier_name_raw: string | null; suppliers: unknown; created_at: string }[];
  return (
    <>
      <PageHeader title="Invoices" description="Upload, check what was read, then approve. Stock changes only when you confirm receiving." />
      <div className="space-y-4">
        <Card title="Upload an invoice">
          <UploadForm kind="invoice" label="PDF, photo or CSV (max 25 MB, 50 pages)" accept="application/pdf,image/jpeg,image/png,image/webp,.csv,text/csv" camera />
        </Card>
        {rows.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {rows.slice(0, PAGE).map((r) => (
              <ListLink
                key={r.id}
                href={`/inventory/invoices/${r.id}`}
                title={`${(r.suppliers as { name: string } | null)?.name ?? r.supplier_name_raw ?? "Unknown supplier"}${r.invoice_number ? ` #${r.invoice_number}` : ""}`}
                meta={<>{r.invoice_date ? dateLabel(r.invoice_date) : `Uploaded ${dateLabel(r.created_at, app.location.timezone)}`}{r.is_credit_note ? " · credit note" : ""}{r.duplicate_of_id ? " · possible duplicate" : ""}</>}
                right={<div className="space-y-1"><p className="tabular font-medium">{money(r.total, r.currency)}</p><Badge tone={TONE[r.status]}>{r.status.replace("_", " ")}</Badge>{r.status === "approved" ? <> <Badge tone={r.receiving_status === "received" ? "ok" : "warn"}>{r.receiving_status.replace("_", " ")}</Badge></> : null}</div>}
              />
            ))}
          </ul>
        ) : <EmptyState title="No invoices yet" />}
        <Pagination page={page} hasMore={rows.length > PAGE} makeHref={(p) => `/inventory/invoices?page=${p}`} />
      </div>
    </>
  );
}
