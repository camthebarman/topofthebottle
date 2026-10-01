# Cost model (10 / 100 / 1,000 locations)

**Every vendor price below is an assumption to confirm against current price lists before any
commercial decision.** They were not looked up live for this document. The model is meant to show
which costs scale with what, and where the margin risk is (AI and payment fees), not to quote.

## Usage assumptions per location per month

| Driver | Assumption | Basis |
|---|---|---|
| Sales lines imported | 9,000 (≈ 300 items/day) | Busy independent bar |
| Database growth | ≈ 6 MB (sales lines ≈ 0.5 KB each incl. indexes, plus ledger, counts) | Measured row sizes in local tests, rounded up |
| Uploaded files | 25 invoices × 1 MB + 4 POS CSVs × 1.5 MB ≈ 31 MB | |
| AI invoice extractions | 25 (opt-in; capped at 60 by default) | `usage_allowances` |
| AI variance explanations | 4 (capped at 30) | |
| Active users | 6 | |

## Assumed unit prices (CONFIRM)

| Item | Assumed price |
|---|---|
| Supabase Pro project | $25/mo, includes 8 GB database and 100 GB storage; compute add-ons from ≈ $10 to $110+/mo; PITR add-on ≈ $100/mo |
| App hosting (Node) | $20/mo (small) → $100/mo (several instances) → $400/mo (autoscaling) |
| Monitoring / logs | $0 → $30 → $150/mo |
| Transactional email | $0 → $20 → $90/mo |
| AI per invoice extraction | ≈ $0.04 (≈ 3k input tokens with a page image, 1k output, at an assumed $5 / $25 per million tokens) |
| AI per variance explanation | ≈ $0.05 (≈ 4k input, 1.2k output) |
| Stripe | 2.9% + $0.30 per successful card charge, plus Stripe Billing ≈ 0.7% of billing volume |

## Monthly totals

Computed: AI = locations × (25 × $0.04 + 4 × $0.05); Stripe = (locations ÷ 1.5) × ($58.50 × 3.6% + $0.30).

| | 10 locations | 100 locations | 1,000 locations |
|---|---|---|---|
| Revenue at $39/location | $390 | $3,900 | $39,000 |
| Supabase (plan + compute + PITR) | $25 (no PITR) | $25 + $60 + $100 = $185 | $25 + $410 + $100 + ≈ $15 DB/storage overage ≈ $550 |
| Data after 12 months | ≈ 0.7 GB DB, 3.7 GB files | ≈ 7 GB DB, 37 GB files | ≈ 72 GB DB, 370 GB files |
| Hosting | $20 | $100 | $400 |
| Monitoring + email | $0 | $50 | $240 |
| AI (if every location opts in at the usage above) | $12 | $120 | $1,200 |
| Stripe (one charge per org; assume 1.5 locations/org avg, ≈ $2.41/org) | ≈ $16 | ≈ $160 | ≈ $1,604 |
| **Total variable + platform** | **≈ $73** | **≈ $615** | **≈ $3,994** |
| Gross margin before people | ≈ 81% | ≈ 84% | ≈ 90% |

Excluded: salaries, support, onboarding labour (sold separately), legal/compliance, accounting,
insurance, and any security review — these dominate at 10 and 100 locations.

## Sensitivities

- **AI is the largest variable cost** and is bounded by per-org monthly allowances. If allowances
  were removed and a location ran 300 extractions/month, AI alone would be ≈ $12/location (31% of
  revenue). Keep the caps; price heavy use as an add-on.
- **Card fees** are fixed per charge: a single-location org pays ≈ $1.70 (4.4%) per month; annual
  billing would cut this.
- **Database** growth is dominated by sales lines. At 1,000 locations, 12 months ≈ 108M lines.
  Partitioning `sales_lines` by month and archiving aggregates after 25 months should be planned
  before ≈ 300 locations; queries already aggregate per location and period (ADR 0006).
- **Storage** is cheap but retention is 7 years for invoices: plan lifecycle to colder storage.
