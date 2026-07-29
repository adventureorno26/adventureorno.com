// google-photos-token — persistent Google Photos auth for the web app.
//
// The browser never holds a Google refresh token. Instead:
//   * First time: the client runs Google's auth-code popup with access_type=offline
//     and sends us the one-time `code`. We exchange it for a refresh_token (stored
//     here, per person) + an access_token (returned to the client).
//   * Every time after: the client calls us with no code; we use the stored
//     refresh_token to mint a fresh access_token silently — no sign-in prompt.
//
// Auth: the caller's Supabase JWT identifies which person's token to use (so Erica
// and Josh each connect their own Google account). Deploy WITH jwt verification:
//   supabase functions deploy google-photos-token
//
// Secrets required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (the Web OAuth client).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY =
  Deno.env.get('AON_SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');

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

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// The GIS popup auth-code flow exchanges against the special "postmessage" redirect.
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

async function exchangeCode(code: string): Promise<Response> {
  return fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      redirect_uri: 'postmessage',
      grant_type: 'authorization_code',
    }),
  });
}

async function refresh(refreshToken: string): Promise<Response> {
  return fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: 'not configured' }, 500);

  // Identify the caller.
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: me } = await asUser.auth.getUser();
  if (!me?.user) return json({ error: 'not authorized' }, 401);
  const profileId = me.user.id;

  let body: { code?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body = refresh path */
  }

  // First-time connect: exchange the auth code, store the refresh token.
  if (body.code) {
    const res = await exchangeCode(body.code);
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !data.access_token) {
      return json({ error: data.error ?? 'exchange failed' }, 400);
    }
    if (data.refresh_token) {
      await admin
        .from('google_tokens')
        .upsert({ profile_id: profileId, refresh_token: data.refresh_token, updated_at: new Date().toISOString() });
    }
    return json({ access_token: data.access_token, expires_in: data.expires_in ?? 3600 });
  }

  // Returning: mint a fresh access token from the stored refresh token.
  const { data: row } = await admin
    .from('google_tokens')
    .select('refresh_token')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (!row?.refresh_token) return json({ needsConsent: true });

  const res = await refresh(row.refresh_token);
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) {
    // Refresh token revoked/expired → drop it so the client re-consents.
    if (res.status === 400 || res.status === 401) {
      await admin.from('google_tokens').delete().eq('profile_id', profileId);
    }
    return json({ needsConsent: true });
  }
  return json({ access_token: data.access_token, expires_in: data.expires_in ?? 3600 });
});
