# Performance

All numbers are from a **local development stack**, not production hardware: Supabase CLI
containers (PostgreSQL 17.6) and the test process on one 4-core Intel Xeon VM (2.8 GHz,
16 GB RAM), Node 22. Raw output: `docs/evidence/perf-2026-10-01.json`. Reproduce with
`pnpm db:reset && pnpm --filter web test:perf`.

Production will differ (network latency to a hosted database, shared CPU, cold caches). Treat
these as evidence that the design scales to the target, not as SLAs.

| Workload (brief §13) | Result | Pass criterion | Notes |
|---|---|---|---|
| 50,000-row POS CSV import, outside the request | Validate **7.8 s**, commit **2.3 s** (6.2 MB file) | Runs as a background job; no request blocks; all 50,000 rows accepted then inserted | Validate streams the file through the RFC 4180 parser in chunks, dedupes against existing keys in batches of 1,000. Progress shown in the UI; user can leave the page |
| 100,000+ normalized sales rows: report aggregation | **498 ms** over **250,000** sales lines (616 item groups) | Under 2 s | `sales_summary` is a security-definer aggregate with one permission check (ADR 0006). With per-row RLS the same query took ≈ 5 s |
| Theoretical usage from aggregated sales | **4 ms** for 616 groups | — | Usage is computed on aggregated groups, not raw rows |
| Concurrent counting: 36 parallel writes (3 users × the same 12 products, same area) | **102 ms**, no errors, exactly one line per product+area | No errors, no duplicate lines | A count line is keyed by product and area; when two people count the same product in the same area, the last save is kept. Counting by area avoids this in practice |
| Conflicting finalize of the same count | **Exactly 1** winner; the others get "Someone else changed this" | One winner | Optimistic concurrency (`version` + 40001) |
| Conflicting product edits in two browsers | Second save refused, first value kept | No silent overwrite | `e2e/stock.spec.ts` |
| Multiple tenants | Second tenant's queries see nothing of the first; definer aggregates refuse other tenants | Isolation holds under load | `test/integration/isolation.test.ts` |

## Earlier run (same code path, different VM)

On 2026-09-30 (Xeon 2.1 GHz): validate 6.9 s, commit 1.8 s, aggregation 191 ms at 100,000 rows,
36 parallel writes in 120 ms.

## Known limits

- PostgREST caps responses at 1,000 rows; every list query that can exceed it pages with `fetchAll`.
- One job per organization runs at a time (ADR 0004), so a second large import from the same
  tenant waits; other tenants are not delayed.
- No load test of the Next.js server under concurrent users was run.
