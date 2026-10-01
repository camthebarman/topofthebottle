# Test results

Run on 2026-10-01 in the development container (4-core Xeon, 16 GB) against the local Supabase
stack, and on GitHub Actions for branch `claude/bar-ops-platform`.

| Suite | Command | Result |
|---|---|---|
| Domain unit tests (costing, units, inventory, variance fixture, CSV/POS, catering, invoices, legacy, templates) | `pnpm --filter @tz/domain test` | 88 passed |
| Web unit tests (actions, uploads, CSV invoices, AI vetting, rate limiting, demo mode) | `pnpm --filter web test` | 15 passed |
| Database tests (pgTAP: tenancy, RLS, ledgers, grants, organization deletion) | `pnpm exec supabase test db` | 48 passed |
| Integration (real Postgres/Auth/Storage: isolation, Stripe webhooks, retention, invoice reversal) | `pnpm --filter web test:integration` | 17 passed |
| End to end (Chromium at 360×780 and 430×932, production build, CSP violations fail the run) | `pnpm --filter web test:e2e` | 18 passed (9 scenarios × 2 widths); 6 demo-mode tests run separately against a demo server, also passing |
| Performance workloads | `pnpm --filter web test:perf` | 3 passed; numbers in `docs/performance.md` |
| Backup/restore drill | `bash scripts/backup-restore-check.sh` | PASSED (60 tables, users, ledger sum) |
| Migration safety | `bash scripts/check-migrations.sh` | passed |
| Lint / typecheck | `pnpm --filter web lint`, `pnpm typecheck` | clean |
| Dependency audit | `pnpm audit --prod --audit-level high` | no known vulnerabilities (1 low in dev deps) |
| Secret scan | gitleaks (CI) | passed |

## End-to-end scenarios
1. `flow.spec.ts`: the brief's journey: create organization → invite bartender → products and costs
   → copy and customize Negroni → current menu → upload, review, approve CSV invoice → confirm
   receiving → count stock → import Toast-format sales (with a bad row and a Server column) →
   Insights variance → Bar Book handoff acknowledged by staff → publish overnight schedule, staff
   notified → plan an event, quote snapshot, CSV → full export (staff gets 403).
2. `stock.spec.ts`: waste, batch production, transfer between locations, reversal; two users
   editing the same product (second save refused).
3. `invoice-reversal.spec.ts`: reverse an approved, received invoice; start a correction.
4. `mfa.spec.ts`: TOTP enrolment; password-only session blocked from pages and `/api/export`;
   session cookies HttpOnly.
5. `secondary.spec.ts`: managers-only Bar Book entry hidden from staff; task resolved; schedule
   overlap blocks publishing; event send/return and prep sheet.
6. `legacy.spec.ts`: import of earlier-tool JSON lists every record not imported.
7. `demo.spec.ts` (only with `DEMO_E2E=1` against a `DEMO_MODE=1` server after `pnpm --filter web demo:reset`): one-tap demo sign-in, Insights flags the seeded gin and lime-juice overuse, two-factor setup, invitations and sign-up are refused, and the bartender sees no costs.

Screenshots from the 360 px run: `docs/screenshots/` (full page).

Not covered by automated tests: Stripe Checkout/Portal UI, live AI calls, magic-link email
sign-in, import cancel button, credit-note UI, tablet and desktop widths.
