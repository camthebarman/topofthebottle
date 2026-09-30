-- Inventory ledger, counts, transfers and batch production.

create table public.inventory_areas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 80),
  sort_order integer not null default 0,
  archived_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade
);

-- Location-specific stocking: par levels and preferred supplier pack.
create table public.location_products (
  org_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  par_base numeric(14, 4) check (par_base >= 0),
  preferred_supplier_item_id uuid,
  active boolean not null default true,
  primary key (location_id, product_id),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade,
  foreign key (org_id, product_id) references public.products (org_id, id) on delete cascade,
  foreign key (org_id, preferred_supplier_item_id) references public.supplier_items (org_id, id) on delete set null (preferred_supplier_item_id)
);

create type public.movement_type as enum (
  'opening_balance', 'receipt', 'transfer_in', 'transfer_out', 'supplier_return', 'waste', 'breakage',
  'production_consume', 'production_output', 'event_dispatch', 'event_return', 'count_adjustment', 'manual_adjustment'
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  type public.movement_type not null,
  qty_base numeric(18, 6) not null check (qty_base <> 0),
  occurred_at timestamptz not null default now(),
  reverses_id uuid,
  reason text check (length(reason) <= 500),
  source_type text check (source_type in ('invoice', 'receiving', 'count', 'transfer', 'production', 'event', 'manual')),
  source_id uuid,
  idempotency_key text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade,
  foreign key (org_id, product_id) references public.products (org_id, id),
  foreign key (org_id, reverses_id) references public.stock_movements (org_id, id),
  check (type <> 'manual_adjustment' or reverses_id is not null or length(trim(coalesce(reason, ''))) > 0)
);
create index stock_movements_period on public.stock_movements (org_id, location_id, product_id, occurred_at);
create index stock_movements_source on public.stock_movements (org_id, source_type, source_id);
-- A movement can be reversed at most once.
create unique index stock_movements_one_reversal on public.stock_movements (reverses_id) where reverses_id is not null;
create unique index stock_movements_idempotency on public.stock_movements (org_id, idempotency_key) where idempotency_key is not null;

-- Sign rules, and reversal consistency.
create or replace function app.check_movement() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_sign integer;
  v_orig public.stock_movements;
begin
  v_sign := case new.type
    when 'opening_balance' then 1 when 'receipt' then 1 when 'transfer_in' then 1 when 'production_output' then 1 when 'event_return' then 1
    when 'transfer_out' then -1 when 'supplier_return' then -1 when 'waste' then -1 when 'breakage' then -1
    when 'production_consume' then -1 when 'event_dispatch' then -1
    else 0 end;
  if new.reverses_id is not null then
    select * into v_orig from public.stock_movements where id = new.reverses_id;
    if v_orig.reverses_id is not null then
      raise exception 'Reverse the original movement, not a reversal' using errcode = '22023';
    end if;
    if v_orig.product_id <> new.product_id or v_orig.location_id <> new.location_id or v_orig.type <> new.type
       or v_orig.qty_base <> -new.qty_base then
      raise exception 'A reversal must exactly negate the original movement' using errcode = '22023';
    end if;
  elsif v_sign <> 0 and sign(new.qty_base) <> v_sign then
    raise exception '% movements must be %', new.type, case when v_sign > 0 then 'positive' else 'negative' end using errcode = '22023';
  end if;
  return new;
end $$;
create trigger stock_movements_check before insert on public.stock_movements for each row execute function app.check_movement();

-- Extended cost of receipts, kept apart so cost visibility is a row-level permission.
create table public.stock_movement_costs (
  movement_id uuid primary key,
  org_id uuid not null,
  extended_cost numeric(18, 6) not null,
  currency char(3) not null default 'USD',
  foreign key (org_id, movement_id) references public.stock_movements (org_id, id) on delete cascade
);

-- ---------------------------------------------------------------- counts

create table public.count_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  name text,
  status text not null default 'draft' check (status in ('draft', 'finalized', 'void')),
  -- The instant the count represents. Movements at or before it are "before the count".
  counted_at timestamptz not null default now(),
  started_by uuid references auth.users (id) on delete set null,
  finalized_by uuid references auth.users (id) on delete set null,
  finalized_at timestamptz,
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade
);
create index count_sessions_loc on public.count_sessions (org_id, location_id, counted_at desc);

create table public.count_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  session_id uuid not null,
  product_id uuid not null,
  area_id uuid,
  method text not null check (method in ('full_units', 'tenths', 'weight', 'measured')),
  full_units numeric(12, 3) not null default 0 check (full_units >= 0),
  tenths numeric(4, 1) check (tenths between 0 and 10),
  gross_weight_g numeric(12, 2) check (gross_weight_g >= 0),
  measured_base numeric(14, 4) check (measured_base >= 0),
  -- Computed server-side from the entry and the product's container data.
  qty_base numeric(18, 6) not null check (qty_base >= 0),
  approximate boolean not null,
  uncertainty_base numeric(18, 6) not null default 0,
  counted_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (org_id, session_id) references public.count_sessions (org_id, id) on delete cascade,
  foreign key (org_id, product_id) references public.products (org_id, id),
  foreign key (org_id, area_id) references public.inventory_areas (org_id, id)
);
create unique index count_lines_one on public.count_lines (session_id, product_id, coalesce(area_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------- transfers and production

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  from_location_id uuid not null,
  to_location_id uuid not null,
  occurred_at timestamptz not null default now(),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  check (from_location_id <> to_location_id),
  foreign key (org_id, from_location_id) references public.locations (org_id, id),
  foreign key (org_id, to_location_id) references public.locations (org_id, id)
);

create table public.production_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  recipe_version_id uuid not null,
  output_product_id uuid not null,
  output_qty_base numeric(18, 6) not null check (output_qty_base > 0),
  produced_at timestamptz not null default now(),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, location_id) references public.locations (org_id, id),
  foreign key (org_id, recipe_version_id) references public.recipe_versions (org_id, id),
  foreign key (org_id, output_product_id) references public.products (org_id, id)
);

-- ---------------------------------------------------------------- RLS

alter table public.inventory_areas enable row level security;
alter table public.location_products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_movement_costs enable row level security;
alter table public.count_sessions enable row level security;
alter table public.count_lines enable row level security;
alter table public.transfers enable row level security;
alter table public.production_runs enable row level security;

create policy "members read areas" on public.inventory_areas for select to authenticated using (app.can_see_location(org_id, location_id));
create policy "settings managers edit areas" on public.inventory_areas for all to authenticated
  using (app.has_location_perm(org_id, location_id, 'settings.manage')) with check (app.has_location_perm(org_id, location_id, 'settings.manage'));

create policy "members read stocking" on public.location_products for select to authenticated using (app.can_see_location(org_id, location_id));
create policy "catalog editors edit stocking" on public.location_products for all to authenticated
  using (app.has_location_perm(org_id, location_id, 'catalog.edit')) with check (app.has_location_perm(org_id, location_id, 'catalog.edit'));

create policy "members read movements" on public.stock_movements for select to authenticated using (app.can_see_location(org_id, location_id));
-- Movements are inserted only by the posting functions below (security definer with explicit checks).

create policy "cost viewers read movement costs" on public.stock_movement_costs for select to authenticated using (app.has_perm(org_id, 'costs.view'));

create policy "members read count sessions" on public.count_sessions for select to authenticated using (app.can_see_location(org_id, location_id));
create policy "counters start sessions" on public.count_sessions for insert to authenticated
  with check (app.has_location_perm(org_id, location_id, 'inventory.count') and status = 'draft');
create policy "counters edit draft sessions" on public.count_sessions for update to authenticated
  using (status = 'draft' and app.has_location_perm(org_id, location_id, 'inventory.count'))
  with check (status in ('draft', 'void') and app.has_location_perm(org_id, location_id, 'inventory.count'));

create policy "members read count lines" on public.count_lines for select to authenticated
  using (exists (select 1 from public.count_sessions s where s.id = session_id and app.can_see_location(s.org_id, s.location_id)));
-- Count lines are written through upsert_count_line(), which computes the quantity.

create policy "members read transfers" on public.transfers for select to authenticated
  using (app.can_see_location(org_id, from_location_id) or app.can_see_location(org_id, to_location_id));
create policy "members read production" on public.production_runs for select to authenticated using (app.can_see_location(org_id, location_id));

revoke insert, update, delete on public.stock_movements, public.stock_movement_costs, public.count_lines, public.transfers, public.production_runs from authenticated, anon;

create trigger count_sessions_touch before update on public.count_sessions for each row execute function app.touch_updated_at();
create trigger count_sessions_version before update on public.count_sessions for each row execute function app.bump_version();

-- ---------------------------------------------------------------- functions

-- Book quantity of a product at a location as of an instant.
create or replace function public.book_balance(p_org uuid, p_location uuid, p_product uuid, p_as_of timestamptz default now())
returns numeric
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(sum(qty_base), 0) from public.stock_movements
  where org_id = p_org and location_id = p_location and product_id = p_product and occurred_at <= p_as_of
$$;

create or replace function public.book_balances(p_org uuid, p_location uuid, p_as_of timestamptz default now())
returns table (product_id uuid, qty_base numeric)
language sql stable security invoker
set search_path = ''
as $$
  select m.product_id, sum(m.qty_base) from public.stock_movements m
  where m.org_id = p_org and m.location_id = p_location and m.occurred_at <= p_as_of
  group by m.product_id
$$;

-- Record waste, breakage, a manual adjustment, an opening balance or an event movement.
create or replace function public.record_movement(
  p_org uuid, p_location uuid, p_product uuid, p_type public.movement_type, p_qty_base numeric,
  p_occurred_at timestamptz, p_reason text, p_idempotency_key text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_type not in ('waste', 'breakage', 'manual_adjustment', 'opening_balance', 'event_dispatch', 'event_return', 'supplier_return') then
    raise exception 'Use the dedicated action for % movements', p_type using errcode = '22023';
  end if;
  if not app.has_location_perm(p_org, p_location, 'inventory.move') then
    raise exception 'You do not have permission to record stock movements' using errcode = '42501';
  end if;
  if p_occurred_at > now() + interval '5 minutes' then
    raise exception 'Movements cannot be dated in the future' using errcode = '22023';
  end if;
  if p_idempotency_key is not null then
    select id into v_id from public.stock_movements where org_id = p_org and idempotency_key = p_idempotency_key;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.stock_movements (org_id, location_id, product_id, type, qty_base, occurred_at, reason, source_type, idempotency_key, created_by)
  values (p_org, p_location, p_product, p_type, p_qty_base, coalesce(p_occurred_at, now()), p_reason,
    case when p_type in ('event_dispatch', 'event_return') then 'event' else 'manual' end, p_idempotency_key, auth.uid())
  returning id into v_id;
  perform app.audit(p_org, 'stock.movement_recorded', 'stock_movement', v_id::text,
    jsonb_build_object('type', p_type, 'qty_base', p_qty_base, 'product', p_product, 'reason', p_reason));
  return v_id;
end $$;

create or replace function public.reverse_movement(p_org uuid, p_movement uuid, p_reason text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_orig public.stock_movements;
  v_id uuid;
begin
  select * into v_orig from public.stock_movements where id = p_movement and org_id = p_org for update;
  if v_orig.id is null then
    raise exception 'Movement not found' using errcode = '22023';
  end if;
  if not app.has_location_perm(p_org, v_orig.location_id, 'inventory.move') then
    raise exception 'You do not have permission to reverse stock movements' using errcode = '42501';
  end if;
  if v_orig.type = 'count_adjustment' then
    raise exception 'Count adjustments are corrected by a new count, not a reversal' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Give a reason for the reversal' using errcode = '22023';
  end if;
  insert into public.stock_movements (org_id, location_id, product_id, type, qty_base, occurred_at, reverses_id, reason, source_type, source_id, created_by)
  values (p_org, v_orig.location_id, v_orig.product_id, v_orig.type, -v_orig.qty_base, now(), v_orig.id, p_reason, v_orig.source_type, v_orig.source_id, auth.uid())
  returning id into v_id;
  insert into public.stock_movement_costs (movement_id, org_id, extended_cost, currency)
  select v_id, org_id, -extended_cost, currency from public.stock_movement_costs where movement_id = v_orig.id;
  perform app.audit(p_org, 'stock.movement_reversed', 'stock_movement', v_orig.id::text, jsonb_build_object('reversal', v_id, 'reason', p_reason));
  return v_id;
end $$;

-- Save one count-sheet entry. Quantity is computed here from the product's container data,
-- mirroring countToBase() in the domain package.
create or replace function public.upsert_count_line(
  p_org uuid, p_session uuid, p_product uuid, p_area uuid, p_method text,
  p_full_units numeric, p_tenths numeric, p_gross_weight_g numeric, p_measured_base numeric
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_session public.count_sessions;
  v_p public.products;
  v_size numeric;
  v_partial numeric := 0;
  v_approx boolean := false;
  v_unc numeric := 0;
  v_id uuid;
begin
  select * into v_session from public.count_sessions where id = p_session and org_id = p_org;
  if v_session.id is null or v_session.status <> 'draft' then
    raise exception 'Count session is not open' using errcode = '22023';
  end if;
  if not app.has_location_perm(p_org, v_session.location_id, 'inventory.count') then
    raise exception 'You do not have permission to count' using errcode = '42501';
  end if;
  select * into v_p from public.products where id = p_product and org_id = p_org;
  if v_p.id is null then
    raise exception 'Product not found' using errcode = '22023';
  end if;
  v_size := v_p.container_size_base;
  if coalesce(p_full_units, 0) < 0 then
    raise exception 'Full units cannot be negative' using errcode = '22023';
  end if;
  if (p_method <> 'measured' or coalesce(p_full_units, 0) > 0) and v_size is null then
    raise exception '% has no container size; set one before counting containers', v_p.name using errcode = '22023';
  end if;
  case p_method
    when 'full_units' then null;
    when 'tenths' then
      if p_tenths is null or p_tenths < 0 or p_tenths > 10 then
        raise exception 'Tenths must be between 0 and 10' using errcode = '22023';
      end if;
      v_partial := v_size * p_tenths / 10;
      v_approx := p_tenths > 0;
      v_unc := case when v_approx then v_size * 0.05 else 0 end;
    when 'weight' then
      if v_p.full_weight_g is null or v_p.empty_weight_g is null then
        raise exception '% needs full and empty container weights for scale counts', v_p.name using errcode = '22023';
      end if;
      if p_gross_weight_g is null or p_gross_weight_g < v_p.empty_weight_g or p_gross_weight_g > v_p.full_weight_g * 1.05 then
        raise exception 'Scale weight is outside the empty-to-full range for this container' using errcode = '22023';
      end if;
      v_partial := least(v_size, v_size * (p_gross_weight_g - v_p.empty_weight_g) / (v_p.full_weight_g - v_p.empty_weight_g));
      v_approx := true;
      v_unc := v_size * 0.02;
    when 'measured' then
      if p_measured_base is null or p_measured_base < 0 then
        raise exception 'Measured quantity cannot be negative' using errcode = '22023';
      end if;
      v_partial := p_measured_base;
    else
      raise exception 'Unknown count method %', p_method using errcode = '22023';
  end case;

  insert into public.count_lines (org_id, session_id, product_id, area_id, method, full_units, tenths, gross_weight_g, measured_base,
    qty_base, approximate, uncertainty_base, counted_by, updated_at)
  values (p_org, p_session, p_product, p_area, p_method, coalesce(p_full_units, 0), p_tenths, p_gross_weight_g, p_measured_base,
    coalesce(p_full_units, 0) * coalesce(v_size, 0) + v_partial, v_approx, v_unc, auth.uid(), now())
  on conflict (session_id, product_id, coalesce(area_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update
    set method = excluded.method, full_units = excluded.full_units, tenths = excluded.tenths, gross_weight_g = excluded.gross_weight_g,
        measured_base = excluded.measured_base, qty_base = excluded.qty_base, approximate = excluded.approximate,
        uncertainty_base = excluded.uncertainty_base, counted_by = excluded.counted_by, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_count_line(p_org uuid, p_line uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_loc uuid;
begin
  select s.location_id into v_loc from public.count_lines l join public.count_sessions s on s.id = l.session_id
  where l.id = p_line and l.org_id = p_org and s.status = 'draft';
  if v_loc is null or not app.has_location_perm(p_org, v_loc, 'inventory.count') then
    raise exception 'Count line not found or session closed' using errcode = '42501';
  end if;
  delete from public.count_lines where id = p_line;
end $$;

-- Finalize: post count adjustments so the book matches the count at counted_at.
-- Products not counted are left alone and reported back.
create or replace function public.finalize_count(p_org uuid, p_session uuid, p_expected_version integer)
returns table (product_id uuid, counted numeric, book numeric, adjustment numeric)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_session public.count_sessions;
begin
  select * into v_session from public.count_sessions where id = p_session and org_id = p_org for update;
  if v_session.id is null then
    raise exception 'Count session not found' using errcode = '22023';
  end if;
  if not app.has_location_perm(p_org, v_session.location_id, 'inventory.finalize') then
    raise exception 'You do not have permission to finalize counts' using errcode = '42501';
  end if;
  if v_session.status <> 'draft' then
    raise exception 'This count is already %', v_session.status using errcode = '22023';
  end if;
  if v_session.version <> p_expected_version then
    raise exception 'This count was changed by someone else. Reload and try again.' using errcode = '40001';
  end if;
  if not exists (select 1 from public.count_lines where session_id = p_session) then
    raise exception 'Nothing has been counted yet' using errcode = '22023';
  end if;

  drop table if exists _count_result;
  create temporary table _count_result on commit drop as
  select c.product_id, c.counted, coalesce(b.book, 0) as book, c.counted - coalesce(b.book, 0) as adjustment
  from (select l.product_id, sum(l.qty_base) as counted from public.count_lines l where l.session_id = p_session group by l.product_id) c
  left join lateral (
    select sum(m.qty_base) as book from public.stock_movements m
    where m.org_id = p_org and m.location_id = v_session.location_id and m.product_id = c.product_id and m.occurred_at <= v_session.counted_at
  ) b on true;

  insert into public.stock_movements (org_id, location_id, product_id, type, qty_base, occurred_at, reason, source_type, source_id, created_by)
  select p_org, v_session.location_id, r.product_id, 'count_adjustment', r.adjustment, v_session.counted_at, 'Finalized count', 'count', p_session, auth.uid()
  from _count_result r where r.adjustment <> 0;

  update public.count_sessions set status = 'finalized', finalized_at = now(), finalized_by = auth.uid(), version = p_expected_version
  where id = p_session;
  perform app.audit(p_org, 'count.finalized', 'count_session', p_session::text,
    jsonb_build_object('lines', (select count(*) from _count_result), 'adjusted', (select count(*) from _count_result where adjustment <> 0)));
  return query select r.product_id, r.counted, r.book, r.adjustment from _count_result r;
end $$;

-- Move stock between two locations in one transaction.
create or replace function public.post_transfer(p_org uuid, p_from uuid, p_to uuid, p_lines jsonb, p_note text, p_occurred_at timestamptz default now())
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  l jsonb;
begin
  if not (app.has_location_perm(p_org, p_from, 'inventory.move') and app.has_location_perm(p_org, p_to, 'inventory.move')) then
    raise exception 'You need stock permissions at both locations' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 200 then
    raise exception 'Add between 1 and 200 lines' using errcode = '22023';
  end if;
  insert into public.transfers (org_id, from_location_id, to_location_id, occurred_at, note, created_by)
  values (p_org, p_from, p_to, p_occurred_at, p_note, auth.uid()) returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if (l ->> 'qty_base')::numeric <= 0 then
      raise exception 'Transfer quantities must be positive' using errcode = '22023';
    end if;
    insert into public.stock_movements (org_id, location_id, product_id, type, qty_base, occurred_at, source_type, source_id, created_by)
    values (p_org, p_from, (l ->> 'product_id')::uuid, 'transfer_out', -(l ->> 'qty_base')::numeric, p_occurred_at, 'transfer', v_id, auth.uid()),
           (p_org, p_to, (l ->> 'product_id')::uuid, 'transfer_in', (l ->> 'qty_base')::numeric, p_occurred_at, 'transfer', v_id, auth.uid());
  end loop;
  perform app.audit(p_org, 'stock.transfer_posted', 'transfer', v_id::text, jsonb_build_object('lines', jsonb_array_length(p_lines)));
  return v_id;
end $$;

-- Record a batch: consume ingredients and create the prepared product.
-- p_consumed: [{product_id, qty_base}] computed server-side from the recipe version.
create or replace function public.record_production(p_org uuid, p_location uuid, p_recipe_version uuid, p_output_qty_base numeric, p_consumed jsonb, p_note text, p_produced_at timestamptz default now())
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_output uuid;
  l jsonb;
begin
  if not app.has_location_perm(p_org, p_location, 'inventory.move') then
    raise exception 'You do not have permission to record production' using errcode = '42501';
  end if;
  select produces_product_id into v_output from public.recipe_versions where id = p_recipe_version and org_id = p_org;
  if v_output is null then
    raise exception 'This recipe is not set up to produce a stocked batch' using errcode = '22023';
  end if;
  insert into public.production_runs (org_id, location_id, recipe_version_id, output_product_id, output_qty_base, produced_at, note, created_by)
  values (p_org, p_location, p_recipe_version, v_output, p_output_qty_base, p_produced_at, p_note, auth.uid()) returning id into v_id;
  insert into public.stock_movements (org_id, location_id, product_id, type, qty_base, occurred_at, source_type, source_id, created_by)
  values (p_org, p_location, v_output, 'production_output', p_output_qty_base, p_produced_at, 'production', v_id, auth.uid());
  for l in select * from jsonb_array_elements(p_consumed) loop
    if (l ->> 'qty_base')::numeric > 0 then
      insert into public.stock_movements (org_id, location_id, product_id, type, qty_base, occurred_at, source_type, source_id, created_by)
      values (p_org, p_location, (l ->> 'product_id')::uuid, 'production_consume', -(l ->> 'qty_base')::numeric, p_produced_at, 'production', v_id, auth.uid());
    end if;
  end loop;
  perform app.audit(p_org, 'stock.production_recorded', 'production_run', v_id::text, jsonb_build_object('output_qty_base', p_output_qty_base));
  return v_id;
end $$;

grant execute on function public.book_balance, public.book_balances, public.record_movement, public.reverse_movement,
  public.upsert_count_line, public.delete_count_line, public.finalize_count, public.post_transfer, public.record_production to authenticated;
revoke execute on function public.book_balance, public.book_balances, public.record_movement, public.reverse_movement,
  public.upsert_count_line, public.delete_count_line, public.finalize_count, public.post_transfer, public.record_production from anon, public;
