# Threat model

Scope: the Table Zero Bar web app (Next.js on a Node host), Supabase (Postgres, Auth,
private Storage), Stripe (billing), Anthropic API (optional AI). Method: STRIDE per
trust boundary, then the specific risks named in the product brief.

This is an engineering threat model written alongside the implementation. **It is not a
security audit or penetration test, and none has been performed.** See "Open risks".

## Assets

| Asset | Why it matters |
|---|---|
| Tenant business data: costs, prices, stock, invoices, sales | Commercially sensitive; competitors and vendors would value it |
| Staff data: names, emails, schedules, Bar Book authorship and acknowledgements | Personal data of employees |
| Uploaded documents (invoices, POS CSVs) | May contain addresses, account numbers, staff names in CSV columns |
| Session cookies, MFA factors | Account takeover |
| Server secrets: Supabase service role, Stripe, Anthropic, JOBS_SECRET | Full cross-tenant access, billing fraud, AI spend |
| Ledger integrity (stock movements, receivings, sales) | Variance and costs are only as trustworthy as the history |

## Trust boundaries

1. Browser ↔ app server (untrusted client; all input validated with zod on the server).
2. App server ↔ Postgres as the **user** (anon key + user JWT; RLS is the enforcement point).
3. App server ↔ Postgres as **service role** (jobs, webhooks, retention only; bypasses RLS).
4. App server ↔ Stripe (signed webhooks in; API calls out).
5. App server ↔ Anthropic (untrusted model output in; minimised evidence out).
6. Scheduler ↔ `/api/jobs/tick` (shared bearer secret).

## Controls by threat

| Threat | Control | Where | Verified |
|---|---|---|---|
| Cross-tenant read/write (S, I, E) | RLS on all 60 public tables; helper functions `app.is_member/has_perm/has_location_perm`; tenant-safe composite FKs `(org_id, id)` so a row cannot reference another org's row | migrations `0100`–`1200` | pgTAP 42 tests; integration `isolation.test.ts` (API-level, second tenant) |
| Over-privileged staff (E) | Role → permission table; location scoping via `memberships.location_ids`; costs in separate tables so bartenders cannot read them (`costs.view`) | `role_permissions`, `product_costs` | pgTAP; e2e signs in as bartender and checks cost absence |
| Server actions callable directly (E) | Every action calls `getContext()` + `requirePerm()`; RLS still applies underneath | `src/lib/session.ts`, `src/lib/action.ts` | integration + e2e |
| MFA bypass via actions/API (S) | `getContext()` redirects any session with a verified factor but `aal1` to `/mfa`; covers pages, actions, route handlers | `src/lib/session.ts` | `e2e/mfa.spec.ts` (export API refused before step-up) |
| Session theft via XSS (S, I) | Strict CSP with per-request nonce, `script-src 'self' 'nonce-…' 'strict-dynamic'`, `connect-src 'self'`, `frame-ancestors 'none'`; HttpOnly SameSite=Lax session cookies; React escaping; no `dangerouslySetInnerHTML` | `src/proxy.ts`, `src/lib/supabase/*` | e2e: zero CSP violations across the full flow; cookies asserted HttpOnly |
| Shared origin (D7) | Dedicated hostname; no GitHub Pages; `Cache-Control: private, no-store` on authenticated responses | `src/proxy.ts` | headers inspected in e2e runs |
| Credential stuffing / brute force (S) | Per address+account: sign-in 8/min, magic link 3/min, MFA 6/min, invites 10/min, sign-up 5/min per address. Per account regardless of address: sign-in 30/15 min, magic link 6/15 min. Client address is read from the right of `X-Forwarded-For` (`TRUSTED_PROXY_HOPS`) so a forged header cannot rotate it. Supabase Auth's own limits also apply. Trade-off: the per-account cap lets someone delay a known user's sign-in for up to 15 min | `src/lib/rate-limit.ts`, `src/app/(auth)/actions.ts` | `test/unit/rate-limit.test.ts`; **single-instance memory store** (see open risks) |
| Malicious uploads (T, D) | 25 MB cap, 50 PDF pages, type sniffed from bytes (not extension/MIME), private bucket with MIME allow-list, signed URLs with short expiry, SHA-256 dedupe, per-org monthly byte allowance | `src/server/uploads.ts`, migration `0400` | unit tests (`identifies files by content`, `counts PDF pages`) |
| CSV formula injection in exports (T) | `csvCell` neutralizes formula-trigger cells (keeps legitimate negative numbers); full data export is JSON | `packages/domain/src/csv.ts` (`neutralizeFormula`) | `csv-pos.test.ts` "formula injection" |
| Prompt injection via invoices, CSVs, notes, filenames (T, E) | Model has **no tools, no SQL, no write authority**; output is a zod-validated structure; system prompts mark evidence as untrusted data; `vetExplanation` rejects accusatory language and evidence ids not in the input; invoice extraction output is a *draft* a human must confirm line by line before approval | `src/server/ai/provider.ts`, `jobs/explain.ts`, `jobs/invoice.ts` | unit tests "rejects accusations and invented evidence" |
| AI data minimisation (I, D8) | Org opt-in per feature (`ai_insights_opt_in`, `ai_invoice_opt_in`, default off); evidence allow-list (product names, quantities, statuses, coverage) — no staff, guests, notes, Bar Book, schedules; monthly allowance (30 explanations, 60 extractions by default) | `org_settings`, `usage_allowances` | code review; unit tests |
| AI key exposure (D6) | Keys in server env only, modules marked `server-only`; browser never contacts provider (`connect-src 'self'`) | `src/lib/env.ts` | CSP e2e |
| Accusing staff (reputational / legal) | Variance language is "unexplained usage", never theft; no per-person variance; AI output vetted; void/comp-by-hour report has no staff dimension and says so | `packages/domain/src/variance.ts`, insights UI | domain variance test asserts wording; vet tests |
| Staff personal data from POS CSV | Columns matching server/employee/staff/bartender/cashier are flagged sensitive and **cannot be mapped**; they are not stored in sales lines | `packages/domain/src/pos.ts` | `e2e/flow.spec.ts` (Toast `Server` column) |
| Ledger tampering (T, R) | Stock movements, receivings and sales are insert-only (UPDATE/DELETE revoked); corrections are reversals; audit log written only by definer function | migrations `0300`, `0400`, `0500` | pgTAP |
| Lost updates (T) | `version` column + trigger raises 40001 on stale writes; shown as "Someone else changed this" | `app.bump_version` | `e2e/stock.spec.ts` concurrent edit; perf concurrent counts |
| Replay / forged Stripe webhooks (S, T) | Signature check on raw body; event ids stored (`stripe_events`) for idempotency; out-of-order events ignored by `created` timestamp | `api/stripe/webhook` | `test/integration/stripe.test.ts` |
| Job endpoint abuse (E, D) | Bearer secret ≥ 32 chars, timing-safe compare; endpoint disabled if unset | `api/jobs/tick` | manual |
| Noisy tenant starves others (D) | Job claim fairness per org, timeouts, backoff, max attempts; CSV import runs out of request; per-org allowances | `claim_job`, `jobs/queue.ts` | perf: 50k-row import in background |
| Secrets in logs (I) | Structured logger redacts fields named like token, secret, password, authorization, cookie, api key, service role, email, phone, card | `src/lib/log.ts` | code review |
| Secrets in repo (I) | `.env.local` git-ignored; gitleaks in CI | `.github/workflows/ci.yml` | **CI not yet run** at time of writing |
| Data deletion requests (privacy) | Owner-requested org deletion with 30-day delay, cancellable, then cascade + storage purge; document retention (invoices 7 y, POS files 2 y), audited | `server/retention.ts` | `test/integration/retention.test.ts` (expired vs current files; due vs not-yet-due org; other tenants untouched) |

## Open risks and prerequisites (not mitigated here)

1. **No independent security review or penetration test** has been done.
2. **Rate limiter is in-memory per instance.** Behind more than one instance it must move
   to a shared store (Postgres or Redis). Supabase Auth's own limits still apply.
3. **Supabase hosted project hardening** (network restrictions, leaked-password protection,
   SMTP with DKIM/SPF, backup PITR, log drains) is a production configuration task, not
   code; see `docs/runbooks/environment.md`.
4. **No malware scanning** of uploads. Files are never executed or rendered inline except
   as images/PDF via signed URL download, but a scanner should be added before onboarding
   untrusted vendors' files at scale.
5. **The AI provider path has only run against the development stub.** No real API key was
   available; behaviour with the live model (refusals, latency, cost) is unverified.
6. **Stripe has only been exercised with signed synthetic events** in tests, not with a
   real Stripe test-mode account.
7. Session revocation on role change relies on RLS (immediate) but the JWT stays valid
   until expiry (default 1 h) for Auth-level claims.
8. Dependency vulnerabilities: `pnpm audit --prod` reported none at high/critical on
   2026-10-01; one low-severity dev-dependency advisory remained.
