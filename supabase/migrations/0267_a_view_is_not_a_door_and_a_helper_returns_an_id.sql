-- 0267 — two things 0266 left for the guards to find, and they found them.
--
-- `0176_the_only_door_is_the_rpc`:
--
--     FAIL: a browser can still write directly: visit_profiles.INSERT, UPDATE, DELETE
--
-- The tables had those privileges revoked. The VIEWS that replaced them were created fresh,
-- and Supabase's bootstrap grants `all` on new relations to `authenticated` — so the privilege
-- bits came back on a relation that had spent its whole life read-only. Nothing could actually
-- be written through them (a view over a join is not auto-updatable, which is why the test
-- suite is full of "cannot insert into view"), but "it fails for a second reason" is not the
-- rule. The rule is that the only door is the RPC, and a door that is locked because the
-- hinges are broken is not locked.
--
-- `the_readers_stay_enforced`:
--
--     These SECURITY DEFINER functions read public.activities directly and are not on the
--     allowlist: subject_for_activity.
--
-- Correct, and it belongs on the list rather than being rewritten: it reads exactly one column
-- of one row — `owner_profile`, to decide who owns the registry entry it is about to make —
-- and returns a subject id. No attribute of an activity leaves it. Reading through
-- `visible_activities` would be wrong here for the same reason it is wrong in
-- `set_place_solo`: a recording the caller cannot see still needs its registry entry, and a
-- subject that silently fails to exist is a participation that silently does not get written.
revoke insert, update, delete, truncate, references, trigger on public.activity_profiles from authenticated, anon;
revoke insert, update, delete, truncate, references, trigger on public.visit_profiles from authenticated, anon;

-- And the two new tables never got the same treatment, which is its own small hole: every
-- other canonical table is read-only to a browser and these two were writable-subject-to-RLS.
revoke insert, update, delete, truncate on public.memory_people from authenticated, anon;
revoke insert, update, delete, truncate on public.memory_subjects from authenticated, anon;
