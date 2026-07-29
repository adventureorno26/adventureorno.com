-- 0076_wishes.sql — wishlist voting: each of you marks a bucket-list place
-- "want to go". When you both do, it's a "both want to go" — which powers the
-- date-night spinner (pick a random place you both want). place_wishes is one
-- row per (place, person who wants it).

create table if not exists public.place_wishes (
  place_id uuid not null references public.places(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (place_id, profile_id)
);
alter table public.place_wishes enable row level security;

drop policy if exists place_wishes_select on public.place_wishes;
create policy place_wishes_select on public.place_wishes
  for select using (public.is_member());
drop policy if exists place_wishes_write on public.place_wishes;
create policy place_wishes_write on public.place_wishes
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Toggle the caller's want on a place.
create or replace function public.toggle_wish(p_place uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null or not public.is_member() then raise exception 'not authorized'; end if;
  if exists (select 1 from public.place_wishes where place_id = p_place and profile_id = v_me) then
    delete from public.place_wishes where place_id = p_place and profile_id = v_me;
  else
    insert into public.place_wishes (place_id, profile_id) values (p_place, v_me)
      on conflict do nothing;
  end if;
end $$;
grant execute on function public.toggle_wish(uuid) to authenticated;

-- Wants per place: who wants it, total wanters, how many real members exist, and
-- whether EVERY member wants it (= "both want to go" for a 2-person household).
create or replace function public.wishes_overview()
returns table(place_id uuid, wanters uuid[], n integer, member_total integer, everyone boolean)
language sql stable security definer set search_path = public as $$
  with members as (
    select count(*)::int c from public.profiles
      where role in ('owner','editor') and coalesce(display_name,'') !~* '(test|bot)'
  )
  select w.place_id, array_agg(w.profile_id) as wanters, count(*)::int as n,
    (select c from members) as member_total,
    count(*) >= (select c from members) and (select c from members) >= 2 as everyone
  from public.place_wishes w
  group by w.place_id;
$$;
grant execute on function public.wishes_overview() to authenticated;

-- Date-night spinner: a random place you BOTH want to go. Optional radius (km)
-- from a point (e.g. home) to keep it local.
create or replace function public.date_night_pick(
  p_lat double precision default null, p_lng double precision default null,
  p_radius_km double precision default null
) returns uuid language sql volatile security definer set search_path = public as $$
  with mem as (
    select count(*)::int c from public.profiles
      where role in ('owner','editor') and coalesce(display_name,'') !~* '(test|bot)'
  ),
  bothwant as (
    select w.place_id from public.place_wishes w
    group by w.place_id
    having count(*) >= (select c from mem) and (select c from mem) >= 2
  )
  select b.place_id from bothwant b
  join public.places p on p.id = b.place_id
  where p_lat is null or p_lng is null or p_radius_km is null
     or (p.lat is not null and st_dwithin(
           p.geom, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_radius_km * 1000))
  order by random()
  limit 1;
$$;
grant execute on function public.date_night_pick(double precision, double precision, double precision) to authenticated;
