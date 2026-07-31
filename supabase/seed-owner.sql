-- seed-owner.sql — ONE-TIME bootstrap of the household owner.
-- The invite Edge Function needs an existing owner to authorize new invites, so
-- the very first owner is seeded by hand. Run this in the Supabase SQL editor.
--
-- Prerequisite: the owner's auth user must exist. Create it in the dashboard:
--   Authentication → Users → Add user → "Send invitation" (or "Create user")
--   using their real email. Supabase emails a link even with signups disabled.
--
-- Then run EITHER option below (replace the placeholder with the real address).

-- Option A (recommended): seed a pending OWNER invite. On her first login the
-- app's claim_invite() promotes it to an owner profile — same path as everyone
-- else, so it's well exercised.
insert into public.invites (email, role)
values ('owner@example.com', 'owner') -- replace with the real owner email at run time
on conflict do nothing;

-- Option B (direct): if you'd rather create the profile immediately, look up the
-- owner's id in Authentication → Users and run:
--
--   insert into public.profiles (id, role, display_name)
--   values ('<owner-auth-user-uuid>', 'owner', 'Owner')
--   on conflict (id) do update set role = 'owner';
