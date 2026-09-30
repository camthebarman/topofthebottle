# Implementation status

Durable checklist. Updated at each checkpoint. Legend: **Done** (implemented and
verified by the listed check), **Partial**, **Blocked**, **Unverified**
(implemented but not yet exercised end to end).

## Checkpoint log

- 2026-09-30 · Phase 1–2 start: repo audit, domain engine (costing, units,
  inventory ledger, time, schedule, CSV, POS normalization, usage, variance,
  catering, invoices) with 74 passing unit tests.

## Phase 2 — calculation engine

| Requirement | Status | Evidence |
|---|---|---|
| Duplicate ingredients aggregate (10 stock / 2×1 → 5) | Done | `packages/domain/test/costing.test.ts` |
| Unresolved ingredients → explicit incomplete | Done | same |
| Zero/invalid yield rejected | Done | same |
| Cycle detection, unit mismatch, weight≠volume | Done | same |
| Prepared vs raw availability, no double count | Done | same |
| Variance fixture (+500 mL, $10, no accusation) | Done | `packages/domain/test/variance.test.ts` |

## Phase 3 — products, recipes, menu, inventory (checkpoint 2026-09-30)

| Requirement | Status | Evidence |
|---|---|---|
| Classic library (17 templates, original text, provenance) | Done | migration `..0800_recipe_templates.sql`; e2e copies Negroni |
| Immutable recipe versions, optimistic concurrency | Done | `save_recipe_version`; e2e shows Version 2 |
| Ingredient→product mapping per location, effective-dated | Done | e2e maps 3 ingredients |
| Current menu selection with price history | Done | `set_menu_item`; e2e 21.7% cost |
| Incomplete costing shown honestly (no partial totals) | Done | e2e asserts "Cost is incomplete" |
| Inventory ledger, reversals, counts (tenths/scale/measured), finalize | Done | pgTAP + e2e count 2.5 bottles |
| Moving-average / last-cost valuation from ledger | Done | SQL `ledger_unit_costs` mirrors domain `unitCost` (tested) |
| Transfers, batch production, waste/adjustments UI | Implemented, Unverified in browser | |
