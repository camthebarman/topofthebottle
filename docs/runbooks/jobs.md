# Runbook: background jobs

Kinds: `pos_import_validate`, `pos_import_commit`, `invoice_extract`, `insights_explain`,
`data_export`, `retention_sweep`. Stored in `public.jobs`.

## Running
- After enqueue, the request schedules a short run with `after()` (best effort).
- Reliable path: cron `POST /api/jobs/tick` with `Authorization: Bearer $JOBS_SECRET` every minute
  (runs ≤ 45 s, then retention), or `pnpm --filter web worker` as a long-running process.

## Diagnosing
```sql
select kind, status, count(*) from jobs group by 1,2;
select id, org_id, kind, attempts, last_error, locked_at from jobs where status in ('failed','running') order by updated_at desc limit 20;
```
- `running` with an old `locked_at` is recovered automatically after 2× its timeout.
- `failed` after max attempts: read `last_error`. Fix the cause, then requeue:
  `update jobs set status='queued', attempts=0, run_after=now() where id='…';`
- Users can cancel imports in the UI (`cancel_requested`).
- One running job per organization by default; a stuck job delays only that tenant.
