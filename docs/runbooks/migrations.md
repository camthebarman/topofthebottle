# Runbook: database migrations

- Migrations live in `supabase/migrations/`, named `YYYYMMDDHHMMSS_description.sql`, applied in order.
- **Append-only.** Never edit a migration that has run anywhere shared. Write a new one.
- `scripts/check-migrations.sh` (CI) rejects top-level `DROP TABLE/SCHEMA/COLUMN/TYPE`, `TRUNCATE`,
  `DELETE FROM` and `ALTER TABLE … DROP` unless the line ends with `-- destructive-ok: <reason>`
  and has been reviewed. Prefer expand → migrate → contract across releases.
- Every new table: `org_id`, composite FK to its parent, `alter table … enable row level security`,
  policies using `app.*` helpers, and pgTAP coverage. `02_grants.test.sql` fails if a table lacks RLS.

## Local
```
pnpm db:reset            # recreate, apply all migrations, load supabase/seed.sql
pnpm exec supabase test db
```

## Production
1. Take a manual backup (or confirm PITR is current).
2. `supabase link --project-ref <ref>` then `supabase db push --dry-run`; review the SQL.
3. `supabase db push`.
4. Deploy the app version that needs the migration **after** it applies (migrations must be
   backward compatible with the previous app version).
5. Smoke test: `/api/health`, sign in, open Inventory and Insights.

Never run `supabase/seed.sql` against production; it creates demo users.
