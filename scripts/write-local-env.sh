#!/usr/bin/env bash
# Writes apps/web/.env.local from the running local Supabase stack. Local keys only.
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(pnpm exec supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
cat > apps/web/.env.local <<ENV
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
APP_URL=http://localhost:3000
AI_PROVIDER=stub
ENV
echo "wrote apps/web/.env.local"
