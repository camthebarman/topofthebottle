# ADR 0006: Security-definer aggregates for large reports

Status: accepted

Measured: `sales_summary` over 250k rows took ~5 s with per-row RLS. Rewritten as `security definer`
functions that check `app.has_location_perm(org, location, 'insights.view')` once, then aggregate
without RLS: 191 ms for 100k rows. Each such function must (1) take org and location explicitly,
(2) check permission first, (3) filter by both. Covered by an isolation test that calls them as a
member of another tenant and expects an error.
