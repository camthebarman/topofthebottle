-- Aggregated sales for analysis. Grouping in the database keeps large histories
-- (hundreds of thousands of lines) out of the application server.

-- Lines with a timestamp are selected by instant; date-only lines by business date.
-- Security definer with one explicit permission check: evaluating the row policy
-- per line made large histories slow (see docs/performance.md).
create or replace function public.sales_summary(p_org uuid, p_location uuid, p_from timestamptz, p_to timestamptz, p_from_date date, p_to_date date)
returns table (business_date date, item_key text, item_name text, modifiers text[], kind text, void_prepared boolean, quantity numeric, net_sales numeric, gross_sales numeric, lines bigint)
language sql stable security definer
set search_path = ''
as $$
  select s.business_date, s.item_key, max(s.item_name), s.modifiers, s.kind, s.void_prepared,
    sum(s.quantity), sum(s.net_sales), sum(s.gross_sales), count(*)
  from public.sales_lines s
  where s.org_id = p_org and s.location_id = p_location
    and (app.has_location_perm(p_org, p_location, 'insights.view') or app.has_location_perm(p_org, p_location, 'imports.manage'))
    and (
      (s.occurred_at is not null and s.occurred_at > p_from and s.occurred_at <= p_to)
      or (s.occurred_at is null and s.business_date >= p_from_date and s.business_date_end <= p_to_date)
    )
  group by s.business_date, s.item_key, s.modifiers, s.kind, s.void_prepared
  order by s.business_date, s.item_key, s.modifiers, s.kind, s.void_prepared nulls first
$$;

-- Aggregate rows that only partly overlap the period cannot be apportioned; report them.
create or replace function public.sales_partial_overlap(p_org uuid, p_location uuid, p_from_date date, p_to_date date)
returns bigint
language sql stable security invoker
set search_path = ''
as $$
  select count(*) from public.sales_lines s
  where s.org_id = p_org and s.location_id = p_location and s.occurred_at is null
    and s.business_date <= p_to_date and s.business_date_end >= p_from_date
    and not (s.business_date >= p_from_date and s.business_date_end <= p_to_date)
$$;

-- Void and comp counts by local hour, for transaction-level data. No staff dimension by design.
create or replace function public.void_comp_by_hour(p_org uuid, p_location uuid, p_from timestamptz, p_to timestamptz, p_tz text)
returns table (hour integer, kind text, lines bigint, quantity numeric, gross numeric)
language sql stable security definer
set search_path = ''
as $$
  select extract(hour from s.occurred_at at time zone p_tz)::integer, s.kind, count(*), sum(s.quantity), sum(s.gross_sales)
  from public.sales_lines s
  where s.org_id = p_org and s.location_id = p_location and s.occurred_at > p_from and s.occurred_at <= p_to
    and s.kind in ('void', 'comp', 'refund')
    and app.has_location_perm(p_org, p_location, 'insights.view')
  group by 1, 2 order by 1, 2
$$;

grant execute on function public.sales_summary, public.sales_partial_overlap, public.void_comp_by_hour to authenticated, service_role;
revoke execute on function public.sales_summary, public.sales_partial_overlap, public.void_comp_by_hour from anon, public;

create index sales_lines_occurred on public.sales_lines (org_id, location_id, occurred_at) where occurred_at is not null;
