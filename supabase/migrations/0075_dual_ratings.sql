-- 0075_dual_ratings.sql — his/her ratings: each of you rates a place separately
-- (1-5 stars) so the card can show both + whether you agree. place_ratings is
-- one row per (place, person). Existing single places.rating is migrated to the
-- owner (Erica) so nothing is lost; the owner's rating still mirrors back to
-- places.rating for any legacy read.

create table if not exists public.place_ratings (
  place_id uuid not null references public.places(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (place_id, profile_id)
);
alter table public.place_ratings enable row level security;

drop policy if exists place_ratings_select on public.place_ratings;
create policy place_ratings_select on public.place_ratings
  for select using (public.is_member());
drop policy if exists place_ratings_write on public.place_ratings;
create policy place_ratings_write on public.place_ratings
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Seed from the existing single rating, attributed to the owner.
insert into public.place_ratings (place_id, profile_id, rating)
select p.id, (select id from public.profiles where role = 'owner'
              and coalesce(display_name,'') !~* '(test|bot)' limit 1), p.rating
from public.places p
where p.rating is not null
on conflict do nothing;

-- Set (or clear, when p_rating is null) the caller's own rating.
create or replace function public.set_my_rating(p_place uuid, p_rating smallint)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
  v_owner uuid := (select id from public.profiles where role='owner'
                   and coalesce(display_name,'') !~* '(test|bot)' limit 1);
begin
  if v_me is null or not public.is_member() then raise exception 'not authorized'; end if;
  if p_rating is null then
    delete from public.place_ratings where place_id = p_place and profile_id = v_me;
  else
    insert into public.place_ratings (place_id, profile_id, rating, updated_at)
      values (p_place, v_me, p_rating, now())
      on conflict (place_id, profile_id) do update set rating = excluded.rating, updated_at = now();
  end if;
  -- Keep the legacy single column mirroring the OWNER's rating.
  if v_me = v_owner then
    update public.places set rating = p_rating where id = p_place;
  end if;
end $$;
grant execute on function public.set_my_rating(uuid, smallint) to authenticated;

create or replace function public.place_ratings_for(p_place uuid)
returns table(profile_id uuid, rating smallint)
language sql stable security definer set search_path = public as $$
  select profile_id, rating from public.place_ratings where place_id = p_place;
$$;
grant execute on function public.place_ratings_for(uuid) to authenticated;
