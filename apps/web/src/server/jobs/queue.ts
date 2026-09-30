import "server-only";
import { hostname } from "node:os";
import { log } from "@/lib/log";
import { type AdminClient, createAdminClient } from "@/lib/supabase/admin";

export type JobKind = "pos_import_validate" | "pos_import_commit" | "invoice_extract" | "insights_explain" | "data_export" | "retention_sweep";

export interface JobRow {
  id: string;
  org_id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  timeout_seconds: number;
  created_by: string | null;
  cancel_requested: boolean;
}

export class JobCancelled extends Error {}
/** A failure that retrying will not fix (bad input). */
export class PermanentJobError extends Error {}

export interface JobContext {
  admin: AdminClient;
  job: JobRow;
  progress(pct: number): Promise<void>;
  /** Throws JobCancelled if a person asked to cancel. */
  checkCancelled(): Promise<void>;
}

type Handler = (ctx: JobContext) => Promise<Record<string, unknown> | void>;
const handlers = new Map<JobKind, Handler>();

export function registerHandler(kind: JobKind, h: Handler): void {
  handlers.set(kind, h);
}

/**
 * Queue a job. Call only after the caller's permission for the underlying
 * action has been checked; the service role writes the row.
 */
export async function enqueue(orgId: string, kind: JobKind, payload: Record<string, unknown>, opts: { createdBy: string; idempotencyKey?: string; timeoutSeconds?: number; maxAttempts?: number }): Promise<string> {
  const admin = createAdminClient();
  if (opts.idempotencyKey) {
    const { data } = await admin.from("jobs").select("id").eq("org_id", orgId).eq("kind", kind).eq("idempotency_key", opts.idempotencyKey).maybeSingle();
    if (data) return data.id as string;
  }
  const { data, error } = await admin
    .from("jobs")
    .insert({ org_id: orgId, kind, payload, created_by: opts.createdBy, idempotency_key: opts.idempotencyKey ?? null, timeout_seconds: opts.timeoutSeconds ?? 300, max_attempts: opts.maxAttempts ?? 3 })
    .select("id")
    .single();
  if (error) throw new Error(`Could not queue job: ${error.message}`);
  return data.id as string;
}

const WORKER = `${hostname()}:${process.pid}`;
let running = false;

/** Process jobs until none are runnable or the time budget is spent. */
export async function runJobs(opts: { maxMs?: number; kinds?: JobKind[] } = {}): Promise<number> {
  if (running) return 0; // one runner per process; other instances claim safely via SKIP LOCKED
  running = true;
  const deadline = Date.now() + (opts.maxMs ?? 55_000);
  const kinds = opts.kinds ?? [...handlers.keys()];
  const admin = createAdminClient();
  let processed = 0;
  try {
    while (Date.now() < deadline) {
      const { data, error } = await admin.rpc("claim_job", { p_worker: WORKER, p_kinds: kinds, p_per_org_limit: 1 });
      if (error) {
        log("error", "jobs.claim_failed", { error: error.message });
        break;
      }
      const job = (data as JobRow[] | null)?.[0];
      if (!job) break;
      await runOne(admin, job);
      processed++;
    }
  } finally {
    running = false;
  }
  return processed;
}

async function runOne(admin: AdminClient, job: JobRow): Promise<void> {
  const handler = handlers.get(job.kind);
  const started = Date.now();
  const ctx: JobContext = {
    admin,
    job,
    progress: async (pct) => {
      await admin.from("jobs").update({ progress: Math.max(0, Math.min(100, Math.round(pct))), locked_at: new Date().toISOString() }).eq("id", job.id);
    },
    checkCancelled: async () => {
      const { data } = await admin.from("jobs").select("cancel_requested").eq("id", job.id).single();
      if (data?.cancel_requested) throw new JobCancelled("Cancelled");
      if (Date.now() - started > job.timeout_seconds * 1000) throw new Error(`Timed out after ${job.timeout_seconds}s`);
    },
  };
  try {
    if (!handler) throw new PermanentJobError(`No handler for ${job.kind}`);
    const result = await handler(ctx);
    await admin.from("jobs").update({ status: "succeeded", progress: 100, result: result ?? null, locked_at: null, last_error: null }).eq("id", job.id);
    log("info", "jobs.succeeded", { jobId: job.id, kind: job.kind, ms: Date.now() - started });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cancelled = err instanceof JobCancelled;
    const permanent = err instanceof PermanentJobError || cancelled;
    const retry = !permanent && job.attempts < job.max_attempts;
    const backoffSeconds = Math.min(600, 15 * 2 ** (job.attempts - 1));
    await admin
      .from("jobs")
      .update({
        status: cancelled ? "cancelled" : retry ? "queued" : "failed",
        last_error: message.slice(0, 1000),
        locked_at: null,
        locked_by: null,
        run_after: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
      })
      .eq("id", job.id);
    log(retry ? "warn" : "error", "jobs.failed", { jobId: job.id, kind: job.kind, attempt: job.attempts, retry, error: message });
    if (!retry) await onFinalFailure(admin, job, message, cancelled);
  }
}

const finalFailureHooks = new Map<JobKind, (admin: AdminClient, job: JobRow, message: string, cancelled: boolean) => Promise<void>>();
export function onFinalFailureOf(kind: JobKind, hook: (admin: AdminClient, job: JobRow, message: string, cancelled: boolean) => Promise<void>): void {
  finalFailureHooks.set(kind, hook);
}
async function onFinalFailure(admin: AdminClient, job: JobRow, message: string, cancelled: boolean) {
  try {
    await finalFailureHooks.get(job.kind)?.(admin, job, message, cancelled);
  } catch (e) {
    log("error", "jobs.final_failure_hook_failed", { jobId: job.id, error: e instanceof Error ? e.message : String(e) });
  }
}
