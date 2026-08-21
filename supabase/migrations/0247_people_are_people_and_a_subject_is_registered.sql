-- 0247 — people are people, and a subject is registered rather than guessed at.
--
-- §5, Phase 3, first concrete step: *"Database/RLS contracts for tenancy, universal people,
-- events and messaging first."* Only the PEOPLE half is built here. Events and messaging
-- previews are still pending Erica's approval, and building a storage contract for a screen
-- nobody has agreed to is how a schema acquires tables nothing ever uses.
--
-- WHAT §8b-i ASKED FOR, and why the existing tables cannot answer it:
--
--   "A user can tag any person, find anyone tagged in their photos/memories, retrieve
--    everything they did with one or several people, and use that same selection for
--    statistics. There is no privileged Partner data type."
--
-- Today a participant must have an ACCOUNT: `activity_profiles` and `visit_profiles` both
-- point at `profiles`. So the only people who can ever appear in this app are the two who can
-- sign in to it. A friend, a parent, a child on a hike — none of them can be recorded at all,
-- and 178 photos have no participants of any kind because photos were never given a
-- participant table.
--
-- THREE TABLES, AND ONE OF THEM IS THE POINT.
--
--   people           an owner's private contact. A person, not an account. `linked_profile`
--                    is nullable: having an account is a property SOME people have, not the
--                    price of being recorded. This is "account access separate from memory
--                    participation" — the same person is one row whether or not they sign in.
--   memory_subjects  the registry. §8b-i: "use an enforceable subject registry rather than an
--                    unchecked polymorphic foreign key" — so a subject carries a REAL foreign
--                    key per kind, a CHECK tying the kind to the column it filled in, and
--                    `on delete cascade` from the record it stands for. A row cannot point at
--                    something that is not there, and cannot outlive it.
--   memory_people    who was in it, and separately: whether they have confirmed it is them,
--                    and whether they can see it. "Verification separate from sharing" —
--                    confirming you are in a photograph is not agreeing that anybody may look
--                    at it.
--
-- WHAT THIS IS NOT DOING, DELIBERATELY. It does not touch `activity_profiles` or
-- `visit_profiles`, and it registers no outing, visit or place subjects. §8b-i calls those
-- "migration inputs, not the final commercial API", and moving 1,278 rows and twenty-four
-- readers over in the same change that introduces the model is how one fact ends up stored
-- twice — the defect this codebase keeps having. **Only photos are registered here**, because
-- a photo is the one kind with nothing to mirror: it has never had participants at all. So
-- this adds a capability rather than a second copy of an existing one, and the outing/visit
-- migration happens against a model that has already run against real data.
--
-- AND ONE WORD FOR ONE IDEA. `tag_claims.status` says **declined**; `activity_profiles`
-- says **rejected**; both mean the same thing, and that is exactly how 0228 came to gate
-- sharing on a value that could never appear. The new tables use `declined`, everywhere,
-- and never the other one.

-- ---------------------------------------------------------------------------
-- 1. A person.
-- ---------------------------------------------------------------------------
-- The existing table was built for one thing — a child on a visit, `kind` defaulting to
-- 'child' — and holds zero rows, so widening it costs nothing and beats a second people
-- table beside it.
alter table public.people
  add column if not exists owner_profile  uuid references public.profiles(id) on delete cascade,
  add column if not exists linked_profile uuid references public.profiles(id) on delete set null,
  add column if not exists favourite      boolean not null default false,
  add column if not exists updated_at     timestamptz not null default now();

update public.people set owner_profile = created_by where owner_profile is null;
delete from public.people where owner_profile is null;   -- no rows; makes the NOT NULL safe
alter table public.people alter column owner_profile set not null;

-- `kind` was 'child' or nothing. A person is a person; the column stays because it is
-- somebody's note about a relationship, not a type of record.
alter table public.people alter column kind set default 'person';

-- One contact per account per owner: if you have already recorded that this person signs in
-- here, recording it again would give the same human two rows and split their memories.
create unique index if not exists people_one_link_per_owner
  on public.people (owner_profile, linked_profile)
  where linked_profile is not null and deleted_at is null;

comment on table public.people is
  'A PERSON, owned by whoever recorded them — not an account. `linked_profile` is nullable '
  'because having an account is a property some people have, not the price of being '
  'remembered (0247). Before this, a participant had to be one of the two people who could '
  'sign in.';

-- ---------------------------------------------------------------------------
-- 2. The subject registry.
-- ---------------------------------------------------------------------------
create table if not exists public.memory_subjects (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('photo','outing','visit','place')),
  owner_profile uuid not null references public.profiles(id) on delete cascade,
  photo_id      uuid references public.photos(id)      on delete cascade,
  activity_id   uuid references public.activities(id)  on delete cascade,
  visit_id      uuid references public.visits(id)      on delete cascade,
  place_id      uuid references public.places(id)      on delete cascade,
  created_at    timestamptz not null default now(),
  -- EXACTLY ONE TARGET, AND IT IS THE ONE THE KIND NAMES. This is what makes the registry
  -- enforceable: not a `subject_type`/`subject_id` pair that Postgres cannot check, but four
  -- real foreign keys of which precisely one is filled in.
  constraint memory_subjects_kind_matches_target check (
    num_nonnulls(photo_id, activity_id, visit_id, place_id) = 1
    and (kind <> 'photo'  or photo_id    is not null)
    and (kind <> 'outing' or activity_id is not null)
    and (kind <> 'visit'  or visit_id    is not null)
    and (kind <> 'place'  or place_id    is not null))
);

-- One subject per record, so "who was in this photo" has one answer.
create unique index if not exists memory_subjects_one_per_photo    on public.memory_subjects (photo_id)    where photo_id is not null;
create unique index if not exists memory_subjects_one_per_activity on public.memory_subjects (activity_id) where activity_id is not null;
create unique index if not exists memory_subjects_one_per_visit    on public.memory_subjects (visit_id)    where visit_id is not null;
create unique index if not exists memory_subjects_one_per_place    on public.memory_subjects (place_id)    where place_id is not null;

comment on table public.memory_subjects is
  'The one thing a tag can be about: a photo, an outing, a visit or a place. Four real '
  'foreign keys and a CHECK tying the kind to the one that is filled in, rather than an '
  'unchecked polymorphic pair — a subject cannot point at something that is not there, and '
  'cascades away with it (0247).';

-- ---------------------------------------------------------------------------
-- 3. Who was in it.
-- ---------------------------------------------------------------------------
create table if not exists public.memory_people (
  subject_id uuid not null references public.memory_subjects(id) on delete cascade,
  person_id  uuid not null references public.people(id)          on delete cascade,
  tagged_by  uuid references public.profiles(id) on delete set null,

  -- WAS THEY THERE / IN IT. One word for one idea: `declined`, never `rejected`.
  participation_status text not null default 'proposed'
    check (participation_status in ('proposed','accepted','declined','retracted')),

  -- DID THE PERSON CONFIRM IT IS THEM. Separate from participation on purpose: an owner may
  -- be certain who is in their own photograph, and that is still not the person saying so.
  -- Somebody with no account can never move past 'unverified', and that is honest rather
  -- than a gap — it says exactly what is known.
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','confirmed_by_person','confirmed_by_owner')),

  -- CAN THEY SEE IT. §8b-i: verification separate from sharing. Confirming that you are in a
  -- photograph is not agreeing that anyone may look at it, and being able to look at it is
  -- not a claim that you are in it.
  sharing_status text not null default 'not_shared'
    check (sharing_status in ('not_shared','shared_with_person')),

  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (subject_id, person_id)
);

create index if not exists memory_people_by_person on public.memory_people (person_id);

comment on table public.memory_people is
  'Who was in a memory, and — kept apart on purpose — whether THEY have confirmed it, and '
  'whether they can see it. An owner being certain who is in their own photograph is not the '
  'person saying so, and being allowed to look at something is not a claim to be in it (0247).';

-- ---------------------------------------------------------------------------
-- 4. RLS, written before anything reads these.
-- ---------------------------------------------------------------------------
alter table public.memory_subjects enable row level security;
alter table public.memory_people   enable row level security;

-- Whether the caller may see the record a subject stands for. SECURITY DEFINER because a
-- policy that queries `photos` would have the caller's own RLS applied to that subquery, and
-- the answer would then depend on evaluation order rather than on the rule. This states the
-- rule once, and every kind that is not yet registered answers FALSE rather than TRUE — a
-- registry entry for something this function has no case for shows nobody anything.
create or replace function public.can_see_memory_subject(p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.memory_subjects s
     where s.id = p_subject
       and public.is_member()
       and case s.kind
             when 'photo' then exists (
               select 1 from public.photos ph
                where ph.id = s.photo_id
                  and ph.deleted_at is null
                  and (ph.uploaded_by = auth.uid()
                    or (ph.uploaded_by is null and public.is_owner())
                    or (ph.place_id is not null and public.place_is_saved(ph.place_id))))
             when 'outing' then public.can_see_activity(s.activity_id)
             else false
           end);
$function$;

comment on function public.can_see_memory_subject is
  'Whether the caller may see the record a subject stands for — the photo rule from '
  'photos_select, and 0228 for an outing. Unregistered kinds answer FALSE, so a subject this '
  'function has no case for shows nobody anything (0247).';

-- A subject is visible when the thing it stands for is.
drop policy if exists memory_subjects_select on public.memory_subjects;
create policy memory_subjects_select on public.memory_subjects for select
  using (public.can_see_memory_subject(id));

-- Registering one is the owner's act. `owner_profile` must be the caller: a registry row is
-- how a photo acquires people, and writing one on somebody else's behalf is the beginning of
-- writing their answers for them.
drop policy if exists memory_subjects_write on public.memory_subjects;
create policy memory_subjects_write on public.memory_subjects for all
  using (owner_profile = auth.uid() and public.is_editor_or_owner())
  with check (owner_profile = auth.uid() and public.is_editor_or_owner());

-- A tag is visible to whoever can see the memory, and to the person it names.
drop policy if exists memory_people_select on public.memory_people;
create policy memory_people_select on public.memory_people for select
  using (
    public.can_see_memory_subject(subject_id)
    or exists (select 1 from public.people pe
                where pe.id = memory_people.person_id
                  and (pe.owner_profile = auth.uid() or pe.linked_profile = auth.uid())));

drop policy if exists memory_people_write on public.memory_people;
create policy memory_people_write on public.memory_people for all
  using (exists (select 1 from public.memory_subjects s
                  where s.id = memory_people.subject_id and s.owner_profile = auth.uid()))
  with check (exists (select 1 from public.memory_subjects s
                       where s.id = memory_people.subject_id and s.owner_profile = auth.uid()));

-- A CONTACT IS PRIVATE, with one exception that has to exist: a person tagged on a memory
-- you can see must be readable, or the tag renders as a blank space and the app tells you
-- somebody was there without being able to say who.
drop policy if exists people_read on public.people;
drop policy if exists people_write on public.people;
create policy people_read on public.people for select
  using (
    owner_profile = auth.uid()
    or linked_profile = auth.uid()
    or exists (select 1 from public.memory_people mp
                where mp.person_id = people.id
                  and public.can_see_memory_subject(mp.subject_id)));
create policy people_write on public.people for all
  using (owner_profile = auth.uid())
  with check (owner_profile = auth.uid());

comment on policy people_read on public.people is
  'Your own contacts, the contact card that is you, and anyone tagged on a memory you can '
  'see — that last one has to exist, or a tag renders as a blank space and the app says '
  'somebody was there without being able to say who (0247).';

grant select on public.memory_subjects to authenticated;
grant select on public.memory_people   to authenticated;
revoke all on public.memory_subjects from anon;
revoke all on public.memory_people   from anon;
