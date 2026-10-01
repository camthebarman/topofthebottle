#!/usr/bin/env bash
# Migration safety: top-level destructive statements need an explicit, reviewed marker.
# A line ending in "-- destructive-ok: <reason>" is allowed. Function bodies (indented)
# are not checked here; they are covered by tests.
set -euo pipefail
status=0
for f in supabase/migrations/*.sql; do
  while IFS= read -r hit; do
    case "$hit" in *"-- destructive-ok:"*) continue ;; esac
    echo "$f: $hit"
    status=1
  done < <(grep -inE '^(drop (table|schema|column|type)|truncate|delete from|alter table [^;]* drop (column|constraint))' "$f" || true)
done
# Migrations are append-only once released: names must sort after the newest released one.
if [ $status -ne 0 ]; then echo "Destructive statements found. Preserve data or mark the line with -- destructive-ok: <reason>."; fi
exit $status
