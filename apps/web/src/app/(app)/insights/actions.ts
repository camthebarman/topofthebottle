"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action, zUuid } from "@/lib/action";
import { fromDbError, UserError } from "@/lib/errors";
import { getContext, requirePerm } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiMode } from "@/server/ai/provider";
import { aiEvidence, buildReport, CALC_VERSION } from "@/server/insights";
import { enqueue, kick } from "@/server/jobs";
import { orgSettings } from "@/server/menu";

export const requestExplanation = action(z.object({ opening: zUuid, closing: zUuid }), async ({ opening, closing }) => {
  const app = await getContext();
  requirePerm(app, "insights.view");
  requirePerm(app, "insights.ai");
  requirePerm(app, "costs.view");
  const settings = await orgSettings(app);
  if (!settings.ai_insights_opt_in) throw new UserError("AI explanations are off. An owner or manager can turn them on in Settings.");
  if (aiMode() === "unavailable") throw new UserError("AI explanations are not configured on this server.");
  const report = await buildReport(app, opening, closing);
  const evidence = aiEvidence(report);
  if (!evidence.lines.length) throw new UserError("Nothing in this period needs review, so there is nothing to explain.");
  const evidenceHash = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  const admin = createAdminClient();
  const { data: run, error } = await admin
    .from("analysis_runs")
    .insert({ org_id: app.org.orgId, location_id: app.location.id, opening_count_id: opening, closing_count_id: closing, calc_version: CALC_VERSION, input_hash: report.inputHash, capability: report.capability.level, result: { evidence, evidence_hash: evidenceHash }, created_by: app.user.id })
    .select("id")
    .single();
  if (error) throw fromDbError(error);
  await enqueue(app.org.orgId, "insights_explain", { runId: run.id, evidenceHash }, { createdBy: app.user.id, idempotencyKey: `${run.id}`, timeoutSeconds: 180, maxAttempts: 2 });
  kick(["insights_explain"]);
  redirect(`/insights?opening=${opening}&closing=${closing}&explain=${run.id}`);
});
