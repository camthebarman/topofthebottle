# Source audit

The reference repositories were read, not modified. Nothing was pushed to them.
This product is a new codebase; ideas and domain knowledge were reused, code was not
copied wholesale (the sources are browser-only vanilla JS with localStorage persistence,
which does not fit a multi-tenant server product).

## Repositories inspected

| Repository | Commit inspected | Branches also read | What it is |
|---|---|---|---|
| camthebarman/86d | `8c10bda029199cc7ba163d9a155c7a9ad165f93b` (main) | `claude/86d-unified-dashboard-x8hdl8` @ `451186c` | Unified food/bev/floor tools + browser "agent", GitHub Pages deploy |
| camthebarman/Don-t-Go-Pour | `58b0cfbdc15106fe9812769e813e33fcd6a5177f` (main) | — | Beverage costing / pour cost |
| camthebarman/Food-Cost-and-Inventory-Management | `bbac5fa15986749454a083b7520505d30e5103e1` (main) | — | Food costing and inventory |
| camthebarman/clayton-bt | `05d9b32f0d8cbe8f55d3e939da9537e4e7a58e0b` (main) | `claude/inventory-ui-redesign-xfv17e` @ `6c41f56` | Catering / fleet tools, inventory redesign |
| camthebarman/tablezero | `7374fc234c20a0e6ba47c93123c1925630a98e0b` (main) | — | Brand and product notes |

Naming note from tablezero docs: "86" collides with an existing product (use86.com).
This product is called **Table Zero Bar** in the UI; no "86" branding is used.

## What was reused (as knowledge, re-implemented)

| Idea | From | Where it lives now |
|---|---|---|
| Pour cost = ingredient cost / price; target cost % | Don-t-Go-Pour, 86d bev | `packages/domain/src/costing.ts` (`menuMetrics`) |
| Batch/prep recipes feeding drinks | 86d bev | `prepForProduct`, `explodeRecipe` with cycle detection |
| Tenths bottle counting, scale weights | 86d bev, clayton-bt | `packages/domain/src/inventory.ts` (`countToBase` with uncertainty) |
| Trim/usable yield for produce | Food-Cost | `costing.ts` yield handling (now validated: 0 < yield ≤ 100) |
| Par and suggested orders | Food-Cost, 86d | `suggestedOrderPacks` |
| Catering headcount/drinks-per-hour planning | clayton-bt | `packages/domain/src/catering.ts` (largest-remainder allocation) |
| Shared bar notes / handoff | 86d floor | Bar Book (entries, revisions, acknowledgements) |
| Legacy data shapes (food/bev/floor localStorage JSON) | 86d | `packages/domain/src/legacy.ts` + Settings → Import |

Not reused: the browser agent (client-side Claude calls), floor/waitlist guest data,
GitHub Pages hosting, localStorage persistence, and any UI code.

## Reported defects: reproduction and resolution

| # | Defect | Reproduced against source | Evidence | Fix in this product | Verified by |
|---|---|---|---|---|---|
| D1 | Duplicate ingredients overstate availability | Yes. 86d food `maxPortions` returns **10** for 10 units on hand with the ingredient listed twice at 1 each (correct: 5). 86d bev `maxServings` returns 5 (correct). | `docs/evidence/source-defect-repro.cjs` output below | Requirements are aggregated per product before dividing (`explodeRecipe` → `availableServings`) | `packages/domain/test/costing.test.ts` "reported defect 1" |
| D2 | Unresolved ingredients silently disappear | Yes. Food and bev `recipeCost` return `1` (cost of the resolved line only) with no flag; food `maxPortions` returns 10 portions, ignoring the missing ingredient. | repro output | Every unresolved reference is an explicit `issue`; totals are `incomplete` and the UI shows "Cost is incomplete", never a partial sum | costing test "reported defect 2"; e2e asserts "Cost is incomplete" |
| D3 | Zero yield treated as full yield | Yes. Food `yieldFactor({yieldPct: 0})` returns **1** (100%). Bev `prepCostPerUnit` with yield 0 returns **0** (free). | repro output | Yield must be 0 < y ≤ 100 (DB check constraints + domain validation); zero-yield preps are rejected | costing test "reported defect 3"; legacy test "reports zero yields" |
| D4 | Storage failures not propagated | Yes, by inspection. `86d/js/floor/storage.js:152` and `86d/js/food/storage.js:584` catch and `console.warn`; callers proceed as if saved. `86d/js/bev/storage.js:513` throws but callers do not handle it. | source lines | Server actions return an error state when a write fails; the form shows it and keeps the user's input (React 19 auto-reset avoided). DB errors are mapped to user messages, internals hidden | `apps/web/test/unit/server.test.ts` "reports a persistence failure instead of claiming success" |
| D5 | Clayton normalization deletes batches, transfers, settings | Yes, by inspection on `claude/inventory-ui-redesign-xfv17e`: `js/catering/storage.js:614 delete s.batches`, `js/fleet/storage.js:126-127 delete s.transfers; delete s.settings` | `git grep` on that branch | Legacy import never drops data silently: every record not imported is listed as an exception with a reason and count. Migrations are append-only and `scripts/check-migrations.sh` blocks unmarked destructive statements | `packages/domain/test/legacy.test.ts`; `e2e/legacy.spec.ts`; CI step |
| D6 | AI credentials and sensitive data in localStorage | Yes. `86d/js/agent/claude.js:29` stores the API key in localStorage; `:89` sends `anthropic-dangerous-direct-browser-access: true` | source lines | Provider key is a server env var only (`server-only` modules); the browser never calls the AI provider. Only drafts of unsent text are kept in sessionStorage, cleared on sign-out | `apps/web/src/server/ai/provider.ts`; `src/components/drafts.tsx`; CSP `connect-src` excludes the provider |
| D7 | GitHub Pages shared origin | Yes. `86d/.github/workflows/deploy-pages.yml` publishes to `*.github.io`, an origin shared with every other Pages site of the account, so localStorage and cookies are not isolated | workflow file | Deployed on its own hostname (`APP_URL`), HttpOnly session cookies, strict CSP with per-request nonce, `frame-ancestors 'none'`, no-store caching | `src/proxy.ts`; e2e checks zero CSP violations |
| D8 | AI snapshots include guest names and notes | Yes. `86d/js/agent/claude.js:65` sends `AgentEngine.snapshot()`, which includes floor data built at `86d/js/floor/app.js:950-963` (waitlist `name`, table `notes`, `guests`) | source lines | AI evidence is an allow-listed structure: product names, statuses, quantities, coverage. No staff, guest, note, schedule or Bar Book content. Org opt-in and monthly allowance required | `apps/web/src/server/jobs/explain.ts` (`Evidence` type); `vetExplanation` unit tests |

### Reproduction output (D1–D3)

```
$ node source-defect-repro.cjs     # against 86d @ 8c10bda
D1 food maxPortions dup (expect 5): 10
D1 bev maxServings dup (expect 5): 5
D2 food recipeCost w/ missing (returns number, no flag): 1
D2 bev recipeCost w/ missing: 1
D2 food maxPortions w/ missing: {"portions":10,"limitedBy":{...},"unlimited":false}
D3 food yieldFactor(0%) (expect reject, got): 1
D3 bev prepCostPerUnit yield 0 (expect reject, got): 0
```
