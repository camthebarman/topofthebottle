-- Uploaded documents (private storage), invoices, extraction versions, receiving.

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  kind text not null check (kind in ('invoice', 'pos_export')),
  storage_path text not null unique,
  filename text not null check (length(filename) <= 255),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'text/csv', 'text/plain')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  page_count integer check (page_count between 1 and 50),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  retain_until date,
  deleted_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade,
  -- Storage paths are always org/<org_id>/..., so storage policies can check tenancy.
  check (storage_path like 'org/' || org_id::text || '/%')
);
create index documents_org_hash on public.documents (org_id, sha256);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  document_id uuid,
  supplier_id uuid,
  supplier_name_raw text,
  invoice_number text,
  invoice_date date,
  due_date date,
  is_credit_note boolean not null default false,
  -- A corrected invoice replaces an earlier one; the earlier one is reversed, not edited.
  corrects_invoice_id uuid,
  currency char(3) not null default 'USD',
  subtotal numeric(14, 2),
  freight numeric(14, 2),
  deposits numeric(14, 2),
  tax numeric(14, 2),
  discount numeric(14, 2),
  total numeric(14, 2),
  status text not null default 'uploaded' check (status in
    ('uploaded', 'extracting', 'needs_review', 'approved', 'rejected', 'extraction_failed')),
  -- Whether stock has been received against this invoice (partial receipts allowed).
  receiving_status text not null default 'not_received' check (receiving_status in ('not_received', 'partial', 'received', 'not_applicable')),
  duplicate_of_id uuid,
  duplicate_override_reason text,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  review_notes text,
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade,
  foreign key (org_id, document_id) references public.documents (org_id, id),
  foreign key (org_id, supplier_id) references public.suppliers (org_id, id),
  foreign key (org_id, corrects_invoice_id) references public.invoices (org_id, id),
  foreign key (org_id, duplicate_of_id) references public.invoices (org_id, id)
);
create index invoices_org_date on public.invoices (org_id, location_id, invoice_date desc);
create index invoices_supplier_number on public.invoices (org_id, supplier_id, invoice_number);

-- Each extraction attempt is kept; the reviewed lines record which one they came from.
create table public.invoice_extractions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  invoice_id uuid not null,
  attempt integer not null,
  provider text not null,
  model text,
  method text not null check (method in ('csv', 'pdf_text', 'vision', 'manual')),
  status text not null check (status in ('succeeded', 'failed')),
  -- Schema-validated candidate fields. Never executed or rendered as HTML.
  output jsonb,
  error text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (invoice_id, attempt),
  foreign key (org_id, invoice_id) references public.invoices (org_id, id) on delete cascade
);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  invoice_id uuid not null,
  position integer not null,
  description text not null check (length(description) <= 500),
  supplier_sku text,
  product_id uuid,
  supplier_item_id uuid,
  quantity numeric(12, 3) not null,
  purchase_unit text,
  units_per_pack numeric(10, 3) not null default 1 check (units_per_pack > 0),
  unit_size_base numeric(14, 4) check (unit_size_base > 0),
  unit_price numeric(14, 4),
  discount numeric(14, 2),
  line_total numeric(14, 2),
  deposit_per_pack numeric(10, 4),
  -- suggested: proposed by matching, not accepted; confirmed: accepted by a person.
  match_status text not null default 'unmatched' check (match_status in ('unmatched', 'suggested', 'confirmed', 'not_stock')),
  match_note text,
  -- Qualitative extraction confidence reported by the extractor; not a calibrated probability.
  confidence text check (confidence in ('high', 'medium', 'low')),
  source_extraction_id uuid,
  edited_by uuid references auth.users (id) on delete set null,
  edited_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, invoice_id) references public.invoices (org_id, id) on delete cascade,
  foreign key (org_id, product_id) references public.products (org_id, id),
  foreign key (org_id, supplier_item_id) references public.supplier_items (org_id, id),
  foreign key (org_id, source_extraction_id) references public.invoice_extractions (org_id, id)
);
create index invoice_lines_invoice on public.invoice_lines (invoice_id, position);

create table public.receivings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  invoice_id uuid not null,
  received_at timestamptz not null,
  received_by uuid references auth.users (id) on delete set null,
  notes text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, idempotency_key),
  foreign key (org_id, location_id) references public.locations (org_id, id),
  foreign key (org_id, invoice_id) references public.invoices (org_id, id)
);

create table public.receiving_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  receiving_id uuid not null,
  invoice_line_id uuid not null,
  product_id uuid not null,
  received_quantity numeric(12, 3) not null,
  received_base numeric(18, 6) not null,
  movement_id uuid,
  foreign key (org_id, receiving_id) references public.receivings (org_id, id) on delete cascade,
  foreign key (org_id, invoice_line_id) references public.invoice_lines (org_id, id),
  foreign key (org_id, product_id) references public.products (org_id, id),
  foreign key (org_id, movement_id) references public.stock_movements (org_id, id)
);

alter table public.documents enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_extractions enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.receivings enable row level security;
alter table public.receiving_lines enable row level security;

-- Documents: uploaders of that kind see them.
create policy "document readers" on public.documents for select to authenticated using (
  deleted_at is null and app.can_see_location(org_id, location_id) and
  ((kind = 'invoice' and app.has_perm(org_id, 'invoices.upload')) or (kind = 'pos_export' and app.has_perm(org_id, 'imports.manage')))
);
create policy "document uploaders" on public.documents for insert to authenticated with check (
  app.can_see_location(org_id, location_id) and uploaded_by = auth.uid() and
  ((kind = 'invoice' and app.has_perm(org_id, 'invoices.upload')) or (kind = 'pos_export' and app.has_perm(org_id, 'imports.manage')))
);

create policy "invoice readers" on public.invoices for select to authenticated using (app.has_location_perm(org_id, location_id, 'invoices.upload'));
create policy "invoice creators" on public.invoices for insert to authenticated
  with check (app.has_location_perm(org_id, location_id, 'invoices.upload') and status = 'uploaded' and approved_by is null);
-- Header edits while in review; approval happens in approve_invoice().
create policy "invoice reviewers edit" on public.invoices for update to authenticated
  using (status in ('uploaded', 'needs_review', 'extraction_failed') and app.has_location_perm(org_id, location_id, 'invoices.upload'))
  with check (status in ('uploaded', 'needs_review', 'extraction_failed', 'rejected') and approved_by is null and app.has_location_perm(org_id, location_id, 'invoices.upload'));

create policy "extraction readers" on public.invoice_extractions for select to authenticated using (app.has_perm(org_id, 'invoices.upload'));

create policy "line readers" on public.invoice_lines for select to authenticated using (app.has_perm(org_id, 'invoices.upload'));
create policy "line editors" on public.invoice_lines for all to authenticated
  using (app.has_perm(org_id, 'invoices.upload') and exists (select 1 from public.invoices i where i.id = invoice_id and i.status in ('uploaded', 'needs_review', 'extraction_failed')))
  with check (app.has_perm(org_id, 'invoices.upload') and exists (select 1 from public.invoices i where i.id = invoice_id and i.status in ('uploaded', 'needs_review', 'extraction_failed')));

create policy "receiving readers" on public.receivings for select to authenticated using (app.can_see_location(org_id, location_id) and app.has_perm(org_id, 'invoices.upload'));
create policy "receiving line readers" on public.receiving_lines for select to authenticated using (app.has_perm(org_id, 'invoices.upload'));

revoke delete on public.invoices, public.documents from authenticated, anon;
revoke insert, update, delete on public.invoice_extractions, public.receivings, public.receiving_lines from authenticated, anon;

create trigger invoices_touch before update on public.invoices for each row execute function app.touch_updated_at();
create trigger invoices_version before update on public.invoices for each row execute function app.bump_version();

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'text/csv', 'text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Objects live at org/<org_id>/<kind>/<uuid>.<ext>. Access requires membership in that org
-- and the matching permission. Reads go through short-lived signed URLs issued by the server.
create policy "tenant document upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = 'org'
  and (
    ((storage.foldername(name))[3] = 'invoice' and app.has_perm(((storage.foldername(name))[2])::uuid, 'invoices.upload'))
    or ((storage.foldername(name))[3] = 'pos_export' and app.has_perm(((storage.foldername(name))[2])::uuid, 'imports.manage'))
  )
);
create policy "tenant document read" on storage.objects for select to authenticated using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = 'org'
  and (
    ((storage.foldername(name))[3] = 'invoice' and app.has_perm(((storage.foldername(name))[2])::uuid, 'invoices.upload'))
    or ((storage.foldername(name))[3] = 'pos_export' and app.has_perm(((storage.foldername(name))[2])::uuid, 'imports.manage'))
  )
);
-- No update or delete policies: documents are removed by the retention job with the service role.

-- ---------------------------------------------------------------- invoice functions

-- Approve an invoice. Records purchase costs (cost history rows) from the reviewed lines.
-- Does NOT receive stock: receiving is a separate confirmation.
-- p_line_costs: [{invoice_line_id, product_id, cost_per_base}] computed server-side under the cost policy.
create or replace function public.approve_invoice(p_org uuid, p_invoice uuid, p_expected_version integer, p_line_costs jsonb, p_update_costs boolean, p_duplicate_override text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  l jsonb;
begin
  select * into v_inv from public.invoices where id = p_invoice and org_id = p_org for update;
  if v_inv.id is null then
    raise exception 'Invoice not found' using errcode = '22023';
  end if;
  if not app.has_location_perm(p_org, v_inv.location_id, 'invoices.approve') then
    raise exception 'You do not have permission to approve invoices' using errcode = '42501';
  end if;
  if v_inv.status <> 'needs_review' then
    raise exception 'Only invoices in review can be approved (this one is %)', v_inv.status using errcode = '22023';
  end if;
  if v_inv.version <> p_expected_version then
    raise exception 'This invoice was changed by someone else. Reload and try again.' using errcode = '40001';
  end if;
  if v_inv.supplier_id is null or v_inv.total is null then
    raise exception 'Set the supplier and total before approving' using errcode = '22023';
  end if;
  if v_inv.duplicate_of_id is not null and length(trim(coalesce(p_duplicate_override, ''))) = 0 then
    raise exception 'This looks like a duplicate. Give a reason to approve it anyway.' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoice_lines where invoice_id = p_invoice and match_status in ('unmatched', 'suggested')) then
    raise exception 'Confirm or mark every line as not stock before approving' using errcode = '22023';
  end if;

  if p_update_costs and not v_inv.is_credit_note then
    for l in select * from jsonb_array_elements(coalesce(p_line_costs, '[]'::jsonb)) loop
      if (l ->> 'cost_per_base') is not null then
        insert into public.product_costs (org_id, product_id, location_id, cost_per_base, currency, effective_at, source, source_id, created_by)
        values (p_org, (l ->> 'product_id')::uuid, v_inv.location_id, (l ->> 'cost_per_base')::numeric, v_inv.currency,
          coalesce(v_inv.invoice_date::timestamptz, now()), 'invoice', p_invoice, auth.uid());
      end if;
    end loop;
  end if;

  update public.invoices set status = 'approved', approved_by = auth.uid(), approved_at = now(),
    duplicate_override_reason = nullif(trim(coalesce(p_duplicate_override, '')), ''),
    receiving_status = case when v_inv.is_credit_note then 'not_applicable' else receiving_status end,
    version = p_expected_version
  where id = p_invoice;
  perform app.audit(p_org, 'invoice.approved', 'invoice', p_invoice::text,
    jsonb_build_object('total', v_inv.total, 'update_costs', p_update_costs, 'duplicate_override', p_duplicate_override));
end $$;

-- Confirm what physically arrived. Creates receipt movements with landed cost.
-- p_lines: [{invoice_line_id, received_quantity, received_base, extended_cost}]
create or replace function public.receive_invoice(p_org uuid, p_invoice uuid, p_received_at timestamptz, p_lines jsonb, p_notes text, p_idempotency_key text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_rec uuid;
  v_mov uuid;
  v_line public.invoice_lines;
  l jsonb;
  v_billed numeric;
  v_received numeric;
begin
  select * into v_inv from public.invoices where id = p_invoice and org_id = p_org for update;
  if v_inv.id is null then
    raise exception 'Invoice not found' using errcode = '22023';
  end if;
  if not app.has_location_perm(p_org, v_inv.location_id, 'invoices.approve') then
    raise exception 'You do not have permission to receive stock' using errcode = '42501';
  end if;
  if v_inv.status <> 'approved' or v_inv.is_credit_note then
    raise exception 'Only approved invoices can be received' using errcode = '22023';
  end if;
  select id into v_rec from public.receivings where org_id = p_org and idempotency_key = p_idempotency_key;
  if v_rec is not null then
    return v_rec; -- retried request
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Nothing to receive' using errcode = '22023';
  end if;
  insert into public.receivings (org_id, location_id, invoice_id, received_at, received_by, notes, idempotency_key)
  values (p_org, v_inv.location_id, p_invoice, coalesce(p_received_at, now()), auth.uid(), p_notes, p_idempotency_key) returning id into v_rec;
  for l in select value from jsonb_array_elements(p_lines) loop
    select * into v_line from public.invoice_lines where id = (l ->> 'invoice_line_id')::uuid and invoice_id = p_invoice;
    if v_line.id is null or v_line.product_id is null or v_line.match_status <> 'confirmed' then
      raise exception 'Every received line must be a confirmed product line of this invoice' using errcode = '22023';
    end if;
    if (l ->> 'received_base')::numeric <= 0 then
      continue;
    end if;
    insert into public.stock_movements (org_id, location_id, product_id, type, qty_base, occurred_at, source_type, source_id, idempotency_key, created_by)
    values (p_org, v_inv.location_id, v_line.product_id, 'receipt', (l ->> 'received_base')::numeric, coalesce(p_received_at, now()),
      'receiving', v_rec, null, auth.uid())
    returning id into v_mov;
    if (l ->> 'extended_cost') is not null then
      insert into public.stock_movement_costs (movement_id, org_id, extended_cost, currency)
      values (v_mov, p_org, (l ->> 'extended_cost')::numeric, v_inv.currency);
    end if;
    insert into public.receiving_lines (org_id, receiving_id, invoice_line_id, product_id, received_quantity, received_base, movement_id)
    values (p_org, v_rec, v_line.id, v_line.product_id, (l ->> 'received_quantity')::numeric, (l ->> 'received_base')::numeric, v_mov);
  end loop;
  select coalesce(sum(il.quantity), 0) into v_billed from public.invoice_lines il where il.invoice_id = p_invoice and il.match_status = 'confirmed';
  select coalesce(sum(rl.received_quantity), 0) into v_received from public.receiving_lines rl
    join public.receivings r on r.id = rl.receiving_id where r.invoice_id = p_invoice;
  update public.invoices set receiving_status = case when v_received >= v_billed then 'received' when v_received > 0 then 'partial' else 'not_received' end
  where id = p_invoice;
  perform app.audit(p_org, 'invoice.received', 'invoice', p_invoice::text, jsonb_build_object('receiving', v_rec, 'billed', v_billed, 'received', v_received));
  return v_rec;
end $$;

grant execute on function public.approve_invoice, public.receive_invoice to authenticated;
revoke execute on function public.approve_invoice, public.receive_invoice from anon, public;
