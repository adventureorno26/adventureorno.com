-- Manual "belongs to" attribution for a place (null = both) + a category-specific
-- favorite (wine/meal/beer).
alter table places add column if not exists solo_profile uuid references profiles(id);
alter table places add column if not exists favorite text;

-- People for the filter/attribution UI — exclude test/bot accounts.
create or replace function map_people()
returns table (id uuid, display_name text, role text)
language sql stable security definer set search_path to public as $$
  select id, display_name, role from profiles
   where role in ('owner','editor') and coalesce(display_name,'') !~* '(test|bot)'
   order by role desc, display_name;
$$;
