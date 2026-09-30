-- Synthetic seed data for local development only. Never run against production.
-- Sign in with owner@demo.test / manager@demo.test / bartender@demo.test, password "demo-password-123".
-- All names and figures are invented.

do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_manager uuid := '22222222-2222-4222-8222-222222222222';
  v_bartender uuid := '33333333-3333-4333-8333-333333333333';
  v_other uuid := '44444444-4444-4444-8444-444444444444';
  v_org uuid;
  v_loc uuid;
  v_org2 uuid;
  u record;
begin
  for u in select * from (values
    (v_owner, 'owner@demo.test'), (v_manager, 'manager@demo.test'),
    (v_bartender, 'bartender@demo.test'), (v_other, 'other-org@demo.test')) as t(id, email)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('demo-password-123', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now());
  end loop;

  -- Organization owned by the demo owner.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_org := public.create_organization('Demo Cocktail Bar', 'Main bar', 'America/New_York', 'Olivia Owner');
  select id into v_loc from public.locations where org_id = v_org;
  insert into public.locations (org_id, name, timezone) values (v_org, 'Rooftop', 'America/New_York');
  insert into public.memberships (org_id, user_id, role, display_name) values
    (v_org, v_manager, 'manager', 'Max Manager'),
    (v_org, v_bartender, 'bartender', 'Bea Bartender');

  -- A second, unrelated tenant for isolation testing.
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  v_org2 := public.create_organization('Unrelated Tavern', 'Tavern', 'America/Chicago', 'Other Owner');
  perform set_config('request.jwt.claims', '', true);

  insert into public.suppliers (org_id, name) values (v_org, 'Harbor Beverage Co.'), (v_org, 'Green Market Produce');
  insert into public.inventory_areas (org_id, location_id, name, sort_order) values (v_org, v_loc, 'Back bar', 1), (v_org, v_loc, 'Storage', 2);

  insert into public.products (org_id, name, category, dimension, container_size_base, container_label, full_weight_g, empty_weight_g, default_count_method)
  select v_org, p.name, p.cat, 'volume', p.size, 'bottle', p.fw, p.ew, 'tenths'
  from (values
    ('House London Dry Gin', 'spirit', 1000, 1560.0, 620.0), ('House Bourbon', 'spirit', 1000, 1590.0, 640.0),
    ('Rye Whiskey', 'spirit', 750, 1250.0, 510.0), ('Blanco Tequila', 'spirit', 1000, 1580.0, 630.0),
    ('Light Rum', 'spirit', 1000, 1540.0, 600.0), ('Campari', 'liqueur', 1000, 1640.0, 600.0),
    ('Sweet Vermouth', 'liqueur', 1000, 1650.0, 610.0), ('Dry Vermouth', 'liqueur', 750, 1260.0, 500.0),
    ('Orange Liqueur', 'liqueur', 750, 1280.0, 520.0), ('Aromatic Bitters', 'mixer', 200, null, null)
  ) as p(name, cat, size, fw, ew);
  insert into public.products (org_id, name, category, dimension, container_size_base, container_label, default_count_method, usable_yield_pct)
  values (v_org, 'Fresh lime juice', 'juice', 'volume', 946, 'quart', 'measured', null),
         (v_org, 'Fresh lemon juice', 'juice', 'volume', 946, 'quart', 'measured', null),
         (v_org, 'Simple syrup (house)', 'syrup', 'volume', 1000, 'bottle', 'measured', null),
         (v_org, 'Granulated sugar', 'food', 'mass', 1814, 'bag', 'full_units', null),
         (v_org, 'Oranges', 'garnish', 'count', null, null, 'measured', 90),
         (v_org, 'Soda water', 'mixer', 'volume', 1000, 'bottle', 'full_units', null);

  -- Costs (per base unit) as of 30 days ago.
  insert into public.product_costs (org_id, product_id, cost_per_base, effective_at, source)
  select v_org, p.id, c.cpb, now() - interval '30 days', 'seed'
  from public.products p join (values
    ('House London Dry Gin', 0.0220), ('House Bourbon', 0.0260), ('Rye Whiskey', 0.0400), ('Blanco Tequila', 0.0280),
    ('Light Rum', 0.0180), ('Campari', 0.0300), ('Sweet Vermouth', 0.0180), ('Dry Vermouth', 0.0200),
    ('Orange Liqueur', 0.0330), ('Aromatic Bitters', 0.1300), ('Fresh lime juice', 0.0120), ('Fresh lemon juice', 0.0110),
    ('Granulated sugar', 0.0011), ('Oranges', 0.5500), ('Soda water', 0.0015)
  ) as c(name, cpb) on c.name = p.name where p.org_id = v_org;

  -- Opening stock 8 days ago.
  insert into public.stock_movements (org_id, location_id, product_id, type, qty_base, occurred_at, reason, source_type)
  select v_org, v_loc, p.id, 'opening_balance', coalesce(p.container_size_base, 20) * 6, now() - interval '8 days', 'Seed opening stock', 'manual'
  from public.products p where p.org_id = v_org;
end $$;

-- Copy classics and map ingredients as the owner, so recipes use the normal versioning path.
do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_org uuid := (select id from public.organizations where name = 'Demo Cocktail Bar');
  v_loc uuid := (select id from public.locations where name = 'Main bar' and org_id = (select id from public.organizations where name = 'Demo Cocktail Bar'));
  t text;
  r uuid;
  m record;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  foreach t in array array['negroni', 'daiquiri', 'margarita', 'old-fashioned', 'martini', 'simple-syrup'] loop
    r := public.copy_recipe_template(v_org, t, null);
  end loop;
  for m in select i.id ingredient_id, p.id product_id from public.ingredients i join (values
      ('London dry gin', 'House London Dry Gin'), ('Campari', 'Campari'), ('Sweet vermouth', 'Sweet Vermouth'), ('Orange', 'Oranges'),
      ('Light rum', 'Light Rum'), ('Lime juice', 'Fresh lime juice'), ('Simple syrup', 'Simple syrup (house)'),
      ('Blanco tequila', 'Blanco Tequila'), ('Orange liqueur', 'Orange Liqueur'), ('Bourbon or rye whiskey', 'House Bourbon'),
      ('Aromatic bitters', 'Aromatic Bitters'), ('Dry vermouth', 'Dry Vermouth'), ('Granulated sugar', 'Granulated sugar'), ('Water', 'Soda water')
    ) as x(ing, prod) on lower(i.name) = lower(x.ing) and i.org_id = v_org
    join public.products p on p.name = x.prod and p.org_id = v_org
  loop
    perform public.map_ingredient(v_org, v_loc, m.ingredient_id, m.product_id);
  end loop;
  for m in select id, name from public.recipes where org_id = v_org and kind = 'drink' loop
    perform public.set_menu_item(v_org, v_loc, m.id, case m.name when 'Negroni' then 14 when 'Martini' then 15 else 13 end, null, 'Classics', true);
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $$;
