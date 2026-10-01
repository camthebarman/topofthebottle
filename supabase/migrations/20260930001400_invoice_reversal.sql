-- Reversing an approved invoice, and correcting it with a replacement.
-- Nothing is deleted or edited in place: costs are marked reversed from a point in time,
-- receipts are reversed in the ledger, and a corrected invoice links to the one it replaces.

alter table public.invoices drop constraint invoices_status_check; -- destructive-ok: widened below, no data changes
alter table public.invoices add constraint invoices_status_check check (status in
  ('uploaded', 'extracting', 'needs_review', 'approved', 'rejected', 'extraction_failed', 'reversed'));
alter table public.invoices
  add column reversed_by uuid references auth.users (id) on delete set null,
  add column reversed_at timestamptz,
  add column reversal_reason text check (length(reversal_reason) <= 500);

-- A cost stays in effect for reports up to the moment it was reversed, so reports for earlier
-- periods reproduce exactly; from then on the previous cost applies again.
alter table public.product_costs add column reversed_at timestamptz;

create or replace function public.product_costs_as_of(p_org uuid, p_location uuid, p_as_of timestamptz default now())
returns table (product_id uuid, cost_per_base numeric, effective_at timestamptz, source text)
language sql stable security invoker
set search_path = ''
as $$
  select distinct on (c.product_id) c.product_id, c.cost_per_base, c.effective_at, c.source
  from public.product_costs c
  where c.org_id = p_org and (c.location_id = p_location or c.location_id is null) and c.effective_at <= p_as_of
    and (c.reversed_at is null or c.reversed_at > p_as_of)
  order by c.product_id, (c.location_id is not null) desc, c.effective_at desc, c.created_at desc
$$;

create or replace function public.reverse_invoice(p_org uuid, p_invoice uuid, p_expected_version integer, p_reason text, p_reverse_receipts boolean)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  m record;
  v_reversed integer := 0;
  v_open integer;
  v_mov uuid;
begin
  select * into v_inv from public.invoices where id = p_invoice and org_id = p_org for update;
  if v_inv.id is null then
    raise exception 'Invoice not found' using errcode = '22023';
  end if;
  if not app.has_location_perm(p_org, v_inv.location_id, 'invoices.approve') then
    raise exception 'You do not have permission to reverse invoices' using errcode = '42501';
  end if;
  if v_inv.status <> 'approved' then
    raise exception 'Only approved invoices can be reversed (this one is %)', v_inv.status using errcode = '22023';
  end if;
  if v_inv.version <> p_expected_version then
    raise exception 'This invoice was changed by someone else. Reload and try again.' using errcode = '40001';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Give a reason for reversing the invoice' using errcode = '22023';
  end if;

  -- Receipts that have not already been reversed.
  select count(*) into v_open
  from public.receiving_lines rl join public.receivings r on r.id = rl.receiving_id
  where r.invoice_id = p_invoice and rl.movement_id is not null
    and not exists (select 1 from public.stock_movements x where x.reverses_id = rl.movement_id);
  if p_reverse_receipts then
    for m in
      select s.* from public.receiving_lines rl
      join public.receivings r on r.id = rl.receiving_id
      join public.stock_movements s on s.id = rl.movement_id
      where r.invoice_id = p_invoice
        and not exists (select 1 from public.stock_movements x where x.reverses_id = s.id)
    loop
      insert into public.stock_movements (org_id, location_id, product_id, type, qty_base, occurred_at, reverses_id, reason, source_type, source_id, created_by)
      values (p_org, m.location_id, m.product_id, m.type, -m.qty_base, now(), m.id, 'Invoice reversed: ' || trim(p_reason), m.source_type, m.source_id, auth.uid())
      returning id into v_mov;
      insert into public.stock_movement_costs (movement_id, org_id, extended_cost, currency)
      select v_mov, org_id, -extended_cost, currency from public.stock_movement_costs where movement_id = m.id;
      v_reversed := v_reversed + 1;
    end loop;
  end if;

  update public.product_costs set reversed_at = now()
  where org_id = p_org and source = 'invoice' and source_id = p_invoice and reversed_at is null;

  update public.invoices set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(),
    reversal_reason = trim(p_reason), version = p_expected_version
  where id = p_invoice;
  perform app.audit(p_org, 'invoice.reversed', 'invoice', p_invoice::text,
    jsonb_build_object('reason', trim(p_reason), 'receipts_reversed', v_reversed, 'receipts_kept', case when p_reverse_receipts then 0 else v_open end));
  return v_reversed;
end $$;

-- Start a corrected invoice from a reversed (or rejected) one: same document and lines, back in review.
create or replace function public.create_corrected_invoice(p_org uuid, p_invoice uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_new uuid;
begin
  select * into v_inv from public.invoices where id = p_invoice and org_id = p_org;
  if v_inv.id is null then
    raise exception 'Invoice not found' using errcode = '22023';
  end if;
  if not app.has_location_perm(p_org, v_inv.location_id, 'invoices.approve') then
    raise exception 'You do not have permission to correct invoices' using errcode = '42501';
  end if;
  if v_inv.status not in ('reversed', 'rejected') then
    raise exception 'Reverse the invoice before correcting it' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoices where org_id = p_org and corrects_invoice_id = p_invoice and status <> 'rejected') then
    raise exception 'A correction for this invoice already exists' using errcode = '23505';
  end if;
  insert into public.invoices (org_id, location_id, document_id, supplier_id, supplier_name_raw, invoice_number, invoice_date, due_date,
    is_credit_note, corrects_invoice_id, currency, subtotal, freight, deposits, tax, discount, total, status, review_notes, created_by)
  values (p_org, v_inv.location_id, v_inv.document_id, v_inv.supplier_id, v_inv.supplier_name_raw, v_inv.invoice_number, v_inv.invoice_date, v_inv.due_date,
    v_inv.is_credit_note, p_invoice, v_inv.currency, v_inv.subtotal, v_inv.freight, v_inv.deposits, v_inv.tax, v_inv.discount, v_inv.total, 'needs_review',
    'Correction of an earlier invoice. Check every line before approving.', auth.uid())
  returning id into v_new;
  insert into public.invoice_lines (org_id, invoice_id, position, description, supplier_sku, product_id, supplier_item_id, quantity, purchase_unit,
    units_per_pack, unit_size_base, unit_price, discount, line_total, deposit_per_pack, match_status, match_note, confidence, source_extraction_id)
  select org_id, v_new, position, description, supplier_sku, product_id, supplier_item_id, quantity, purchase_unit,
    units_per_pack, unit_size_base, unit_price, discount, line_total, deposit_per_pack,
    -- Corrections are reviewed again: confirmed matches go back to suggested.
    case when match_status = 'confirmed' then 'suggested' else match_status end, match_note, confidence, source_extraction_id
  from public.invoice_lines where invoice_id = p_invoice;
  perform app.audit(p_org, 'invoice.correction_started', 'invoice', v_new::text, jsonb_build_object('corrects', p_invoice));
  return v_new;
end $$;

revoke execute on function public.reverse_invoice, public.create_corrected_invoice from public, anon;
grant execute on function public.reverse_invoice, public.create_corrected_invoice to authenticated;
