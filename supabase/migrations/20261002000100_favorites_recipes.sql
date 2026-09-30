-- Statblock: favorite foods, custom recipes, exact matches first in search
--
-- Favorites: a food plus the amount to log it at, one per food per user.
--
-- Recipes: ingredients (any visible food, by grams) and an optional cooked
-- weight and serving count. Each recipe is backed by a custom food whose
-- per-100 g macros and nutrients are the ingredients' totals divided by the
-- cooked weight (the ingredients' weight when none is given), so a serving
-- is logged by weight like any other food.
--
-- Logged food is scored from its food row at scoring time. So that editing a
-- recipe never rewrites days already logged, a change to a recipe whose food
-- has been logged moves the recipe to a new food row; the old one is retired
-- (hidden from search) and keeps its values. foods.recipe_id links every
-- version back to its recipe, so favorites and recents follow the recipe.

-- ---------------------------------------------------------------------------
-- Favorites
-- ---------------------------------------------------------------------------
create table public.food_favorites (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  food_id       bigint not null references public.foods (id),
  grams         numeric(8,2) not null check (grams > 0 and grams < 100000),
  portion_label text,
  created_at    timestamptz not null default now(),
  primary key (user_id, food_id)
);

alter table public.food_favorites enable row level security;

create policy "own: read" on public.food_favorites for select to authenticated
  using (user_id = auth.uid());
create policy "own: add" on public.food_favorites for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.foods f where f.id = food_id));
create policy "own: edit" on public.food_favorites for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.foods f where f.id = food_id));
create policy "own: delete" on public.food_favorites for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.food_favorites to authenticated;

-- ---------------------------------------------------------------------------
-- Recipes
-- ---------------------------------------------------------------------------
create table public.recipes (
  id            bigint generated always as identity primary key,
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 120),
  cooked_grams  numeric(9,2) check (cooked_grams > 0),   -- null: the ingredients' weight
  servings      numeric(6,2) check (servings > 0),       -- optional, adds a "1 serving" portion
  food_id       bigint,                                  -- the current version's food
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger recipes_touch before update on public.recipes
  for each row execute function public.touch_updated_at();

create index recipes_owner on public.recipes (owner_user_id);

alter table public.foods add column recipe_id bigint references public.recipes (id) on delete set null;
alter table public.recipes add constraint recipes_food_fk foreign key (food_id) references public.foods (id);
create index foods_recipe on public.foods (recipe_id) where recipe_id is not null;

create table public.recipe_ingredients (
  id            bigint generated always as identity primary key,
  recipe_id     bigint not null references public.recipes (id) on delete cascade,
  food_id       bigint not null references public.foods (id),
  grams         numeric(8,2) not null check (grams > 0 and grams < 100000),
  portion_label text,
  created_at    timestamptz not null default now()
);

create index recipe_ingredients_recipe on public.recipe_ingredients (recipe_id);

alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;

create policy "own: read" on public.recipes for select to authenticated
  using (owner_user_id = auth.uid());
create policy "own: add" on public.recipes for insert to authenticated
  with check (owner_user_id = auth.uid());
create policy "own: edit" on public.recipes for update to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create policy "own recipe: read" on public.recipe_ingredients for select to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_user_id = auth.uid()));
create policy "own recipe: write" on public.recipe_ingredients for all to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_user_id = auth.uid()))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_user_id = auth.uid())
              and exists (select 1 from public.foods f where f.id = food_id));

grant select, insert, update on public.recipes to authenticated;
grant select, insert, update, delete on public.recipe_ingredients to authenticated;

-- Rebuilds a recipe's food from its ingredients. Runs as the caller, so RLS
-- limits it to the caller's own recipes and custom foods.
create or replace function public.recompute_recipe(p_recipe_id bigint)
returns bigint
language plpgsql
as $$
declare
  r         public.recipes;
  v_food    bigint;
  v_total   numeric;
  v_count   integer;
  v_logged  boolean;
begin
  select * into r from public.recipes where id = p_recipe_id for update;
  if not found then
    raise exception 'recipe % not found', p_recipe_id;
  end if;

  select count(*), coalesce(sum(grams), 0) into v_count, v_total
  from public.recipe_ingredients where recipe_id = r.id;
  v_total := coalesce(r.cooked_grams, v_total);

  -- A logged version stays as it was; the recipe moves to a new food.
  v_food := r.food_id;
  v_logged := v_food is not null and exists (select 1 from public.food_log where food_id = v_food);
  if v_food is null or v_logged then
    insert into public.foods (source, owner_user_id, name, recipe_id)
    values ('custom', r.owner_user_id, r.name, r.id)
    returning id into v_food;
    if v_logged then
      update public.foods set retired_at = coalesce(retired_at, now()) where id = r.food_id;
      update public.food_favorites set food_id = v_food where food_id = r.food_id;
    end if;
    update public.recipes set food_id = v_food where id = r.id;
  end if;

  update public.foods f set
    name = r.name,
    kcal_100g = t.kcal, protein_100g = t.protein, carbs_100g = t.carbs,
    fat_100g = t.fat, fiber_100g = t.fiber,
    -- Hidden from search while empty or deleted.
    retired_at = case when v_count = 0 or r.deleted_at is not null then coalesce(f.retired_at, now()) end
  from (
    select
      round(sum(i.grams / 100 * coalesce(x.kcal_100g, 0)) / nullif(v_total, 0) * 100, 2) as kcal,
      round(sum(i.grams / 100 * coalesce(x.protein_100g, 0)) / nullif(v_total, 0) * 100, 2) as protein,
      round(sum(i.grams / 100 * coalesce(x.carbs_100g, 0)) / nullif(v_total, 0) * 100, 2) as carbs,
      round(sum(i.grams / 100 * coalesce(x.fat_100g, 0)) / nullif(v_total, 0) * 100, 2) as fat,
      round(sum(i.grams / 100 * coalesce(x.fiber_100g, 0)) / nullif(v_total, 0) * 100, 2) as fiber
    from public.recipe_ingredients i
    join public.foods x on x.id = i.food_id
    where i.recipe_id = r.id
  ) t
  where f.id = v_food;

  -- Full nutrient profile, for INT: every nutrient any ingredient reports.
  delete from public.food_nutrients where food_id = v_food;
  if v_total > 0 then
    insert into public.food_nutrients (food_id, nutrient_id, amount_100g)
    select v_food, fn.nutrient_id, sum(i.grams / 100 * fn.amount_100g) / v_total * 100
    from public.recipe_ingredients i
    join public.food_nutrients fn on fn.food_id = i.food_id
    where i.recipe_id = r.id
    group by fn.nutrient_id;
  end if;

  delete from public.food_portions where food_id = v_food;
  if v_total > 0 then
    if r.servings is not null then
      insert into public.food_portions (food_id, label, grams, sort)
      values (v_food, '1 serving', round(v_total / r.servings, 2), 0);
    end if;
    insert into public.food_portions (food_id, label, grams, sort)
    values (v_food, 'whole recipe', round(v_total, 2), 1);
  end if;

  return v_food;
end;
$$;

create or replace function public.create_recipe(p_name text)
returns bigint
language plpgsql
as $$
declare v_id bigint;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into public.recipes (name) values (trim(p_name)) returning id into v_id;
  perform public.recompute_recipe(v_id);
  return v_id;
end;
$$;

create or replace function public.update_recipe(
  p_recipe_id bigint, p_name text, p_cooked_grams numeric, p_servings numeric)
returns bigint
language plpgsql
as $$
begin
  update public.recipes
  set name = trim(p_name), cooked_grams = p_cooked_grams, servings = p_servings
  where id = p_recipe_id and deleted_at is null;
  if not found then
    raise exception 'recipe % not found', p_recipe_id;
  end if;
  return public.recompute_recipe(p_recipe_id);
end;
$$;

create or replace function public.add_recipe_ingredient(
  p_recipe_id bigint, p_food_id bigint, p_grams numeric, p_portion_label text default null)
returns bigint
language plpgsql
as $$
begin
  -- Recipes inside recipes wouldn't follow later edits, so they're not allowed.
  if exists (select 1 from public.foods where id = p_food_id and recipe_id is not null) then
    raise exception 'a recipe can''t be an ingredient';
  end if;
  insert into public.recipe_ingredients (recipe_id, food_id, grams, portion_label)
  values (p_recipe_id, p_food_id, p_grams, nullif(trim(p_portion_label), ''));
  return public.recompute_recipe(p_recipe_id);
end;
$$;

create or replace function public.update_recipe_ingredient(p_ingredient_id bigint, p_grams numeric)
returns bigint
language plpgsql
as $$
declare v_recipe bigint;
begin
  update public.recipe_ingredients set grams = p_grams, portion_label = null
  where id = p_ingredient_id returning recipe_id into v_recipe;
  if v_recipe is null then
    raise exception 'ingredient % not found', p_ingredient_id;
  end if;
  return public.recompute_recipe(v_recipe);
end;
$$;

create or replace function public.remove_recipe_ingredient(p_ingredient_id bigint)
returns bigint
language plpgsql
as $$
declare v_recipe bigint;
begin
  delete from public.recipe_ingredients where id = p_ingredient_id returning recipe_id into v_recipe;
  if v_recipe is null then
    raise exception 'ingredient % not found', p_ingredient_id;
  end if;
  return public.recompute_recipe(v_recipe);
end;
$$;

-- Deleting hides the recipe and its food from search; logged entries keep it.
create or replace function public.delete_recipe(p_recipe_id bigint)
returns void
language plpgsql
as $$
begin
  update public.recipes set deleted_at = now() where id = p_recipe_id and deleted_at is null;
  if not found then
    raise exception 'recipe % not found', p_recipe_id;
  end if;
  update public.foods set retired_at = coalesce(retired_at, now()) where recipe_id = p_recipe_id;
  delete from public.food_favorites where food_id in (select id from public.foods where recipe_id = p_recipe_id);
end;
$$;

revoke all on function public.recompute_recipe(bigint) from public, anon;
revoke all on function public.create_recipe(text) from public, anon;
revoke all on function public.update_recipe(bigint, text, numeric, numeric) from public, anon;
revoke all on function public.add_recipe_ingredient(bigint, bigint, numeric, text) from public, anon;
revoke all on function public.update_recipe_ingredient(bigint, numeric) from public, anon;
revoke all on function public.remove_recipe_ingredient(bigint) from public, anon;
revoke all on function public.delete_recipe(bigint) from public, anon;
grant execute on function public.recompute_recipe(bigint) to authenticated;
grant execute on function public.create_recipe(text) to authenticated;
grant execute on function public.update_recipe(bigint, text, numeric, numeric) to authenticated;
grant execute on function public.add_recipe_ingredient(bigint, bigint, numeric, text) to authenticated;
grant execute on function public.update_recipe_ingredient(bigint, numeric) to authenticated;
grant execute on function public.remove_recipe_ingredient(bigint) to authenticated;
grant execute on function public.delete_recipe(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Search: an exact name match first, then the user's own foods and recipes,
-- then whole foods, dishes and packaged foods.
-- ---------------------------------------------------------------------------
create or replace function public.search_foods(p_query text, p_limit integer default 25)
returns setof public.foods
language sql
stable
as $$
  select f.*
  from public.foods f
  where (f.search_tsv @@ websearch_to_tsquery('english', p_query)
         or f.name % p_query
         or f.name ilike '%' || trim(p_query) || '%')
    and f.retired_at is null
  order by lower(f.name) = lower(trim(p_query)) desc,
           f.source_rank,
           lower(f.name) like lower(trim(p_query)) || '%' desc,
           ts_rank(f.search_tsv, websearch_to_tsquery('english', p_query)) desc,
           similarity(f.name, p_query) desc,
           f.name
  limit greatest(1, least(p_limit, 100))
$$;
