# Runbook: backups and restore

## What must be backed up
1. **Postgres** schemas `public`, `app`, `auth` (all tenant data, ledgers, users, MFA factors).
2. **Storage** bucket `documents` (uploaded invoices and POS files). Not included in database dumps.
3. **Secrets** (Supabase keys, Stripe, Anthropic, JOBS_SECRET) in the hosting provider's secret store.

## Production (hosted Supabase) — prerequisites, not yet configured
- Enable daily backups and **Point-in-Time Recovery** on the Supabase project (paid add-on).
- Replicate the `documents` bucket to a second provider (e.g. S3 with versioning) on a schedule.
- Keep a weekly logical dump (`pg_dump -Fc -n public -n app -n auth`) in separate storage with
  30-day retention, encrypted at rest.

## Restore drill (verified locally)
`scripts/backup-restore-check.sh` dumps the local database, restores into a scratch database,
compares row counts for all 60 public tables and `auth.users`, and compares the stock ledger sum.
Tools run inside the database container so client and server versions match.

Last run, 2026-10-01 (after the full E2E suite had written data):
```
1/4 dump (custom format, schemas public, app, auth)
-rw-r--r--    1 root     root      13078207 Oct  1 02:31 /tmp/app-1790821865.dump
2/4 create scratch database restore_check_1790821865
3/4 restore
restore reported 2 error line(s) (see /tmp/restore-warnings.log)
4/4 compare row counts
auth.users source=4 restored=4
ledger sum source=94370.000000 restored=94370.000000
checked 60 tables
RESTORE CHECK PASSED
```
The restore error is `schema "public" already exists` (the scratch database already has it) and is
expected. The drill also runs in CI (`database-and-e2e` job).

Not yet drilled: restoring Storage objects, and PITR on a hosted project.

## Restoring a single tenant
Ledgers are append-only, so most mistakes are fixed with reversals in the app, not restores. To
recover one organization's deleted rows: restore the latest backup into a scratch database, export
that org's rows with `COPY (select … where org_id = '<id>')`, review, and insert into production in a
transaction with triggers enabled. Never restore a whole database over live data for one tenant.
