# Runbook: public demo

A shareable demo of the app: "Lantern & Lime", an invented cocktail bar with five weeks of sales,
deliveries, counts, Bar Book entries, a schedule and an upcoming event. Visitors sign in with one
tap as the owner, manager, bartender or a read-only viewer. Everyone shares those accounts, so the
data is rebuilt every night.

Use a **separate Supabase project** for the demo. Never point the demo at production data, and
never set `DEMO_MODE` in production.

## What demo mode changes (`DEMO_MODE=1`)
- A banner on every page: shared accounts, invented data, nightly reset.
- The sign-in page offers one-tap sign-in for the four demo roles and shows the demo password.
- Turned off: creating accounts, email sign-in links, invitations, changing team members,
  adding or renaming locations, two-factor setup, billing, organization deletion, creating new
  organizations. Each shows "turned off in the demo" instead.
- The per-account sign-in limit is skipped (the accounts are shared); the per-address limit stays.
- AI and billing stay off because no keys are configured.

## One-time setup (about 20 minutes)

### 1. Supabase (demo project)
1. Create a project, for example `table-zero-demo`. Note the **project ref**, **database password**,
   **Project URL**, **anon key** and **service role key** (Project Settings → API).
2. Authentication → Sign In / Providers → Email: turn **off** "Allow new users to sign up".
   (The demo accounts are created by the reset script with the service role, so this does not
   block them.)
3. Authentication → URL Configuration: set **Site URL** to the Vercel address from step 2.
4. Apply the schema from your machine:
   ```
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <project-ref>
   pnpm exec supabase db push
   ```
   Do **not** run `supabase/seed.sql` on the demo project; the reset script creates the demo data.

### 2. Vercel
1. Add New → Project → import `camthebarman/topofthebottle`.
2. Root Directory: `apps/web`. Framework: Next.js (detected). Keep the default build command.
3. Production branch: the branch you want to show (for now `claude/bar-ops-platform`).
4. Environment variables:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service role key |
   | `APP_URL` | `https://<your-project>.vercel.app` |
   | `DEMO_MODE` | `1` |
   | `DEMO_PASSWORD` | a new password of 10+ characters (shown to visitors) |
5. Deploy.

### 3. GitHub secrets (Settings → Secrets and variables → Actions)
| Secret | Value |
|---|---|
| `DEMO_SUPABASE_URL` | Project URL |
| `DEMO_SUPABASE_ANON_KEY` | anon key |
| `DEMO_SUPABASE_SERVICE_ROLE_KEY` | service role key |
| `DEMO_PASSWORD` | the same password as in Vercel |
| `SUPABASE_ACCESS_TOKEN`, `DEMO_DB_PASSWORD`, `DEMO_PROJECT_REF` | optional: lets the workflow apply migrations |

### 4. Load the demo data
Actions → **Demo reset** → Run workflow (tick "Apply database migrations" if you set the optional
secrets). It takes about a minute. After that it runs every night at about 03:52 Chicago time.

You can also run it locally against the demo project:
```
NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
DEMO_PASSWORD=… pnpm --filter web demo:reset
```

## What the reset does
`apps/web/scripts/demo-reset.ts`:
1. Deletes accounts on `@demo.tablezero.test` and organizations whose **every** member is such an
   account (anything else is skipped and logged), including their uploaded files.
2. Creates the four accounts and the organization through the app's own database functions:
   24 products, 12 menu items (10 classics plus a draft beer and a house wine), two suppliers,
   opening stock, four weeks of deliveries (approved, then received), weekly counts, logged waste,
   a transfer to the patio, and five weekly POS files run through the real import jobs.
3. Builds a story into the numbers: gin and lime juice are used about 7% and 15% beyond spec,
   tequila got more expensive mid-month, and a case of Campari arrived without an invoice. Insights
   flags the first two as "requires review" without blaming anyone.
4. Leaves things for visitors to do: an invoice to review, a "Seasonal Special" to map to a
   recipe, open Bar Book tasks, next week's schedule to publish, an event to quote.

## Checking it
With the demo server running:
```
DEMO_E2E=1 E2E_BASE_URL=https://<your-project>.vercel.app pnpm --filter web exec playwright test e2e/demo.spec.ts
```

## Costs and limits
Free tiers of Supabase and Vercel cover a low-traffic demo. Free Supabase projects can be paused after a period of
inactivity; check the current policy and whether the nightly reset keeps the project active. Vercel's Hobby plan is for
non-commercial use; check its terms before sharing the demo commercially.
