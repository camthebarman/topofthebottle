-- Unmapped POS items and modifiers across imported sales, for the mapping screen.

create or replace function public.unmapped_sales_items(p_org uuid, p_location uuid, p_limit integer default 100)
returns table (item_key text, item_name text, quantity numeric, net_sales numeric, last_date date)
language sql stable security invoker
set search_path = ''
as $$
  select s.item_key, max(s.item_name), sum(s.quantity), sum(coalesce(s.net_sales, s.gross_sales, 0)) filter (where s.kind in ('sale', 'comp')), max(s.business_date)
  from public.sales_lines s
  where s.org_id = p_org and s.location_id = p_location
    and not exists (select 1 from public.pos_item_mappings m where m.location_id = s.location_id and m.item_key = s.item_key and m.effective_to is null)
  group by s.item_key
  order by 4 desc nulls last
  limit least(p_limit, 500)
$$;

create or replace function public.unmapped_modifiers(p_org uuid, p_location uuid, p_limit integer default 100)
returns table (modifier_key text, example text, lines bigint)
language sql stable security invoker
set search_path = ''
as $$
  select lower(regexp_replace(trim(m), '\s+', ' ', 'g')), max(m), count(*)
  from public.sales_lines s, unnest(s.modifiers) m
  where s.org_id = p_org and s.location_id = p_location
    and not exists (
      select 1 from public.modifier_mappings mm
      where mm.location_id = s.location_id and mm.effective_to is null
        and mm.modifier_key = lower(regexp_replace(trim(m), '\s+', ' ', 'g'))
        and (mm.item_key is null or mm.item_key = s.item_key)
    )
  group by 1
  order by 3 desc
  limit least(p_limit, 500)
$$;

grant execute on function public.unmapped_sales_items, public.unmapped_modifiers to authenticated;
revoke execute on function public.unmapped_sales_items, public.unmapped_modifiers from anon, public;
