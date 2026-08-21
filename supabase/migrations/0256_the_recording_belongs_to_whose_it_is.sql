-- 0256 — a recording's first participant is whose recording it is, not who typed it in.
--
-- Found while writing 0255's fixture: inserting an activity owned by HIM, while signed in as
-- HER, put HER on his run.
--
--     insert into activities (…, owner_profile = J0255, …)   -- signed in as E0255
--     → activity_profiles: E0255 / unknown
--
-- `default_participants` credits `auth.uid()` and never looks at `new.owner_profile` — which
-- `set_activity_owner` has already decided, in a BEFORE trigger, by the time this AFTER
-- trigger runs. So the row says "whoever was holding the keyboard was on this run", and that
-- is the 0039 shape: 46 of her activities on his stats, arrived at by an attribution nobody
-- stated.
--
-- MEASURED BEFORE FIXING, because "found a bug" and "found harm" are different claims:
--
--     activity_profiles rows crediting somebody other than the owner
--       written at the same moment as the activity (i.e. by this trigger) …… 0
--       written later, on their own (a backfill on 2026-08-14) …………………………… 12
--
-- **Nothing has been harmed.** Every path that inserts an activity today does so as its owner
-- — the file importer runs as the person uploading, and the Strava backfill runs with no
-- `auth.uid()` at all and falls through to the athlete lookup. The defect is latent, and it
-- is the kind that stays latent until the first time somebody adds an activity on another
-- person's behalf, which is a thing this app is now explicitly heading towards.
--
-- The twelve rows from 08-14 are NOT touched here. They are a different question, they were
-- made by a backfill rather than by this, and whether she was on those runs is hers to say.
--
-- The visit branch above already gets this right and says why: *"A person creating a visit is
-- saying they were there."* True — for a visit somebody makes by hand. A recording is not
-- made by hand; it is imported, and it belongs to whoever recorded it.
create or replace function public.default_participants()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_owner uuid;
begin
  if tg_table_name = 'visits' then
    -- A person creating a visit is saying they were there. Nobody else is implied.
    if auth.uid() is not null then
      insert into public.visit_profiles (visit_id, profile_id)
      values (new.id, auth.uid())
      on conflict do nothing;
    end if;
    -- No uid means a machine made it. §0.3: it waits for review rather than guessing.
    return null;
  end if;

  -- WHOSE RECORDING IT IS, in this order:
  --   1. the owner, already decided by `set_activity_owner` in the BEFORE trigger
  --   2. the athlete whose token fetched it — the only attribution Strava's terms allow
  --   3. the person doing the inserting, which is right only when they are the owner and
  --      is the last resort rather than the first
  v_owner := new.owner_profile;

  if v_owner is null and new.athlete_id is not null then
    select sa.profile_id into v_owner
      from public.strava_accounts sa where sa.athlete_id = new.athlete_id;
  end if;

  if v_owner is null then
    v_owner := auth.uid();
  end if;

  if v_owner is not null then
    insert into public.activity_profiles (activity_id, profile_id)
    values (new.id, v_owner)
    on conflict do nothing;
  end if;
  return null;
end $function$;

comment on function public.default_participants is
  'The first participant on a recording is WHOSE RECORDING IT IS — owner_profile, then the '
  'Strava athlete, and only then the person inserting it. It credited auth.uid() outright '
  'until 0256, so adding an activity on somebody else''s behalf put YOU on their run.';
