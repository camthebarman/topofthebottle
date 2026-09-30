-- Tenancy, roles, permissions, audit.
--
-- Every tenant-owned table carries org_id. Parents expose unique (org_id, id)
-- and children reference (org_id, parent_id), so a row can never point at a
-- row in another organization, whatever the policies say.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- roles

create type public.member_role as enum ('owner', 'manager', 'bartender', 'read_only');

create table public.permissions (
  id text primary key,
  description text not null
);

create table public.role_permissions (
  role public.member_role not null,
  permission text not null references public.permissions (id),
  primary key (role, permission)
);

insert into public.permissions (id, description) values
  ('org.view', 'See the organization and its locations'),
  ('costs.view', 'See product costs, recipe costs, margins and inventory value'),
  ('catalog.edit', 'Create and edit products, suppliers and ingredients'),
  ('recipes.edit', 'Create and version recipes'),
  ('menu.edit', 'Change the current menu and selling prices'),
  ('inventory.count', 'Enter counts in draft count sessions'),
  ('inventory.finalize', 'Finalize counts, which adjusts the book'),
  ('inventory.move', 'Record waste, transfers, production and adjustments'),
  ('invoices.upload', 'Upload invoices and edit extracted data'),
  ('invoices.approve', 'Approve invoices, post purchases and confirm receiving'),
  ('imports.manage', 'Upload, map and commit POS imports'),
  ('insights.view', 'See Insights reports'),
  ('insights.ai', 'Request AI explanations of Insights'),
  ('barbook.write', 'Write bar book entries and acknowledge them'),
  ('barbook.manage', 'Resolve, assign and see manager-only bar book entries'),
  ('schedule.view_team', 'See published team schedules'),
  ('schedule.publish', 'Edit and publish schedules'),
  ('events.manage', 'Plan beverage events and quotes'),
  ('members.manage', 'Invite, change and remove members'),
  ('billing.manage', 'Manage subscription and billing'),
  ('settings.manage', 'Change organization and location settings'),
  ('audit.view', 'Read the audit log'),
  ('data.export', 'Export and request deletion of organization data');

insert into public.role_permissions (role, permission)
select 'owner', id from public.permissions;

insert into public.role_permissions (role, permission)
select 'manager', id from public.permissions
where id not in ('billing.manage', 'data.export');

insert into public.role_permissions (role, permission) values
  ('bartender', 'org.view'),
  ('bartender', 'inventory.count'),
  ('bartender', 'barbook.write'),
  ('bartender', 'schedule.view_team'),
  ('bartender', 'invoices.upload'),
  ('read_only', 'org.view'),
  ('read_only', 'schedule.view_team'),
  ('read_only', 'insights.view'),
  ('read_only', 'costs.view');

-- ---------------------------------------------------------------- organizations

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  timezone text not null default 'America/New_York',
  business_day_cutoff time not null default '04:00',
  currency char(3) not null default 'USD',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  -- Null: every location. Otherwise the member only sees these locations.
  location_ids uuid[],
  display_name text,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id) where status = 'active';

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.member_role not null,
  location_ids uuid[],
  -- Only a hash of the token is stored; the token itself is shown once.
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index invitations_open_email on public.invitations (org_id, lower(email))
  where accepted_at is null and revoked_at is null;

create table public.org_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  valuation_method text not null default 'moving_average' check (valuation_method in ('moving_average', 'last_cost')),
  freight_policy text not null default 'allocate_by_value' check (freight_policy in ('exclude', 'allocate_by_value')),
  tax_policy text not null default 'exclude' check (tax_policy in ('exclude', 'allocate_by_value')),
  target_cost_pct numeric(5, 2) not null default 20 check (target_cost_pct > 0 and target_cost_pct < 100),
  price_stale_days integer not null default 90 check (price_stale_days > 0),
  variance_review_pct numeric(5, 2) not null default 5 check (variance_review_pct >= 0),
  min_sales_coverage_pct numeric(5, 2) not null default 95 check (min_sales_coverage_pct between 0 and 100),
  void_prepared_consumes boolean not null default true,
  comp_consumes boolean not null default true,
  ai_insights_opt_in boolean not null default false,
  ai_invoice_opt_in boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- ---------------------------------------------------------------- helpers
-- security definer so policies can consult memberships without recursion.

create or replace function app.current_user_id() returns uuid
language sql stable
set search_path = ''
as $$ select auth.uid() $$;

create or replace function app.member_role(p_org uuid) returns public.member_role
language sql stable security definer
set search_path = ''
as $$
  select m.role from public.memberships m
  where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function app.is_member(p_org uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  )
$$;

create or replace function app.has_perm(p_org uuid, p_perm text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.role_permissions rp on rp.role = m.role
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active'
      and rp.permission = p_perm
  )
$$;

create or replace function app.can_see_location(p_org uuid, p_location uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active'
      and (m.location_ids is null or p_location = any (m.location_ids))
  )
$$;

create or replace function app.has_location_perm(p_org uuid, p_location uuid, p_perm text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.role_permissions rp on rp.role = m.role
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active'
      and (m.location_ids is null or p_location = any (m.location_ids))
      and rp.permission = p_perm
  )
$$;

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;

-- updated_at maintenance
create or replace function app.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Optimistic concurrency: callers send the version they read; a stale write fails.
create or replace function app.bump_version() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version is distinct from old.version then
    raise exception 'This record was changed by someone else. Reload and try again.'
      using errcode = '40001';
  end if;
  new.version := old.version + 1;
  return new;
end $$;

-- ---------------------------------------------------------------- audit

create table public.audit_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  data jsonb not null default '{}'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now()
);
create index audit_events_org_time on public.audit_events (org_id, created_at desc);

create or replace function app.audit(p_org uuid, p_action text, p_entity_type text, p_entity_id text, p_data jsonb default '{}'::jsonb)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, data, correlation_id)
  values (p_org, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_data, '{}'::jsonb),
          nullif(current_setting('request.headers', true)::jsonb ->> 'x-correlation-id', ''));
$$;
revoke all on function app.audit from public;
grant execute on function app.audit to authenticated, service_role;

-- ---------------------------------------------------------------- RLS

alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.organizations enable row level security;
alter table public.locations enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.org_settings enable row level security;
alter table public.audit_events enable row level security;

create policy "permissions readable" on public.permissions for select to authenticated using (true);
create policy "role permissions readable" on public.role_permissions for select to authenticated using (true);

create policy "members see their organizations" on public.organizations
  for select to authenticated using (app.is_member(id));
create policy "settings managers rename organizations" on public.organizations
  for update to authenticated using (app.has_perm(id, 'settings.manage')) with check (app.has_perm(id, 'settings.manage'));

create policy "members see permitted locations" on public.locations
  for select to authenticated using (app.can_see_location(org_id, id));
create policy "settings managers add locations" on public.locations
  for insert to authenticated with check (app.has_perm(org_id, 'settings.manage'));
create policy "settings managers edit locations" on public.locations
  for update to authenticated using (app.has_perm(org_id, 'settings.manage')) with check (app.has_perm(org_id, 'settings.manage'));

create policy "members see co-members" on public.memberships
  for select to authenticated using (app.is_member(org_id));
-- Membership changes go through functions that enforce owner rules.

create policy "member managers see invitations" on public.invitations
  for select to authenticated using (app.has_perm(org_id, 'members.manage'));

create policy "members read settings" on public.org_settings
  for select to authenticated using (app.is_member(org_id));
create policy "settings managers update settings" on public.org_settings
  for update to authenticated using (app.has_perm(org_id, 'settings.manage')) with check (app.has_perm(org_id, 'settings.manage'));

create policy "auditors read audit log" on public.audit_events
  for select to authenticated using (app.has_perm(org_id, 'audit.view'));
-- No insert/update/delete policies: audit rows are written only by app.audit().

create trigger memberships_touch before update on public.memberships
  for each row execute function app.touch_updated_at();
create trigger org_settings_touch before update on public.org_settings
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- membership functions

-- Create an organization with its first location, owned by the caller.
create or replace function public.create_organization(p_name text, p_location_name text, p_timezone text, p_display_name text default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown time zone %', p_timezone using errcode = '22023';
  end if;
  insert into public.organizations (name, created_by) values (trim(p_name), v_uid) returning id into v_org;
  insert into public.locations (org_id, name, timezone) values (v_org, trim(p_location_name), p_timezone);
  insert into public.memberships (org_id, user_id, role, display_name) values (v_org, v_uid, 'owner', nullif(trim(p_display_name), ''));
  insert into public.org_settings (org_id) values (v_org);
  perform app.audit(v_org, 'organization.created', 'organization', v_org::text, jsonb_build_object('name', p_name));
  return v_org;
end $$;

-- Returns the raw token once; only its hash is stored.
create or replace function public.create_invitation(p_org uuid, p_email text, p_role public.member_role, p_location_ids uuid[] default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not app.has_perm(p_org, 'members.manage') then
    raise exception 'You do not have permission to invite members' using errcode = '42501';
  end if;
  if p_role = 'owner' and app.member_role(p_org) <> 'owner' then
    raise exception 'Only owners can invite owners' using errcode = '42501';
  end if;
  if p_location_ids is not null and exists (
    select 1 from unnest(p_location_ids) l where not exists (select 1 from public.locations x where x.id = l and x.org_id = p_org)
  ) then
    raise exception 'Unknown location' using errcode = '22023';
  end if;
  insert into public.invitations (org_id, email, role, location_ids, token_hash, invited_by)
  values (p_org, lower(trim(p_email)), p_role, p_location_ids, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid());
  perform app.audit(p_org, 'invitation.created', 'invitation', lower(trim(p_email)), jsonb_build_object('role', p_role));
  return v_token;
end $$;

create or replace function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.invitations where id = p_invitation;
  if v_org is null or not app.has_perm(v_org, 'members.manage') then
    raise exception 'Invitation not found' using errcode = '42501';
  end if;
  update public.invitations set revoked_at = now() where id = p_invitation and accepted_at is null;
  perform app.audit(v_org, 'invitation.revoked', 'invitation', p_invitation::text);
end $$;

create or replace function public.accept_invitation(p_token text, p_display_name text default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  select * into v_inv from public.invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;
  if v_inv.id is null or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at < now() then
    raise exception 'This invitation is invalid or has expired' using errcode = '22023';
  end if;
  if v_inv.email <> v_email then
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;
  insert into public.memberships (org_id, user_id, role, location_ids, display_name)
  values (v_inv.org_id, v_uid, v_inv.role, v_inv.location_ids, nullif(trim(p_display_name), ''))
  on conflict (org_id, user_id) do update
    set role = excluded.role, location_ids = excluded.location_ids, status = 'active',
        display_name = coalesce(excluded.display_name, public.memberships.display_name);
  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  perform app.audit(v_inv.org_id, 'invitation.accepted', 'membership', v_uid::text, jsonb_build_object('role', v_inv.role));
  return v_inv.org_id;
end $$;

-- Change a member's role or locations, or revoke them. Keeps at least one owner.
create or replace function public.update_membership(p_org uuid, p_user uuid, p_role public.member_role, p_location_ids uuid[], p_status text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_current public.memberships;
  v_caller_role public.member_role := app.member_role(p_org);
begin
  if not app.has_perm(p_org, 'members.manage') then
    raise exception 'You do not have permission to manage members' using errcode = '42501';
  end if;
  select * into v_current from public.memberships where org_id = p_org and user_id = p_user for update;
  if v_current.user_id is null then
    raise exception 'Member not found' using errcode = '22023';
  end if;
  if (v_current.role = 'owner' or p_role = 'owner') and v_caller_role <> 'owner' then
    raise exception 'Only owners can change owners' using errcode = '42501';
  end if;
  if v_current.role = 'owner' and (p_role <> 'owner' or p_status <> 'active') and (
    select count(*) from public.memberships where org_id = p_org and role = 'owner' and status = 'active'
  ) <= 1 then
    raise exception 'An organization needs at least one owner' using errcode = '22023';
  end if;
  update public.memberships set role = p_role, location_ids = p_location_ids, status = p_status
  where org_id = p_org and user_id = p_user;
  perform app.audit(p_org, 'membership.updated', 'membership', p_user::text,
    jsonb_build_object('from_role', v_current.role, 'to_role', p_role, 'status', p_status));
end $$;

grant execute on function public.create_organization, public.create_invitation, public.revoke_invitation,
  public.accept_invitation, public.update_membership to authenticated;
revoke execute on function public.create_organization, public.create_invitation, public.revoke_invitation,
  public.accept_invitation, public.update_membership from anon, public;

-- Permissions of the caller in an org, for the UI (never trusted for authorization).
create or replace function public.my_permissions(p_org uuid)
returns table (permission text)
language sql stable security definer
set search_path = ''
as $$
  select rp.permission from public.memberships m
  join public.role_permissions rp on rp.role = m.role
  where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active'
$$;
grant execute on function public.my_permissions to authenticated;
revoke execute on function public.my_permissions from anon, public;
