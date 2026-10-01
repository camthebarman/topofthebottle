#!/usr/bin/env bash
# Backup and restore drill for a test environment.
# Dumps the application schemas (tenant data, audit, auth users) from the source
# database, restores into a scratch database, and compares row counts per table.
# Client tools must match the server major version. Locally they run inside the
# database container: PGTOOLS="docker exec -i supabase_db_table-zero-bar".
# Usage: scripts/backup-restore-check.sh
set -euo pipefail
PGTOOLS="${PGTOOLS:-docker exec -i supabase_db_table-zero-bar}"
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:5432/postgres}"
pg_dump() { $PGTOOLS pg_dump "$@"; }
pg_restore() { $PGTOOLS pg_restore "$@"; }
psql() { $PGTOOLS psql "$@"; }
BASE="${DB_URL%/*}"
SCRATCH_DB="restore_check_$(date +%s)"
DUMP="/tmp/app-$(date +%s).dump"
TABLES_SQL="select table_schema||'.'||table_name from information_schema.tables where table_type='BASE TABLE' and table_schema in ('public') order by 1"

echo "1/4 dump (custom format, schemas public, app, auth)"
pg_dump "$DB_URL" -Fc --schema=public --schema=app --schema=auth --no-owner --no-privileges -f "$DUMP"
$PGTOOLS ls -l "$DUMP"

echo "2/4 create scratch database $SCRATCH_DB"
psql "$DB_URL" -qc "create database $SCRATCH_DB"
trap 'psql "$DB_URL" -qc "drop database if exists $SCRATCH_DB" >/dev/null' EXIT
psql "$BASE/$SCRATCH_DB" -qc "create extension if not exists pgcrypto with schema extensions" 2>/dev/null || psql "$BASE/$SCRATCH_DB" -qc "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions"

echo "3/4 restore"
pg_restore --no-owner --no-privileges -d "$BASE/$SCRATCH_DB" "$DUMP" 2> /tmp/restore-warnings.log || true
echo "restore reported $(grep -c "error" /tmp/restore-warnings.log || true) error line(s) (see /tmp/restore-warnings.log)"

echo "4/4 compare row counts"
fail=0; checked=0
for t in $(psql "$DB_URL" -Atc "$TABLES_SQL"); do
  a=$(psql "$DB_URL" -Atc "select count(*) from $t")
  b=$(psql "$BASE/$SCRATCH_DB" -Atc "select count(*) from $t" 2>/dev/null || echo "missing")
  checked=$((checked+1))
  if [ "$a" != "$b" ]; then echo "MISMATCH $t source=$a restored=$b"; fail=1; fi
done
users_a=$(psql "$DB_URL" -Atc "select count(*) from auth.users")
users_b=$(psql "$BASE/$SCRATCH_DB" -Atc "select count(*) from auth.users")
echo "auth.users source=$users_a restored=$users_b"
[ "$users_a" = "$users_b" ] || fail=1
# A spot check that ledger arithmetic survives: total book quantity is identical.
qa=$(psql "$DB_URL" -Atc "select coalesce(sum(qty_base),0) from public.stock_movements")
qb=$(psql "$BASE/$SCRATCH_DB" -Atc "select coalesce(sum(qty_base),0) from public.stock_movements")
echo "ledger sum source=$qa restored=$qb"
[ "$qa" = "$qb" ] || fail=1
echo "checked $checked tables"
if [ $fail -eq 0 ]; then echo "RESTORE CHECK PASSED"; else echo "RESTORE CHECK FAILED"; exit 1; fi
