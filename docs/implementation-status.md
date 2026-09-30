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
