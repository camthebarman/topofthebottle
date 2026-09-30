-- Starter library of classic recipes.
--
-- Instructions are written for this product. Proportions follow common,
-- long-published classic formulas (proportions are not creative expression);
-- they are starting points to adjust to the house spec, not authoritative
-- specifications. No text or photos are copied from any book or website.

insert into public.recipe_templates (id, name, kind, category, glassware, method, garnish, components, yield_servings, provenance) values
('old-fashioned', 'Old Fashioned', 'drink', 'Stirred', 'Rocks glass',
 'Stir whiskey, syrup and bitters with ice until well chilled. Strain over a large cube.',
 'Orange peel, expressed',
 '[{"ingredient":"Bourbon or rye whiskey","dimension":"volume","qty":60,"unit":"ml"},{"ingredient":"Simple syrup","dimension":"volume","qty":7.5,"unit":"ml"},{"ingredient":"Aromatic bitters","dimension":"volume","qty":2,"unit":"dash"},{"ingredient":"Orange","dimension":"count","qty":0.1,"unit":"each"}]',
 1, 'Table Zero starter library, 2026. Common classic proportions; adjust to your house spec.'),
('manhattan', 'Manhattan', 'drink', 'Stirred', 'Coupe',
 'Stir with ice until cold and silky. Strain into a chilled coupe.',
 'Brandied cherry',
 '[{"ingredient":"Rye whiskey","dimension":"volume","qty":60,"unit":"ml"},{"ingredient":"Sweet vermouth","dimension":"volume","qty":30,"unit":"ml"},{"ingredient":"Aromatic bitters","dimension":"volume","qty":2,"unit":"dash"},{"ingredient":"Cocktail cherry","dimension":"count","qty":1,"unit":"each"}]',
 1, 'Table Zero starter library, 2026. Common classic proportions; adjust to your house spec.'),
('martini', 'Martini', 'drink', 'Stirred', 'Coupe or Nick & Nora',
 'Stir gin and vermouth with ice until very cold. Strain into a chilled glass.',
 'Lemon twist or olive',
 '[{"ingredient":"London dry gin","dimension":"volume","qty":60,"unit":"ml"},{"ingredient":"Dry vermouth","dimension":"volume","qty":15,"unit":"ml"},{"ingredient":"Orange bitters","dimension":"volume","qty":1,"unit":"dash"}]',
 1, 'Table Zero starter library, 2026. Common classic proportions; ratio varies widely by house.'),
('margarita', 'Margarita', 'drink', 'Shaken', 'Rocks glass, optional salt rim',
 'Shake hard with ice. Strain over fresh ice.',
 'Lime wheel',
 '[{"ingredient":"Blanco tequila","dimension":"volume","qty":60,"unit":"ml"},{"ingredient":"Orange liqueur","dimension":"volume","qty":22.5,"unit":"ml"},{"ingredient":"Lime juice","dimension":"volume","qty":22.5,"unit":"ml"},{"ingredient":"Simple syrup","dimension":"volume","qty":5,"unit":"ml"}]',
 1, 'Table Zero starter library, 2026. Common classic proportions; adjust to your house spec.'),
('daiquiri', 'Daiquiri', 'drink', 'Shaken', 'Coupe',
 'Shake hard with ice. Double strain into a chilled coupe.',
 'Lime wheel (optional)',
 '[{"ingredient":"Light rum","dimension":"volume","qty":60,"unit":"ml"},{"ingredient":"Lime juice","dimension":"volume","qty":22.5,"unit":"ml"},{"ingredient":"Simple syrup","dimension":"volume","qty":15,"unit":"ml"}]',
 1, 'Table Zero starter library, 2026. Common classic proportions; adjust to your house spec.'),
('negroni', 'Negroni', 'drink', 'Built or stirred', 'Rocks glass',
 'Stir with ice. Strain over a large cube, or build in the glass and stir.',
 'Orange peel',
 '[{"ingredient":"London dry gin","dimension":"volume","qty":30,"unit":"ml"},{"ingredient":"Campari","dimension":"volume","qty":30,"unit":"ml"},{"ingredient":"Sweet vermouth","dimension":"volume","qty":30,"unit":"ml"},{"ingredient":"Orange","dimension":"count","qty":0.1,"unit":"each"}]',
 1, 'Table Zero starter library, 2026. Equal-parts classic formula.'),
('whiskey-sour', 'Whiskey Sour', 'drink', 'Shaken', 'Rocks glass',
 'If using egg white, shake without ice first, then shake again with ice. Strain over fresh ice.',
 'Aromatic bitters drops, cherry',
 '[{"ingredient":"Bourbon whiskey","dimension":"volume","qty":60,"unit":"ml"},{"ingredient":"Lemon juice","dimension":"volume","qty":22.5,"unit":"ml"},{"ingredient":"Simple syrup","dimension":"volume","qty":22.5,"unit":"ml"},{"ingredient":"Egg white","dimension":"volume","qty":15,"unit":"ml"}]',
 1, 'Table Zero starter library, 2026. Common classic proportions; egg white optional.'),
('mojito', 'Mojito', 'drink', 'Built', 'Highball',
 'Gently press mint with syrup and lime. Add rum and crushed ice, top with soda and stir to combine.',
 'Mint sprig',
 '[{"ingredient":"Light rum","dimension":"volume","qty":60,"unit":"ml"},{"ingredient":"Lime juice","dimension":"volume","qty":22.5,"unit":"ml"},{"ingredient":"Simple syrup","dimension":"volume","qty":15,"unit":"ml"},{"ingredient":"Mint leaves","dimension":"count","qty":8,"unit":"each"},{"ingredient":"Soda water","dimension":"volume","qty":60,"unit":"ml"}]',
 1, 'Table Zero starter library, 2026. Common classic proportions; adjust to your house spec.'),
('gimlet', 'Gimlet', 'drink', 'Shaken', 'Coupe',
 'Shake with ice and strain into a chilled coupe.',
 'Lime wheel',
 '[{"ingredient":"London dry gin","dimension":"volume","qty":60,"unit":"ml"},{"ingredient":"Lime juice","dimension":"volume","qty":22.5,"unit":"ml"},{"ingredient":"Simple syrup","dimension":"volume","qty":15,"unit":"ml"}]',
 1, 'Table Zero starter library, 2026. Fresh-lime version of a classic formula.'),
('paloma', 'Paloma', 'drink', 'Built', 'Highball, optional salt rim',
 'Build tequila and lime over ice, top with grapefruit soda and stir once.',
 'Grapefruit wedge',
 '[{"ingredient":"Blanco tequila","dimension":"volume","qty":60,"unit":"ml"},{"ingredient":"Lime juice","dimension":"volume","qty":15,"unit":"ml"},{"ingredient":"Grapefruit soda","dimension":"volume","qty":120,"unit":"ml"}]',
 1, 'Table Zero starter library, 2026. Common classic proportions.'),
('moscow-mule', 'Moscow Mule', 'drink', 'Built', 'Mug or highball',
 'Build over ice, top with ginger beer, stir once.',
 'Lime wedge',
 '[{"ingredient":"Vodka","dimension":"volume","qty":45,"unit":"ml"},{"ingredient":"Lime juice","dimension":"volume","qty":15,"unit":"ml"},{"ingredient":"Ginger beer","dimension":"volume","qty":120,"unit":"ml"}]',
 1, 'Table Zero starter library, 2026. Common classic proportions.'),
('french-75', 'French 75', 'drink', 'Shaken, topped', 'Flute',
 'Shake gin, lemon and syrup with ice. Strain into a flute and top with sparkling wine.',
 'Lemon twist',
 '[{"ingredient":"London dry gin","dimension":"volume","qty":30,"unit":"ml"},{"ingredient":"Lemon juice","dimension":"volume","qty":15,"unit":"ml"},{"ingredient":"Simple syrup","dimension":"volume","qty":15,"unit":"ml"},{"ingredient":"Sparkling wine","dimension":"volume","qty":60,"unit":"ml"}]',
 1, 'Table Zero starter library, 2026. Common classic proportions.'),
('sidecar', 'Sidecar', 'drink', 'Shaken', 'Coupe, optional sugar rim',
 'Shake with ice and strain into a chilled coupe.',
 'Orange twist',
 '[{"ingredient":"Cognac","dimension":"volume","qty":45,"unit":"ml"},{"ingredient":"Orange liqueur","dimension":"volume","qty":22.5,"unit":"ml"},{"ingredient":"Lemon juice","dimension":"volume","qty":22.5,"unit":"ml"}]',
 1, 'Table Zero starter library, 2026. Common classic proportions.'),
('spritz', 'Aperitivo Spritz', 'drink', 'Built', 'Wine glass',
 'Build over ice: sparkling wine, then the bitter aperitivo, then a splash of soda. Stir gently.',
 'Orange slice',
 '[{"ingredient":"Sparkling wine","dimension":"volume","qty":90,"unit":"ml"},{"ingredient":"Bitter aperitivo","dimension":"volume","qty":60,"unit":"ml"},{"ingredient":"Soda water","dimension":"volume","qty":30,"unit":"ml"}]',
 1, 'Table Zero starter library, 2026. Common 3-2-1 proportions.'),
('boulevardier', 'Boulevardier', 'drink', 'Stirred', 'Rocks glass or coupe',
 'Stir with ice until cold. Strain over a large cube or into a chilled coupe.',
 'Orange peel',
 '[{"ingredient":"Bourbon or rye whiskey","dimension":"volume","qty":45,"unit":"ml"},{"ingredient":"Campari","dimension":"volume","qty":30,"unit":"ml"},{"ingredient":"Sweet vermouth","dimension":"volume","qty":30,"unit":"ml"}]',
 1, 'Table Zero starter library, 2026. Common classic proportions.'),
('simple-syrup', 'Simple syrup (1:1)', 'prep', 'Syrup', null,
 'Stir equal weights of sugar and hot water until dissolved. Cool, label and date. Refrigerate.',
 null,
 '[{"ingredient":"Granulated sugar","dimension":"mass","qty":1000,"unit":"g"},{"ingredient":"Water","dimension":"volume","qty":1000,"unit":"ml"}]',
 1, 'Table Zero starter library, 2026. Yield is approximate; measure your batch and update the yield.'),
('rich-syrup', 'Rich syrup (2:1)', 'prep', 'Syrup', null,
 'Stir two parts sugar into one part hot water by weight until dissolved. Cool, label and date.',
 null,
 '[{"ingredient":"Granulated sugar","dimension":"mass","qty":1000,"unit":"g"},{"ingredient":"Water","dimension":"volume","qty":500,"unit":"ml"}]',
 1, 'Table Zero starter library, 2026. Yield is approximate; measure your batch and update the yield.')
on conflict (id) do nothing;

-- Prep templates yield a measured quantity, not servings.
alter table public.recipe_templates add column yield_qty numeric(14, 4), add column yield_unit text;
update public.recipe_templates set yield_qty = 1600, yield_unit = 'ml' where id = 'simple-syrup';
update public.recipe_templates set yield_qty = 1100, yield_unit = 'ml' where id = 'rich-syrup';

-- Copy a template into an organization: find or create each generic ingredient by name,
-- then save version 1 of a new recipe that the organization owns and can edit freely.
create or replace function public.copy_recipe_template(p_org uuid, p_template text, p_name text default null)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  t public.recipe_templates;
  c jsonb;
  v_ing uuid;
  v_components jsonb := '[]'::jsonb;
begin
  if not app.has_perm(p_org, 'recipes.edit') then
    raise exception 'You do not have permission to edit recipes' using errcode = '42501';
  end if;
  select * into t from public.recipe_templates where id = p_template;
  if t.id is null then
    raise exception 'Template not found' using errcode = '22023';
  end if;
  for c in select * from jsonb_array_elements(t.components) loop
    select id into v_ing from public.ingredients where org_id = p_org and lower(name) = lower(c ->> 'ingredient');
    if v_ing is null then
      insert into public.ingredients (org_id, name, dimension)
      values (p_org, c ->> 'ingredient', (c ->> 'dimension')::public.dimension) returning id into v_ing;
    end if;
    v_components := v_components || jsonb_build_array(jsonb_build_object('ingredient_id', v_ing, 'qty', c -> 'qty', 'unit', c ->> 'unit'));
  end loop;
  return public.save_recipe_version(
    p_org, null, coalesce(nullif(trim(p_name), ''), t.name), t.kind, t.category,
    case when t.yield_qty is null then t.yield_servings end, t.yield_qty, t.yield_unit, null,
    jsonb_build_object('glassware', t.glassware, 'method', t.method, 'garnish', t.garnish,
      'notes', 'Copied from the starter library. ' || t.provenance),
    v_components, null, t.id);
end $$;
grant execute on function public.copy_recipe_template to authenticated;
revoke execute on function public.copy_recipe_template from anon, public;

-- Ingredients are created by recipe editors too (not only catalog editors).
create policy "recipe editors add ingredients" on public.ingredients for insert to authenticated with check (app.has_perm(org_id, 'recipes.edit'));
