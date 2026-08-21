-- 0257 — the trigger writes the evidence it actually has.
--
-- 0256 made `default_participants` credit the recording's OWNER instead of whoever inserted
-- it. Correct, and it had a consequence I only found by looking at the row afterwards:
--
--     insert into activities (…)                       -- trigger writes (id, owner), evidence 'unknown'
--     insert into activity_profiles (…, 'own_recording')
--       on conflict do nothing                         -- …and this now does NOTHING
--
-- `ingest_activity` has always followed its insert with an explicit participant row carrying
-- `evidence = 'own_recording'`. Before 0256 that row was for a DIFFERENT profile than the
-- trigger's, so both landed. Now they are the same profile, the explicit one loses the
-- conflict, and the surviving row says `unknown`.
--
-- WHICH IS NOT COSMETIC. 0236 protects a participant row from being deleted by somebody
-- else's statement precisely by asking whether it evidences their own recording:
--
--     and coalesce(ap.evidence, '') <> 'own_recording'
--
-- So every activity imported after 0256 would have had an owner row that "Just me" could
-- delete — the thing 0236 exists to prevent, reintroduced by a fix to a different trigger a
-- day later. Nothing shipped: found before merging, on the same afternoon.
--
-- The trigger states what it knows rather than leaving a default to be corrected by whoever
-- inserts next. It IS the owner's own recording; that is the whole reason the row is being
-- written.
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
      insert into public.visit_profiles (visit_id, profile_id, claim_status, evidence, created_by)
      values (new.id, auth.uid(), 'accepted', 'own_statement', 'user')
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
    -- SAYING WHAT IT IS. `own_recording` is what 0236 keys the "not yours to delete"
    -- protection on, and a row left at the column default said `unknown` instead.
    insert into public.activity_profiles
      (activity_id, profile_id, claim_status, evidence, created_by)
    values (new.id, v_owner, 'accepted', 'own_recording', 'import')
    on conflict do nothing;
  end if;
  return null;
end $function$;

comment on function public.default_participants is
  'The first participant on a recording is WHOSE RECORDING IT IS — owner_profile, then the '
  'Strava athlete, and only then the person inserting it (0256) — recorded as '
  '`own_recording`, which is what 0236 keys the "not yours to delete" protection on (0257).';
