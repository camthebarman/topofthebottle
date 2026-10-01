# Runbook: retention, export and deletion

| Data | Retention | Mechanism |
|---|---|---|
| Uploaded invoices | 7 years from upload | `documents.retain_until`; daily sweep deletes the file, marks the row, writes an audit event |
| Uploaded POS files | 2 years | same |
| Tenant records | While the organization exists | — |
| Organization after owner requests deletion | Deleted 30 days later (cancellable until then) | `data_requests` → `runRetention()` removes storage under `org/<id>/` and deletes the organization (cascades to every tenant row) |
| Structured logs | Per log provider | Logs redact secrets and emails |

- **Export:** owners download a JSON export from Settings → Your data (streamed, paged, 48 tables:
  catalog, recipes, menu, ledger, counts, invoices, sales, Bar Book, schedules, events, analyses,
  audit log, subscription). It includes document *metadata*, not the uploaded files, and not
  per-row import diagnostics (`pos_import_rows`). Files can be downloaded individually from their
  invoice or import page. A bundled file export is a launch follow-up.
- **Deletion requests:** Settings → Your data → type the organization name. Owners can cancel before
  the date. A failed deletion sets the request to `failed` and logs `retention.organization_failed`;
  fix and set it back to `requested`.
- Backups still contain deleted data until they age out (state this in the privacy policy).
- Verified by `apps/web/test/integration/retention.test.ts`.
