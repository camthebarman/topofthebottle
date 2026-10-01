-- Deleting an organization cascades through many paths at once (for example ingredients and
-- recipe versions both lead to recipe_components). Non-cascading foreign keys inside a tenant
-- were checked immediately, so a row could be checked before the cascade had removed the rows
-- pointing at it, and the organization could not be deleted. Checking them at commit keeps
-- the protection (a product still cannot be deleted while history refers to it) and lets a
-- whole tenant be removed in one statement.

do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'f'
      and connamespace = 'public'::regnamespace
      and not condeferrable
      and confdeltype in ('a', 'r')            -- NO ACTION / RESTRICT
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (org_id,%'
  loop
    execute format('alter table %s alter constraint %I deferrable initially deferred', c.tbl, c.conname);
  end loop;
end $$;

-- Every tenant table also gets a direct cascading key to its organization, so deleting an
-- organization reaches every row. production_runs, receivings and transfers had no cascading
-- path at all, which made any organization with a delivery, transfer or batch undeletable.
do $$
declare
  t record;
begin
  for t in
    select c.oid, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'organizations'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)
      and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f'
                      and k.confrelid = 'public.organizations'::regclass and k.confdeltype = 'c')
  loop
    execute format('alter table public.%I add constraint %I foreign key (org_id) references public.organizations (id) on delete cascade',
      t.relname, left(t.relname || '_org_cascade', 63));
  end loop;
end $$;
