// invite — owner-only Edge Function. Records an invite row and asks Supabase
// Auth to generate/send a magic-link email to the invitee.
//
// Auth model:
//  * The caller must be an authenticated OWNER. We verify the caller's JWT with
//    the anon client, then check their role via the service_role client.
//  * The invite row (email, role) is written with service_role so it exists
//    before the invitee's first login; claim_invite() promotes it to a profile.
//
// Secrets (Supabase project secrets, never committed):
//   SUPABASE_URL (auto-injected), AON_SUPABASE_PUBLISHABLE_KEY,
//   AON_SUPABASE_SECRET_KEY
//
// Deploy: supabase functions deploy invite

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY =
  Deno.env.get('AON_SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY =
  Deno.env.get('AON_SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing authorization' }, 401);

  // 1. Identify the caller from their JWT.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userErr,
  } = await asCaller.auth.getUser();
  if (userErr || !user) return json({ error: 'invalid session' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 2. Caller must be an owner.
  const { data: caller } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (caller?.role !== 'owner') return json({ error: 'owner role required' }, 403);

  // 3. Validate input. `redirectTo` is the site origin the invitee should land
  //    on (the client passes window.location.origin + '/login').
  let payload: { email?: string; role?: string; redirectTo?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  const email = (payload.email ?? '').trim().toLowerCase();
  const role =
    payload.role === 'owner' ? 'owner' : payload.role === 'viewer' ? 'viewer' : 'editor';
  const redirectTo = payload.redirectTo ?? 'https://adventureorno.com/login';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'valid email required' }, 400);
  }

  // 4. Record the invite (claim_invite() consumes it on first login).
  const { error: invErr } = await admin.from('invites').insert({
    email,
    role,
    invited_by: user.id,
  });
  if (invErr) return json({ error: invErr.message }, 500);

  // 5. Email the invitee. inviteUserByEmail creates the auth user + sends a
  //    confirmation link, which is what lets them sign in while public signups
  //    are disabled. If the auth user already exists (re-invite), fall back to a
  //    fresh magic link.
  const { error: linkErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (linkErr) {
    // Email delivery failed (e.g. no SMTP configured, or the auth user already
    // exists from a prior invite). Generate an authorized magic link and RETURN it
    // so the owner can share it manually — NEVER report success while dropping the
    // only way in.
    const { data: linkData, error: otpErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    });
    const actionLink = linkData?.properties?.action_link;
    if (otpErr || !actionLink) {
      return json({ error: otpErr?.message ?? 'could not create an invite link' }, 500);
    }
    return json({ ok: true, email, role, emailed: false, action_link: actionLink });
  }

  return json({ ok: true, email, role, emailed: true });
});
