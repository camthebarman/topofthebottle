# Runbook: incidents

1. **Assess.** `/api/health` (database round trip and `queued_over_15m` job backlog), the jobs
   runbook queries, Supabase status page.
2. **Suspected cross-tenant exposure or credential leak:** rotate the affected secret first
   (Supabase service role / JWT secret, Stripe, Anthropic, JOBS_SECRET), redeploy, then
   investigate via `audit_events` and logs. Notify affected customers per your legal obligations.
3. **Bad data after a release:** prefer forward fixes and ledger reversals. Restore only via the
   single-tenant procedure in the backup runbook.
4. **Billing webhook failures:** Stripe retries for 3 days; events are idempotent (`stripe_events`),
   so replaying from the Stripe dashboard is safe.
5. **AI provider outage or cost spike:** set `ANTHROPIC_API_KEY` empty (features degrade to
   "not available"; CSV invoice reading still works) or lower `usage_allowances`.
6. Write a short post-incident note: timeline, impact, cause, fixes.
