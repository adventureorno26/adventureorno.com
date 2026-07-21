// geocode-new-places — names the places the clustering job created. SQL can't
// call MapTiler, so cluster_unassigned() flags new places `needs_geocode`; this
// reverse-geocodes each to a locality-level name + country + US state.
//
// Callers: the nightly cron (pg_net, Authorization: Bearer <service_role_key>),
// or the owner from /settings ("Name new places now"). verify_jwt = true — a
// valid Supabase JWT (service_role or an authenticated owner) is required.
//
// Secret: MAPTILER_KEY (set via `supabase secrets set MAPTILER_KEY=...`).
// Deploy: supabase functions deploy geocode-new-places

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MAPTILER_KEY = Deno.env.get('MAPTILER_KEY')!;
const BATCH = 25;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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

interface Geo {
  name: string;
  country: string | null;
  admin1: string | null;
}

async function reverseGeocode(lng: number, lat: number): Promise<Geo | null> {
  try {
    type Feat = {
      text?: string;
      place_name?: string;
      context?: Array<{ id: string; text: string }>;
    };
    const lookup = async (types?: string): Promise<Feat | null> => {
      const url =
        `https://api.maptiler.com/geocoding/${lng},${lat}.json?key=${MAPTILER_KEY}&limit=1` +
        (types ? `&types=${types}` : '');
      const r = await fetch(url);
      if (!r.ok) return null;
      const d = (await r.json()) as { features?: Feat[] };
      return d.features?.[0] ?? null;
    };
    // Prefer a locality-level name ("Asheville"); if the point is remote (a
    // trailhead, coastline) and no locality matches, fall back to anything
    // MapTiler can name (county/region/POI) rather than leaving "Unnamed place".
    const f =
      (await lookup('municipality,place,locality,municipal_district')) ??
      (await lookup('county,region,subregion')) ??
      (await lookup());
    if (!f) return null;
    const ctx = (prefix: string): string | null =>
      f.context?.find((c) => c.id.startsWith(prefix))?.text ?? null;
    return {
      name: f.text ?? f.place_name ?? 'Unnamed place',
      country: ctx('country'),
      admin1: ctx('region') ?? ctx('subregion'),
    };
  } catch {
    return null;
  }
}

function jwtRole(jwt: string): string | null {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Authorize: service_role (cron) or an owner session. The platform gateway
  // (verify_jwt) has already validated the JWT signature, so we can trust its
  // claims — service_role means the nightly cron; anything else must be an owner.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!jwt) return json({ error: 'unauthenticated' }, 401);
  if (jwtRole(jwt) !== 'service_role') {
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await asCaller.auth.getUser();
    if (!user) return json({ error: 'invalid session' }, 401);
    const { data: prof } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (prof?.role !== 'owner') return json({ error: 'owner required' }, 403);
  }

  const { data: places, error } = await admin
    .from('places')
    .select('id, lat, lng')
    .eq('needs_geocode', true)
    .limit(BATCH);
  if (error) return json({ error: error.message }, 500);

  let named = 0;
  for (const p of places ?? []) {
    const geo = await reverseGeocode(p.lng as number, p.lat as number);
    const patch = geo
      ? {
          name: geo.name,
          country: geo.country,
          admin1: geo.admin1,
          // Auto places are named by their locality, so that's their city too
          // (used for trip grouping).
          city: geo.name,
          needs_geocode: false,
          geocoded_at: new Date().toISOString(),
        }
      : // Couldn't reach MapTiler — leave the flag set so a later run retries,
        // but stamp the attempt so it isn't hammered.
        { geocoded_at: new Date().toISOString() };
    await admin.from('places').update(patch).eq('id', p.id);
    if (geo) named++;
  }

  return json({ ok: true, considered: places?.length ?? 0, named });
});
