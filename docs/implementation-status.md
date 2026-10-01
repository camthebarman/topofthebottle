# Implementation status

Snapshot: 2026-10-01, branch `claude/bar-ops-platform`.

**Legend.** **Verified**: implemented and exercised by an automated test named in the Evidence
column (unit, pgTAP, integration against a real Postgres/Auth/Storage stack, or Playwright in
Chromium at 360 and 430 px against a production build). **Implemented**: built and reviewed, but no
automated test drives it end to end. **Partial**: some of the requirement is missing (stated).
**Blocked**: needs something this environment does not have. **Out of scope**: excluded by the
brief.

Nothing here is a claim of production readiness. See `docs/launch-blockers.md`.

## Reported defects (brief §2)
| # | Status | Evidence |
|---|---|---|
| D1 duplicate ingredients | Verified | `costing.test.ts` "reported defect 1"; reproduced against source (`docs/source-audit.md`) |
| D2 unresolved ingredients | Verified | `costing.test.ts` "reported defect 2"; e2e "Cost is incomplete" |
| D3 zero yield | Verified | `costing.test.ts` "reported defect 3"; DB check constraints; `legacy.test.ts` |
| D4 storage failures | Verified | `server.test.ts` "reports a persistence failure"; forms keep input on error |
| D5 destructive normalization | Verified | `legacy.test.ts`, `e2e/legacy.spec.ts`; `scripts/check-migrations.sh` in CI |
| D6 secrets in localStorage | Verified | Keys server-only; CSP `connect-src 'self'`; HttpOnly cookies asserted in `e2e/mfa.spec.ts` |
| D7 shared origin | Implemented (needs a deployed hostname to fully verify) | `src/proxy.ts` headers; zero CSP violations in e2e |
| D8 AI snapshot personal data | Verified | `Evidence` allow-list in `jobs/explain.ts`; vet tests |

## Architecture and tenancy (§3–4, §12)
| Requirement | Status | Evidence |
|---|---|---|
| TypeScript strict, Next.js 16, Tailwind 4, Supabase, decimal domain package | Verified | CI typecheck + builds |
| Multi-org, multi-location, roles (owner/manager/bartender/read-only) | Verified | pgTAP 01; `isolation.test.ts`; e2e invites a bartender |
| RLS on all 60 tables; tenant-safe composite FKs | Verified | pgTAP `02_grants` (RLS on every table), 01 (cross-tenant FK refusal) |
| Guessed IDs, nested selects, storage paths, jobs, definer reports | Verified | `isolation.test.ts` (11 cases) |
| Ledger immutability, reversals, audit log protected | Verified | pgTAP; e2e reversal |
| Optimistic concurrency | Verified | `e2e/stock.spec.ts` concurrent edit; perf finalize race |
| Business day, timezone, DST, overnight | Verified | domain `ops.test.ts` (fall-back overnight shift); e2e overnight shift |
| Decimal money/qty, dimensional units, US fl oz vs weight oz | Verified | domain tests |
| Pagination / no full-history loads | Implemented | `fetchAll` paging; lists limited; aggregates server-side |
| MFA (TOTP) enforced for enrolled users on pages, actions, APIs | Verified | `e2e/mfa.spec.ts` |
| Requiring MFA for every owner/manager (org policy) | Partial | Supported, not mandatory; no org-level "require MFA" switch |
| Revocable invitations, membership changes, last-owner protection | Verified (DB) | pgTAP; e2e invite accept |
| Rate limits (auth) and tenant allowances (uploads, AI, extraction, rows) | Verified | `rate-limit.test.ts`; `consume_allowance` used by jobs. Limiter is per-instance memory |
| CSP nonce, security headers, no-store private responses | Verified | e2e CSP listener |
| Structured redacted logs with correlation ids | Implemented | `src/lib/log.ts`; used in actions and uploads |
| Dependency and secret scanning | Verified | GitHub Actions run on this branch: `pnpm audit` and gitleaks passed |
| Backup/restore drill | Verified (database) | `scripts/backup-restore-check.sh` locally and in CI; Storage restore not drilled |
| Export and deletion workflows, retention | Verified | e2e export; `retention.test.ts`; `03_org_deletion.test.sql` deletes a populated organization (recipes, ledger, transfer) |
| Stripe checkout, portal, signed idempotent webhooks, entitlements, grace | Partial | Webhook signature/replay/out-of-order verified (`stripe.test.ts`); checkout and portal **not run** (no Stripe test account in this environment) |

## Product (§5–9)
| Requirement | Status | Evidence |
|---|---|---|
| Navigation Today / Recipes / Inventory / Bar Book / More; desktop sidebar | Verified | e2e at 360 px; screenshots |
| 360–430 px, no horizontal scroll, labelled controls, unique ids | Verified at 360 and 430 px | `expectNoHorizontalScroll` (also asserts no duplicate ids) on every major page |
| Save/error/conflict states, drafts isolated and cleared on sign-out | Verified | e2e; `drafts.tsx` |
| Installable app shell | Partial | Web manifest and icon; no service worker or offline shell (connectivity required by design) |
| Screen-reader / keyboard support | Implemented | Native elements, labels, live regions; no audit with assistive technology performed |
| Classic library (17 original templates, provenance), copy and customize | Verified | e2e copies and edits Negroni |
| Custom drinks, preps, basic food recipes, versions | Verified | e2e; `stock.spec.ts` links prep to stock |
| Ingredient→product mapping per location, effective-dated | Verified | e2e |
| Cost/serving, cost %, ingredient margin, target price, availability, freshness | Verified | e2e (21.7% cost) and domain tests |
| Current menu selection vs library; history uses effective versions | Verified | e2e; Insights tests use closing-count version fallback |
| Prepared vs raw availability, cycles, nested preps | Verified | domain tests |
| Inventory areas, counts (tenths, scale, measured) with uncertainty | Verified | e2e count; domain tests |
| Waste, breakage, returns, adjustments, transfers, batch production, reversals | Verified | `e2e/stock.spec.ts` + ledger check |
| Pars, valuation, suggested order quantities | Verified (domain) / Implemented (UI) | domain tests; inventory overview |
| Invoice upload (PDF/image/CSV), sniffing, size/page limits, private storage, signed URLs | Verified | unit tests; e2e uploads a CSV invoice |
| Invoice extraction by AI vision | Blocked | Code path built; no API key. Stub used in development |
| Review: correct fields, product matches (never auto-accepted), totals reconciliation | Verified | e2e invoice review; `ops.test.ts` |
| Approval separate from receiving; billed vs received differences | Verified | e2e approve then receive |
| Duplicates (hash + supplier/number) with override reason | Verified (domain + DB) | `ops.test.ts`; approve requires reason |
| Credit notes | Verified (DB/domain) | approve handles credit notes; no e2e |
| Invoice reversal and corrected invoices | Verified | `invoice-reversal.test.ts`, `e2e/invoice-reversal.spec.ts` |
| Cost policy (freight/tax) and reproducible history | Verified | domain landed-cost tests; reversal test checks as-of costs |
| Bar Book: categories, priority, visibility, tasks, due, resolution, acks, history, search, carry-forward | Verified | `e2e/flow.spec.ts` (ack), `e2e/secondary.spec.ts` (visibility, task resolve) |
| Schedule: staff, shifts, copy week, overlaps, overnight, publish versions, notices | Verified | e2e (publish overnight, notice); `secondary.spec.ts` (overlap blocks publish); domain tests (copy, diff) |
| Payroll, timeclock, labour law, marketplaces | Out of scope | |
| Events: demand allocation, batches, pack rounding, ice, costs, quote snapshots, CSV, prep sheet | Verified | e2e (225 drinks, quote v1, CSV); `secondary.spec.ts` (sheet); `catering` domain tests |
| Events: stock moves only by explicit dispatch/return | Verified | `secondary.spec.ts` + ledger check |

## POS import and Insights (§10–11)
| Requirement | Status | Evidence |
|---|---|---|
| Generic mapper: encoding/BOM, delimiter, preview, mapping, date formats, decimals | Verified | `csv-pos.test.ts`; `templates.test.ts`; e2e |
| Quarantine with reasons; explicit acceptance of partial imports | Verified | e2e (bad quantity row) |
| Dedupe by line ids / fingerprints; overlapping aggregate policy | Verified | domain tests; `commit_pos_import` |
| Staff/personal columns excluded | Verified | e2e Toast `Server` column absent from export |
| Modifiers (ignore/scale/add/substitute) or marked incomplete | Verified (domain) | `csv-pos.test.ts`, usage tests |
| Voids/comps/refunds treatment | Verified | domain + e2e counts |
| 50k-row import outside request | Verified | `docs/performance.md` |
| Toast presets | **Unverified** | From Toast's published field reference; no real export available |
| Square preset | **Unverified draft** | No authoritative header reference |
| Lightspeed, Clover | Generic mapper only | |
| Direct POS integrations, Zapier | Out of scope (future) | |
| Recipes entered after the analysed period | Verified (demo data) | First saved version is used and the report names those recipes |
| Capability levels, variance formula, method, uncertainty, coverage, freshness | Verified | `variance.test.ts` (brief fixture: +500 mL, $10, no accusation); e2e Insights |
| AI explanations with validated, vetted, cited output; no-AI fallback | Verified with stub / Blocked live | Vet tests; e2e stub. Live provider not called |

## Operations (§13)
| Requirement | Status | Evidence |
|---|---|---|
| Durable jobs (retry, backoff, timeout, progress, cancel, recovery, per-org cap) | Verified (cancel: Implemented) | perf import via jobs; isolation tests for job access; import cancel button has no automated test |
| Health check | Implemented | `/api/health` |
| Error monitoring | Partial | Structured logs only; no monitoring service wired |
| Runbooks, environment docs, migrations, cost model | Done | `docs/runbooks/*`, `docs/cost-model.md` |
| Performance workloads with environment | Verified | `docs/performance.md`, `docs/evidence/perf-2026-10-01.json` |

## Public demo
| Requirement | Status | Evidence |
|---|---|---|
| Demo mode (banner, one-tap roles, unsafe actions refused) | Verified locally | `e2e/demo.spec.ts`, `demo.test.ts` |
| Nightly demo data rebuild through the app's own functions and import jobs | Verified locally | `pnpm --filter web demo:reset` run repeatedly against the local stack |
| Hosted demo (Supabase + Vercel) | Blocked | Needs the owner's accounts; steps in `docs/runbooks/demo.md` |

## Checkpoint log
- 2026-09-30: domain engine; schema and RLS; products, recipes, menu, inventory; invoices; POS
  import; Bar Book, schedule, events; Insights; billing; hardening.
- 2026-10-01: MFA enforced in `getContext`; HttpOnly cookies; unique field ids; TRUNCATE revoked;
  invoice reversal/correction; CSV invoice rows never dropped silently; trusted-hop client IP;
  retention, rate-limit, reversal, stock, MFA and secondary-flow tests; CI; documentation.
- 2026-10-01 (later): docs site; demo mode and demo data. Building the demo found two real bugs, both
  fixed and tested: organizations with deliveries, transfers or recipes could not be deleted (missing
  cascade paths and immediate foreign-key checks), and Insights ignored recipes entered after the
  analysed period.
