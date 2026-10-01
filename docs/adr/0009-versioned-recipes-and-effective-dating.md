# ADR 0009: Immutable recipe versions and effective-dated mappings

Status: accepted

Recipes, ingredient→product mappings, POS item mappings, menu prices and product costs are
effective-dated. Reports reconstruct "what was true then": sales use the recipe version and
mappings in effect on their business day. For sales dated before a recipe or mapping first existed
(common right after onboarding), the version in effect at the closing count is used and the report
says so. Edits never rewrite history; they create a new version with optimistic concurrency.
