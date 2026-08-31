// Seed deterministic fictional users for Playwright against a disposable LOCAL
// Supabase stack. The host guard is deliberate: this script must never create or
// modify accounts in a hosted project.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !secret) {
  throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) are required.');
}

const parsed = new URL(url);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
  throw new Error(`Refusing to seed a non-local Supabase host: ${parsed.hostname}`);
}

const users = [
  {
    email: process.env.TEST_OWNER_EMAIL || 'owner.e2e@example.invalid',
    password: process.env.TEST_OWNER_PASSWORD || 'Local-E2E-owner-2026!',
    role: 'owner',
    display_name: 'E2E Owner',
  },
  {
    email: process.env.TEST_EDITOR_EMAIL || 'editor.e2e@example.invalid',
    password: process.env.TEST_EDITOR_PASSWORD || 'Local-E2E-editor-2026!',
    role: 'editor',
    display_name: 'E2E Editor',
  },
  {
    email: process.env.TEST_VIEWER_EMAIL || 'viewer.e2e@example.invalid',
    password: process.env.TEST_VIEWER_PASSWORD || 'Local-E2E-viewer-2026!',
    role: 'viewer',
    display_name: 'E2E Viewer',
  },
];

const supabase = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const existingByEmail = new Map();
for (let page = 1; ; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
  if (error) throw error;
  for (const user of data.users) existingByEmail.set(user.email?.toLowerCase(), user);
  if (data.users.length < 100) break;
}

const seeded = new Map();
for (const fixture of users) {
  let user = existingByEmail.get(fixture.email.toLowerCase());
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: fixture.email,
      password: fixture.password,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  } else {
    const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
      password: fixture.password,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  }

  const { error: profileError } = await supabase.from('profiles').upsert({
    id: user.id,
    role: fixture.role,
    display_name: fixture.display_name,
  });
  if (profileError) throw profileError;
  seeded.set(fixture.role, user.id);
}

// ---- ONE SPACE, CONSTRUCTED DELIBERATELY (0298) ----------------------------
//
// These three used to end up in one space by accident. `ensure_profile_space()` had a branch
// that put any new non-owner into "the" space whenever exactly one existed, and the seeding
// leaned on it without saying so. 0298 removed that branch — nobody joins somebody else's
// space — so each of them now gets their own, and `mutating.spec.ts`, which is entirely
// about what an OWNER, an EDITOR and a VIEWER may do to the SAME rows, would have had three
// people looking at three empty spaces.
//
// The roles are still real and still govern writes (0286: roles govern WRITES, visibility
// belongs to the space boundary). What changed is that sharing a space is now something you
// do on purpose, so the fixture does it on purpose.
// `seeded` and NOT `existingByEmail`: the latter is the listing taken BEFORE any user is
// created, so on a fresh stack it is empty and every id here would be undefined.
const ownerId = seeded.get('owner');
if (!ownerId) throw new Error('Seeding produced no owner, so there is no space to share.');

const { data: ownerMembership, error: mErr } = await supabase
  .from('space_memberships')
  .select('space_id')
  .eq('profile_id', ownerId)
  .limit(1)
  .maybeSingle();
if (mErr) throw mErr;
if (!ownerMembership) throw new Error('The owner has no space membership to share.');

for (const role of ['editor', 'viewer']) {
  const id = seeded.get(role);
  if (!id) continue;
  // Drop the space they were given on their own, then put them in the owner's.
  const { error: delErr } = await supabase.from('space_memberships').delete().eq('profile_id', id);
  if (delErr) throw delErr;
  const { error: insErr } = await supabase
    .from('space_memberships')
    .insert({ space_id: ownerMembership.space_id, profile_id: id, role });
  if (insErr) throw insErr;
}

console.log(
  `Seeded ${users.length} fictional E2E users in the local Supabase stack, ` +
    `the editor and viewer placed in the owner's space deliberately (0298).`,
);
