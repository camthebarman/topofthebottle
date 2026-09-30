import "server-only";
import { after } from "next/server";
import { log } from "@/lib/log";
import { commitPosImport, validatePosImport } from "./pos";
import { extractInvoiceJob, markExtractionFailed } from "./invoice";
import { type JobKind, onFinalFailureOf, registerHandler, runJobs } from "./queue";

registerHandler("pos_import_validate", validatePosImport);
registerHandler("pos_import_commit", commitPosImport);
registerHandler("invoice_extract", extractInvoiceJob);
onFinalFailureOf("invoice_extract", (admin, job, message) => markExtractionFailed(admin, job, message));
onFinalFailureOf("pos_import_validate", async (admin, job, message, cancelled) => {
  await admin.from("pos_imports").update({ status: cancelled ? "cancelled" : "failed", error: message.slice(0, 1000) }).eq("id", String(job.payload.importId));
});
onFinalFailureOf("pos_import_commit", async (admin, job, message) => {
  // Nothing was written (single transaction); return the import to review.
  await admin.from("pos_imports").update({ status: "needs_review", error: message.slice(0, 1000) }).eq("id", String(job.payload.importId));
});

export { enqueue, runJobs } from "./queue";

/** Start processing after the response is sent. Durable: if this process dies, the tick endpoint or worker resumes the job. */
export function kick(kinds?: JobKind[]): void {
  after(async () => {
    try {
      await runJobs({ maxMs: 240_000, ...(kinds ? { kinds } : {}) });
    } catch (e) {
      log("error", "jobs.kick_failed", { error: e instanceof Error ? e.message : String(e) });
    }
  });
}
