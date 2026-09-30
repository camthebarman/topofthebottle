import "server-only";
import { AiRefusedError, AiUnavailableError, type Explanation, explainVariance, vetExplanation } from "@/server/ai/provider";
import { type JobContext, PermanentJobError } from "./queue";

export const PROMPT_VERSION = "insights-explain-v1";

interface Evidence {
  lines: { id: string; product: string; status: string; unexplained: string | null; unit: string; approximate_counts: boolean }[];
  unmapped_sales: { id: string; item: string }[];
  sales_coverage_pct: string | null;
  missing_analysis: { analysis: string; needs: string }[];
}

/** Deterministic, non-AI explanation used by the development stub. */
export function stubExplanation(e: Evidence): Explanation {
  return {
    summary: `Development stub (no AI provider): ${e.lines.length} product(s) need review. Sales coverage ${e.sales_coverage_pct ?? "unknown"}%.`,
    findings: e.lines.slice(0, 5).map((l) => ({
      evidence_ids: [l.id],
      observation: `${l.product}: unexplained usage of ${l.unexplained ?? "?"} ${l.unit}${l.approximate_counts ? " (counts include estimates)" : ""}.`,
      possible_explanations: ["Unlogged waste", "Pours differing from the recipe", "Counting or recording mistakes"],
      recommended_checks: ["Recount the product", "Review the waste log for the period"],
    })),
    data_gaps: e.missing_analysis.map((m) => `${m.analysis}: ${m.needs}`),
  };
}

export async function explainJob(ctx: JobContext): Promise<Record<string, unknown>> {
  const { admin, job } = ctx;
  const runId = String(job.payload.runId);
  const { data: run } = await admin.from("analysis_runs").select("id, org_id, input_hash, result").eq("id", runId).eq("org_id", job.org_id).single();
  if (!run) throw new PermanentJobError("Analysis not found");
  const evidence = (run.result as { evidence: Evidence }).evidence;
  const evidenceHash = String(job.payload.evidenceHash);
  const { data: cached } = await admin.from("analysis_explanations").select("id").eq("run_id", runId).eq("evidence_hash", evidenceHash).eq("prompt_version", PROMPT_VERSION).eq("status", "succeeded").maybeSingle();
  if (cached) return { cached: true };
  const { data: settings } = await admin.from("org_settings").select("ai_insights_opt_in").eq("org_id", job.org_id).single();
  if (!settings?.ai_insights_opt_in) throw new PermanentJobError("AI explanations are turned off for this organization");
  const { data: ok } = await admin.rpc("consume_allowance", { p_org: job.org_id, p_metric: "ai_explanation", p_amount: 1 });
  if (!ok) throw new PermanentJobError("This month's AI explanation allowance is used up");
  try {
    const r = await explainVariance(evidence, () => stubExplanation(evidence));
    const allowed = new Set([...evidence.lines.map((l) => l.id), ...evidence.unmapped_sales.map((u) => u.id)]);
    const problem = vetExplanation(r.output, allowed);
    await admin.from("analysis_explanations").insert({
      org_id: job.org_id, run_id: runId, evidence_hash: evidenceHash, provider: r.provider, model: r.model, prompt_version: PROMPT_VERSION,
      status: problem ? "rejected" : "succeeded", output: problem ? null : r.output, error: problem, input_tokens: r.inputTokens, output_tokens: r.outputTokens, created_by: job.created_by,
    });
    return { status: problem ? "rejected" : "succeeded" };
  } catch (e) {
    if (e instanceof AiUnavailableError || e instanceof AiRefusedError) {
      await admin.from("analysis_explanations").insert({ org_id: job.org_id, run_id: runId, evidence_hash: evidenceHash, provider: "none", prompt_version: PROMPT_VERSION, status: "failed", error: e.message, created_by: job.created_by });
      throw new PermanentJobError(e.message);
    }
    throw e;
  }
}
