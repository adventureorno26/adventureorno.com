-- 0165 — §0.8 phase 2 (ADD ONLY). Participants become rows instead of a null.
--
-- §0.3: "Replace null-as-data attribution with explicit rows."
--
-- WHAT NULL MEANS TODAY, and why it has to stop. `visits.solo_profile` is a single
-- nullable column doing two jobs: a profile id means "only this person", and NULL means
-- "both of us". That works for exactly two people and silently breaks the moment a third
-- is added — which is the whole point of the flok work. It also cannot express "Erica and
-- Mark but not Josh", and it makes every stats query carry a null special case.
--
-- THE BACKFILL, AND WHERE IT REFUSES TO GUESS (§0.3 again: "Put ambiguous rows into a
-- review table; never guess additional participants"):
--
--   solo_profile = a profile   → exactly that profile.        341 Erica + 47 Josh
--   solo_profile IS NULL       → the two real member profiles. 101 rows
--
-- "The two real members" is Erica (owner) and Josh (editor). Test Bot is an editor too
-- and is EXCLUDED by name — it is an automation account, and adding it to 101 of her
-- visits would be inventing history. If that assumption ever fails — a fourth member, a
-- renamed bot, anything other than exactly two real members — the migration puts the row
-- in `visit_participant_review` and moves on rather than guessing.
--
-- `solo_profile` is NOT removed and NOT made read-only here. Both stay in step during
-- the compatibility period; phase 8 removes the old one after parity is proven.
--
-- ROLLBACK: drop visit_profiles, visit_participant_review and the sync trigger.
-- solo_profile is untouched, so no attribution is lost.

begin;

create table if not exists public.visit_profiles (
  visit_id   uuid not null references public.visits(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (visit_id, profile_id)
);

comment on table public.visit_profiles is
  'Who was on a visit, as explicit rows (§0.3). Replaces solo_profile null-as-data. '
  'Account holders only; children, pets and companions stay in visit_people.';

create index if not exists visit_profiles_profile_idx on public.visit_profiles(profile_id);

-- Where the backfill puts anything it will not guess at.
create table if not exists public.visit_participant_review (
  visit_id   uuid primary key references public.visits(id) on delete cascade,
  reason     text not null,
  noted_at   timestamptz not null default now()
);

comment on table public.visit_participant_review is
  'Visits whose legacy attribution could not be translated safely. A human decides; '
  'nothing here is guessed (§0.3).';

alter table public.visit_profiles enable row level security;
alter table public.visit_participant_review enable row level security;

drop policy if exists visit_profiles_read on public.visit_profiles;
create policy visit_profiles_read on public.visit_profiles
  for select using (public.is_member());

drop policy if exists visit_review_read on public.visit_participant_review;
create policy visit_review_read on public.visit_participant_review
  for select using (public.is_owner());

revoke all on public.visit_profiles from public, anon;
revoke all on public.visit_participant_review from public, anon;
grant select on public.visit_profiles to authenticated;
grant select on public.visit_participant_review to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill. Idempotent — re-running adds nothing and re-reviews nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  v_members uuid[];
  v_count   int;
begin
  -- The real member profiles: owners and editors, excluding automation accounts.
  select array_agg(id order by created_at) into v_members
    from public.profiles
   where role in ('owner','editor')
     and coalesce(display_name,'') !~* '(test|bot)';
  v_count := coalesce(array_length(v_members, 1), 0);

  -- 1. A named person is unambiguous.
  insert into public.visit_profiles (visit_id, profile_id)
  select v.id, v.solo_profile from public.visits v
   where v.solo_profile is not null
  on conflict do nothing;

  -- 2. NULL meant "both" — only translate it when there are exactly two real members.
  if v_count = 2 then
    insert into public.visit_profiles (visit_id, profile_id)
    select v.id, m from public.visits v, unnest(v_members) m
     where v.solo_profile is null
    on conflict do nothing;
  else
    insert into public.visit_participant_review (visit_id, reason)
    select v.id,
           format('solo_profile was NULL ("both") but there are %s real member profiles, not 2', v_count)
      from public.visits v
     where v.solo_profile is null
    on conflict (visit_id) do nothing;
    raise notice 'PARTICIPANTS: % visit(s) sent for review — expected 2 real members, found %',
      (select count(*) from public.visits where solo_profile is null), v_count;
  end if;

  raise notice 'PARTICIPANTS: % row(s) written for % visit(s)',
    (select count(*) from public.visit_profiles),
    (select count(distinct visit_id) from public.visit_profiles);
end $$;

-- ---------------------------------------------------------------------------
-- Keep the two in step while both exist. Phase 8 removes solo_profile.
-- ---------------------------------------------------------------------------
create or replace function public.visits_sync_participants()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_members uuid[];
begin
  if tg_op = 'UPDATE' and new.solo_profile is not distinct from old.solo_profile then
    return new;
  end if;

  delete from public.visit_profiles where visit_id = new.id;

  if new.solo_profile is not null then
    insert into public.visit_profiles (visit_id, profile_id) values (new.id, new.solo_profile)
    on conflict do nothing;
  else
    select array_agg(id) into v_members from public.profiles
     where role in ('owner','editor') and coalesce(display_name,'') !~* '(test|bot)';
    if coalesce(array_length(v_members,1),0) = 2 then
      insert into public.visit_profiles (visit_id, profile_id)
      select new.id, m from unnest(v_members) m on conflict do nothing;
    else
      insert into public.visit_participant_review (visit_id, reason)
      values (new.id, 'solo_profile NULL with other than 2 real members')
      on conflict (visit_id) do nothing;
    end if;
  end if;
  return new;
end $function$;

revoke all on function public.visits_sync_participants() from public, anon, authenticated;

drop trigger if exists visits_sync_participants on public.visits;
create trigger visits_sync_participants
  after insert or update of solo_profile on public.visits
  for each row execute function public.visits_sync_participants();

commit;
