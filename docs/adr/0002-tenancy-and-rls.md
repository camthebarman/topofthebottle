# ADR 0002: Tenancy enforced in Postgres with RLS and tenant-safe foreign keys

Status: accepted

## Decision
- Every tenant table has `org_id`; most have `location_id`. Uniqueness `(org_id, id)` on parents and
  composite foreign keys `(org_id, x_id) → parent(org_id, id)` make cross-tenant references
  impossible, not merely forbidden.
- RLS on every table. Policies call `security definer` helpers in schema `app`
  (`is_member`, `has_perm`, `can_see_location`, `has_location_perm`) with `search_path = ''`.
- Writes that must be atomic or rule-heavy (approve invoice, receive, finalize count, commit import,
  membership changes) are `security definer` functions that check permissions explicitly.
- Ledgers (stock movements, receipts, sales) are insert-only for API roles; corrections are reversals.
- Costs live in separate tables (`product_costs`, `stock_movement_costs`) so `costs.view` is enforced
  by RLS rather than by column filtering in the app.
- API roles have no TRUNCATE/REFERENCES/TRIGGER (migration `1300`).

## Consequences
+ A bug in an app query cannot leak another tenant's rows; tested by pgTAP and API-level tests.
− Per-row policy evaluation is slow for large aggregates. See ADR 0006.
