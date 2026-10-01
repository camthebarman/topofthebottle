#!/usr/bin/env bash
# Database tests (pgTAP) against the local Supabase stack. Resets the database first.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm exec supabase db reset
pnpm exec supabase test db
