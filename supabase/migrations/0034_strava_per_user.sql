-- Per-user "is MY Strava connected" (each partner connects their own).
create or replace function strava_connected_me() returns boolean
language sql stable security definer set search_path to public as $$
  select exists (select 1 from strava_accounts where profile_id = auth.uid());
$$;

-- Who's connected → athlete_id + name, for attribution UI / the "just me" toggle.
create or replace function strava_athletes()
returns table (athlete_id bigint, profile_id uuid, display_name text)
language sql stable security definer set search_path to public as $$
  select sa.athlete_id, sa.profile_id, pr.display_name
    from strava_accounts sa left join profiles pr on pr.id = sa.profile_id;
$$;
