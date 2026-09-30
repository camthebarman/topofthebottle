-- Transactional commit of a validated POS import.
--
-- Accepted staged rows become sales_lines in one statement. Rows whose dedupe key
-- already exists are skipped (and counted), never duplicated. Modifier rows whose
-- parent item is in an earlier import are attached to that sales line.
-- Aggregate imports with the 'replace' overlap policy supersede the overlapping
-- earlier aggregate imports inside the same transaction.

create or replace function public.commit_pos_import(p_import uuid, p_actor uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_imp public.pos_imports;
  v_inserted integer := 0;
  v_attached integer := 0;
  v_skipped integer := 0;
  v_superseded integer := 0;
  v_quarantined integer;
begin
  select * into v_imp from public.pos_imports where id = p_import for update;
  if v_imp.id is null then
    raise exception 'Import not found' using errcode = '22023';
  end if;
  if v_imp.status <> 'committing' then
    raise exception 'Import is % and cannot be committed', v_imp.status using errcode = '22023';
  end if;
  select count(*) into v_quarantined from public.pos_import_rows where import_id = p_import and outcome = 'quarantined';
  if v_quarantined > 0 and not v_imp.accept_partial then
    raise exception 'This import has % rejected rows; accept a partial import to continue', v_quarantined using errcode = '22023';
  end if;

  if v_imp.kind = 'aggregate' and v_imp.overlap_policy = 'replace' then
    with old as (
      select i.id from public.pos_imports i
      where i.org_id = v_imp.org_id and i.location_id = v_imp.location_id and i.id <> v_imp.id
        and i.kind = 'aggregate' and i.status = 'committed'
        and i.date_start <= v_imp.date_end and v_imp.date_start <= i.date_end
    ), del as (
      delete from public.sales_lines s using old where s.import_id = old.id returning 1
    ), upd as (
      update public.pos_imports i set status = 'superseded' from old where i.id = old.id returning 1
    )
    select count(*) into v_superseded from upd;
  end if;

  -- Item rows (not modifier rows attached to an item in another import).
  with src as (
    select r.row_number, r.normalized n
    from public.pos_import_rows r
    where r.import_id = p_import and r.outcome = 'accepted'
      and (r.normalized ->> 'parentLineId' is null)
  ), ins as (
    insert into public.sales_lines (org_id, location_id, import_id, row_number, business_date, business_date_end, occurred_at,
      transaction_id, line_id, item_key, item_name, category, modifiers, quantity, gross_sales, net_sales, discount, kind, void_prepared, dedupe_key)
    select v_imp.org_id, v_imp.location_id, p_import, src.row_number,
      (n ->> 'businessDate')::date, (n ->> 'businessDateEnd')::date, (n ->> 'occurredAt')::timestamptz,
      n ->> 'transactionId', n ->> 'lineId', n ->> 'itemKey', n ->> 'itemName', n ->> 'category',
      coalesce(array(select jsonb_array_elements_text(n -> 'modifiers')), '{}'),
      (n ->> 'quantity')::numeric, (n ->> 'grossSales')::numeric, (n ->> 'netSales')::numeric, (n ->> 'discount')::numeric,
      n ->> 'kind', (n ->> 'voidPrepared')::boolean, n ->> 'dedupeKey'
    from src
    on conflict (org_id, location_id, dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  select count(*) - v_inserted into v_skipped from public.pos_import_rows
  where import_id = p_import and outcome = 'accepted' and normalized ->> 'parentLineId' is null;

  -- Modifier rows: attach to the parent sales line (same location, transaction and line id).
  with mods as (
    select r.normalized n from public.pos_import_rows r
    where r.import_id = p_import and r.outcome = 'accepted' and r.normalized ->> 'parentLineId' is not null
      and r.normalized ->> 'kind' <> 'void'
  ), grouped as (
    select n ->> 'transactionId' tx, n ->> 'parentLineId' parent, array_agg(n ->> 'itemName' order by n ->> 'lineId') names
    from mods group by 1, 2
  ), upd as (
    update public.sales_lines s
    set modifiers = s.modifiers || array(select x from unnest(g.names) x where not (x = any (s.modifiers)))
    from grouped g
    where s.org_id = v_imp.org_id and s.location_id = v_imp.location_id and s.transaction_id = g.tx and s.line_id = g.parent
    returning 1
  )
  select count(*) into v_attached from upd;

  update public.pos_imports
  set status = 'committed', committed_at = now(), committed_by = p_actor,
      stats = stats || jsonb_build_object('inserted', v_inserted, 'skipped_existing', v_skipped, 'modifier_lines_updated', v_attached, 'superseded_imports', v_superseded)
  where id = p_import;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, data)
  values (v_imp.org_id, p_actor, 'pos_import.committed', 'pos_import', p_import::text,
    jsonb_build_object('inserted', v_inserted, 'skipped_existing', v_skipped, 'quarantined', v_quarantined, 'superseded', v_superseded));

  return jsonb_build_object('inserted', v_inserted, 'skipped_existing', v_skipped, 'modifier_lines_updated', v_attached, 'superseded_imports', v_superseded);
end $$;
revoke execute on function public.commit_pos_import from public, anon, authenticated;
grant execute on function public.commit_pos_import to service_role;

-- Aggregate imports that overlap a committed aggregate import at the same location.
create or replace function public.overlapping_imports(p_import uuid)
returns table (id uuid, date_start date, date_end date, created_at timestamptz)
language sql stable security invoker
set search_path = ''
as $$
  select i.id, i.date_start, i.date_end, i.created_at
  from public.pos_imports me
  join public.pos_imports i on i.org_id = me.org_id and i.location_id = me.location_id and i.id <> me.id
    and i.status = 'committed' and i.date_start <= me.date_end and me.date_start <= i.date_end
  where me.id = p_import
$$;
grant execute on function public.overlapping_imports to authenticated, service_role;
revoke execute on function public.overlapping_imports from anon, public;

-- Existing dedupe keys among a set, for marking duplicates during validation.
create or replace function public.existing_sale_keys(p_org uuid, p_location uuid, p_keys text[])
returns setof text
language sql stable security invoker
set search_path = ''
as $$
  select s.dedupe_key from public.sales_lines s
  where s.org_id = p_org and s.location_id = p_location and s.dedupe_key = any (p_keys)
$$;
grant execute on function public.existing_sale_keys to service_role;
revoke execute on function public.existing_sale_keys from anon, public, authenticated;
