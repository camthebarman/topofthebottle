# Table Zero Bar

Bar operations for independent bars: beverage costing, a recipe book with classic templates,
current-menu dashboard, inventory and purchasing with an invoice reader, POS CSV imports with
deterministic variance analysis (Insights), a Bar Book for handoffs, basic scheduling, and a
beverage-event calculator. Mobile-first, multi-organization, multi-location.

**Status:** working software with automated tests; **not deployed and not production-ready**.
Read `docs/implementation-status.md` and `docs/launch-blockers.md` first.

## Layout
```
packages/domain   Pure TypeScript calculation engine (decimal.js, no I/O) + tests
apps/web          Next.js 16 app: pages, server actions, API routes, jobs, tests, e2e
supabase/         Migrations (RLS everywhere), pgTAP tests, demo seed, local config
scripts/          Migration safety check, restore drill, env writer, data dictionary generator
docs/             Audit, threat model, ADRs, runbooks, performance, cost model, screenshots
```

## Run locally
Requires Node 22, pnpm 10 and Docker.
```
pnpm install
pnpm db:start                      # local Supabase (Postgres, Auth, Storage)
bash scripts/write-local-env.sh    # apps/web/.env.local with local keys
pnpm db:reset                      # migrations + demo data
pnpm dev                           # http://localhost:3000
```
Demo accounts (local only, password `demo-password-123`): `owner@demo.test`,
`manager@demo.test`, `bartender@demo.test`, and `other-org@demo.test` (a separate tenant).
Background jobs run after each request; for a steady worker: `pnpm --filter web worker`.

## Test
```
pnpm typecheck && pnpm --filter web lint
pnpm --filter @tz/domain test          # calculation engine
pnpm --filter web test                 # web unit tests
pnpm exec supabase test db             # pgTAP: tenancy, RLS, grants
pnpm --filter web test:integration     # isolation, Stripe webhooks, retention, invoice reversal
pnpm --filter web test:e2e             # Chromium at 360 and 430 px on a production build
pnpm --filter web test:perf            # 50k-row import, 250k sales rows, concurrency
bash scripts/backup-restore-check.sh   # restore drill
```
CI (`.github/workflows/ci.yml`) runs all of these plus dependency audit and secret scanning.

## Documentation
| | |
|---|---|
| What is done and how it was verified | `docs/implementation-status.md`, `docs/test-results.md` |
| What blocks launch | `docs/launch-blockers.md` |
| Source repositories and the 8 reported defects | `docs/source-audit.md` |
| Security | `docs/threat-model.md`, `docs/permission-matrix.md`, `docs/ai.md` |
| Design decisions | `docs/adr/` |
| Schema | `docs/data-dictionary.md` (generated) |
| Operations | `docs/runbooks/`, `docs/performance.md`, `docs/cost-model.md` |
| Imports | `docs/import-templates.md`, `docs/import-templates/` |
| Screens at 360 px | `docs/screenshots/` |
| Docs as a website | `node scripts/build-docs-site.mjs` → `site/`; published by `.github/workflows/pages.yml` from `main` |

## Principles the code enforces
- Costs, availability and variance are never shown as complete when inputs are missing.
- Ledgers are append-only; corrections are reversals. Past reports stay reproducible.
- POS data alone never proves over-pouring or theft; no per-person variance; staff columns in
  POS files are not imported.
- AI is optional, opt-in per organization, server-side only, and has no write authority.
