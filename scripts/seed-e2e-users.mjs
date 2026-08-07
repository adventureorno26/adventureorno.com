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
}

console.log(`Seeded ${users.length} fictional E2E users in the local Supabase stack.`);
