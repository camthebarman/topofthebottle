-- Billing entitlements, background jobs, usage allowances, data requests, final grant hardening.

-- ---------------------------------------------------------------- billing

create table public.billing_accounts (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  stripe_customer_id text unique,
  created_at timestamptz not null default now()
);

-- Written only from verified Stripe webhooks.
create table public.subscriptions (
  id text primary key, -- Stripe subscription id
  org_id uuid not null references public.organizations (id) on delete cascade,
  status text not null,
  price_id text,
  -- Paid locations.
  quantity integer not null default 0 check (quantity >= 0),
  current_period_end timestamptz,
  cancel_at timestamptz,
  canceled_at timestamptz,
  stripe_updated_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index subscriptions_org on public.subscriptions (org_id);

-- Webhook idempotency: an event id is processed once.
create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

-- Grace period after cancellation or failed payment, during which data stays readable and exportable.
create or replace function public.org_entitlement(p_org uuid)
returns table (state text, paid_locations integer, active_locations integer, grace_until timestamptz)
language sql stable security definer
set search_path = ''
as $$
  with s as (
    select * from public.subscriptions where org_id = p_org order by stripe_updated_at desc limit 1
  ), locs as (
    select count(*)::integer n from public.locations where org_id = p_org and archived_at is null
  )
  select
    case
      when s.status in ('active', 'trialing') then 'active'
      when s.status in ('past_due', 'unpaid') then 'grace'
      when s.status = 'canceled' and coalesce(s.canceled_at, s.current_period_end) + interval '30 days' > now() then 'grace'
      when s.status is null then 'trial_unpaid'
      else 'read_only'
    end,
    coalesce(s.quantity, 0),
    (select n from locs),
    case when s.status in ('past_due', 'unpaid', 'canceled') then coalesce(s.canceled_at, s.current_period_end) + interval '30 days' end
  from (select 1) one left join s on true
  where app.is_member(p_org)
$$;
grant execute on function public.org_entitlement to authenticated;
revoke execute on function public.org_entitlement from anon, public;

alter table public.billing_accounts enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;
create policy "billing managers read account" on public.billing_accounts for select to authenticated using (app.has_perm(org_id, 'billing.manage'));
create policy "members read subscription" on public.subscriptions for select to authenticated using (app.is_member(org_id));
revoke insert, update, delete on public.billing_accounts, public.subscriptions from authenticated, anon;
revoke all on public.stripe_events from authenticated, anon;

-- ---------------------------------------------------------------- jobs

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('pos_import_validate', 'pos_import_commit', 'invoice_extract', 'insights_explain', 'data_export', 'retention_sweep')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  progress integer not null default 0 check (progress between 0 and 100),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  timeout_seconds integer not null default 300,
  last_error text,
  cancel_requested boolean not null default false,
  idempotency_key text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index jobs_idempotency on public.jobs (org_id, kind, idempotency_key) where idempotency_key is not null;
create index jobs_queue on public.jobs (status, run_after) where status in ('queued', 'running');

alter table public.jobs enable row level security;
create policy "creators and managers read jobs" on public.jobs for select to authenticated
  using (app.is_member(org_id) and (created_by = auth.uid() or app.has_perm(org_id, 'settings.manage')));
revoke insert, update, delete on public.jobs from authenticated, anon;
create trigger jobs_touch before update on public.jobs for each row execute function app.touch_updated_at();

create or replace function public.request_job_cancel(p_job uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.jobs set cancel_requested = true,
    status = case when status = 'queued' then 'cancelled' else status end
  where id = p_job and status in ('queued', 'running')
    and app.is_member(org_id) and (created_by = auth.uid() or app.has_perm(org_id, 'settings.manage'));
  if not found then
    raise exception 'Job not found or already finished' using errcode = '22023';
  end if;
end $$;
grant execute on function public.request_job_cancel to authenticated;
revoke execute on function public.request_job_cancel from anon, public;

-- Claim the next runnable job. Fair across tenants: an organization with a job
-- already running is skipped while others wait, up to p_per_org_limit concurrent jobs.
create or replace function public.claim_job(p_worker text, p_kinds text[], p_per_org_limit integer default 1)
returns setof public.jobs
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  -- Recover jobs whose worker died (lock older than their timeout).
  update public.jobs set status = 'queued', locked_at = null, locked_by = null,
    last_error = coalesce(last_error, '') || ' [lock expired]'
  where status = 'running' and locked_at < now() - make_interval(secs => timeout_seconds * 2);

  select j.* into v_job from public.jobs j
  where j.status = 'queued' and j.run_after <= now() and j.kind = any (p_kinds) and not j.cancel_requested
    and (select count(*) from public.jobs r where r.org_id = j.org_id and r.status = 'running') < p_per_org_limit
  order by j.run_after, j.created_at
  limit 1
  for update skip locked;
  if v_job.id is null then
    return;
  end if;
  update public.jobs set status = 'running', locked_at = now(), locked_by = p_worker, attempts = attempts + 1
  where id = v_job.id returning * into v_job;
  return next v_job;
end $$;
revoke execute on function public.claim_job from public, anon, authenticated;
grant execute on function public.claim_job to service_role;

-- ---------------------------------------------------------------- usage allowances

-- Metered, costly actions (OCR/vision, AI). Limits are configuration, not final commercial terms.
create table public.usage_counters (
  org_id uuid not null references public.organizations (id) on delete cascade,
  metric text not null check (metric in ('invoice_extraction', 'ai_explanation', 'upload_bytes', 'pos_rows')),
  period_start date not null,
  used bigint not null default 0,
  primary key (org_id, metric, period_start)
);
create table public.usage_allowances (
  org_id uuid references public.organizations (id) on delete cascade,
  metric text not null,
  monthly_limit bigint not null check (monthly_limit >= 0),
  unique nulls not distinct (org_id, metric)
);
-- Defaults (org_id null). Adjust per plan; these are placeholders for cost control.
insert into public.usage_allowances (org_id, metric, monthly_limit) values
  (null, 'invoice_extraction', 60),
  (null, 'ai_explanation', 30),
  (null, 'upload_bytes', 2147483648),
  (null, 'pos_rows', 1000000);

alter table public.usage_counters enable row level security;
alter table public.usage_allowances enable row level security;
create policy "members read usage" on public.usage_counters for select to authenticated using (app.is_member(org_id));
create policy "members read allowances" on public.usage_allowances for select to authenticated using (org_id is null or app.is_member(org_id));
revoke insert, update, delete on public.usage_counters, public.usage_allowances from authenticated, anon;

-- Atomically consume allowance. Returns false (and consumes nothing) when it would exceed the limit.
create or replace function public.consume_allowance(p_org uuid, p_metric text, p_amount bigint)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_limit bigint;
  v_period date := date_trunc('month', now())::date;
  v_used bigint;
begin
  select monthly_limit into v_limit from public.usage_allowances
  where metric = p_metric and (org_id = p_org or org_id is null)
  order by org_id nulls last limit 1;
  insert into public.usage_counters (org_id, metric, period_start, used) values (p_org, p_metric, v_period, 0)
  on conflict do nothing;
  select used into v_used from public.usage_counters where org_id = p_org and metric = p_metric and period_start = v_period for update;
  if v_limit is not null and v_used + p_amount > v_limit then
    return false;
  end if;
  update public.usage_counters set used = used + p_amount where org_id = p_org and metric = p_metric and period_start = v_period;
  return true;
end $$;
revoke execute on function public.consume_allowance from public, anon, authenticated;
grant execute on function public.consume_allowance to service_role;

-- ---------------------------------------------------------------- data requests

create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('export', 'delete_organization')),
  status text not null default 'requested' check (status in ('requested', 'processing', 'ready', 'completed', 'cancelled', 'failed')),
  requested_by uuid references auth.users (id) on delete set null,
  -- Deletion waits out a cooling-off period and can be cancelled until then.
  scheduled_for timestamptz,
  result_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.data_requests enable row level security;
create policy "exporters read requests" on public.data_requests for select to authenticated using (app.has_perm(org_id, 'data.export'));
revoke insert, update, delete on public.data_requests from authenticated, anon;

-- ---------------------------------------------------------------- hardening

-- The anonymous role never touches application data.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- Reference tables are read-only for users.
revoke insert, update, delete on public.permissions, public.role_permissions, public.recipe_templates from authenticated;
-- Structural tables changed only through functions.
revoke insert, delete on public.organizations, public.memberships, public.invitations, public.org_settings from authenticated;
revoke update on public.memberships, public.invitations from authenticated;
revoke delete on public.locations from authenticated;
revoke insert, update, delete on public.audit_events from authenticated;
