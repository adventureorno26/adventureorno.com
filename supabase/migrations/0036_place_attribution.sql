-- Attribute a place to whoever adds it; backfill existing to the owner (Erica).
alter table places alter column created_by set default auth.uid();
update places set created_by = (select id from profiles where role = 'owner' limit 1)
  where created_by is null;

-- Who "belongs" to each place: the adder, plus anyone with an activity or photo
-- there. Powers the "Just me / Just Josh / Both" map filter.
create or replace function place_people()
returns table (place_id uuid, profile_id uuid)
language sql stable security definer set search_path to public as $$
  select id, created_by from places where created_by is not null
  union
  select place_id, owner_profile from activities where place_id is not null and owner_profile is not null
  union
  select place_id, uploaded_by from photos where place_id is not null and uploaded_by is not null
$$;

-- People who can own things (for the filter's labels).
create or replace function map_people()
returns table (id uuid, display_name text, role text)
language sql stable security definer set search_path to public as $$
  select id, display_name, role from profiles where role in ('owner','editor') order by role desc;
$$;
