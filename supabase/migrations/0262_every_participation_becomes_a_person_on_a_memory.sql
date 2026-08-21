-- 0262 — every participation becomes a person on a memory. Step one of two.
--
-- §8b-i calls `activity_profiles` and `visit_profiles` *"migration inputs, not the final
-- commercial API"*. This is the migration, and it is deliberately split:
--
--   THIS ONE   registers a subject for every activity and visit, and copies all 1,278
--              participations into `memory_people` with their provenance intact. Nothing
--              reads the new rows yet; the two old tables remain authoritative.
--   THE NEXT   re-runs this backfill, then turns those tables into views over the new store
--              so the twenty-four readers keep working, and retires them as an API.
--
-- WHY SPLIT AT ALL, when a mirror is the defect this codebase keeps having. Because the
-- alternative is one change that moves 1,278 rows, redirects fourteen writers and repoints
-- twenty-four readers at once, against a database she uses daily — and because the mapping
-- below is the part most likely to be wrong, and it is far better checked against real data
-- than reasoned about. The window is named, it is short, and the next migration begins by
-- re-running this so anything written in between is carried over. **If that second step does
-- not happen, this one is a mirror and should be reverted, not left.**
--
-- WHAT A PROFILE MAPS TO. A person with an account is one person however many contact lists
-- they appear in, so participation is recorded against their OWN self-contact — the `people`
-- row where owner and linked profile are the same — rather than against whichever household
-- member happened to tag them. That keeps exactly one row per (memory, account) and makes the
-- compatibility views in the next step exact rather than DISTINCT-ed.
--
-- Every profile that has ever been on anything already has one (0248 seeded the household),
-- but a fresh database does not, and neither will the next person to sign up — so a trigger
-- makes it part of having an account rather than something a migration did once.
--
-- ONE WORD FOR ONE IDEA, again. `activity_profiles.claim_status` says **rejected**;
-- `tag_claims.status` says **declined**; they mean the same thing and the disagreement is how
-- 0228 came to gate sharing on a value that could never appear. The new store says `declined`
-- and nothing else.

-- ---------------------------------------------------------------------------
-- 1. The provenance the old tables carry and the new one did not.
-- ---------------------------------------------------------------------------
-- `evidence` is what 0236 and 0240 key their "not yours to delete" protections on, and
-- `rule_id` is what `respond_to_tag` scopes a decline by. Migrating without them would move
-- the rows and leave the rules behind.
alter table public.memory_people
  add column if not exists evidence   text not null default 'unknown',
  add column if not exists created_by text not null default 'unknown',
  add column if not exists rule_id    uuid references public.tagging_rules(id) on delete set null;

comment on column public.memory_people.evidence is
  'How this participation came to be recorded — own_recording, own_statement, owner_asserted, '
  'tagged_and_accepted, unknown. 0236/0240 key "not yours to delete" on own_recording, so it '
  'has to travel with the row (0262).';

-- ---------------------------------------------------------------------------
-- 2. Having an account makes you a person.
-- ---------------------------------------------------------------------------
create or replace function public.profile_self_person()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.people (display_name, kind, owner_profile, linked_profile, favourite, created_by)
  values (coalesce(nullif(btrim(new.display_name), ''), 'Someone'), 'person', new.id, new.id, true, new.id)
  on conflict do nothing;
  return null;
end $function$;

drop trigger if exists profiles_self_person on public.profiles;
create trigger profiles_self_person after insert on public.profiles
  for each row execute function public.profile_self_person();

comment on function public.profile_self_person is
  'A person with an account is a person. Their own contact row is what participation is '
  'recorded against, so it is created with the account rather than by a migration that ran '
  'once (0262).';

-- Existing accounts, including any that were created before 0248's seed.
insert into public.people (display_name, kind, owner_profile, linked_profile, favourite, created_by)
select coalesce(nullif(btrim(p.display_name), ''), 'Someone'), 'person', p.id, p.id, true, p.id
  from public.profiles p
 where not exists (select 1 from public.people pe
                    where pe.owner_profile = p.id and pe.linked_profile = p.id
                      and pe.deleted_at is null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. A subject for everything that has people on it.
-- ---------------------------------------------------------------------------
insert into public.memory_subjects (kind, owner_profile, activity_id)
select 'outing', coalesce(a.owner_profile, (select id from public.profiles where role = 'owner' limit 1)), a.id
  from public.activities a
 where a.owner_profile is not null
    or exists (select 1 from public.activity_profiles ap where ap.activity_id = a.id)
on conflict (activity_id) do nothing;

insert into public.memory_subjects (kind, owner_profile, visit_id)
select 'visit',
       coalesce((select vp.profile_id from public.visit_profiles vp
                  where vp.visit_id = v.id order by vp.created_at limit 1),
                (select id from public.profiles where role = 'owner' limit 1)),
       v.id
  from public.visits v
on conflict (visit_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. The participations themselves.
-- ---------------------------------------------------------------------------
with self_person as (
  select pe.linked_profile as profile_id, pe.id as person_id
    from public.people pe
   where pe.owner_profile = pe.linked_profile and pe.deleted_at is null)
insert into public.memory_people
  (subject_id, person_id, tagged_by, participation_status, verification_status, sharing_status,
   evidence, created_by, rule_id, decided_by, decided_at, created_at)
select s.id, sp.person_id, ap.asserted_by,
       case coalesce(ap.claim_status, 'accepted')
         when 'proposed' then 'proposed'
         when 'rejected' then 'declined'
         else 'accepted' end,
       case when coalesce(ap.evidence, '') in ('own_recording','own_statement','tagged_and_accepted')
            then 'confirmed_by_person' else 'unverified' end,
       'not_shared',
       coalesce(ap.evidence, 'unknown'), coalesce(ap.created_by, 'unknown'), ap.rule_id,
       ap.decided_by, ap.decided_at, ap.created_at
  from public.activity_profiles ap
  join public.memory_subjects s on s.activity_id = ap.activity_id
  join self_person sp on sp.profile_id = ap.profile_id
on conflict (subject_id, person_id) do nothing;

with self_person as (
  select pe.linked_profile as profile_id, pe.id as person_id
    from public.people pe
   where pe.owner_profile = pe.linked_profile and pe.deleted_at is null)
insert into public.memory_people
  (subject_id, person_id, tagged_by, participation_status, verification_status, sharing_status,
   evidence, created_by, rule_id, decided_by, decided_at, created_at)
select s.id, sp.person_id, vp.asserted_by,
       case coalesce(vp.claim_status, 'accepted')
         when 'proposed' then 'proposed'
         when 'rejected' then 'declined'
         else 'accepted' end,
       case when coalesce(vp.evidence, '') in ('own_recording','own_statement','tagged_and_accepted')
            then 'confirmed_by_person' else 'unverified' end,
       'not_shared',
       coalesce(vp.evidence, 'unknown'), coalesce(vp.created_by, 'unknown'), vp.rule_id,
       vp.decided_by, vp.decided_at, vp.created_at
  from public.visit_profiles vp
  join public.memory_subjects s on s.visit_id = vp.visit_id
  join self_person sp on sp.profile_id = vp.profile_id
on conflict (subject_id, person_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. And it has to be exact, or it is not a migration.
-- ---------------------------------------------------------------------------
do $$
declare v_missing int; v_extra int; v_status int;
begin
  select count(*) into v_missing
    from public.activity_profiles ap
    join public.people sp on sp.owner_profile = ap.profile_id and sp.linked_profile = ap.profile_id
   where not exists (select 1 from public.memory_people mp
                     join public.memory_subjects s on s.id = mp.subject_id
                    where s.activity_id = ap.activity_id and mp.person_id = sp.id);
  if v_missing > 0 then
    raise exception 'BACKFILL INCOMPLETE: % outing participations did not arrive', v_missing;
  end if;

  select count(*) into v_missing
    from public.visit_profiles vp
    join public.people sp on sp.owner_profile = vp.profile_id and sp.linked_profile = vp.profile_id
   where not exists (select 1 from public.memory_people mp
                     join public.memory_subjects s on s.id = mp.subject_id
                    where s.visit_id = vp.visit_id and mp.person_id = sp.id);
  if v_missing > 0 then
    raise exception 'BACKFILL INCOMPLETE: % visit participations did not arrive', v_missing;
  end if;

  -- Nothing invented: every outing/visit row in the new store must answer to an old one.
  select count(*) into v_extra
    from public.memory_people mp
    join public.memory_subjects s on s.id = mp.subject_id
    join public.people pe on pe.id = mp.person_id
   where s.kind in ('outing','visit')
     and pe.linked_profile is not null
     and not exists (select 1 from public.activity_profiles ap
                      where ap.activity_id = s.activity_id and ap.profile_id = pe.linked_profile)
     and not exists (select 1 from public.visit_profiles vp
                      where vp.visit_id = s.visit_id and vp.profile_id = pe.linked_profile);
  if v_extra > 0 then
    raise exception 'BACKFILL INVENTED % participations that are in no source table', v_extra;
  end if;

  -- And the answer each row gives must be the same answer.
  select count(*) into v_status
    from public.activity_profiles ap
    join public.people sp on sp.owner_profile = ap.profile_id and sp.linked_profile = ap.profile_id
    join public.memory_subjects s on s.activity_id = ap.activity_id
    join public.memory_people mp on mp.subject_id = s.id and mp.person_id = sp.id
   where mp.participation_status <> case coalesce(ap.claim_status,'accepted')
                                      when 'proposed' then 'proposed'
                                      when 'rejected' then 'declined'
                                      else 'accepted' end;
  if v_status > 0 then
    raise exception 'BACKFILL CHANGED % answers on the way across', v_status;
  end if;

  raise notice '0262: % people on memories after the backfill',
    (select count(*) from public.memory_people);
end $$;
