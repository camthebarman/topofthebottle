import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { d, fromBase, landedCosts, reconcileInvoice, UNITS } from "@tz/domain";
import { Badge, Card, DataList, Notice, PageHeader } from "@/components/ui";
import { must } from "@/lib/action";
import { dateLabel, money, num } from "@/lib/format";
import { getContext, pagePerm } from "@/lib/session";
import { orgSettings } from "@/server/menu";
import { ApproveForm, HeaderForm, LineForm, ReceiveForm, RejectForm, RetryForm } from "./forms";

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ approved?: string; received?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const app = await getContext();
  pagePerm(app, "invoices.upload");
  const { data: inv } = await app.supabase.from("invoices").select("*, documents(id, filename, mime_type, page_count)").eq("id", id).maybeSingle();
  if (!inv) notFound();
  const [linesRes, suppliersRes, productsRes, extRes, recRes, dupRes, settings] = await Promise.all([
    app.supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("position"),
    app.supabase.from("suppliers").select("id, name").eq("org_id", app.org.orgId).is("archived_at", null).order("name"),
    app.supabase.from("products").select("id, name, dimension").eq("org_id", app.org.orgId).is("archived_at", null).order("name").limit(2000),
    app.supabase.from("invoice_extractions").select("attempt, provider, model, method, status, error, created_at").eq("invoice_id", id).order("attempt", { ascending: false }),
    app.supabase.from("receiving_lines").select("invoice_line_id, received_quantity, receivings!inner(invoice_id)").eq("receivings.invoice_id", id),
    inv.duplicate_of_id ? app.supabase.from("invoices").select("id, invoice_number, invoice_date, total, status").eq("id", inv.duplicate_of_id).maybeSingle() : Promise.resolve({ data: null }),
    orgSettings(app),
  ]);
  const lines = must(linesRes) as Record<string, string | null>[];
  const products = must(productsRes) as { id: string; name: string; dimension: "volume" | "mass" | "count" }[];
  const doc = inv.documents as { id: string; filename: string; mime_type: string; page_count: number | null } | null;
  const inputs = lines.map((l) => ({ description: l.description ?? "", quantity: l.quantity ?? "0", unitPrice: l.unit_price, discount: l.discount, lineTotal: l.line_total, unitsPerPack: l.units_per_pack ?? "1", unitSizeBase: l.unit_size_base, depositPerPack: l.deposit_per_pack }));
  const totals = { subtotal: inv.subtotal, freight: inv.freight, deposits: inv.deposits, tax: inv.tax, discount: inv.discount, total: inv.total, isCreditNote: inv.is_credit_note };
  const recon = reconcileInvoice(inputs, totals);
  const costs = landedCosts(inputs, totals, { freight: settings.freight_policy, tax: settings.tax_policy, invoiceDiscount: "allocate_by_value" });
  const editable = ["uploaded", "needs_review", "extraction_failed"].includes(inv.status);
  const received = new Map<string, number>();
  for (const r of (recRes.data ?? []) as { invoice_line_id: string; received_quantity: string }[]) received.set(r.invoice_line_id, (received.get(r.invoice_line_id) ?? 0) + Number(r.received_quantity));
  const unresolved = lines.filter((l) => l.match_status === "unmatched" || l.match_status === "suggested").length;
  const supplier = (must(suppliersRes) as { id: string; name: string }[]).find((s) => s.id === inv.supplier_id);
  const units = Object.values(UNITS).map((u) => ({ id: u.id, label: u.label, dimension: u.dimension }));
  const ext = (extRes.data ?? [])[0] as { provider: string; model: string | null; method: string; status: string; error: string | null } | undefined;

  return (
    <>
      <PageHeader
        title={`${supplier?.name ?? inv.supplier_name_raw ?? "Invoice"}${inv.invoice_number ? ` #${inv.invoice_number}` : ""}`}
        description={<><Badge tone={inv.status === "approved" ? "ok" : inv.status === "rejected" ? "neutral" : "warn"}>{inv.status.replace("_", " ")}</Badge>{inv.status === "approved" ? <> <Badge tone={inv.receiving_status === "received" ? "ok" : "warn"}>{inv.receiving_status.replace("_", " ")}</Badge></> : null}{inv.is_credit_note ? <> <Badge tone="info">credit note</Badge></> : null}</>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card title="Document">
            {doc ? (
              <>
                <p className="mb-2 text-sm text-muted">{doc.filename}{doc.page_count ? ` · ${doc.page_count} page(s)` : ""}</p>
                {doc.mime_type.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/documents/${doc.id}`} alt="Uploaded invoice" className="max-h-[70vh] w-full rounded-lg border border-border object-contain" />
                ) : doc.mime_type === "application/pdf" ? (
                  <iframe title="Invoice PDF" src={`/api/documents/${doc.id}`} sandbox="" className="hidden h-[70vh] w-full rounded-lg border border-border lg:block" />
                ) : null}
                <a className="mt-2 inline-block text-accent underline min-h-11" href={`/api/documents/${doc.id}`} target="_blank" rel="noopener noreferrer">Open document</a>
              </>
            ) : <p className="text-sm text-muted">No document.</p>}
            {ext ? (
              <p className="mt-2 text-xs text-muted">
                {ext.status === "succeeded" ? `Read by ${ext.provider === "stub" ? "the development stub (no AI configured)" : ext.method === "csv" ? "CSV column matching" : `${ext.provider}${ext.model ? ` (${ext.model})` : ""}`}.` : `Automatic reading failed: ${ext.error}`} Confidence labels are the reader&apos;s own judgement, not measured accuracy. Check every line.
              </p>
            ) : null}
          </Card>
        </div>

        <div className="space-y-4">
          {sp.approved ? <Notice tone="ok" role="status">Approved. Stock has not changed yet: confirm receiving when the goods are checked in.</Notice> : null}
          {sp.received ? <Notice tone="ok" role="status">Received into stock.</Notice> : null}
          {inv.status === "extracting" ? <Notice tone="info" role="status">Reading the document… Refresh in a moment.</Notice> : null}
          {inv.review_notes ? <Notice tone="neutral">{inv.review_notes}</Notice> : null}
          {dupRes.data ? (
            <Notice tone="warn" title="Possible duplicate">
              Matches <a className="underline" href={`/inventory/invoices/${dupRes.data.id}`}>invoice {dupRes.data.invoice_number ?? ""} ({dateLabel(dupRes.data.invoice_date)}, {money(dupRes.data.total)}, {dupRes.data.status})</a>. Approving needs a reason.
            </Notice>
          ) : null}

          <Card title="Invoice details">
            {editable ? (
              <HeaderForm
                invoiceId={id}
                version={inv.version}
                suppliers={must(suppliersRes) as { id: string; name: string }[]}
                initial={{ supplierId: inv.supplier_id ?? "", supplierRaw: inv.supplier_name_raw ?? "", invoiceNumber: inv.invoice_number ?? "", invoiceDate: inv.invoice_date ?? "", dueDate: inv.due_date ?? "", isCreditNote: inv.is_credit_note, subtotal: inv.subtotal ?? "", freight: inv.freight ?? "", deposits: inv.deposits ?? "", tax: inv.tax ?? "", discount: inv.discount ?? "", total: inv.total ?? "" }}
                canAddSupplier={app.can("catalog.edit")}
              />
            ) : (
              <DataList items={[
                { label: "Invoice date", value: dateLabel(inv.invoice_date) },
                { label: "Subtotal", value: money(inv.subtotal, inv.currency) },
                { label: "Freight", value: money(inv.freight, inv.currency) },
                { label: "Deposits", value: money(inv.deposits, inv.currency) },
                { label: "Tax", value: money(inv.tax, inv.currency) },
                { label: "Total", value: money(inv.total, inv.currency) },
                { label: "Approved", value: inv.approved_at ? dateLabel(inv.approved_at, app.location.timezone) : "—" },
              ]} />
            )}
          </Card>

          <Card title="Totals check">
            {recon.balanced ? <Notice tone="ok">Lines, subtotal and total agree (within 2¢).</Notice> : (
              <Notice tone="warn" title="Discrepancies">
                <ul className="list-disc pl-5">{recon.messages.map((m) => <li key={m}>{m}</li>)}</ul>
              </Notice>
            )}
            <p className="mt-2 text-xs text-muted">Cost policy: freight {settings.freight_policy === "allocate_by_value" ? "spread across lines by value" : "excluded"}; tax {settings.tax_policy === "exclude" ? "excluded (recoverable)" : "included by value"}; deposits never part of product cost.</p>
          </Card>

          <Card title={`Lines (${lines.length})`}>
            {unresolved ? <p className="mb-2 text-sm text-warn">{unresolved} line(s) still need a decision: confirm the product, or mark as not stock.</p> : null}
            <ul className="space-y-3">
              {lines.map((l, idx) => {
                const p = products.find((x) => x.id === l.product_id);
                const sizeUnit = p?.dimension === "mass" ? "g" : p?.dimension === "count" ? "each" : "ml";
                return (
                  <li key={l.id} className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge tone={l.match_status === "confirmed" ? "ok" : l.match_status === "not_stock" ? "neutral" : "warn"}>{l.match_status?.replace("_", " ")}</Badge>
                      {l.confidence ? <Badge tone={l.confidence === "high" ? "neutral" : "warn"}>{l.confidence} confidence</Badge> : null}
                      {l.match_note ? <span className="text-xs text-muted">{l.match_note}</span> : null}
                      {app.can("costs.view") && costs[idx]?.costPerBase && l.unit_size_base ? <span className="text-xs text-muted">Landed: {money(costs[idx]!.costPerBase!.times(l.unit_size_base))} per unit</span> : null}
                      {received.has(l.id!) ? <span className="text-xs text-ok">Received {num(received.get(l.id!))} of {num(l.quantity)}</span> : null}
                    </div>
                    {editable ? (
                      <LineForm
                        invoiceId={id}
                        products={products}
                        units={units}
                        initial={{ lineId: l.id!, description: l.description ?? "", quantity: l.quantity ?? "", productId: l.product_id ?? "", unitsPerPack: l.units_per_pack ?? "1", unitSizeQty: l.unit_size_base ? String(Number(fromBase(l.unit_size_base, sizeUnit))) : "", unitSizeUnit: sizeUnit, unitPrice: l.unit_price ?? "", discount: l.discount ?? "", lineTotal: l.line_total ?? "", depositPerPack: l.deposit_per_pack ?? "" }}
                      />
                    ) : (
                      <p className="text-sm">{l.description} · {num(l.quantity)} × {money(l.unit_price)} = {money(l.line_total)}{p ? ` → ${p.name}` : ""}</p>
                    )}
                  </li>
                );
              })}
            </ul>
            {editable ? (
              <details className="mt-3">
                <summary className="min-h-11 cursor-pointer py-2 font-medium text-accent">Add a line</summary>
                <LineForm invoiceId={id} products={products} units={units} initial={{ lineId: "", description: "", quantity: "1", productId: "", unitsPerPack: "1", unitSizeQty: "", unitSizeUnit: "ml", unitPrice: "", discount: "", lineTotal: "", depositPerPack: "" }} />
              </details>
            ) : null}
          </Card>

          {editable && app.can("invoices.approve") ? (
            <Card title="Approve">
              <ApproveForm invoiceId={id} version={inv.version} duplicate={!!inv.duplicate_of_id} unresolved={unresolved} balanced={recon.balanced} isCreditNote={inv.is_credit_note} />
            </Card>
          ) : null}

          {inv.status === "approved" && !inv.is_credit_note && app.can("invoices.approve") && inv.receiving_status !== "received" ? (
            <Card title="Confirm receiving">
              <p className="mb-2 text-sm text-muted">Count what physically arrived. Only these quantities enter stock. Short or damaged items: enter what you actually received.</p>
              <ReceiveForm invoiceId={id} idempotencyKey={randomUUID()} lines={lines.filter((l) => l.match_status === "confirmed").map((l) => ({ id: l.id!, description: l.description ?? "", billed: l.quantity ?? "0", already: received.get(l.id!) ?? 0, unit: l.purchase_unit ?? "units" }))} />
            </Card>
          ) : null}

          {editable ? (
            <div className="flex flex-wrap gap-2">
              {inv.status !== "extracting" && doc && doc.mime_type !== "text/csv" ? <RetryForm invoiceId={id} /> : null}
              <RejectForm invoiceId={id} version={inv.version} />
            </div>
          ) : null}
          {inv.status === "approved" && d(inv.total ?? 0).lt(0) ? <p className="text-sm text-muted">Credit notes change no stock. Record returned goods under Inventory → Record → Return to supplier.</p> : null}
        </div>
      </div>
    </>
  );
}
