# Launch blockers and known limitations

## Must be resolved before charging customers
1. **No production environment exists.** Hosted Supabase project, Node host on a dedicated
   hostname, SMTP, scheduler for jobs, monitoring: see `docs/runbooks/environment.md`.
   Nothing has been deployed (deployment needs separate authorization).
2. **Stripe not exercised end to end.** Webhook verification, idempotency and entitlement states
   are tested with signed synthetic events; Checkout and the Customer Portal have never run against
   a Stripe test account. Create the product/price, run a test-mode subscription, cancellation and
   failed payment, and confirm entitlement banners and read-only mode.
3. **AI provider never called live.** Invoice vision extraction and Insights explanations ran only
   against the development stub. With a real key: test refusals, latency, token costs, extraction
   quality on real invoices, and confirm the provider's data-retention terms for the privacy notice.
4. **POS presets unverified.** Toast presets follow published documentation; Square is a draft.
   Obtain real exports (with the customer's consent) and mark presets verified only after they pass.
5. **No independent security review or penetration test.** The threat model is self-assessed.
6. **Legal documents missing:** terms, privacy notice (staff data, AI processing, retention,
   backups), data processing agreement, sub-processor list.
7. **Backups in production:** enable PITR and Storage replication, and drill a restore of both.
8. **Rate limiter is per-instance memory.** Move to a shared store before running more than one
   app instance.

## Should be resolved soon after
- Org setting to require MFA for owners and managers (MFA is supported and enforced once enrolled).
- Error monitoring service and alerting on job backlog (`/api/health` exposes `queued_over_15m`).
- Bundled export including uploaded files (JSON export covers records; files download individually).
- Malware scanning of uploads.
- Accessibility review with a screen reader; automated runs cover 360 and 430 px, not tablet/desktop.
- `sales_lines` partitioning plan before ≈ 300 active locations (`docs/cost-model.md`).

## Known product limitations (by design or deferred)
- Connectivity required for all writes; no offline mode or service worker.
- Two people counting the same product in the same area: last save wins for that line.
- Toast comps appear as discounted sales unless the export flags them.
- POS staff identifiers are deliberately not imported (ADR 0008), so no per-person analysis.
- One background job per organization at a time; a large import delays that tenant's next job.
- Payroll, timeclock, labour-law rules, direct POS integrations and Zapier are out of scope.
- CSV invoices: up to 200 lines per file (the excess is reported, not dropped).
