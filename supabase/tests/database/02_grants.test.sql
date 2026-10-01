begin;
select plan(3);

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type = 'TRUNCATE'),
  0, 'API roles cannot TRUNCATE any table (TRUNCATE ignores row-level security)');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('REFERENCES', 'TRIGGER')),
  0, 'API roles have no REFERENCES or TRIGGER grants');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'every public table has row-level security enabled');

select * from finish();
rollback;
