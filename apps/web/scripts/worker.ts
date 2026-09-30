/**
 * Standalone job worker for deployments where request-time processing is not
 * enough (large imports, many tenants). Run: pnpm worker
 * It uses the same handlers as the web app and claims jobs with SKIP LOCKED,
 * so any number of workers and web instances can run side by side.
 */
import { runJobs } from "../src/server/jobs";
import { runRetention } from "../src/server/retention";

let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

async function main() {
  console.log(JSON.stringify({ event: "worker.started", pid: process.pid }));
  let lastRetention = 0;
  while (!stopping) {
    const n = await runJobs({ maxMs: 55_000 });
    if (Date.now() - lastRetention > 3_600_000) {
      console.log(JSON.stringify({ event: "worker.retention", ...(await runRetention()) }));
      lastRetention = Date.now();
    }
    if (n === 0) await new Promise((r) => setTimeout(r, 2000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
