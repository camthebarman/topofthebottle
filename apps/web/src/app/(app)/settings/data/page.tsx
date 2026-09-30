import { Card, Notice, PageHeader } from "@/components/ui";
import { dateLabel } from "@/lib/format";
import { getContext, pagePerm } from "@/lib/session";
import { CancelDeletionForm, DeletionForm } from "../forms";

export const metadata = { title: "Your data" };

export default async function DataPage() {
  const app = await getContext();
  pagePerm(app, "data.export");
  const { data: reqs } = await app.supabase.from("data_requests").select("id, kind, status, scheduled_for, created_at").eq("org_id", app.org.orgId).order("created_at", { ascending: false }).limit(10);
  const pending = (reqs ?? []).find((r: { kind: string; status: string }) => r.kind === "delete_organization" && r.status === "requested") as { id: string; scheduled_for: string } | undefined;
  return (
    <>
      <PageHeader title="Your data" />
      <div className="space-y-4">
        <Card title="Export everything">
          <p className="mb-3 text-sm">Downloads a JSON file with every record in this organization: products, recipes and versions, menus, stock ledger, counts, invoices and lines, imported sales, bar book, schedules, events and the audit log. Uploaded files are listed with their details; download them from each invoice or import.</p>
          <a className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 font-medium text-accent-fg" href="/api/export">Download export</a>
          <p className="mt-2 text-xs text-muted">Export stays available during a cancelled subscription&apos;s 30-day grace period.</p>
        </Card>
        <Card title="Retention">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>Invoice documents: kept 7 years (tax records), then deleted.</li>
            <li>POS export files: kept 2 years. Imported sales lines stay until you delete the organization.</li>
            <li>Audit log: kept while the organization exists.</li>
            <li>Backups: rolling 7 days (managed database backups); deleted data leaves backups when they roll over.</li>
          </ul>
        </Card>
        <Card title="Delete this organization">
          {pending ? (
            <>
              <Notice tone="warn">Deletion is scheduled for {dateLabel(pending.scheduled_for, app.location.timezone)}. All data will be removed permanently.</Notice>
              <div className="mt-3"><CancelDeletionForm id={pending.id} /></div>
            </>
          ) : <DeletionForm orgName={app.org.orgName} />}
        </Card>
      </div>
    </>
  );
}
