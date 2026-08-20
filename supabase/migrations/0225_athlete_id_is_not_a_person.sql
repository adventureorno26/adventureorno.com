-- 0225 — `athlete_id` is not a person, and six days were erased because it was used as one.
--
-- The audit §3e Step 1 asked for, run. All SIX groups spanning more than an hour turn out
-- to be the same fault, and it is not "unreviewed" — it is wrong:
--
--   Josh  2023-08-02   6.04 mi at 10:27  +  6.02 mi at 22:39   merged, 12h12m apart
--   Josh  2023-08-01   6.02 mi at 15:29  +  6.12 mi at 21:40   merged,  6h11m apart
--   Erica 2022-12-04   Dickey Ridge 5.46 +  Shenandoah 5.97    merged,  2h28m apart
--   Erica 2025-10-04   ride 9.80        +  ride 10.50          merged,  1h34m apart
--   Josh  2023-05-30   3.89 mi          +  3.88 mi             merged,  1h29m apart
--   Erica 2020-05-12   ride 6.44        +  ride 6.08           merged,  1h28m apart
--
-- Every one is ONE PERSON going out twice in a day — the same loop in the morning and
-- again at night — recorded as "one outing recorded twice".
--
-- THE CAUSE. `dedupe_shared_outings` decides "these are two different people" with
--     a2.athlete_id is distinct from r.athlete_id
-- but `athlete_id` says which STRAVA ACCOUNT a row came from, not whose outing it is. A
-- file import has `athlete_id = NULL`, so her own file copy and her own Strava copy read as
-- two different athletes — and so does her file copy of a *different* run the same day.
-- `null is distinct from <id>` is TRUE, and that is the whole bug.
--
-- WHY IT MATTERS MORE THAN A DUPLICATE. Linking makes an outing count ONCE. Six wrong links
-- means **six days of hers and his were deleted from every total** — not visibly, not
-- recoverably by looking, just quietly absent. That is the failure mode this repository
-- keeps naming: nothing on screen looks wrong, and the number is smaller than the truth.
--
-- WHAT THIS DOES. Unlinks those six, which RESTORES six outings rather than removing
-- anything; and fixes the matcher to compare `owner_profile` — the column that actually
-- says whose outing it is — so it stops proposing a person as their own companion.
--
-- The unlink is scoped to same-owner groups spanning more than an hour. A genuine joint
-- outing is two people, and no outing in this database is one person recording twice with
-- an hour between the starts.

-- ---------------------------------------------------------------------------
-- 1. Undo the six.
-- ---------------------------------------------------------------------------
do $$
declare v_undone int;
begin
  create temp table _bad_groups on commit drop as
  select coalesce(a.shared_group_id, a.id) as grp
    from public.activities a
   where a.shared_group_id is not null
   group by 1
  having count(distinct a.owner_profile) = 1
     and max(a.start_date) - min(a.start_date) > interval '1 hour';

  update public.activities a
     set shared_group_id = null
    from _bad_groups b
   where coalesce(a.shared_group_id, a.id) = b.grp;
  get diagnostics v_undone = row_count;

  raise notice '0225: unlinked % activities across % wrongly-merged groups',
    v_undone, (select count(*) from _bad_groups);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Stop it happening: compare the OWNER, not the Strava account.
-- ---------------------------------------------------------------------------
create or replace function public.dedupe_shared_outings()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count int := 0; r record; m record;
begin
  for r in
    select id, owner_profile, lat, lng, distance, start_date, name
      from activities
     where shared_group_id is null and lat is not null and start_date is not null
  loop
    select a2.id, a2.shared_group_id, a2.name, a2.start_date into m
      from activities a2
     where a2.id <> r.id
       -- OWNER, not athlete_id. athlete_id names a Strava account; a file import has none,
       -- so `null is distinct from <id>` made a person their own companion (0225).
       and a2.owner_profile is not null and r.owner_profile is not null
       and a2.owner_profile <> r.owner_profile
       and a2.lat is not null and a2.start_date is not null
       and abs(extract(epoch from (a2.start_date - r.start_date))) < 1800
       and abs(a2.distance - r.distance) <= 0.15 * greatest(r.distance, 1)
       and (6371000*acos(least(1, cos(radians(r.lat))*cos(radians(a2.lat))
             *cos(radians(a2.lng - r.lng)) + sin(radians(r.lat))*sin(radians(a2.lat))))) < 200
     order by abs(extract(epoch from (a2.start_date - r.start_date)))
     limit 1;

    if m.id is not null then
      insert into public.suggestions
        (subject_type, subject_id, field, current_value, proposed_value,
         label, source, confidence, evidence, group_key, rank, status)
      select 'activity', r.id, 'shared_group_id',
             to_jsonb(null::uuid), to_jsonb(coalesce(m.shared_group_id, m.id)),
             format('The same outing as "%s" — %s min apart',
                    coalesce(m.name,'(unnamed)'),
                    round(abs(extract(epoch from (m.start_date - r.start_date)))/60.0, 1)),
             'dedupe', 0.6,
             jsonb_build_object('kept', m.id, 'dropped', r.id, 'reason', 'joint outing',
                                'kept_name', m.name, 'dropped_name', r.name,
                                'minutes_apart', round(abs(extract(epoch from (m.start_date - r.start_date)))/60.0, 1)),
             'dedupe:' || r.id::text, 1, 'pending'
      where not exists (
        select 1 from public.suggestions s
         where s.group_key = 'dedupe:' || r.id::text and s.status = 'pending');
      if found then v_count := v_count + 1; end if;
    end if;
  end loop;
  return v_count;
end $function$;

comment on function public.dedupe_shared_outings is
  'Proposes (never writes) that two DIFFERENT PEOPLE recorded one outing. Compares '
  'owner_profile, not athlete_id: athlete_id names a Strava account, a file import has '
  'none, and treating null as "a different athlete" merged six days of one person going '
  'out twice into six single outings (0225).';
