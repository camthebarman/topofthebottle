-- Tenant isolation and role checks at the database layer.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

-- Fixture: two organizations, each with an owner; org A also has a bartender and a read-only member.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner-a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'owner-b@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'bartender-a@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'viewer-a@example.test');

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.create_organization('Org A', 'A Main', 'America/New_York') $$, 'owner A creates org');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select lives_ok($$ select public.create_organization('Org B', 'B Main', 'America/Chicago') $$, 'owner B creates org');
select throws_ok($$ select public.create_organization('Bad', 'X', 'Mars/Olympus') $$, '22023', null, 'unknown time zone rejected');

select pg_temp.as_admin();
create temporary table ids as
select (select id from public.organizations where name = 'Org A') as org_a,
       (select id from public.organizations where name = 'Org B') as org_b,
       (select id from public.locations where name = 'A Main') as loc_a,
       (select id from public.locations where name = 'B Main') as loc_b;
grant select on ids to authenticated;
insert into public.memberships (org_id, user_id, role) select org_a, '00000000-0000-0000-0000-0000000000a2', 'bartender' from ids;
insert into public.memberships (org_id, user_id, role) select org_a, '00000000-0000-0000-0000-0000000000a3', 'read_only' from ids;

-- Owner B creates a product with a cost in org B.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.products (org_id, name, dimension, container_size_base) select org_b, 'B Gin', 'volume', 750 from ids;
insert into public.product_costs (org_id, product_id, cost_per_base, source)
select org_b, (select id from public.products where name = 'B Gin'), 0.03, 'manual' from ids;

-- ---------- cross-tenant reads: owner A sees nothing of org B, even with a guessed id
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select is((select count(*) from public.organizations)::int, 1, 'owner A sees only their organization');
select is((select count(*) from public.locations where id = (select loc_b from ids))::int, 0, 'guessed location id of org B is invisible');
select is((select count(*) from public.products where org_id = (select org_b from ids))::int, 0, 'org B products invisible');
select is((select count(*) from public.product_costs)::int, 0, 'org B costs invisible');
select is((select count(*) from public.memberships where org_id = (select org_b from ids))::int, 0, 'org B memberships invisible');

-- ---------- cross-tenant writes
select throws_ok(
  $$ insert into public.products (org_id, name, dimension) select org_b, 'Injected', 'volume' from ids $$,
  '42501', null, 'owner A cannot insert into org B');
update public.products set name = 'Hijacked' where org_id = (select org_b from ids);
select pg_temp.as_admin();
select is((select name from public.products where org_id = (select org_b from ids)), 'B Gin', 'owner A cannot update org B rows');

-- Tenant-safe foreign keys: a row in org A cannot reference a product in org B.
select pg_temp.as_admin();
select throws_ok(
  $$ insert into public.product_conversions (org_id, product_id, from_qty, from_unit, to_qty, to_unit)
     select org_a, (select id from public.products where name = 'B Gin'), 1, 'l', 900, 'g' from ids $$,
  '23503', null, 'composite FK blocks cross-org reference even for privileged writes');

-- ---------- functions refuse cross-tenant ids
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ select public.record_movement((select org_b from ids), (select loc_b from ids), (select id from public.products limit 1), 'waste', -10, now(), 'x') $$,
  '42501', null, 'record_movement rejects another org');
select throws_ok(
  $$ select public.create_invitation((select org_b from ids), 'x@example.test', 'owner') $$,
  '42501', null, 'cannot invite into another org');
select throws_ok(
  $$ select public.set_menu_item((select org_b from ids), (select loc_b from ids), gen_random_uuid(), 10, 20, null, true) $$,
  '42501', null, 'cannot edit another org menu');

-- ---------- roles inside org A
insert into public.products (org_id, name, dimension, container_size_base) select org_a, 'A Gin', 'volume', 750 from ids;
insert into public.product_costs (org_id, product_id, cost_per_base, source)
select org_a, (select id from public.products where name = 'A Gin'), 0.02, 'manual' from ids;
select lives_ok(
  $$ select public.record_movement((select org_a from ids), (select loc_a from ids), (select id from public.products where name = 'A Gin'), 'opening_balance', 7500, now() - interval '1 hour', 'opening') $$,
  'owner records opening balance');
select throws_ok(
  $$ select public.record_movement((select org_a from ids), (select loc_a from ids), (select id from public.products where name = 'A Gin'), 'waste', 10, now(), 'spill') $$,
  '22023', null, 'waste must be negative');
select throws_ok(
  $$ select public.record_movement((select org_a from ids), (select loc_a from ids), (select id from public.products where name = 'A Gin'), 'manual_adjustment', -10, now(), '') $$,
  '23514', null, 'manual adjustment needs a reason');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select is((select count(*) from public.products)::int, 1, 'bartender sees org A products');
select is((select count(*) from public.product_costs)::int, 0, 'bartender cannot see costs');
select is((select count(*) from public.stock_movement_costs)::int, 0, 'bartender cannot see movement costs');
select throws_ok(
  $$ insert into public.products (org_id, name, dimension) select org_a, 'Bartender product', 'volume' from ids $$,
  '42501', null, 'bartender cannot edit catalog');
select throws_ok(
  $$ select public.record_movement((select org_a from ids), (select loc_a from ids), (select id from public.products where name = 'A Gin'), 'waste', -10, now(), 'spill') $$,
  '42501', null, 'bartender cannot record waste without inventory.move');
select is((select count(*) from public.audit_events)::int, 0, 'bartender cannot read the audit log');
select is((select count(*) from public.invitations)::int, 0, 'bartender cannot see invitations');
select throws_ok(
  $$ select public.update_membership((select org_a from ids), '00000000-0000-0000-0000-0000000000a2', 'owner', null, 'active') $$,
  '42501', null, 'bartender cannot promote themselves');

-- Count flow: bartender counts, cannot finalize.
select lives_ok(
  $$ insert into public.count_sessions (org_id, location_id, counted_at) select org_a, loc_a, now() from ids $$,
  'bartender starts a count');
select lives_ok(
  $$ select public.upsert_count_line((select org_a from ids), (select id from public.count_sessions limit 1),
       (select id from public.products where name = 'A Gin'), null, 'tenths', 9, 4, null, null) $$,
  'bartender enters 9 bottles and 4 tenths');
select is((select qty_base from public.count_lines limit 1), 7050.0::numeric, 'count line computed server-side (9 x 750 + 300)');
select is((select approximate from public.count_lines limit 1), true, 'tenths estimate marked approximate');
select throws_ok(
  $$ select public.finalize_count((select org_a from ids), (select id from public.count_sessions limit 1), 1) $$,
  '42501', null, 'bartender cannot finalize');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ select public.finalize_count((select org_a from ids), (select id from public.count_sessions limit 1), 99) $$,
  '40001', null, 'stale version rejected');
select is(
  (select adjustment from public.finalize_count((select org_a from ids), (select id from public.count_sessions limit 1), 1)),
  -450.0::numeric, 'finalize posts count - book adjustment');
select is(public.book_balance((select org_a from ids), (select loc_a from ids), (select id from public.products where name = 'A Gin')), 7050.0::numeric, 'book now matches count');

-- Ledger immutability
select throws_ok($$ update public.stock_movements set qty_base = 1 $$, '42501', null, 'movements cannot be updated');
select throws_ok($$ delete from public.stock_movements $$, '42501', null, 'movements cannot be deleted');
select throws_ok(
  $$ select public.reverse_movement((select org_a from ids), (select id from public.stock_movements where type = 'count_adjustment'), 'oops') $$,
  '22023', null, 'count adjustments are not reversible');
select lives_ok(
  $$ select public.reverse_movement((select org_a from ids), (select id from public.stock_movements where type = 'opening_balance'), 'entered at the wrong location') $$,
  'opening balance reversed');
select throws_ok(
  $$ select public.reverse_movement((select org_a from ids), (select id from public.stock_movements where type = 'opening_balance' and reverses_id is null), 'again') $$,
  '23505', null, 'a movement can only be reversed once');

-- Audit trail exists and is read-only.
select ok((select count(*) from public.audit_events where action = 'count.finalized') = 1, 'finalize audited');
select throws_ok($$ delete from public.audit_events $$, '42501', null, 'audit rows cannot be deleted');

-- Read-only member sees costs but cannot write.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select is((select count(*) from public.product_costs)::int, 1, 'read-only member sees org A costs');
select throws_ok(
  $$ insert into public.count_sessions (org_id, location_id) select org_a, loc_a from ids $$,
  '42501', null, 'read-only member cannot count');

select * from finish();
rollback;
