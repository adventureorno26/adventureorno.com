-- 0201 — tagging becomes DATA: a claim someone makes, that someone else accepts.
--
-- Erica, 2026-08-17: "The whole point of this app is to be able to tag and share those
-- memories. When I originally uploaded my Strava I told you to add him on all activities
-- since December 21, 2025 except Richmond Yuengling marathon."
--
-- THAT SENTENCE IS THE SPECIFICATION. A rule, over a date range, with a named exception,
-- for another person to see and share. Every part of it was real; what was missing is that
-- it was implemented as `update activities set also_profiles = … where start_date >=
-- '2025-12-21'` inside migration 0039 — a claim with nowhere to live. It could not be
-- listed, amended, revoked, or told apart from a guess, and its exception survived only
-- because somebody remembered to apply it by hand.
--
-- Her assertion was never the problem. An owner saying who was with her is the best
-- evidence this system will ever have: better than a GPS coincidence, better than any
-- matcher. It just needed somewhere to be written down AS an assertion.
--
-- WHY PROPOSALS DO NOT GO IN `activity_profiles`. §A: "You tag someone … They are asked to
-- verify it before it is added." Before it is ADDED. If a proposed tag were written into
-- the participant tables, every reader would immediately count it, and proposing would BE
-- applying — the exact thing §2 forbids. So claims live in `tag_claims`, and accepting one
-- is what writes the participant row. Nothing that reads participants has to change, and a
-- proposal cannot masquerade as a fact.

-- ---------------------------------------------------------------------------
-- 1. A rule is a bulk claim, stored where it can be seen and undone.
-- ---------------------------------------------------------------------------
create table if not exists public.tagging_rules (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid not null references public.profiles(id) on delete restrict,
  subject_profile uuid not null references public.profiles(id) on delete cascade,
  from_date       date,
  to_date         date,
  activity_types  text[] not null default '{}',
  note            text,
  status          text not null default 'active',
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_by      uuid references public.profiles(id) on delete set null,
  constraint tagging_rules_status_ck check (status in ('active','revoked'))
);

comment on table public.tagging_rules is
  'A person saying "these outings were also theirs", over a range, once. 0039 did exactly '
  'this as a hardcoded date inside a migration; here it is a row, so it can be listed, '
  'amended, revoked, and distinguished from a guess.';

-- The exception travels WITH the rule. Erica named one in the same breath as the rule, and
-- the only reason it survived 0039 is that a person remembered it.
create table if not exists public.tagging_rule_exceptions (
  rule_id      uuid not null references public.tagging_rules(id) on delete cascade,
  subject_kind text not null,
  subject_id   uuid not null,
  reason       text,
  created_at   timestamptz not null default now(),
  primary key (rule_id, subject_kind, subject_id),
  constraint tagging_rule_exceptions_kind_ck check (subject_kind in ('activity','visit'))
);

-- ---------------------------------------------------------------------------
-- 2. The claim itself — proposed, accepted, declined, retracted.
-- ---------------------------------------------------------------------------
create table if not exists public.tag_claims (
  id            uuid primary key default gen_random_uuid(),
  rule_id       uuid references public.tagging_rules(id) on delete set null,
  subject_kind  text not null,
  subject_id    uuid not null,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  asserted_by   uuid not null references public.profiles(id) on delete restrict,
  status        text not null default 'proposed',
  decided_at    timestamptz,
  note          text,
  created_at    timestamptz not null default now(),
  constraint tag_claims_kind_ck   check (subject_kind in ('activity','visit')),
  constraint tag_claims_status_ck check (status in ('proposed','accepted','declined','retracted','accepted_legacy'))
);

create unique index if not exists tag_claims_one_per_subject
  on public.tag_claims (subject_kind, subject_id, profile_id);
create index if not exists tag_claims_for_person
  on public.tag_claims (profile_id, status);
create index if not exists tag_claims_by_rule on public.tag_claims (rule_id);

comment on table public.tag_claims is
  'A tag BEFORE it is a fact. §A: the tagged person is asked to verify it before it is '
  'added, so proposals live here and accepting is what writes activity_profiles / '
  'visit_profiles. A proposal in the participant tables would be counted by every reader, '
  'which would make proposing identical to applying.';

-- ---------------------------------------------------------------------------
-- 3. Participants say how they came to be believed.
-- ---------------------------------------------------------------------------
-- activity_profiles got claim_status/evidence/created_by in 0200; visit_profiles matches
-- it here, and both gain the provenance of the decision.
alter table public.visit_profiles
  add column if not exists claim_status text not null default 'accepted',
  add column if not exists evidence     text not null default 'unknown',
  add column if not exists created_by   text not null default 'unknown';

alter table public.activity_profiles
  add column if not exists asserted_by uuid references public.profiles(id) on delete set null,
  add column if not exists decided_by  uuid references public.profiles(id) on delete set null,
  add column if not exists decided_at  timestamptz,
  add column if not exists rule_id     uuid references public.tagging_rules(id) on delete set null;

alter table public.visit_profiles
  add column if not exists asserted_by uuid references public.profiles(id) on delete set null,
  add column if not exists decided_by  uuid references public.profiles(id) on delete set null,
  add column if not exists decided_at  timestamptz,
  add column if not exists rule_id     uuid references public.tagging_rules(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. Making, answering and revoking claims.
-- ---------------------------------------------------------------------------
-- Proposing a rule: writes the rule, then one claim per matching activity, skipping
-- anything excepted and anything the person is already on.
create or replace function public.propose_tagging_rule(
  p_subject uuid, p_from date, p_to date default null,
  p_types text[] default '{}', p_note text default null,
  p_except uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); v_rule uuid; v_n int;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_subject = v_me then
    raise exception 'a rule tags someone else; you are already on your own outings';
  end if;

  insert into public.tagging_rules (created_by, subject_profile, from_date, to_date, activity_types, note)
  values (v_me, p_subject, p_from, p_to, coalesce(p_types,'{}'), p_note)
  returning id into v_rule;

  insert into public.tagging_rule_exceptions (rule_id, subject_kind, subject_id, reason)
  select v_rule, 'activity', x, 'named when the rule was made'
    from unnest(coalesce(p_except,'{}')) x
  on conflict do nothing;

  -- READS THE VIEW, NOT THE TABLE. It only ever touches the caller's own activities
  -- (`owner_profile = v_me`), so the two are equivalent here — but going through
  -- `visible_activities` means this function never becomes the exception that erodes the
  -- rule. `the_readers_stay_enforced` caught the first draft doing it the other way, which
  -- is the guard doing its job on the person who wrote it.
  insert into public.tag_claims (rule_id, subject_kind, subject_id, profile_id, asserted_by, status)
  select v_rule, 'activity', a.id, p_subject, v_me, 'proposed'
    from public.visible_activities a
   where a.owner_profile = v_me
     and (p_from is null or coalesce(a.local_date, a.start_date::date) >= p_from)
     and (p_to   is null or coalesce(a.local_date, a.start_date::date) <= p_to)
     and (coalesce(array_length(p_types,1),0) = 0 or a.type = any(p_types))
     and not exists (select 1 from public.tagging_rule_exceptions e
                      where e.rule_id = v_rule and e.subject_kind='activity' and e.subject_id = a.id)
     and not exists (select 1 from public.activity_profiles ap
                      where ap.activity_id = a.id and ap.profile_id = p_subject)
  on conflict (subject_kind, subject_id, profile_id) do nothing;

  get diagnostics v_n = row_count;
  update public.tagging_rules set note = coalesce(note,'') || format(' [proposed %s]', v_n)
   where id = v_rule;
  return v_rule;
end $function$;

-- Answering one. ONLY THE TAGGED PERSON MAY ANSWER — §A is about their consent, so the
-- asserter accepting on their behalf would empty the rule of meaning.
create or replace function public.respond_to_tag(p_claim uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c record;
begin
  select * into c from public.tag_claims where id = p_claim;
  if c is null then raise exception 'no such claim'; end if;
  if c.profile_id <> auth.uid() then
    raise exception 'only the tagged person can answer a tag' using errcode = '42501';
  end if;
  if c.status not in ('proposed') then
    raise exception 'that claim is already %', c.status;
  end if;

  update public.tag_claims
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_at = now()
   where id = p_claim;

  if p_accept then
    if c.subject_kind = 'activity' then
      insert into public.activity_profiles
        (activity_id, profile_id, claim_status, evidence, created_by, asserted_by, decided_by, decided_at, rule_id)
      values (c.subject_id, c.profile_id, 'accepted', 'tagged_and_accepted', 'user',
              c.asserted_by, c.profile_id, now(), c.rule_id)
      on conflict do nothing;
    else
      insert into public.visit_profiles
        (visit_id, profile_id, claim_status, evidence, created_by, asserted_by, decided_by, decided_at, rule_id)
      values (c.subject_id, c.profile_id, 'accepted', 'tagged_and_accepted', 'user',
              c.asserted_by, c.profile_id, now(), c.rule_id)
      on conflict do nothing;
    end if;
  end if;
end $function$;

-- Revoking a rule takes back what it CLAIMED, and leaves what was individually accepted.
-- An acceptance is the other person's decision; the asserter does not get to undo it.
create or replace function public.revoke_tagging_rule(p_rule uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); v_n int;
begin
  if not exists (select 1 from public.tagging_rules where id = p_rule and created_by = v_me) then
    raise exception 'only the person who made a rule can revoke it' using errcode = '42501';
  end if;

  update public.tagging_rules
     set status='revoked', revoked_at=now(), revoked_by=v_me where id=p_rule;

  update public.tag_claims set status='retracted', decided_at=now()
   where rule_id = p_rule and status = 'proposed';
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

revoke all on function public.propose_tagging_rule(uuid,date,date,text[],text,uuid[]) from public, anon;
revoke all on function public.respond_to_tag(uuid, boolean) from public, anon;
revoke all on function public.revoke_tagging_rule(uuid) from public, anon;
grant execute on function public.propose_tagging_rule(uuid,date,date,text[],text,uuid[]) to authenticated;
grant execute on function public.respond_to_tag(uuid, boolean) to authenticated;
grant execute on function public.revoke_tagging_rule(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS. Members read; only the RPCs above write.
-- ---------------------------------------------------------------------------
alter table public.tagging_rules            enable row level security;
alter table public.tagging_rule_exceptions  enable row level security;
alter table public.tag_claims               enable row level security;

drop policy if exists tagging_rules_select on public.tagging_rules;
create policy tagging_rules_select on public.tagging_rules for select using (public.is_member());
drop policy if exists tagging_rule_exceptions_select on public.tagging_rule_exceptions;
create policy tagging_rule_exceptions_select on public.tagging_rule_exceptions for select using (public.is_member());
drop policy if exists tag_claims_select on public.tag_claims;
create policy tag_claims_select on public.tag_claims for select using (public.is_member());

revoke insert, update, delete on public.tagging_rules           from anon, authenticated;
revoke insert, update, delete on public.tagging_rule_exceptions from anon, authenticated;
revoke insert, update, delete on public.tag_claims              from anon, authenticated;
revoke all on public.tagging_rules, public.tagging_rule_exceptions, public.tag_claims from anon;

-- ---------------------------------------------------------------------------
-- 6. December 2025, written down at last.
-- ---------------------------------------------------------------------------
-- Her instruction becomes the first rule, retroactively, so the 44 rows stop being
-- anonymous and the exception stops depending on memory.
do $$
declare
  v_erica uuid := (select id from public.profiles where role='owner'
                    and coalesce(display_name,'') !~* '(test|bot)' limit 1);
  v_josh  uuid := (select id from public.profiles where display_name = 'Josh' limit 1);
  v_rule  uuid;
  v_race  uuid;
begin
  if v_erica is null or v_josh is null then return; end if;

  insert into public.tagging_rules
    (created_by, subject_profile, from_date, note, status, created_at)
  values
    (v_erica, v_josh, date '2025-12-21',
     'Recorded retroactively by 0201. Erica, on first importing her Strava: "add him on '
     'all activities since December 21, 2025 except [the] Yuengling marathon." Applied at '
     'the time by migration 0039 as a blanket UPDATE; this row is that same instruction, '
     'finally written where it can be seen and revoked.',
     'active', timestamptz '2026-07-19 16:06:00+00')
  returning id into v_rule;

  -- The exception she named, stored instead of remembered.
  select a.id into v_race from public.activities a
   where a.name ilike '%yuengling%' order by a.start_date limit 1;
  if v_race is not null then
    insert into public.tagging_rule_exceptions (rule_id, subject_kind, subject_id, reason)
    values (v_rule, 'activity', v_race,
            'Named by Erica when she gave the instruction — her race, not a joint outing.')
    on conflict do nothing;
  end if;

  -- Link the rows the instruction produced, and record them as claims already settled.
  update public.activity_profiles ap
     set rule_id = v_rule, asserted_by = v_erica
   from public.activities a
  where a.id = ap.activity_id
    and ap.profile_id = v_josh
    and ap.evidence = 'owner_asserted_date_backfill';

  insert into public.tag_claims
    (rule_id, subject_kind, subject_id, profile_id, asserted_by, status, decided_at, note)
  select v_rule, 'activity', ap.activity_id, v_josh, v_erica, 'accepted_legacy', null,
         'Applied in 2026 by 0039 before tagging existed. Josh has never been asked; '
         'accepting or declining these is his to do.'
    from public.activity_profiles ap
   where ap.profile_id = v_josh and ap.rule_id = v_rule
  on conflict (subject_kind, subject_id, profile_id) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- 7. The exception, honoured in the copy as well as the record.
-- ---------------------------------------------------------------------------
-- `activity_profiles` credits Erica alone on the marathon — her exception held. But
-- `also_profiles` still lists Josh, and `place_people` reads THAT, so he was being credited
-- with a place from the one outing she explicitly kept for herself. One fact stored twice,
-- and the copy left behind: the same shape as `part_of` vs `place_membership`.
--
-- The array is realigned to the record here. Retiring it altogether belongs with the
-- Phase 7a rebuild, not with a data fix.
update public.activities a
   set also_profiles = coalesce((
         select array_agg(ap.profile_id)
           from public.activity_profiles ap
          where ap.activity_id = a.id
            and ap.profile_id <> a.owner_profile), '{}')
 where array_length(a.also_profiles, 1) is not null
   and a.also_profiles is distinct from coalesce((
         select array_agg(ap.profile_id)
           from public.activity_profiles ap
          where ap.activity_id = a.id
            and ap.profile_id <> a.owner_profile), '{}');
