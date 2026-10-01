# Import templates and mapping profiles

Templates live in `docs/import-templates/`. Any CSV works: the mapper lets you pick which column
holds each field and saves that as a **mapping profile** per location for next time.

## POS sales (Imports → Upload)

| Field | Required | Meaning |
|---|---|---|
| Item ID **or** Item name | one of them | What was sold. ID is preferred: names change |
| Quantity | yes | Units sold (negative allowed for refunds) |
| Timestamp **or** Business date | yes for item-level | Timestamp is converted using the location's timezone and business-day start |
| Transaction ID, Line ID | strongly recommended | Used to detect duplicates exactly. Without them, rows are fingerprinted, which can merge genuinely identical lines |
| Parent line ID | for modifier files | Attaches modifier rows to their item |
| Gross, Discount, Net | optional | Money; shown in reports and reconciled against totals |
| Void / Comp / Refund flags | optional | Voids before preparation use no stock; comps used stock; refunds are not treated as stock returned |
| Modifiers | optional | Split by a separator you choose; mapped to rules (ignore, scale, add, substitute) |
| Category, Location | optional | |

**Never imported:** columns that look like staff names (server, employee, staff, bartender,
cashier) or payment/guest data (card, email, phone, guest). They are listed on screen as "Not
imported" and cannot be mapped. See ADR 0008.

Two report shapes:
- **Item-level transactions** (`generic-pos-transactions.csv`): every analysis is available.
- **Product mix summary** (`generic-pos-product-mix.csv`): totals per item for a date range you
  enter. Supports usage and variance for the whole period but not time-of-day, voids or comps.
  Overlapping summaries must be explicitly replaced, because they have no line IDs to dedupe.

Rows that fail validation are quarantined with a reason (bad number, bad date, empty item) and
shown before you commit. Nothing is imported until you press Import.

### Presets

| Preset | Status | Header source |
|---|---|---|
| Toast — Item Selection Details | **Not yet verified** with a real export | Toast data export field reference, `ItemSelectionDetails.csv` |
| Toast — Modifier Selection Details | **Not yet verified** | Toast reference, `ModifiersSelectionDetails.csv` |
| Square — Item Sales detail (draft) | **Not yet verified; draft** | No authoritative Square reference available |
| Lightspeed, Clover, others | Use the generic mapper | — |

Presets only pre-fill the mapping; you review it every time. Known Toast behaviour: comps appear
as discounted sales unless the export includes a comp flag; the import report shows discount totals
so they can be reconciled.

## Supplier invoices as CSV (Inventory → Invoices → Upload)

`invoice-lines.csv`. Columns are detected by name: description (required), quantity (required),
SKU, pack/units per case, unit price, line total. Supplier, invoice number, dates and totals are
**not** read from a CSV; you enter them on the review screen. Up to 200 lines per file; rows that
cannot be read and lines beyond the limit are reported on the review screen. PDFs and photos use AI
extraction only if the organization has opted in.

## Data from the earlier browser tools (Settings → Import)

Upload the JSON exported from the 86d food/bev tools. The importer shows a plan first: products,
recipes and opening stock it will create, and an **exception list** with a reason for every record
it will not import (batches, transfers, settings, zero yields, unresolved ingredients). Nothing is
dropped silently (defect D5).
