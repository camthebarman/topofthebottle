# Permission matrix

Source of truth: `public.role_permissions` (migration `20260930000100_tenancy.sql`), enforced twice:
in Postgres by RLS policies and security-definer functions (`app.has_perm`, `app.has_location_perm`),
and in the app by `requirePerm()` / `pagePerm()` before any action or page runs. The UI hides
controls a role cannot use, but hiding is never the control.

Generated from the database on 2026-10-01.

| Permission | What it allows | Owner | Manager | Bartender | Read-only |
|---|---|:-:|:-:|:-:|:-:|
| `audit.view` | Read the audit log | ✓ | ✓ | — | — |
| `barbook.manage` | Edit/archive any Bar Book entry, see who acknowledged | ✓ | ✓ | — | — |
| `barbook.write` | Write Bar Book entries, acknowledge handoffs | ✓ | ✓ | ✓ | — |
| `billing.manage` | Subscribe, change plan, open Stripe portal | ✓ | — | — | — |
| `catalog.edit` | Products, suppliers, pack sizes, conversions, costs | ✓ | ✓ | — | — |
| `costs.view` | See costs, cost %, inventory value, invoice prices (RLS on cost tables) | ✓ | ✓ | — | ✓ |
| `data.export` | Full data export; request organization deletion | ✓ | — | — | — |
| `events.manage` | Create and quote beverage events | ✓ | ✓ | — | — |
| `imports.manage` | Upload and commit POS CSV imports, map items and modifiers | ✓ | ✓ | — | — |
| `insights.ai` | Request AI explanations (if the org opted in) | ✓ | ✓ | — | — |
| `insights.view` | Insights: variance, coverage, voids/comps | ✓ | ✓ | — | ✓ |
| `inventory.count` | Enter count lines | ✓ | ✓ | ✓ | — |
| `inventory.finalize` | Finalize or void counts | ✓ | ✓ | — | — |
| `inventory.move` | Waste, adjustments, transfers, batch production, reversals | ✓ | ✓ | — | — |
| `invoices.approve` | Review, approve and receive invoices | ✓ | ✓ | — | — |
| `invoices.upload` | Upload invoice documents | ✓ | ✓ | ✓ | — |
| `members.manage` | Invite, change roles, deactivate (owner rules enforced in SQL) | ✓ | ✓ | — | — |
| `menu.edit` | Choose current menu and prices | ✓ | ✓ | — | — |
| `org.view` | See the organization and permitted locations | ✓ | ✓ | ✓ | ✓ |
| `recipes.edit` | Create, copy and version recipes | ✓ | ✓ | — | — |
| `schedule.publish` | Edit and publish schedules | ✓ | ✓ | — | — |
| `schedule.view_team` | See the whole team's published schedule | ✓ | ✓ | ✓ | ✓ |
| `settings.manage` | Organization and location settings, AI opt-ins | ✓ | ✓ | — | — |

## Rules beyond the table

- **Location scoping.** A membership may list `location_ids`; such members see and act only on
  those locations (`app.can_see_location`, `app.has_location_perm`). Null means all locations.
- **Owners.** Only an owner can grant or remove the owner role, and the last active owner cannot be
  removed or demoted (enforced in `public.update_membership` and `public.create_invitation`).
- **Managers** cannot invite owners or change an owner's membership.
- **Bartenders** see recipes, specs and counts but no cost tables; their recipe pages show build
  and method only (verified in `e2e/flow.spec.ts`).
- **Read-only** members can view reports including costs, but cannot change anything.
- **Entitlement.** When billing is `read_only` (unpaid past grace), only `org.view`, `costs.view`, `insights.view`,
  `schedule.view_team`, `audit.view`, `data.export`, `billing.manage` and `members.manage` are honoured (`READ_ONLY_ALLOWED` in `src/lib/session.ts`).
- **Second factor.** Members who enrolled TOTP must complete it each session before any permission
  is honoured (`getContext`).
- **Service role** is used only by background jobs, the Stripe webhook and retention; it never runs on
  behalf of a browser request without a prior permission check.
