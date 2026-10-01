# AI features: what is sent, when, and what it can do

Both AI features are **off by default** and are switched on per organization, separately, by an
owner or manager (Settings → General). Everything else in the product works without AI.

| | Invoice reading | Insights explanations |
|---|---|---|
| Opt-in flag | `org_settings.ai_invoice_opt_in` | `org_settings.ai_insights_opt_in` |
| Who can trigger | Members with `invoices.upload` | Members with `insights.ai` (owner, manager) |
| Sent to the provider | The uploaded invoice file (PDF or image) and a fixed instruction | An allow-listed JSON summary: product names, quantities, statuses, coverage, missing-data notes, evidence ids |
| Never sent | Other documents, stock, sales, staff | Staff names, schedules, Bar Book, invoice text, notes, guest data, costs per person |
| Output | A draft: header fields and lines with qualitative confidence. Every line must be confirmed by a person before approval | Advisory text citing evidence ids; rejected if it accuses anyone or cites ids not in the evidence |
| Can it change data? | No. It fills a review form | No |
| Default monthly allowance | 60 extractions per organization | 30 explanations per organization |
| Without AI | CSV invoices are read by column matching; PDFs/photos are entered by hand | Deterministic variance report with possible explanations and checks |

## Provider handling
- Provider: Anthropic API, called only from the server with `ANTHROPIC_API_KEY`. Model is set by
  `AI_MODEL` (default `claude-opus-5-5`). Structured output is validated with zod; a refusal is shown
  as "the AI declined", never retried into a different answer.
- Requests are bounded: one job per organization at a time, max output tokens per call (16k for
  invoices, 8k for explanations), 180 s job timeout, at most 3 attempts for extraction and 2 for
  explanations, plus the monthly allowances above. Results are cached by evidence hash and prompt version, so the same
  report is not re-sent.
- Uploaded files and evidence are untrusted input. The system prompt says so; the model has no
  tools, no database access and no ability to approve, post or edit anything.
- **Retention at the provider** is governed by the provider's commercial terms and your agreement
  with them. This product makes no promise beyond those terms; review them before enabling AI for
  customers, and state them in your privacy notice.
- Stored here: the structured result, provider, model, prompt version, token counts and the
  evidence hash (`invoice_extractions`, `analysis_explanations`), deleted with the organization.

## Verification status
The live provider path has **not** been exercised: no API key was available in this build. Tests
and E2E runs used the deterministic development stub (`AI_PROVIDER=stub`, refused in production).
