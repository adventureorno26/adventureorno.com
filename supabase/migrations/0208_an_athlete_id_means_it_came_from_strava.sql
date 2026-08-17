-- 0208 — anything carrying an athlete_id IS Strava-origin, and must say so on the way in.
--
-- FOUND THE MOMENT JOSH'S HISTORY LANDED, 2026-08-17. He connected, the backfill pulled 65
-- activities, they were correctly owned by him — and Erica could see every one of them.
--
-- The Strava rule keys on `original_source = 'strava'`. `0193` set that for the rows that
-- existed at the time, as a ONE-OFF UPDATE, and nothing has set it since: the column
-- defaults to 'unknown', and neither the webhook nor the backfill passes it. So every
-- Strava activity imported after 0193 arrived marked 'unknown', and an activity that does
-- not admit where it came from is an activity the rule cannot protect.
--
-- It is the same failure as the leak 0200 closed, pointed the other way, and it appeared
-- within minutes of a second athlete existing — because until today only one person had
-- Strava, so nothing that person owned could leak TO anyone.
--
-- THE FIX IS AT THE DOOR, NOT IN A BACKFILL. A one-off UPDATE is what 0193 did and it
-- lasted exactly until the next import. An `athlete_id` means Strava fetched it; that is
-- true of every row that will ever have one, so the place to say it is the insert.
create or replace function public.set_activity_owner()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.owner_profile is null and new.athlete_id is not null then
    new.owner_profile := (select profile_id from strava_accounts where athlete_id = new.athlete_id);
  end if;

  -- An athlete_id can only have come from a Strava fetch. Marking it here means the
  -- webhook, the backfill and anything written later are all covered without each of them
  -- having to remember — which is precisely what they did not do.
  if new.athlete_id is not null
     and coalesce(nullif(new.original_source, ''), 'unknown') = 'unknown' then
    new.original_source := 'strava';
  end if;
  return new;
end $function$;

-- And the rows already in, including the 65 that arrived this evening.
update public.activities
   set original_source = 'strava'
 where athlete_id is not null
   and coalesce(nullif(original_source, ''), 'unknown') = 'unknown';

-- Their evidence rows too: 0202 backfilled provenance from what was known THEN, and these
-- did not exist yet.
insert into public.activity_sources
  (activity_id, connection_id, provider, origin, external_key, is_primary, confidence)
select a.id,
       (select c.id from public.source_connections c
         where c.provider='strava' and c.external_id = a.athlete_id::text limit 1),
       'strava', 'strava', a.strava_id::text, true, 'exact'
  from public.activities a
 where a.athlete_id is not null
   and not exists (select 1 from public.activity_sources s where s.activity_id = a.id)
on conflict do nothing;
