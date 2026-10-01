#!/usr/bin/env python3
"""Writes docs/data-dictionary.md from the local database schema (run after `supabase db reset`)."""
import os, subprocess
PSQL = os.environ.get("PSQL", "docker exec -i supabase_db_table-zero-bar psql -U postgres").split() + ["-At", "-F", "\t"]

PURPOSE = {
 "organizations": ("Tenant (a business).", "Business"),
 "locations": ("A bar/venue within an organization; has its own timezone and business-day start.", "Business"),
 "memberships": ("User's role in an organization, optional location restriction, display name.", "Personal (staff)"),
 "invitations": ("Pending invites; token stored hashed, expires.", "Personal (email)"),
 "org_settings": ("Targets, AI opt-ins, business-day start, variance threshold.", "Business"),
 "permissions": ("Catalog of permission keys.", "Reference"),
 "role_permissions": ("Role → permission grants.", "Reference"),
 "audit_events": ("Append-only audit log written by definer functions.", "Business + actor ids"),
 "products": ("Stock items (bottles, juices, garnish) with base dimension, container size, tare weights.", "Business"),
 "product_costs": ("Effective-dated cost per base unit. Separate table so costs.view can be enforced by RLS.", "Commercial"),
 "product_conversions": ("Product-specific weight↔volume/count conversions.", "Business"),
 "location_products": ("Per-location par and settings for a product.", "Business"),
 "suppliers": ("Vendors.", "Business"),
 "supplier_items": ("Supplier SKUs and pack sizes for products.", "Commercial"),
 "inventory_areas": ("Count areas within a location (back bar, storage).", "Business"),
 "ingredients": ("Recipe-level ingredient names, mapped to products per location.", "Business"),
 "ingredient_mappings": ("Effective-dated ingredient → product mapping per location.", "Business"),
 "recipes": ("Drinks, dishes and preps (identity; content lives in versions).", "Business"),
 "recipe_versions": ("Immutable recipe versions (yield, method, glass, produces_product_id).", "Business"),
 "recipe_components": ("Lines of a recipe version: ingredient or sub-recipe, qty, unit.", "Business"),
 "recipe_templates": ("Original classic templates (global, read-only) with provenance.", "Reference"),
 "menu_items": ("Current-menu selections with effective-dated price.", "Commercial"),
 "stock_movements": ("Immutable stock ledger (receipts, waste, transfers, production, adjustments, reversals).", "Business"),
 "stock_movement_costs": ("Unit cost attached to receipts/opening balances (restricted by costs.view).", "Commercial"),
 "count_sessions": ("Stock counts (draft → finalized/void), versioned.", "Business"),
 "count_lines": ("Individual counted lines with method and uncertainty.", "Business"),
 "transfers": ("Location-to-location transfer headers linking two movements.", "Business"),
 "production_runs": ("Batch production records linking consume/output movements.", "Business"),
 "documents": ("Uploaded files (private storage path, hash, retention date).", "May contain personal data"),
 "invoices": ("Supplier invoices: draft → approved → received; credit notes.", "Commercial"),
 "invoice_lines": ("Invoice lines with product match, pack math, landed cost.", "Commercial"),
 "invoice_extractions": ("Versioned extraction results (CSV or AI) with provider/model.", "Commercial"),
 "receivings": ("Physical receipt of an approved invoice (idempotent).", "Business"),
 "receiving_lines": ("Received quantities per line, may differ from billed.", "Business"),
 "pos_imports": ("POS CSV import lifecycle and stats.", "Business"),
 "pos_import_rows": ("Per-row outcome (accepted/quarantined/duplicate) with reasons; sensitive columns removed.", "Business"),
 "pos_mapping_profiles": ("Saved column mappings per location.", "Business"),
 "pos_item_mappings": ("POS item key → recipe (or not-stock), effective-dated.", "Business"),
 "modifier_mappings": ("POS modifier → ignore/scale/add/substitute rule.", "Business"),
 "sales_lines": ("Normalized sales (sale/comp/void/refund) — no staff identity.", "Commercial"),
 "analysis_runs": ("Saved Insights calculations with input hash and calc version.", "Commercial"),
 "analysis_explanations": ("AI/stub explanations tied to a run and evidence hash.", "Commercial"),
 "barbook_entries": ("Bar Book handoff notes (current text).", "Personal (authorship)"),
 "barbook_revisions": ("Prior versions of entries.", "Personal (authorship)"),
 "barbook_acks": ("Who acknowledged an entry, when.", "Personal (staff)"),
 "staff_profiles": ("Schedulable staff (may be non-users).", "Personal (staff)"),
 "schedule_weeks": ("Week container, versioned.", "Business"),
 "shifts": ("Shifts with role and assignee.", "Personal (staff)"),
 "schedule_publications": ("Published snapshots of a week.", "Personal (staff)"),
 "bev_events": ("Catering/beverage events with headcount and duration.", "Business (client name)"),
 "bev_event_recipes": ("Drinks selected for an event with mix share.", "Business"),
 "bev_event_quotes": ("Saved quote snapshots.", "Commercial"),
 "billing_accounts": ("Stripe customer link per organization.", "Commercial"),
 "subscriptions": ("Stripe subscription state per location.", "Commercial"),
 "stripe_events": ("Processed webhook ids (idempotency).", "Operational"),
 "jobs": ("Durable background job queue.", "Operational"),
 "notifications": ("In-app notifications.", "Personal (recipient)"),
 "data_requests": ("Export and deletion requests.", "Operational"),
 "usage_allowances": ("Monthly allowances (global defaults or per org).", "Operational"),
 "usage_counters": ("Monthly usage per org and metric.", "Operational"),
}

def q(sql):
    return [l.split("\t") for l in subprocess.run(PSQL + ["-c", sql], capture_output=True, text=True, check=True).stdout.splitlines() if l]

cols = q("""select c.table_name, c.column_name, c.data_type, c.is_nullable, coalesce(c.column_default,'')
 from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
 where c.table_schema='public' and t.table_type='BASE TABLE' order by c.table_name, c.ordinal_position""")
immut = {r[0] for r in q("""select table_name from information_schema.tables t where table_schema='public'
 and not exists (select 1 from information_schema.role_table_grants g where g.table_schema='public' and g.table_name=t.table_name and g.grantee='authenticated' and g.privilege_type in ('UPDATE','DELETE'))""")}
by = {}
for t, c, typ, nul, dflt in cols: by.setdefault(t, []).append((c, typ, nul, dflt))

out = ["# Data dictionary", "", "Generated by `scripts/gen-data-dictionary.py` from the migrated local database. All tables are in",
       "schema `public`, have row-level security enabled, and (except reference tables) carry `org_id`.",
       "\"Write-protected\" means the `authenticated` role has no UPDATE/DELETE grant: rows change only through",
       "security-definer functions or not at all (ledgers).", "",
       "Classification: **Personal** = identifies staff or customers; **Commercial** = costs, prices, sales;",
       "**Business** = operational data; **Reference** = global, read-only.", "",
       "Retention: tenant data is kept while the organization exists and deleted 30 days after an owner requests",
       "deletion. Uploaded invoices are kept 7 years, POS files 2 years (`documents.retain_until`).", ""]
missing = [t for t in by if t not in PURPOSE]
for t in sorted(by):
    p, cls = PURPOSE.get(t, ("(undocumented)", "?"))
    out += [f"## {t}", "", f"{p}  ", f"Classification: {cls}." + (" Write-protected." if t in immut else ""), "",
            "| Column | Type | Null | Default |", "|---|---|---|---|"]
    esc = lambda v: v.replace("|", "\\|")[:60]
    out += [f"| {c} | {typ} | {'yes' if nul=='YES' else 'no'} | {esc(d)} |" for c, typ, nul, d in by[t]]
    out.append("")
open(os.path.join(os.path.dirname(__file__), "..", "docs", "data-dictionary.md"), "w").write("\n".join(out))
print(f"{len(by)} tables; undocumented: {missing}")
