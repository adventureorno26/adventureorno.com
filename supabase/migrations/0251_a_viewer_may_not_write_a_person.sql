-- 0251 — a viewer may not write a person.
--
-- Caught by `0111_create_experience`:
--
--     FAIL: viewer inserted a person (RLS not enforced)
--
-- The old `people_write` policy was `is_editor_or_owner()`. 0247 replaced it with
-- `owner_profile = auth.uid()` to make a contact private to whoever recorded it — and in
-- doing so dropped the requirement that the person recording it may write anything at all.
-- `owner_profile` defaults to `auth.uid()` (0250), so a VIEWER inserting a contact satisfied
-- the new rule perfectly: the row was theirs, and they were not allowed to make it.
--
-- BOTH CONDITIONS, not either. Ownership decides WHICH rows are yours; the role decides
-- whether you may write rows at all. Replacing a role check with an ownership check reads
-- like a tightening and is a widening — the ownership clause is true for everybody about
-- their own rows, including the people who are supposed to be read-only.
--
-- `memory_people_write` gets the same treatment. A viewer could not reach it today, because
-- writing a tag requires owning a subject and `memory_subjects_write` does check the role —
-- but "safe because of what the other policy says" is a rule you have to reconstruct from two
-- places, and this is the migration that exists because somebody did not.
drop policy if exists people_write on public.people;
create policy people_write on public.people for all
  using (owner_profile = auth.uid() and public.is_editor_or_owner())
  with check (owner_profile = auth.uid() and public.is_editor_or_owner());

drop policy if exists memory_people_write on public.memory_people;
create policy memory_people_write on public.memory_people for all
  using (public.is_editor_or_owner()
         and exists (select 1 from public.memory_subjects s
                      where s.id = memory_people.subject_id and s.owner_profile = auth.uid()))
  with check (public.is_editor_or_owner()
              and exists (select 1 from public.memory_subjects s
                           where s.id = memory_people.subject_id and s.owner_profile = auth.uid()));

comment on policy people_write on public.people is
  'Your own contacts, and only if you may write at all. BOTH conditions: ownership decides '
  'which rows are yours, the role decides whether you may make any — 0247 swapped the second '
  'for the first and a viewer could create people (0251).';
