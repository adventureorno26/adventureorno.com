-- 0250 — two policies that pointed at each other, and a column with no default.
--
-- `0154_authz_matrix` caught the first within the hour, which is the second time this week
-- that test has earned its place:
--
--     ERROR: 42P17: infinite recursion detected in policy for relation "people"
--
-- 0247 wrote both halves of a rule that reads perfectly and cannot run:
--
--     people_read           … or the person is tagged on a memory you can see  → memory_people
--     memory_people_select  … or the person named is one of yours              → people
--
-- Each policy consults the other table, whose policy consults the first. Postgres does not
-- unfold that; it stops. **Every direct `select … from people` by a signed-in browser was an
-- error** — not a wrong answer, an error. It was invisible for an hour only because everything
-- shipped in 0248 reads through SECURITY DEFINER functions, which do not evaluate policies at
-- all. So the model worked and the table underneath it did not.
--
-- BOTH CLAUSES ARE RIGHT AND BOTH STAY. A contact must be readable when they are tagged on
-- something you can see, or the tag renders as a blank space; a tag must be readable by the
-- person it names, or nobody can answer one. What has to change is that a policy stops being
-- the thing that answers the question. Two SECURITY DEFINER helpers state each direction once,
-- and a definer function bypasses RLS, so the loop has nowhere to close.
--
-- AND `owner_profile` HAD NO DEFAULT, which `0176_the_only_door_is_the_rpc` found: a plain
-- `insert into people (display_name, kind)` — the shape every existing caller and fixture uses
-- — became a NOT NULL violation. A contact belongs to whoever recorded it, so that is the
-- default, and `auth.uid()` being null for a service caller stays a loud failure rather than
-- an ownerless row.

alter table public.people alter column owner_profile set default auth.uid();

create or replace function public.person_is_mine(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.people pe
                  where pe.id = p_person
                    and (pe.owner_profile = auth.uid() or pe.linked_profile = auth.uid()));
$function$;

comment on function public.person_is_mine is
  'Your own contact, or the contact card that is you. SECURITY DEFINER so that a policy on '
  'memory_people can ask it without consulting people''s policy, which asks memory_people '
  'back — 0247 wrote that loop and every select from people raised 42P17 (0250).';

create or replace function public.person_on_visible_memory(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.memory_people mp
                  where mp.person_id = p_person
                    and public.can_see_memory_subject(mp.subject_id));
$function$;

comment on function public.person_on_visible_memory is
  'Whether this person is tagged on a memory the caller may see — the reason a private '
  'contact is readable at all by somebody else, and the other half of the loop 0250 broke.';

drop policy if exists people_read on public.people;
create policy people_read on public.people for select
  using (
    owner_profile = auth.uid()
    or linked_profile = auth.uid()
    or public.person_on_visible_memory(id));

drop policy if exists memory_people_select on public.memory_people;
create policy memory_people_select on public.memory_people for select
  using (public.can_see_memory_subject(subject_id) or public.person_is_mine(person_id));

revoke all on function public.person_is_mine(uuid) from public, anon;
revoke all on function public.person_on_visible_memory(uuid) from public, anon;
revoke all on function public.can_see_memory_subject(uuid) from public, anon;
grant execute on function public.person_is_mine(uuid) to authenticated;
grant execute on function public.person_on_visible_memory(uuid) to authenticated;
grant execute on function public.can_see_memory_subject(uuid) to authenticated;
