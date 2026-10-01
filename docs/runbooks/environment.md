# Runbook: environments and configuration

## Local development
```
pnpm install
pnpm db:start                     # Supabase in Docker
bash scripts/write-local-env.sh   # apps/web/.env.local from the local stack
pnpm db:reset                     # migrations + demo seed
pnpm dev                          # http://localhost:3000
pnpm --filter web worker          # optional: background job worker
```
Demo sign-ins (local only): `owner@demo.test`, `manager@demo.test`, `bartender@demo.test`,
`other-org@demo.test`, password `demo-password-123`.

## Variables (`apps/web/.env.example`)
| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Public; used only by the server (no browser client) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes for jobs, webhooks, retention | Server only. Never expose |
| `APP_URL` | yes | Dedicated hostname; used in emails and Stripe redirects |
| `JOBS_SECRET` | if using cron | ≥ 32 random chars |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | optional | AI features stay off without a key, and per org until opted in |
| `AI_PROVIDER` | dev only | `stub` for deterministic local output; ignored in production |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` | for billing | Test mode keys until launch |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | with >1 instance | Same value on all instances |
| `TRUSTED_PROXY_HOPS` | default 1 | Proxies in front of the app that append to `X-Forwarded-For` |

## Production prerequisites (not done in this build)
- Hosted Supabase project: enable MFA (TOTP), leaked-password protection, custom SMTP with SPF/DKIM,
  set Site URL and redirect URLs to `APP_URL`, restrict database network access, enable PITR.
- Node host for Next.js (any platform that runs `next start`) on its own hostname with HTTPS.
- A scheduler calling `POST /api/jobs/tick` every minute, or a long-running `worker` process.
- Stripe: product + price ($39/location/month), webhook endpoint `/api/stripe/webhook` with
  events `checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted`
  (payment failures arrive as subscription status `past_due`/`unpaid`).
- Error monitoring and log drain (structured JSON logs go to stdout).
