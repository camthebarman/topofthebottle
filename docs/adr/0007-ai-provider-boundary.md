# ADR 0007: AI provider boundary

Status: accepted

- Server-side only (`server-only` modules); key in env; browser CSP forbids other origins.
- Model `claude-opus-5-5` by default (`AI_MODEL`), structured output validated by zod, server-side
  fallback enabled; refusals are surfaced, not retried into a different answer.
- No tools, no SQL, no writes. Output is advisory text tied to evidence ids; `vetExplanation`
  rejects accusatory wording and unknown ids.
- Inputs are allow-listed evidence (ADR 0008). Per-org opt-in per feature, default off. Monthly
  allowances. Results cached by evidence hash and prompt version.
- Invoice extraction produces a draft; nothing is approved or received without a human.
- `AI_PROVIDER=stub` gives deterministic output in development only; ignored in production.
- **Not verified against the live API** in this build (no key available).
