# ADR 0001: Modular monolith on Next.js + Supabase

Status: accepted (2026-09-30)

## Context
One small team, $39/location/month pricing, independent bars as customers. The brief fixes the stack
defaults (TypeScript strict, Next.js/React, Tailwind, Supabase Postgres/Auth/Storage, RLS, Stripe).

## Decision
- One deployable web app (`apps/web`) plus a pure calculation package (`packages/domain`).
- Feature folders by route (`recipes`, `inventory`, `imports`, `insights`, …) with server code in
  `src/server/*`. No microservices.
- All money and quantity math lives in `@tz/domain` (decimal.js, no I/O), so it is unit-testable and
  shared by pages, jobs and exports.
- Background work runs in the same codebase via a Postgres-backed job queue (ADR 0004).

## Consequences
+ Cheap to run and to reason about; one place to enforce authorization.
− Long CSV imports and AI calls must not run in a request: handled by the job queue.
− Scaling is vertical plus more app instances; the in-memory rate limiter then needs a shared store.
