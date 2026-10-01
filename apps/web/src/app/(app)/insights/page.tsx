import { createHash } from "node:crypto";
import Link from "next/link";
import type { VarianceLine } from "@tz/domain";
import { Badge, Card, DataList, EmptyState, Notice, PageHeader, Stat } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { dateLabel, money, num, pct } from "@/lib/format";
import { getContext, pagePerm } from "@/lib/session";
import { aiMode, type Explanation } from "@/server/ai/provider";
import { aiEvidence, buildReport, finalizedCounts } from "@/server/insights";
import { orgSettings } from "@/server/menu";
import { AutoRefresh } from "../imports/forms";
import { requestExplanation } from "./actions";

export const metadata = { title: "Insights" };

const STATUS: Record<VarianceLine["status"], { label: string; tone: "danger" | "warn" | "ok" | "neutral" }> = {
  requires_review: { label: "Requires review", tone: "warn" },
  incomplete: { label: "Incomplete data", tone: "neutral" },
  within_uncertainty: { label: "Within expected range", tone: "ok" },
  insufficient_data: { label: "Not enough data", tone: "neutral" },
};

function unit(dim: string) {
  return dim === "volume" ? "mL" : dim === "mass" ? "g" : "each";
}
function signed(v: { toNumber(): number } | null, u: string) {
  if (!v) return "—";
  const n = v.toNumber();
  return `${n > 0 ? "+" : ""}${num(n, 1)} ${u}`;
}

function ExplainForm({ opening, closing }: { opening: string; closing: string }) {
  return (
    <ActionForm action={requestExplanation}>
      <input type="hidden" name="opening" value={opening} />
      <input type="hidden" name="closing" value={closing} />
      <SubmitButton variant="secondary" pendingText="Requesting…">Explain with AI</SubmitButton>
    </ActionForm>
  );
}

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ opening?: string; closing?: string; explain?: string }> }) {
  const sp = await searchParams;
  const app = await getContext();
  pagePerm(app, "insights.view");
  const counts = await finalizedCounts(app);
  if (counts.length < 2) {
    return (
      <>
        <PageHeader title="Insights" />
        <EmptyState title="Insights needs two finalized counts">
          Variance compares what physically left the shelf between two counts with what sales and records explain. Finalize a count at the start and end of a period, and import the sales in between.
        </EmptyState>
      </>
    );
  }
  const closing = counts.find((c) => c.id === sp.closing) ?? counts[0]!;
  const opening = counts.find((c) => c.id === sp.opening && c.counted_at < closing.counted_at) ?? counts.find((c) => c.counted_at < closing.counted_at) ?? counts[1]!;
  let report;
  try {
    report = await buildReport(app, opening.id, closing.id);
  } catch (e) {
    return (<><PageHeader title="Insights" /><Notice tone="danger" role="alert">{e instanceof Error ? e.message : "Could not build the report."}</Notice></>);
  }
  const canCost = app.can("costs.view");
  const settings = await orgSettings(app);
  const evidence = aiEvidence(report);
  const evidenceHash = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  const aiAllowed = app.can("insights.ai") && canCost && settings.ai_insights_opt_in && aiMode() !== "unavailable";
  type Ex = { output: Explanation | null; status: string; error: string | null; provider: string; model: string | null };
  let explanation = null as Ex | null;
  let pending = false;
  if (aiAllowed) {
    const { data: runs } = await app.supabase.from("analysis_runs").select("id").eq("location_id", app.location.id).eq("result->>evidence_hash", evidenceHash).order("created_at", { ascending: false }).limit(5);
    const runIds = (runs ?? []).map((r: { id: string }) => r.id);
    if (runIds.length) {
      const { data: ex } = await app.supabase.from("analysis_explanations").select("output, status, error, provider, model").in("run_id", runIds).order("created_at", { ascending: false }).limit(1).maybeSingle();
      explanation = ex as Ex | null;
      pending = !ex && !!sp.explain && runIds.includes(sp.explain);
    }
  }
  const review = report.lines.filter((l) => l.status === "requires_review");
  const q = (o: string, c: string) => `/insights?opening=${o}&closing=${c}`;

  return (
    <>
      <PageHeader title="Insights" description={`${app.location.name} · ${dateLabel(report.opening.counted_at, app.location.timezone)} → ${dateLabel(report.closing.counted_at, app.location.timezone)}`} />
      <div className="space-y-4">
        <Card title="Period">
          <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <label htmlFor="opening" className="text-sm font-medium">Opening count</label>
              <select id="opening" name="opening" defaultValue={opening.id} className="block min-h-11 w-full rounded-lg border border-border bg-surface px-2">
                {counts.map((c) => <option key={c.id} value={c.id}>{c.name ? `${c.name} · ` : ""}{dateLabel(c.counted_at, app.location.timezone)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="closing" className="text-sm font-medium">Closing count</label>
              <select id="closing" name="closing" defaultValue={closing.id} className="block min-h-11 w-full rounded-lg border border-border bg-surface px-2">
                {counts.map((c) => <option key={c.id} value={c.id}>{c.name ? `${c.name} · ` : ""}{dateLabel(c.counted_at, app.location.timezone)}</option>)}
              </select>
            </div>
            <button type="submit" className="min-h-11 rounded-lg border border-border px-4">Show</button>
          </form>
        </Card>

        <Card title="What this data can support">
          <ul className="space-y-1 text-sm">
            {report.capability.available.map((a) => <li key={a}>✓ {a}</li>)}
            {report.capability.unavailable.map((u) => <li key={u.analysis} className="text-muted">— {u.analysis}: needs {u.needs}</li>)}
          </ul>
        </Card>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Net sales" value={money(report.totals.netSales)} />
          <Stat label="Sales matched to recipes" value={report.coverage.pct ? pct(report.coverage.pct) : "—"} tone={report.coverage.pct && report.coverage.pct.lt(settings.min_sales_coverage_pct) ? "warn" : undefined} hint={`${report.coverage.linesResolved} of ${report.coverage.lines} line groups`} />
          {canCost ? <Stat label="Theoretical ingredient cost" value={report.totals.theoreticalCost ? money(report.totals.theoreticalCost) : "Incomplete"} hint={report.totals.theoreticalCost && !report.totals.netSales.isZero() ? `${pct(report.totals.theoreticalCost.div(report.totals.netSales).times(100))} of net sales` : undefined} /> : null}
          {canCost ? <Stat label="Unexplained usage to review" value={money(report.totals.unexplainedValueReview)} tone={review.length ? "warn" : "ok"} hint={`${review.length} product(s)`} /> : null}
        </div>

        {report.recipesEnteredAfterPeriod.length ? (
          <Notice tone="info" title="Recipes set up after this period">
            {report.recipesEnteredAfterPeriod.join(", ")} {report.recipesEnteredAfterPeriod.length === 1 ? "was" : "were"} first entered after the closing count, so the first saved version is used for these sales. If the spec changed since, the figures for this period may not match how the drink was made then.
          </Notice>
        ) : null}
        {report.partialAggregateLines ? <Notice tone="warn">{report.partialAggregateLines} summary-report line(s) cover dates only partly inside this period and are left out. Align summary report ranges with count dates.</Notice> : null}

        <Card title="Inventory variance">
          <p className="mb-3 text-sm text-muted">Unexplained usage is what left the shelf that sales and records do not account for. It can come from pours, unlogged waste, missing sales, counting or recording mistakes, or loss. It does not show who, or why, and it is not proof of anything.</p>
          {report.lines.length ? (
            <ul className="space-y-3">
              {report.lines.map((l) => {
                const u = unit(l.dimension);
                return (
                  <li key={l.productId} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">{l.name}</p>
                      <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
                    </div>
                    <p className="mt-1 text-sm tabular">
                      Unexplained: <strong>{signed(l.unexplained, u)}</strong>{l.unexplainedPct ? ` (${pct(l.unexplainedPct)} of accounted usage)` : ""}{canCost && l.unexplainedValue ? ` · ${money(l.unexplainedValue)}` : ""}{l.uncertaintyBase.gt(0) ? ` · count estimate ±${num(l.uncertaintyBase, 0)} ${u}` : ""}
                    </p>
                    <details className="mt-2">
                      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-accent">How this was calculated</summary>
                      <DataList items={[
                        { label: "Opening count", value: l.opening ? `${num(l.opening, 1)} ${u}` : "—" },
                        { label: "+ Received", value: `${num(l.receipts, 1)} ${u}` },
                        { label: "+ Transfers in / batch output / event returns", value: `${num(l.transfersIn.plus(l.productionOutput).plus(l.eventReturns), 1)} ${u}` },
                        { label: "− Transfers out / supplier returns", value: `${num(l.transfersOut.plus(l.supplierReturns), 1)} ${u}` },
                        { label: "− Closing count", value: l.closing ? `${num(l.closing, 1)} ${u}` : "—" },
                        { label: "= Physical usage (measured)", value: l.physicalDepletion ? `${num(l.physicalDepletion, 1)} ${u}` : "—" },
                        { label: "Served, per recipes (estimate)", value: `${num(l.served, 1)} ${u}` },
                        { label: "+ Logged waste and breakage", value: `${num(l.waste.plus(l.breakage), 1)} ${u}` },
                        { label: "+ Used in batches / sent to events", value: `${num(l.productionConsumed.plus(l.eventDispatched), 1)} ${u}` },
                        { label: "= Accounted usage", value: `${num(l.accountedDepletion, 1)} ${u}` },
                        { label: "Manual adjustments (not counted as explained)", value: `${num(l.manualAdjustments, 1)} ${u}` },
                        ...(canCost ? [{ label: "Cost basis", value: l.costPerBase ? `${money(l.costPerBase.times(l.dimension === "count" ? 1 : 1000))} per ${l.dimension === "count" ? "each" : l.dimension === "volume" ? "L" : "kg"}` : "No cost" }] : []),
                      ]} />
                    </details>
                    {l.issues.length ? <ul className="mt-2 list-disc pl-5 text-xs text-muted">{l.issues.map((i) => <li key={i.message}>{i.message}</li>)}</ul> : null}
                    {l.possibleExplanations.length ? (
                      <div className="mt-2 text-sm">
                        <p className="font-medium">Possible explanations (not conclusions)</p>
                        <ul className="list-disc pl-5 text-muted">{l.possibleExplanations.map((x) => <li key={x}>{x}</li>)}</ul>
                      </div>
                    ) : null}
                    {l.recommendedChecks.length ? (
                      <div className="mt-2 text-sm">
                        <p className="font-medium">Recommended checks</p>
                        <ul className="list-disc pl-5">{l.recommendedChecks.map((x) => <li key={x}>{x}</li>)}</ul>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-sm text-muted">No products were counted in both counts.</p>}
        </Card>

        {aiAllowed ? (
          <Card title="AI explanation (optional)">
            {pending ? <><Notice tone="info" role="status">Working on it…</Notice><AutoRefresh everyMs={3000} /></> : null}
            {explanation?.status === "succeeded" && explanation.output ? (
              <div className="space-y-3 text-sm">
                <p>{explanation.output.summary}</p>
                {explanation.output.findings.map((f, i) => (
                  <div key={i} className="rounded border border-border p-2">
                    <p className="font-medium">{f.observation}</p>
                    {f.possible_explanations.length ? <p className="text-muted">Possible: {f.possible_explanations.join("; ")}</p> : null}
                    {f.recommended_checks.length ? <p>Check: {f.recommended_checks.join("; ")}</p> : null}
                    <p className="text-xs text-muted">Evidence: {f.evidence_ids.join(", ")}</p>
                  </div>
                ))}
                {explanation.output.data_gaps.length ? <p className="text-muted">Data gaps: {explanation.output.data_gaps.join("; ")}</p> : null}
                <p className="text-xs text-muted">Written by {explanation.provider === "stub" ? "the development stub" : `${explanation.provider}${explanation.model ? ` (${explanation.model})` : ""}`} from the figures above; the numbers come from the calculation, not the model. It can be wrong.</p>
              </div>
            ) : explanation && explanation.status !== "succeeded" ? (
              <Notice tone="warn">No explanation was produced{explanation.error ? `: ${explanation.error}` : ""}. The report above does not depend on it.</Notice>
            ) : null}
            {!pending && !(explanation?.status === "succeeded") && review.length ? <ExplainForm opening={opening.id} closing={closing.id} /> : null}
            <p className="mt-2 text-xs text-muted">Sends only the computed figures and product names above. No staff, guest or note data is sent.</p>
          </Card>
        ) : null}

        {report.unresolved.length ? (
          <Card title="Sales not matched to recipes" actions={app.can("imports.manage") ? <Link className="min-h-11 py-2 text-sm text-accent underline" href="/imports/mappings">Map items</Link> : null}>
            <ul className="text-sm">{report.unresolved.slice(0, 20).map((u) => <li key={u.name + u.reason} className="py-1">{u.name}: {u.reason} ({num(u.quantity)} sold, {money(u.netSales)})</li>)}</ul>
          </Card>
        ) : null}

        <Card title="Menu mix">
          <ul className="divide-y divide-border text-sm">
            {report.menuMix.map((m) => <li key={m.itemKey} className="flex justify-between gap-2 py-1.5"><span>{m.name}<span className="block text-xs text-muted">{m.recipeName ?? "not mapped"}</span></span><span className="tabular text-right">{num(m.quantity)} · {money(m.netSales)}</span></li>)}
          </ul>
        </Card>

        {report.voidCompByHour.length ? (
          <Card title="Voids, comps and refunds by hour">
            <ul className="text-sm">{report.voidCompByHour.map((v) => <li key={`${v.hour}${v.kind}`}>{String(v.hour).padStart(2, "0")}:00 · {v.kind} · {v.lines} line(s)</li>)}</ul>
            <p className="mt-2 text-xs text-muted">Patterns only. Shared stations and shifts do not identify a person, and this report has no staff dimension by design.</p>
          </Card>
        ) : null}

        <Card title="Method">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Physical usage = opening count + received + transfers in + batch output + event returns − transfers out − supplier returns − closing count.</li>
            <li>Accounted usage = recipe usage of matched sales + logged waste and breakage + batch ingredients + stock sent to events. Comps count as poured; voids count only if marked as made; refunds do not return stock.</li>
            <li>Unexplained = physical − accounted. Positive means more left the shelf than records explain. Percent is of accounted usage.</li>
            <li>Period: sales with a timestamp after the opening count and up to the closing count; date-only summaries only when fully inside the period ({report.period.fromDate} to {report.period.toDate}, business days end at {app.location.businessDayCutoff}).</li>
            <li>The recipe version and ingredient mapping in effect at the end of each business day are used; for dates before a recipe or mapping was first entered, the one in effect at the closing count is used, or the first one saved if it was entered after the period. {report.costBasis}.</li>
            <li>“Requires review” when unexplained usage exceeds both the count estimates (±) and {num(settings.variance_review_pct)}% of accounted usage, with at least {num(settings.min_sales_coverage_pct)}% of sales matched.</li>
            <li>Calculation version {report.calcVersion}.</li>
          </ul>
        </Card>
        <p className="text-xs text-muted"><Link className="underline" href={q(opening.id, closing.id)}>Link to this period</Link></p>
      </div>
    </>
  );
}
