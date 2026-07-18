-- seed-owner.sql — ONE-TIME bootstrap of Erica as the owner.
-- The invite Edge Function needs an existing owner to authorize new invites, so
-- the very first owner is seeded by hand. Run this in the Supabase SQL editor.
--
-- Prerequisite: Erica's auth user must exist. Create it in the dashboard:
--   Authentication → Users → Add user → "Send invitation" (or "Create user")
--   using her real email. Supabase emails her a link even with signups disabled.
--
-- Then run EITHER option below (replace the email with her real address).

-- Option A (recommended): seed a pending OWNER invite. On her first login the
-- app's claim_invite() promotes it to an owner profile — same path as everyone
-- else, so it's well exercised.
insert into public.invites (email, role)
values ('erica.gaffney6@gmail.com', 'owner')
on conflict do nothing;

-- Option B (direct): if you'd rather create the profile immediately, look up her
-- id in Authentication → Users and run:
--
--   insert into public.profiles (id, role, display_name)
--   values ('<her-auth-user-uuid>', 'owner', 'Erica')
--   on conflict (id) do update set role = 'owner';
