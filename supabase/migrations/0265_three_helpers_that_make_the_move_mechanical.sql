-- 0265 — three helpers, so moving fourteen writers is mechanical rather than fourteen
-- opportunities to be clever.
--
-- Step two of the registry migration turns `activity_profiles` and `visit_profiles` into
-- views. Views cannot take `ON CONFLICT`, and every one of the fourteen functions that writes
-- to those tables uses it — 32 clauses between them — so "the readers keep working and the
-- writers are untouched" was never available. Each writer has to be translated from
-- `(activity_id, profile_id)` to `(subject_id, person_id)`.
--
-- Done by hand fourteen times that is fourteen chances to get a detail wrong. Done through
-- three functions it is a substitution:
--
--     insert into activity_profiles (activity_id, profile_id, …)
--       values (X, P, …) on conflict (activity_id, profile_id) …
--
--     insert into memory_people (subject_id, person_id, …)
--       values (public.subject_for_activity(X), public.person_for_profile(P), …)
--       on conflict (subject_id, person_id) …
--
-- GET-OR-CREATE, not create. A subject is the identity of a memory, not a fact about it: two
-- callers writing a participant for the same activity must land on the same subject, and the
-- second one must not fail. Same for a person's own contact row, which 0262's trigger creates
-- with the account but which a database restored from a partial dump might not have.
--
-- SECURITY DEFINER, and no grant to anybody. These are called from inside other definer
-- functions and from triggers; nothing in the browser has any business calling them, and
-- 0154 will say so within the hour if that stops being true.

create or replace function public.subject_for_activity(p_activity uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_owner uuid;
begin
  select id into v_id from public.memory_subjects where activity_id = p_activity;
  if v_id is not null then return v_id; end if;

  select owner_profile into v_owner from public.activities where id = p_activity;
  if not found then return null; end if;

  insert into public.memory_subjects (kind, owner_profile, activity_id)
  values ('outing',
          coalesce(v_owner, auth.uid(),
                   (select id from public.profiles where role = 'owner' order by created_at limit 1)),
          p_activity)
  on conflict (activity_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.memory_subjects where activity_id = p_activity;
  end if;
  return v_id;
end $function$;

create or replace function public.subject_for_visit(p_visit uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  select id into v_id from public.memory_subjects where visit_id = p_visit;
  if v_id is not null then return v_id; end if;
  if not exists (select 1 from public.visits where id = p_visit) then return null; end if;

  insert into public.memory_subjects (kind, owner_profile, visit_id)
  values ('visit',
          coalesce(auth.uid(),
                   (select id from public.profiles where role = 'owner' order by created_at limit 1)),
          p_visit)
  on conflict (visit_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.memory_subjects where visit_id = p_visit;
  end if;
  return v_id;
end $function$;

-- A person with an account is one person however many contact lists they appear in, so
-- participation is recorded against their OWN contact row (0262). This is how a writer that
-- knows a profile finds it.
create or replace function public.person_for_profile(p_profile uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if p_profile is null then return null; end if;
  select id into v_id from public.people
   where owner_profile = p_profile and linked_profile = p_profile and deleted_at is null
   limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.people (display_name, kind, owner_profile, linked_profile, favourite, created_by)
  select coalesce(nullif(btrim(pr.display_name), ''), 'Someone'), 'person', pr.id, pr.id, true, pr.id
    from public.profiles pr where pr.id = p_profile
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.people
     where owner_profile = p_profile and linked_profile = p_profile and deleted_at is null limit 1;
  end if;
  return v_id;
end $function$;

comment on function public.subject_for_activity is
  'The registry entry for an outing, made if it is not there yet. Get-or-create: a subject is '
  'the identity of a memory, so two callers writing a participant for the same activity must '
  'land on the same one and the second must not fail (0265).';
comment on function public.person_for_profile is
  'The person row for an account — their own contact, the one participation is recorded '
  'against. 0262 creates it with the account; this is how a writer that knows a profile finds '
  'it, and it makes one if a restore left it out (0265).';

revoke all on function public.subject_for_activity(uuid) from public, anon, authenticated;
revoke all on function public.subject_for_visit(uuid) from public, anon, authenticated;
revoke all on function public.person_for_profile(uuid) from public, anon, authenticated;
