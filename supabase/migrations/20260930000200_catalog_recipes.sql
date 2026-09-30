-- Products, suppliers, ingredients, recipes (immutable versions) and menus.

create type public.dimension as enum ('volume', 'mass', 'count');
create type public.recipe_kind as enum ('drink', 'dish', 'prep');

-- ---------------------------------------------------------------- catalog

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  contact text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create unique index suppliers_name on public.suppliers (org_id, lower(name)) where archived_at is null;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  category text not null default 'other' check (category in
    ('spirit', 'liqueur', 'wine', 'beer', 'mixer', 'juice', 'syrup', 'garnish', 'prep', 'food', 'consumable', 'other')),
  dimension public.dimension not null,
  -- Base-unit content of one countable container (750 for a 750 mL bottle).
  container_size_base numeric(14, 4) check (container_size_base > 0),
  container_label text,
  full_weight_g numeric(12, 2) check (full_weight_g > 0),
  empty_weight_g numeric(12, 2) check (empty_weight_g >= 0),
  -- Share of purchased quantity that is usable. Null = 100.
  usable_yield_pct numeric(6, 3) check (usable_yield_pct > 0 and usable_yield_pct <= 100),
  default_count_method text not null default 'tenths' check (default_count_method in ('full_units', 'tenths', 'weight', 'measured')),
  is_prep_output boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (org_id, id),
  check (full_weight_g is null or empty_weight_g is null or full_weight_g > empty_weight_g)
);
create index products_org_name on public.products (org_id, lower(name));

-- Product-specific bridges between dimensions (1 each = 30 mL juice).
create table public.product_conversions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  product_id uuid not null,
  from_qty numeric(14, 4) not null check (from_qty > 0),
  from_unit text not null,
  to_qty numeric(14, 4) not null check (to_qty > 0),
  to_unit text not null,
  note text,
  created_at timestamptz not null default now(),
  foreign key (org_id, product_id) references public.products (org_id, id) on delete cascade
);

-- A supplier's pack of a product: 12 x 750 mL per case.
create table public.supplier_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  supplier_id uuid not null,
  product_id uuid not null,
  supplier_sku text,
  description text,
  units_per_pack numeric(10, 3) not null default 1 check (units_per_pack > 0),
  unit_size_base numeric(14, 4) not null check (unit_size_base > 0),
  pack_label text,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, supplier_id) references public.suppliers (org_id, id) on delete cascade,
  foreign key (org_id, product_id) references public.products (org_id, id) on delete cascade
);
create unique index supplier_items_sku on public.supplier_items (org_id, supplier_id, supplier_sku) where supplier_sku is not null;

-- Cost history. Never updated; the effective cost is the latest row at or before a time.
create table public.product_costs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  product_id uuid not null,
  location_id uuid,
  cost_per_base numeric(18, 8) not null check (cost_per_base >= 0),
  currency char(3) not null default 'USD',
  effective_at timestamptz not null default now(),
  source text not null check (source in ('manual', 'invoice', 'seed')),
  source_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (org_id, product_id) references public.products (org_id, id) on delete cascade,
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade
);
create index product_costs_lookup on public.product_costs (org_id, product_id, effective_at desc);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  dimension public.dimension not null,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create unique index ingredients_name on public.ingredients (org_id, lower(name));

-- Which stocked product fills a generic ingredient at a location, over time.
create table public.ingredient_mappings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  ingredient_id uuid not null,
  product_id uuid not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade,
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete cascade,
  foreign key (org_id, product_id) references public.products (org_id, id) on delete cascade
);
create unique index ingredient_mappings_current on public.ingredient_mappings (org_id, location_id, ingredient_id) where effective_to is null;

-- ---------------------------------------------------------------- recipes

-- Global starter library (not tenant data). Copied into an organization on request.
create table public.recipe_templates (
  id text primary key,
  name text not null,
  kind public.recipe_kind not null default 'drink',
  category text not null,
  glassware text,
  method text not null,
  garnish text,
  -- [{ingredient, dimension, qty, unit}]
  components jsonb not null,
  yield_servings numeric(10, 3) not null default 1,
  provenance text not null
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  kind public.recipe_kind not null,
  category text,
  template_id text references public.recipe_templates (id) on delete set null,
  current_version_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (org_id, id)
);
create index recipes_org_name on public.recipes (org_id, lower(name));

-- Immutable. Editing a recipe creates a new version.
create table public.recipe_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  recipe_id uuid not null,
  version integer not null check (version > 0),
  yield_servings numeric(10, 3) check (yield_servings > 0),
  yield_qty numeric(14, 4) check (yield_qty > 0),
  yield_unit text,
  produces_product_id uuid,
  glassware text,
  method text,
  garnish text,
  batch_instructions text,
  notes text,
  effective_from timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (recipe_id, version),
  check ((yield_servings is not null) <> (yield_qty is not null and yield_unit is not null)),
  foreign key (org_id, recipe_id) references public.recipes (org_id, id) on delete cascade,
  foreign key (org_id, produces_product_id) references public.products (org_id, id)
);
create index recipe_versions_effective on public.recipe_versions (org_id, recipe_id, effective_from desc);

alter table public.recipes
  add constraint recipes_current_version_fk foreign key (org_id, current_version_id)
  references public.recipe_versions (org_id, id) deferrable initially deferred;

create table public.recipe_components (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  recipe_version_id uuid not null,
  position integer not null,
  product_id uuid,
  ingredient_id uuid,
  sub_recipe_id uuid,
  qty numeric(14, 4) not null check (qty >= 0),
  unit text not null,
  yield_pct numeric(6, 3) check (yield_pct > 0 and yield_pct <= 100),
  label text,
  check (num_nonnulls(product_id, ingredient_id, sub_recipe_id) = 1),
  foreign key (org_id, recipe_version_id) references public.recipe_versions (org_id, id) on delete cascade,
  foreign key (org_id, product_id) references public.products (org_id, id),
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id),
  foreign key (org_id, sub_recipe_id) references public.recipes (org_id, id)
);
create index recipe_components_version on public.recipe_components (recipe_version_id, position);

-- ---------------------------------------------------------------- menu

-- A recipe on a location's menu for a period, at a price. Changing the price
-- closes the row and opens a new one, so past menus are reproducible.
create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  recipe_id uuid not null,
  selling_price numeric(12, 2) check (selling_price >= 0),
  currency char(3) not null default 'USD',
  target_cost_pct numeric(5, 2) check (target_cost_pct > 0 and target_cost_pct < 100),
  menu_section text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade,
  foreign key (org_id, recipe_id) references public.recipes (org_id, id) on delete cascade
);
create unique index menu_items_current on public.menu_items (org_id, location_id, recipe_id) where effective_to is null;
create index menu_items_period on public.menu_items (org_id, location_id, effective_from);

-- ---------------------------------------------------------------- RLS

alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.product_conversions enable row level security;
alter table public.supplier_items enable row level security;
alter table public.product_costs enable row level security;
alter table public.ingredients enable row level security;
alter table public.ingredient_mappings enable row level security;
alter table public.recipe_templates enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_versions enable row level security;
alter table public.recipe_components enable row level security;
alter table public.menu_items enable row level security;

create policy "templates readable" on public.recipe_templates for select to authenticated using (true);

-- Catalog: all members read, catalog editors write.
do $$
declare t text;
begin
  foreach t in array array['suppliers', 'products', 'product_conversions', 'supplier_items', 'ingredients'] loop
    execute format('create policy "members read" on public.%I for select to authenticated using (app.is_member(org_id))', t);
    execute format('create policy "catalog editors insert" on public.%I for insert to authenticated with check (app.has_perm(org_id, ''catalog.edit''))', t);
    execute format('create policy "catalog editors update" on public.%I for update to authenticated using (app.has_perm(org_id, ''catalog.edit'')) with check (app.has_perm(org_id, ''catalog.edit''))', t);
  end loop;
end $$;
create policy "catalog editors delete conversions" on public.product_conversions for delete to authenticated using (app.has_perm(org_id, 'catalog.edit'));
create policy "catalog editors delete supplier items" on public.supplier_items for delete to authenticated using (app.has_perm(org_id, 'catalog.edit'));

-- Costs: only cost viewers read; catalog editors who can see costs add history rows.
create policy "cost viewers read costs" on public.product_costs for select to authenticated using (app.has_perm(org_id, 'costs.view'));
create policy "cost editors add costs" on public.product_costs for insert to authenticated
  with check (app.has_perm(org_id, 'catalog.edit') and app.has_perm(org_id, 'costs.view') and source = 'manual');

create policy "members read mappings" on public.ingredient_mappings for select to authenticated using (app.can_see_location(org_id, location_id));
create policy "recipe editors map" on public.ingredient_mappings for insert to authenticated with check (app.has_location_perm(org_id, location_id, 'recipes.edit'));
create policy "recipe editors close mappings" on public.ingredient_mappings for update to authenticated
  using (app.has_location_perm(org_id, location_id, 'recipes.edit')) with check (app.has_location_perm(org_id, location_id, 'recipes.edit'));

create policy "members read recipes" on public.recipes for select to authenticated using (app.is_member(org_id));
create policy "recipe editors insert recipes" on public.recipes for insert to authenticated with check (app.has_perm(org_id, 'recipes.edit'));
create policy "recipe editors update recipes" on public.recipes for update to authenticated using (app.has_perm(org_id, 'recipes.edit')) with check (app.has_perm(org_id, 'recipes.edit'));

create policy "members read versions" on public.recipe_versions for select to authenticated using (app.is_member(org_id));
create policy "recipe editors add versions" on public.recipe_versions for insert to authenticated with check (app.has_perm(org_id, 'recipes.edit'));
create policy "members read components" on public.recipe_components for select to authenticated using (app.is_member(org_id));
create policy "recipe editors add components" on public.recipe_components for insert to authenticated with check (app.has_perm(org_id, 'recipes.edit'));

create policy "members read menu" on public.menu_items for select to authenticated using (app.can_see_location(org_id, location_id));
create policy "menu editors add" on public.menu_items for insert to authenticated with check (app.has_location_perm(org_id, location_id, 'menu.edit'));
create policy "menu editors close" on public.menu_items for update to authenticated
  using (app.has_location_perm(org_id, location_id, 'menu.edit')) with check (app.has_location_perm(org_id, location_id, 'menu.edit'));

-- Immutability: history tables accept no updates or deletes from clients.
revoke update, delete on public.product_costs, public.recipe_versions, public.recipe_components from authenticated, anon;
revoke delete on public.menu_items, public.ingredient_mappings from authenticated, anon;

create trigger products_touch before update on public.products for each row execute function app.touch_updated_at();
create trigger products_version before update on public.products for each row execute function app.bump_version();

-- ---------------------------------------------------------------- recipe functions

-- Save a new immutable version of a recipe (creating the recipe if p_recipe is null).
-- p_components: [{product_id|ingredient_id|sub_recipe_id, qty, unit, yield_pct?, label?}]
create or replace function public.save_recipe_version(
  p_org uuid,
  p_recipe uuid,
  p_name text,
  p_kind public.recipe_kind,
  p_category text,
  p_yield_servings numeric,
  p_yield_qty numeric,
  p_yield_unit text,
  p_produces_product uuid,
  p_details jsonb,
  p_components jsonb,
  p_expected_current_version uuid default null,
  p_template_id text default null
) returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_recipe uuid := p_recipe;
  v_version integer;
  v_version_id uuid;
  v_current uuid;
  c jsonb;
  i integer := 0;
begin
  if not app.has_perm(p_org, 'recipes.edit') then
    raise exception 'You do not have permission to edit recipes' using errcode = '42501';
  end if;
  if jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) > 60 then
    raise exception 'Components must be a list of at most 60 items' using errcode = '22023';
  end if;
  if v_recipe is null then
    insert into public.recipes (org_id, name, kind, category, template_id, created_by)
    values (p_org, trim(p_name), p_kind, p_category, p_template_id, auth.uid()) returning id into v_recipe;
    v_version := 1;
  else
    select current_version_id into v_current from public.recipes where id = v_recipe and org_id = p_org for update;
    if not found then
      raise exception 'Recipe not found' using errcode = '22023';
    end if;
    if v_current is distinct from p_expected_current_version then
      raise exception 'This recipe was changed by someone else. Reload and try again.' using errcode = '40001';
    end if;
    update public.recipes set name = trim(p_name), category = p_category where id = v_recipe;
    select coalesce(max(version), 0) + 1 into v_version from public.recipe_versions where recipe_id = v_recipe;
  end if;

  insert into public.recipe_versions (org_id, recipe_id, version, yield_servings, yield_qty, yield_unit, produces_product_id,
    glassware, method, garnish, batch_instructions, notes, created_by)
  values (p_org, v_recipe, v_version, p_yield_servings, p_yield_qty, p_yield_unit, p_produces_product,
    p_details ->> 'glassware', p_details ->> 'method', p_details ->> 'garnish', p_details ->> 'batch_instructions', p_details ->> 'notes', auth.uid())
  returning id into v_version_id;

  for c in select * from jsonb_array_elements(p_components) loop
    i := i + 1;
    if (c ->> 'sub_recipe_id')::uuid = v_recipe then
      raise exception 'A recipe cannot include itself' using errcode = '22023';
    end if;
    insert into public.recipe_components (org_id, recipe_version_id, position, product_id, ingredient_id, sub_recipe_id, qty, unit, yield_pct, label)
    values (p_org, v_version_id, i, (c ->> 'product_id')::uuid, (c ->> 'ingredient_id')::uuid, (c ->> 'sub_recipe_id')::uuid,
      (c ->> 'qty')::numeric, c ->> 'unit', (c ->> 'yield_pct')::numeric, c ->> 'label');
  end loop;

  update public.recipes set current_version_id = v_version_id where id = v_recipe;
  perform app.audit(p_org, 'recipe.version_saved', 'recipe', v_recipe::text, jsonb_build_object('version', v_version));
  return v_recipe;
end $$;
grant execute on function public.save_recipe_version to authenticated;
revoke execute on function public.save_recipe_version from anon, public;

-- Put a recipe on the menu, or change its price: closes the current row and opens a new one.
create or replace function public.set_menu_item(p_org uuid, p_location uuid, p_recipe uuid, p_price numeric, p_target numeric, p_section text, p_on_menu boolean)
returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if not app.has_location_perm(p_org, p_location, 'menu.edit') then
    raise exception 'You do not have permission to change the menu' using errcode = '42501';
  end if;
  update public.menu_items set effective_to = v_now
  where org_id = p_org and location_id = p_location and recipe_id = p_recipe and effective_to is null;
  if p_on_menu then
    insert into public.menu_items (org_id, location_id, recipe_id, selling_price, target_cost_pct, menu_section, effective_from, created_by)
    values (p_org, p_location, p_recipe, p_price, p_target, p_section, v_now, auth.uid());
  end if;
  perform app.audit(p_org, case when p_on_menu then 'menu.item_set' else 'menu.item_removed' end, 'recipe', p_recipe::text,
    jsonb_build_object('location', p_location, 'price', p_price));
end $$;
grant execute on function public.set_menu_item to authenticated;
revoke execute on function public.set_menu_item from anon, public;

-- Map an ingredient to a product at a location (closing any current mapping).
create or replace function public.map_ingredient(p_org uuid, p_location uuid, p_ingredient uuid, p_product uuid)
returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_idim public.dimension;
  v_pdim public.dimension;
begin
  if not app.has_location_perm(p_org, p_location, 'recipes.edit') then
    raise exception 'You do not have permission to map ingredients' using errcode = '42501';
  end if;
  select dimension into v_idim from public.ingredients where id = p_ingredient and org_id = p_org;
  select dimension into v_pdim from public.products where id = p_product and org_id = p_org;
  if v_idim is null or v_pdim is null then
    raise exception 'Ingredient or product not found' using errcode = '22023';
  end if;
  update public.ingredient_mappings set effective_to = v_now
  where org_id = p_org and location_id = p_location and ingredient_id = p_ingredient and effective_to is null;
  insert into public.ingredient_mappings (org_id, location_id, ingredient_id, product_id, effective_from, created_by)
  values (p_org, p_location, p_ingredient, p_product, v_now, auth.uid());
  perform app.audit(p_org, 'ingredient.mapped', 'ingredient', p_ingredient::text,
    jsonb_build_object('location', p_location, 'product', p_product, 'dimension_differs', v_idim <> v_pdim));
end $$;
grant execute on function public.map_ingredient to authenticated;
revoke execute on function public.map_ingredient from anon, public;
