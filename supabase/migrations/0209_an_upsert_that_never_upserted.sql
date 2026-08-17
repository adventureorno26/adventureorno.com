-- 0209 — the provenance that was being written to nowhere, and the connection nobody registered.
--
-- TWO FAULTS, ONE SHAPE. Both were writes that reported success and did nothing.
--
-- 1. `recordStravaSource()` upserted into activity_sources with
--       onConflict: 'provider,connection_id,external_key'
--    while 0202's uniqueness is an EXPRESSION index —
--       (provider, coalesce(connection_id,'000…'), external_key) where external_key is not null
--    Postgres cannot infer an expression index from a bare column list, so EVERY call
--    returned `42P10: there is no unique or exclusion constraint matching the ON CONFLICT
--    specification`. The result was never inspected, so every failure looked like a success.
--
--    It was invisible because 0208 had backfilled the rows that existed at the time. The
--    25 activities imported AFTER 0208 simply had no provenance, and nothing on screen was
--    wrong. Found by counting, not by looking.
--
-- 2. `source_connections` — the registry that answers "whose account supplied this?" — has
--    only ever been written by 0202's own backfill. The OAuth callback stored tokens and
--    stopped. So when Josh connected on 2026-08-17 his 90 activities all landed with
--    connection_id NULL, while his tokens sat in strava_accounts the whole time.
--
-- FIXED IN THE CODE, not here: both writes now match-then-write and CHECK THE ERROR
-- (supabase/functions/_shared/strava.ts, supabase/functions/strava-auth/index.ts). This
-- migration repairs the rows those bugs left behind, and check-data-integrity.mjs gained a
-- check that counts activities from a connected account carrying no evidence — so the next
-- silent write failure is a number somebody sees rather than a gap nobody does.
--
-- The evidence rows themselves were NOT reconstructed by hand. Re-running the backfill
-- fetched each activity from Strava again, so device_name and origin are what Strava
-- actually says — 57 strava-app, 29 garmin, 4 genuinely unknown for Josh — rather than the
-- placeholder 'strava' that 0208 had to guess. Only the connection link is set here.

-- ---------------------------------------------------------------------------
-- Register every connected account that never got a connection row.
-- ---------------------------------------------------------------------------
insert into public.source_connections (provider, external_id, owner_profile, label, connected_at)
select 'strava', sa.athlete_id::text, sa.profile_id, 'Strava', sa.created_at
  from public.strava_accounts sa
 where sa.profile_id is not null
   and not exists (
     select 1 from public.source_connections c
      where c.provider = 'strava'
        and coalesce(c.external_id,'') = sa.athlete_id::text
        and c.owner_profile = sa.profile_id);

-- ---------------------------------------------------------------------------
-- Point the existing evidence at the connection it came through.
-- ---------------------------------------------------------------------------
-- Matched through the ACTIVITY's athlete_id rather than by guessing from the owner: an
-- activity says which Strava athlete recorded it, and that is the fact that identifies the
-- connection. 0208 already established that athlete_id implies the activity came from Strava.
update public.activity_sources s
   set connection_id = c.id
  from public.activities a
  join public.strava_accounts sa on sa.athlete_id = a.athlete_id
  join public.source_connections c
    on c.provider = 'strava'
   and coalesce(c.external_id,'') = sa.athlete_id::text
   and c.owner_profile = sa.profile_id
 where s.activity_id = a.id
   and s.provider = 'strava'
   and s.connection_id is null;

comment on table public.source_connections is
  'The accounts that supply activities, and whose they are. Written by the OAuth callback '
  'as well as by migration — a registry only a migration can write to is wrong the moment '
  'somebody new connects (0209).';
