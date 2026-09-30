-- Bar book, staff and schedules, beverage events, in-app notifications.

-- ---------------------------------------------------------------- bar book

create table public.barbook_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  category text not null check (category in ('handoff', 'shortage', 'prep', 'equipment', 'event', 'announcement', 'other')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  business_date date not null,
  title text not null check (length(trim(title)) between 1 and 160),
  body text not null default '' check (length(body) <= 5000),
  -- managers: only barbook.manage holders see it (personnel matters, not guest data).
  visibility text not null default 'all' check (visibility in ('all', 'managers')),
  is_task boolean not null default false,
  assigned_to uuid references auth.users (id) on delete set null,
  due_date date,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolution text check (length(resolution) <= 2000),
  requires_ack boolean not null default false,
  author_id uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))) stored,
  unique (org_id, id),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade
);
create index barbook_loc_date on public.barbook_entries (org_id, location_id, business_date desc);
create index barbook_open on public.barbook_entries (org_id, location_id) where status = 'open';
create index barbook_search on public.barbook_entries using gin (search);

create table public.barbook_revisions (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  entry_id uuid not null,
  editor_id uuid,
  previous jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (org_id, entry_id) references public.barbook_entries (org_id, id) on delete cascade
);

create table public.barbook_acks (
  org_id uuid not null,
  entry_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  acked_at timestamptz not null default now(),
  primary key (entry_id, user_id),
  foreign key (org_id, entry_id) references public.barbook_entries (org_id, id) on delete cascade
);

create or replace function app.barbook_revision() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (old.title, old.body, old.category, old.priority, old.visibility, old.assigned_to, old.due_date, old.status, old.resolution)
     is distinct from (new.title, new.body, new.category, new.priority, new.visibility, new.assigned_to, new.due_date, new.status, new.resolution) then
    insert into public.barbook_revisions (org_id, entry_id, editor_id, previous)
    values (old.org_id, old.id, auth.uid(), jsonb_build_object('title', old.title, 'body', old.body, 'category', old.category,
      'priority', old.priority, 'visibility', old.visibility, 'assigned_to', old.assigned_to, 'due_date', old.due_date,
      'status', old.status, 'resolution', old.resolution, 'updated_at', old.updated_at));
  end if;
  if new.status = 'resolved' and old.status = 'open' then
    new.resolved_by := auth.uid();
    new.resolved_at := now();
  elsif new.status = 'open' then
    new.resolved_by := null;
    new.resolved_at := null;
  end if;
  -- Author and location never change.
  new.author_id := old.author_id;
  new.location_id := old.location_id;
  new.org_id := old.org_id;
  return new;
end $$;
create trigger barbook_revision before update on public.barbook_entries for each row execute function app.barbook_revision();
create trigger barbook_touch before update on public.barbook_entries for each row execute function app.touch_updated_at();
create trigger barbook_version before update on public.barbook_entries for each row execute function app.bump_version();

alter table public.barbook_entries enable row level security;
alter table public.barbook_revisions enable row level security;
alter table public.barbook_acks enable row level security;

create policy "staff read bar book" on public.barbook_entries for select to authenticated using (
  app.can_see_location(org_id, location_id)
  and (visibility = 'all' or app.has_location_perm(org_id, location_id, 'barbook.manage'))
);
create policy "staff write bar book" on public.barbook_entries for insert to authenticated with check (
  app.has_location_perm(org_id, location_id, 'barbook.write') and author_id = auth.uid() and status = 'open'
  and (visibility = 'all' or app.has_location_perm(org_id, location_id, 'barbook.manage'))
);
-- Authors edit their own entries; managers edit any; assignees can resolve their tasks.
create policy "authors, assignees and managers update" on public.barbook_entries for update to authenticated using (
  app.can_see_location(org_id, location_id)
  and (visibility = 'all' or app.has_location_perm(org_id, location_id, 'barbook.manage'))
  and (author_id = auth.uid() or assigned_to = auth.uid() or app.has_location_perm(org_id, location_id, 'barbook.manage'))
) with check (
  (visibility = 'all' or app.has_location_perm(org_id, location_id, 'barbook.manage'))
);

create policy "revision readers" on public.barbook_revisions for select to authenticated using (
  exists (select 1 from public.barbook_entries e where e.id = entry_id)
);
create policy "ack readers" on public.barbook_acks for select to authenticated using (
  exists (select 1 from public.barbook_entries e where e.id = entry_id)
);
create policy "ack own" on public.barbook_acks for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.barbook_entries e where e.id = entry_id)
);

revoke delete on public.barbook_entries from authenticated, anon;
revoke insert, update, delete on public.barbook_revisions from authenticated, anon;
revoke update, delete on public.barbook_acks from authenticated, anon;

-- ---------------------------------------------------------------- staff and schedule

-- Staff do not need an account to be scheduled; linking user_id lets them see "my shifts".
create table public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  default_role text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create unique index staff_profiles_user on public.staff_profiles (org_id, user_id) where user_id is not null;

create table public.schedule_weeks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  status text not null default 'draft' check (status in ('draft', 'published')),
  -- Edits after publishing leave the week with unpublished changes until re-published.
  has_unpublished_changes boolean not null default false,
  published_version integer not null default 0,
  published_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (location_id, week_start),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  week_id uuid not null,
  staff_id uuid,
  role text not null check (length(trim(role)) between 1 and 60),
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  -- Derived from local times in the location's zone (server computed).
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  notes text check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (org_id, id),
  foreign key (org_id, week_id) references public.schedule_weeks (org_id, id) on delete cascade,
  foreign key (org_id, staff_id) references public.staff_profiles (org_id, id)
);
create index shifts_week on public.shifts (week_id, shift_date, start_time);
create index shifts_staff_time on public.shifts (org_id, staff_id, starts_at);

-- Immutable snapshot of each publication, so staff can see what changed.
create table public.schedule_publications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  week_id uuid not null,
  version integer not null,
  shifts jsonb not null,
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz not null default now(),
  unique (week_id, version),
  foreign key (org_id, week_id) references public.schedule_weeks (org_id, id) on delete cascade
);

alter table public.staff_profiles enable row level security;
alter table public.schedule_weeks enable row level security;
alter table public.shifts enable row level security;
alter table public.schedule_publications enable row level security;

create policy "members read staff" on public.staff_profiles for select to authenticated using (app.is_member(org_id));
create policy "schedulers manage staff" on public.staff_profiles for all to authenticated
  using (app.has_perm(org_id, 'schedule.publish')) with check (app.has_perm(org_id, 'schedule.publish'));

create policy "schedulers and viewers read weeks" on public.schedule_weeks for select to authenticated using (
  app.has_location_perm(org_id, location_id, 'schedule.publish')
  or (status = 'published' and app.can_see_location(org_id, location_id))
);
create policy "schedulers manage weeks" on public.schedule_weeks for insert to authenticated
  with check (app.has_location_perm(org_id, location_id, 'schedule.publish') and status = 'draft');
create policy "schedulers update weeks" on public.schedule_weeks for update to authenticated
  using (app.has_location_perm(org_id, location_id, 'schedule.publish'))
  with check (app.has_location_perm(org_id, location_id, 'schedule.publish'));

-- Draft shifts are visible to schedulers only. Staff see the published snapshot,
-- or live shifts for published weeks: their own always, the team's with schedule.view_team.
create policy "schedulers read shifts" on public.shifts for select to authenticated using (
  exists (select 1 from public.schedule_weeks w where w.id = week_id and app.has_location_perm(w.org_id, w.location_id, 'schedule.publish'))
);

create policy "readers see publications" on public.schedule_publications for select to authenticated using (
  exists (select 1 from public.schedule_weeks w where w.id = week_id and app.can_see_location(w.org_id, w.location_id)
    and (app.has_location_perm(w.org_id, w.location_id, 'schedule.view_team') or app.has_location_perm(w.org_id, w.location_id, 'schedule.publish')))
);

revoke insert, update, delete on public.shifts, public.schedule_publications from authenticated, anon;

create trigger schedule_weeks_touch before update on public.schedule_weeks for each row execute function app.touch_updated_at();
create trigger schedule_weeks_version before update on public.schedule_weeks for each row execute function app.bump_version();
create trigger shifts_touch before update on public.shifts for each row execute function app.touch_updated_at();

-- A staff member's own published shifts, regardless of team visibility.
create or replace function public.my_published_shifts(p_org uuid, p_from date, p_to date)
returns table (week_id uuid, location_id uuid, shift jsonb)
language sql stable security definer
set search_path = ''
as $$
  select w.id, w.location_id, s.value
  from public.schedule_weeks w
  join lateral (
    select p.shifts from public.schedule_publications p where p.week_id = w.id order by p.version desc limit 1
  ) pub on true
  cross join lateral jsonb_array_elements(pub.shifts) s
  join public.staff_profiles sp on sp.id = (s.value ->> 'staff_id')::uuid and sp.user_id = auth.uid()
  where w.org_id = p_org and app.is_member(p_org) and app.can_see_location(w.org_id, w.location_id)
    and (s.value ->> 'shift_date')::date between p_from and p_to
$$;
grant execute on function public.my_published_shifts to authenticated;
revoke execute on function public.my_published_shifts from anon, public;

-- ---------------------------------------------------------------- notifications

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text check (link ~ '^/[A-Za-z0-9/_?=&%-]*$'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user on public.notifications (user_id, created_at desc) where read_at is null;
alter table public.notifications enable row level security;
create policy "own notifications" on public.notifications for select to authenticated using (user_id = auth.uid() and app.is_member(org_id));
create policy "mark own read" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, delete on public.notifications from authenticated, anon;

-- ---------------------------------------------------------------- beverage events

create table public.bev_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 160),
  event_date date not null,
  start_time time,
  duration_hours numeric(5, 2) not null check (duration_hours > 0 and duration_hours <= 24),
  guests integer not null check (guests >= 0 and guests <= 100000),
  participation_pct numeric(5, 2) not null default 85 check (participation_pct between 0 and 100),
  first_hour_drinks numeric(5, 2) not null default 2 check (first_hour_drinks >= 0),
  later_hour_drinks numeric(5, 2) not null default 1 check (later_hour_drinks >= 0),
  contingency_pct numeric(5, 2) not null default 10 check (contingency_pct between 0 and 100),
  mix jsonb not null default '{"cocktail": 50, "beer": 25, "wine": 20, "non_alcoholic": 5}',
  consumables jsonb not null default '{"iceLbPerParticipant": "1.5", "chillIceLbPerBottleDrink": "0.25", "cupsPerDrink": "1.2", "napkinsPerDrink": "1.5"}',
  other_costs jsonb not null default '[]',
  quote_mode text not null default 'margin' check (quote_mode in ('markup', 'margin')),
  quote_pct numeric(6, 2) not null default 30 check (quote_pct >= 0),
  status text not null default 'draft' check (status in ('draft', 'quoted', 'confirmed', 'completed', 'cancelled')),
  notes text check (length(notes) <= 5000),
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade
);

create table public.bev_event_recipes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  event_id uuid not null,
  recipe_id uuid not null,
  category text not null check (category in ('cocktail', 'beer', 'wine', 'non_alcoholic')),
  share_pct numeric(5, 2) not null check (share_pct > 0 and share_pct <= 100),
  batch_servings integer check (batch_servings > 0),
  unique (event_id, recipe_id),
  foreign key (org_id, event_id) references public.bev_events (org_id, id) on delete cascade,
  foreign key (org_id, recipe_id) references public.recipes (org_id, id)
);

-- Frozen assumptions, demand, costs and price at the time a quote was issued.
create table public.bev_event_quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  event_id uuid not null,
  version integer not null,
  snapshot jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (event_id, version),
  foreign key (org_id, event_id) references public.bev_events (org_id, id) on delete cascade
);

alter table public.bev_events enable row level security;
alter table public.bev_event_recipes enable row level security;
alter table public.bev_event_quotes enable row level security;

create policy "event planners read" on public.bev_events for select to authenticated using (app.has_location_perm(org_id, location_id, 'events.manage'));
create policy "event planners write" on public.bev_events for insert to authenticated with check (app.has_location_perm(org_id, location_id, 'events.manage'));
create policy "event planners update" on public.bev_events for update to authenticated
  using (app.has_location_perm(org_id, location_id, 'events.manage')) with check (app.has_location_perm(org_id, location_id, 'events.manage'));
create policy "event planners manage recipes" on public.bev_event_recipes for all to authenticated
  using (app.has_perm(org_id, 'events.manage')) with check (app.has_perm(org_id, 'events.manage'));
create policy "event planners read quotes" on public.bev_event_quotes for select to authenticated
  using (app.has_perm(org_id, 'events.manage') and app.has_perm(org_id, 'costs.view'));

revoke delete on public.bev_events from authenticated, anon;
revoke insert, update, delete on public.bev_event_quotes from authenticated, anon;

create trigger bev_events_touch before update on public.bev_events for each row execute function app.touch_updated_at();
create trigger bev_events_version before update on public.bev_events for each row execute function app.bump_version();
