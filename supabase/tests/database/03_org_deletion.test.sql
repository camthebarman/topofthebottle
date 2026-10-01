begin;
select plan(3);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'organizations'
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)
     and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f'
                     and k.confrelid = 'public.organizations'::regclass and k.confdeltype = 'c')),
  0, 'every tenant table cascades directly from its organization');

-- A populated organization (recipes, menu, stock ledger, a transfer) can be deleted in one statement.
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);
select public.post_transfer(
  (select id from public.organizations where name = 'Demo Cocktail Bar'),
  (select id from public.locations where name = 'Main bar' and org_id = (select id from public.organizations where name = 'Demo Cocktail Bar')),
  (select id from public.locations where name = 'Rooftop'),
  jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Campari' and org_id = (select id from public.organizations where name = 'Demo Cocktail Bar')), 'qty_base', '1000')),
  'test transfer');
select set_config('request.jwt.claims', '', true);

create temp table _victim as select id from public.organizations where name = 'Demo Cocktail Bar';
delete from public.organizations where id = (select id from _victim);
set constraints all immediate;  -- run the deferred checks now instead of at commit
select pass('deleting a populated organization satisfies every foreign key');

select is(
  (select count(*)::int from public.stock_movements where org_id = (select id from _victim))
  + (select count(*)::int from public.recipe_components where org_id = (select id from _victim))
  + (select count(*)::int from public.transfers where org_id = (select id from _victim)),
  0, 'no rows of the deleted organization remain');

select * from finish();
rollback;
