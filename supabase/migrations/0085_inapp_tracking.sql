-- In-app location tracking for BOTH people.
--
-- Until now location pings came only from Erica's Overland/Shortcut (one device
-- token) and had no person attribution. This adds:
--   * location_pings.profile_id — WHO the ping belongs to (so we can tell when
--     it's both of us together vs just one), backfilled to Erica for the history.
--   * an RLS insert policy so a signed-in person can record their OWN pings
--     straight from the web app (no device token needed → Josh can track too).
--   * tracking_status() — each person's last ping, for the Settings status card.

alter table public.location_pings
  add column if not exists profile_id uuid references public.profiles (id) on delete set null;

-- All existing pings are Erica's device history.
update public.location_pings
  set profile_id = 'ca941ae8-099d-4217-afa7-67a6cadb50f4'
  where profile_id is null;

create index if not exists pings_profile_idx
  on public.location_pings (profile_id, recorded_at desc);

-- A member may insert pings for THEMSELVES only (in-app tracking).
drop policy if exists pings_insert_own on public.location_pings;
create policy pings_insert_own on public.location_pings
  for insert with check (public.is_member() and profile_id = auth.uid());

-- Per-person tracking health for the Settings card.
create or replace function public.tracking_status()
returns table (profile_id uuid, display_name text, last_ping timestamptz, pings bigint)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, max(lp.recorded_at) as last_ping, count(lp.id) as pings
  from public.profiles p
  left join public.location_pings lp on lp.profile_id = p.id
  where p.role in ('owner', 'editor')
  group by p.id, p.display_name
  order by p.display_name;
$$;
grant execute on function public.tracking_status() to authenticated;
