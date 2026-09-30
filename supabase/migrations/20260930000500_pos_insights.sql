-- POS imports, normalized sales, item/modifier mappings, analysis runs and AI explanations.

create table public.pos_mapping_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  vendor text not null,
  kind text not null check (kind in ('transactions', 'aggregate')),
  columns jsonb not null,
  date_format text not null,
  decimal_separator text not null default '.' check (decimal_separator in ('.', ',')),
  modifier_separator text,
  -- Always false for user-created profiles; built-in presets carry their own status in code.
  verified boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

create table public.pos_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  document_id uuid not null,
  kind text not null check (kind in ('transactions', 'aggregate')),
  -- Snapshot of the mapping used, so the import can be explained later.
  profile jsonb not null,
  encoding text,
  delimiter text,
  report_start date,
  report_end date,
  overlap_policy text not null default 'reject' check (overlap_policy in ('reject', 'replace')),
  status text not null default 'uploaded' check (status in
    ('uploaded', 'validating', 'needs_review', 'committing', 'committed', 'failed', 'cancelled', 'superseded')),
  stats jsonb not null default '{}'::jsonb,
  date_start date,
  date_end date,
  accept_partial boolean not null default false,
  accepted_by uuid references auth.users (id) on delete set null,
  committed_at timestamptz,
  committed_by uuid references auth.users (id) on delete set null,
  error text,
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade,
  foreign key (org_id, document_id) references public.documents (org_id, id)
);
create index pos_imports_loc on public.pos_imports (org_id, location_id, created_at desc);

-- Staging: every source row with its outcome. Only mapped fields are kept.
create table public.pos_import_rows (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  import_id uuid not null,
  row_number integer not null,
  outcome text not null check (outcome in ('accepted', 'quarantined', 'duplicate_in_file', 'duplicate_existing')),
  reasons text[] not null default '{}',
  warnings text[] not null default '{}',
  normalized jsonb,
  -- Mapped source values for quarantined rows, so a person can see what was wrong.
  source jsonb,
  foreign key (org_id, import_id) references public.pos_imports (org_id, id) on delete cascade
);
create index pos_import_rows_import on public.pos_import_rows (import_id, outcome, row_number);

create table public.sales_lines (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  location_id uuid not null,
  import_id uuid not null,
  row_number integer not null,
  business_date date not null,
  business_date_end date not null,
  occurred_at timestamptz,
  transaction_id text,
  line_id text,
  item_key text not null,
  item_name text not null,
  category text,
  modifiers text[] not null default '{}',
  quantity numeric(12, 3) not null check (quantity >= 0),
  gross_sales numeric(14, 2),
  net_sales numeric(14, 2),
  discount numeric(14, 2),
  kind text not null check (kind in ('sale', 'void', 'comp', 'refund')),
  void_prepared boolean,
  dedupe_key text not null,
  check (business_date_end >= business_date),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade,
  foreign key (org_id, import_id) references public.pos_imports (org_id, id) on delete cascade
);
create unique index sales_lines_dedupe on public.sales_lines (org_id, location_id, dedupe_key);
create index sales_lines_period on public.sales_lines (org_id, location_id, business_date);
create index sales_lines_item on public.sales_lines (org_id, location_id, item_key);

-- POS item -> recipe, over time. Remapping closes the row and opens a new one.
create table public.pos_item_mappings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  item_key text not null,
  item_name text not null,
  recipe_id uuid,
  -- True when the item intentionally has no recipe (merch, cover charge, food handled elsewhere).
  not_stock boolean not null default false,
  servings_per_unit numeric(10, 3) not null default 1 check (servings_per_unit > 0),
  effective_from date not null default '2000-01-01',
  effective_to date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (not_stock or recipe_id is not null),
  check (effective_to is null or effective_to >= effective_from),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade,
  foreign key (org_id, recipe_id) references public.recipes (org_id, id)
);
create unique index pos_item_mappings_current on public.pos_item_mappings (org_id, location_id, item_key) where effective_to is null;

create table public.modifier_mappings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  modifier_key text not null,
  item_key text,
  -- [{kind: ignore|scale|add|substitute, ...}] validated server-side against the domain schema.
  actions jsonb not null,
  effective_from date not null default '2000-01-01',
  effective_to date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade
);
create unique index modifier_mappings_current on public.modifier_mappings (org_id, location_id, modifier_key, coalesce(item_key, '')) where effective_to is null;

-- ---------------------------------------------------------------- insights

create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  opening_count_id uuid not null,
  closing_count_id uuid not null,
  calc_version text not null,
  -- Hash of every input the result depends on; a changed hash means the run is stale.
  input_hash text not null,
  status text not null default 'succeeded' check (status in ('succeeded', 'failed')),
  capability text not null,
  result jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade,
  foreign key (org_id, opening_count_id) references public.count_sessions (org_id, id),
  foreign key (org_id, closing_count_id) references public.count_sessions (org_id, id)
);
create index analysis_runs_loc on public.analysis_runs (org_id, location_id, created_at desc);

create table public.analysis_explanations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  run_id uuid not null,
  evidence_hash text not null,
  provider text not null,
  model text,
  prompt_version text not null,
  status text not null check (status in ('succeeded', 'failed', 'rejected')),
  output jsonb,
  error text,
  input_tokens integer,
  output_tokens integer,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (org_id, run_id) references public.analysis_runs (org_id, id) on delete cascade
);
create unique index analysis_explanations_cache on public.analysis_explanations (run_id, evidence_hash, prompt_version) where status = 'succeeded';

-- ---------------------------------------------------------------- RLS

alter table public.pos_mapping_profiles enable row level security;
alter table public.pos_imports enable row level security;
alter table public.pos_import_rows enable row level security;
alter table public.sales_lines enable row level security;
alter table public.pos_item_mappings enable row level security;
alter table public.modifier_mappings enable row level security;
alter table public.analysis_runs enable row level security;
alter table public.analysis_explanations enable row level security;

create policy "importers manage profiles" on public.pos_mapping_profiles for all to authenticated
  using (app.has_perm(org_id, 'imports.manage')) with check (app.has_perm(org_id, 'imports.manage') and verified = false);

create policy "importers read imports" on public.pos_imports for select to authenticated using (app.has_location_perm(org_id, location_id, 'imports.manage'));
create policy "importers read rows" on public.pos_import_rows for select to authenticated using (app.has_perm(org_id, 'imports.manage'));

create policy "insight readers read sales" on public.sales_lines for select to authenticated
  using (app.has_location_perm(org_id, location_id, 'insights.view') or app.has_location_perm(org_id, location_id, 'imports.manage'));

create policy "members read item mappings" on public.pos_item_mappings for select to authenticated using (app.can_see_location(org_id, location_id));
create policy "importers map items" on public.pos_item_mappings for insert to authenticated with check (app.has_location_perm(org_id, location_id, 'imports.manage'));
create policy "importers close item mappings" on public.pos_item_mappings for update to authenticated
  using (app.has_location_perm(org_id, location_id, 'imports.manage')) with check (app.has_location_perm(org_id, location_id, 'imports.manage'));
create policy "members read modifier mappings" on public.modifier_mappings for select to authenticated using (app.can_see_location(org_id, location_id));
create policy "importers map modifiers" on public.modifier_mappings for insert to authenticated with check (app.has_location_perm(org_id, location_id, 'imports.manage'));
create policy "importers close modifier mappings" on public.modifier_mappings for update to authenticated
  using (app.has_location_perm(org_id, location_id, 'imports.manage')) with check (app.has_location_perm(org_id, location_id, 'imports.manage'));

create policy "insight readers read runs" on public.analysis_runs for select to authenticated
  using (app.has_location_perm(org_id, location_id, 'insights.view') and app.has_perm(org_id, 'costs.view'));
create policy "insight readers read explanations" on public.analysis_explanations for select to authenticated
  using (app.has_perm(org_id, 'insights.view') and app.has_perm(org_id, 'costs.view'));

-- Imports, sales and analysis are written by server jobs (service role) after permission checks.
revoke insert, update, delete on public.pos_imports, public.pos_import_rows, public.sales_lines,
  public.analysis_runs, public.analysis_explanations from authenticated, anon;
revoke delete on public.pos_item_mappings, public.modifier_mappings from authenticated, anon;

create trigger pos_imports_touch before update on public.pos_imports for each row execute function app.touch_updated_at();
