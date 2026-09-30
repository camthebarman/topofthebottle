-- Read helpers for reproducible as-of reporting. All are security invoker, so RLS applies.

-- Effective cost per product at an instant: the latest cost row at or before p_as_of,
-- preferring a location-specific cost over an organization-wide one.
create or replace function public.product_costs_as_of(p_org uuid, p_location uuid, p_as_of timestamptz default now())
returns table (product_id uuid, cost_per_base numeric, effective_at timestamptz, source text)
language sql stable security invoker
set search_path = ''
as $$
  select distinct on (c.product_id) c.product_id, c.cost_per_base, c.effective_at, c.source
  from public.product_costs c
  where c.org_id = p_org and (c.location_id = p_location or c.location_id is null) and c.effective_at <= p_as_of
  order by c.product_id, (c.location_id is not null) desc, c.effective_at desc, c.created_at desc
$$;

-- Recipe versions in effect at an instant (latest version with effective_from <= p_as_of).
create or replace function public.recipe_versions_as_of(p_org uuid, p_as_of timestamptz default now())
returns setof public.recipe_versions
language sql stable security invoker
set search_path = ''
as $$
  select distinct on (v.recipe_id) v.*
  from public.recipe_versions v
  where v.org_id = p_org and v.effective_from <= p_as_of
  order by v.recipe_id, v.effective_from desc, v.version desc
$$;

-- Valuation from the ledger, replaying movements in order. Mirrors unitCost() in the
-- domain package: receipts (and priced opening balances) set the price; a receipt that
-- was reversed within the window moves quantity but never sets price.
create or replace function public.ledger_unit_costs(p_org uuid, p_location uuid, p_as_of timestamptz default now())
returns table (product_id uuid, moving_average numeric, last_cost numeric)
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  r record;
  v_product uuid := null;
  v_qty numeric := 0;
  v_avg numeric := null;
  v_last numeric := null;
  v_unit numeric;
  v_on_hand numeric;
begin
  for r in
    select m.id, m.product_id, m.type, m.qty_base, m.reverses_id, c.extended_cost,
      exists (select 1 from public.stock_movements x where x.reverses_id = m.id and x.occurred_at <= p_as_of) as was_reversed
    from public.stock_movements m
    left join public.stock_movement_costs c on c.movement_id = m.id
    where m.org_id = p_org and m.location_id = p_location and m.occurred_at <= p_as_of
    order by m.product_id, m.occurred_at, m.id
  loop
    if v_product is distinct from r.product_id then
      if v_product is not null and (v_avg is not null or v_last is not null) then
        product_id := v_product; moving_average := v_avg; last_cost := v_last; return next;
      end if;
      v_product := r.product_id; v_qty := 0; v_avg := null; v_last := null;
    end if;
    if r.type in ('receipt', 'opening_balance') and r.extended_cost is not null and r.reverses_id is null
       and not r.was_reversed and r.qty_base <> 0 then
      v_unit := r.extended_cost / r.qty_base;
      v_last := v_unit;
      v_on_hand := greatest(v_qty, 0);
      if v_avg is null or v_on_hand = 0 then
        v_avg := v_unit;
      else
        v_avg := (v_on_hand * v_avg + r.extended_cost) / (v_on_hand + r.qty_base);
      end if;
    end if;
    v_qty := v_qty + r.qty_base;
  end loop;
  if v_product is not null and (v_avg is not null or v_last is not null) then
    product_id := v_product; moving_average := v_avg; last_cost := v_last; return next;
  end if;
end $$;

grant execute on function public.product_costs_as_of, public.recipe_versions_as_of, public.ledger_unit_costs to authenticated;
revoke execute on function public.product_costs_as_of, public.recipe_versions_as_of, public.ledger_unit_costs from anon, public;
