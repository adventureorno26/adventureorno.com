-- 0050_custom_categories.sql — move categories/tags into the DB so Erica can add
-- her own in Settings and have them appear everywhere tags do (chips, menus, map
-- legend, review-group headings). Built-ins are seeded here with is_custom=false;
-- the app loads this table at boot and merges it over its hardcoded fallback.

create table if not exists public.place_categories (
  slug        text primary key,
  label       text not null,
  icon        text not null default '',       -- emoji (may be '' for containers, per Erica's no-icon rule)
  color       text not null default '#38bdf8',
  review      text not null,                   -- heading for this tag's reviews section
  sort_order  int  not null default 100,
  is_auto     boolean not null default false,  -- derived from Strava activity types
  is_container boolean not null default false, -- groups other places (trip/trail)
  is_custom   boolean not null default true,   -- user-added vs built-in
  created_at  timestamptz not null default now()
);

alter table public.place_categories enable row level security;
drop policy if exists place_categories_select on public.place_categories;
create policy place_categories_select on public.place_categories for select using (public.is_member());
drop policy if exists place_categories_write on public.place_categories;
create policy place_categories_write on public.place_categories for all
  using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());

-- Seed the built-ins (idempotent; keeps existing rows/edits on conflict).
insert into public.place_categories (slug,label,icon,color,review,sort_order,is_auto,is_container,is_custom) values
  ('hiking','Hiking','🥾','#22c55e','Hiking Trail Reviews',10,true,false,false),
  ('walking','Walking','🚶','#4ade80','Walking Trail Reviews',20,true,false,false),
  ('running','Running','🏃','#f97316','Running Trail Reviews',30,true,false,false),
  ('biking','Biking','🚴','#3b82f6','Biking Trail Reviews',40,true,false,false),
  ('jeeping','Jeeping','🚙','#b45309','Jeeping Trail Reviews',50,false,false,false),
  ('camping','Camping','🏕️','#10b981','Campsite Reviews',60,false,false,false),
  ('beach','Beach','🏖️','#06b6d4','Beach Reviews',70,false,false,false),
  ('sunrise','Sunrise','🌅','#fbbf24','Sunrise Spot Reviews',80,false,false,false),
  ('sunset','Sunset','🌇','#fb7185','Sunset Spot Reviews',90,false,false,false),
  ('dining','Restaurant','🍽️','#f59e0b','Restaurant Reviews',100,false,false,false),
  ('winery','Winery','🍷','#a855f7','Winery Reviews',110,false,false,false),
  ('brewery','Brewery','🍺','#ca8a04','Brewery Reviews',120,false,false,false),
  ('viewpoint','Viewpoint','⛰️','#64748b','Viewpoint Reviews',130,false,false,false),
  ('stay','Hotel','🏨','#6366f1','Hotel Reviews',140,false,false,false),
  ('trip','Trip','','#ec4899','Trip Notes',150,false,true,false),
  ('trail','Trail','','#0d9488','Trail Notes',160,false,true,false)
on conflict (slug) do nothing;

-- Add a custom tag from the app. Slugifies the label; review label defaults to
-- "<Label> Reviews". Returns the slug. Editor/owner only.
create or replace function public.add_place_category(
  p_label text, p_icon text default '', p_color text default '#38bdf8', p_review text default null
) returns text language plpgsql security definer set search_path = public as $$
declare s text;
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  s := regexp_replace(lower(trim(p_label)), '[^a-z0-9]+', '-', 'g');
  s := trim(both '-' from s);
  if s = '' then raise exception 'invalid label'; end if;
  insert into public.place_categories (slug,label,icon,color,review,sort_order,is_custom)
  values (s, trim(p_label), coalesce(p_icon,''), coalesce(p_color,'#38bdf8'),
          coalesce(nullif(trim(p_review),''), trim(p_label) || ' Reviews'),
          200, true)
  on conflict (slug) do update set
    label = excluded.label, icon = excluded.icon, color = excluded.color, review = excluded.review;
  return s;
end $$;
grant execute on function public.add_place_category(text,text,text,text) to authenticated;
