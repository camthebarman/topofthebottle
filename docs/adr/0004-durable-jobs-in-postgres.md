# ADR 0004: Durable jobs in Postgres

Status: accepted

## Context
POS imports of 50k rows, invoice extraction and AI explanations exceed request time limits and must
survive restarts. Adding a queue service raises cost and operational surface.

## Decision
A `jobs` table with `claim_job()` using `FOR UPDATE SKIP LOCKED`, a per-organization concurrency cap
(default one running job per org, so one tenant's 50k-row import cannot occupy every worker), FIFO by
`run_after`, recovery of jobs whose lock is older than twice their timeout, exponential backoff, max
attempts, cancellation and idempotency keys. Runners: `after()` kicks a short run after enqueue;
`POST /api/jobs/tick` (bearer secret) for a cron; `scripts/worker.ts` for a long-running worker.

## Consequences
+ No extra infrastructure; jobs are transactional with the data they change.
− Throughput bounded by Postgres; measured 50k-row validate ≈ 7 s and commit ≈ 2 s locally, ample for
  the target scale. Revisit beyond ~1k active locations importing daily.
