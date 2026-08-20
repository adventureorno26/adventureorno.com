-- 0252 — a person attached to a visit you can see is not a private contact.
--
-- `0111_create_experience` again, one rule further on:
--
--     FAIL: viewer cannot read people
--
-- Its comment says why it expected to: *"viewer CAN read people (is_member read policy)"* —
-- which was true and is the rule §8b-i supersedes. A contact is **owner-scoped and private**
-- now; a viewer reading everybody's contact list is the thing that had to stop.
--
-- BUT THE TEST IS ALSO RIGHT, about a narrower thing. The person it looks for is attached to
-- a VISIT — "a non-login person attached to a visit", asserted four sections earlier. Somebody
-- who can see that visit and cannot read that name is told a child was there without being
-- told which child, which is exactly the failure the `memory_people` exception in 0247 exists
-- to prevent. That exception was written for the new tables and not for `visit_people`, which
-- has been carrying people since long before them.
--
-- So the same rule, said once more: a person is readable when they are attached to something
-- you can already see. Everything else stays private to whoever recorded it.
--
-- A definer helper for the same reason as 0250 — a policy on `people` that reads
-- `visit_people` would consult that table's policy, and the loop is how 42P17 happened.
create or replace function public.person_on_visible_visit(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.is_member()
     and exists (select 1 from public.visit_people vp
                   join public.visits v on v.id = vp.visit_id
                  where vp.person_id = p_person);
$function$;

comment on function public.person_on_visible_visit is
  'Whether this person is attached to a visit the caller can see. Visits are household-wide, '
  'so membership is the whole test — the point is that a name on something you can already '
  'see is not a private contact (0252).';

drop policy if exists people_read on public.people;
create policy people_read on public.people for select
  using (
    owner_profile = auth.uid()
    or linked_profile = auth.uid()
    or public.person_on_visible_memory(id)
    or public.person_on_visible_visit(id));

comment on policy people_read on public.people is
  'Your own contacts, the contact card that is you, and anyone attached to a memory or a '
  'visit you can already see. That last part has to exist, or the app tells you somebody was '
  'there without being able to say who (0247, 0252).';

revoke all on function public.person_on_visible_visit(uuid) from public, anon;
grant execute on function public.person_on_visible_visit(uuid) to authenticated;
