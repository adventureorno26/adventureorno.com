// geocode-new-places — names the places the clustering job created. SQL can't
// call MapTiler, so cluster_unassigned() flags new places `needs_geocode`; this
// reverse-geocodes each to a locality-level name + country + US state.
//
// Callers: the nightly cron (AON_SUPABASE_SECRET_KEY in apikey) or the owner
// from /settings. Custom user-or-secret auth requires verify_jwt=false.
//
// Secret: MAPTILER_KEY (set via `supabase secrets set MAPTILER_KEY=...`).
// Deploy: supabase functions deploy geocode-new-places --no-verify-jwt

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY =
  Deno.env.get('AON_SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY =
  Deno.env.get('AON_SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
const MAPTILER_KEY = Deno.env.get('MAPTILER_KEY')!;
const FOURSQUARE_KEY = Deno.env.get('FOURSQUARE_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const BATCH = 25;

const AI_CATEGORIES = [
  'hiking', 'walking', 'running', 'biking', 'jeeping', 'camping', 'beach',
  'sunrise', 'sunset', 'dining', 'winery', 'brewery', 'viewpoint', 'stay',
];

// Automatic AI tag (+ optional better name) from a place's context. No-op when
// ANTHROPIC_API_KEY is unset. Used only when geocoding/Foursquare couldn't tag it,
// so it runs rarely and needs no manual click. Model: claude-opus-4-8.
async function aiEnhance(
  ctx: { name: string; lat: number; lng: number; poi?: string | null },
): Promise<{ category: string | null } | null> {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 256,
        system:
          'Pick the single best tag for a place from the allowed list, or null if ' +
          'none fits. Reply with ONLY the tag word or "null".',
        messages: [{
          role: 'user',
          content:
            `Place: ${ctx.name}\n${ctx.poi ? `Business: ${ctx.poi}\n` : ''}` +
            `Coords: ${ctx.lat}, ${ctx.lng}\nAllowed tags: ${AI_CATEGORIES.join(', ')}`,
        }],
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = ((data.content ?? []).find((b: { type: string }) => b.type === 'text')?.text ?? '')
      .trim().toLowerCase().replace(/[^a-z]/g, '');
    return { category: AI_CATEGORIES.includes(text) ? text : null };
  } catch {
    return null;
  }
}

// Foursquare category name (substring, case-insensitive) → our tag. First hit wins.
const FSQ_TAG_MAP: Array<[string, string]> = [
  ['winery', 'winery'],
  ['vineyard', 'winery'],
  ['brewery', 'brewery'],
  ['beer', 'brewery'],
  ['taproom', 'brewery'],
  ['restaurant', 'dining'],
  ['café', 'dining'],
  ['cafe', 'dining'],
  ['coffee', 'dining'],
  ['bakery', 'dining'],
  ['diner', 'dining'],
  ['food', 'dining'],
  ['bar', 'dining'],
  ['beach', 'beach'],
  ['scenic lookout', 'viewpoint'],
  ['overlook', 'viewpoint'],
  ['trail', 'hiking'],
  ['mountain', 'hiking'],
  ['campground', 'camping'],
  ['rv park', 'camping'],
  ['hotel', 'stay'],
  ['motel', 'stay'],
  ['resort', 'stay'],
  ['inn', 'stay'],
  ['lodge', 'stay'],
  ['bed & breakfast', 'stay'],
];

interface Poi {
  name: string;
  address: string | null;
  tag: string | null;
  distanceM: number;
}

// Nearest Foursquare business to a coordinate (new places-api). Returns null if
// no key, no result, or the nearest is too far to be "at" this spot.
async function foursquarePoi(lat: number, lng: number): Promise<Poi | null> {
  if (!FOURSQUARE_KEY) return null;
  try {
    const url =
      `https://places-api.foursquare.com/places/search?ll=${lat},${lng}` +
      `&radius=70&limit=1&sort=DISTANCE`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${FOURSQUARE_KEY}`,
        'X-Places-Api-Version': '2025-06-17',
      },
    });
    if (!r.ok) return null;
    const d = (await r.json()) as {
      results?: Array<{
        name?: string;
        distance?: number;
        location?: { formatted_address?: string };
        categories?: Array<{ name?: string }>;
      }>;
    };
    const f = d.results?.[0];
    if (!f?.name) return null;
    const catName = (f.categories?.[0]?.name ?? '').toLowerCase();
    const tag = FSQ_TAG_MAP.find(([kw]) => catName.includes(kw))?.[1] ?? null;
    return {
      name: f.name,
      address: f.location?.formatted_address ?? null,
      tag,
      distanceM: f.distance ?? 999,
    };
  } catch {
    return null;
  }
}

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Modern Supabase secret keys are sent only as apikey and require
  // verify_jwt=false; interactive calls still authenticate with a user JWT.
  const isServiceCall = req.headers.get('apikey') === SERVICE_ROLE_KEY;
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!isServiceCall) {
    if (!jwt) return json({ error: 'unauthenticated' }, 401);
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
    .select('id, lat, lng, categories')
    .eq('needs_geocode', true)
    .limit(BATCH);
  if (error) return json({ error: error.message }, 500);

  let named = 0;
  for (const p of places ?? []) {
    const geo = await reverseGeocode(p.lng as number, p.lat as number);
    if (!geo) {
      // Couldn't reach MapTiler — leave the flag set for a later retry.
      await admin.from('places').update({ geocoded_at: new Date().toISOString() }).eq('id', p.id);
      continue;
    }
    // Try to identify the actual business at this spot (Foursquare). If found,
    // name it by the business + fill its address + auto-tag its category.
    const poi = await foursquarePoi(p.lat as number, p.lng as number);
    const existingCats = ((p.categories as string[] | null) ?? []).filter(Boolean);
    const patch: Record<string, unknown> = {
      name: poi?.name ?? geo.name,
      country: geo.country,
      admin1: geo.admin1,
      // Locality is the city (for trip grouping) even when named by a business.
      city: geo.name,
      needs_geocode: false,
      geocoded_at: new Date().toISOString(),
    };
    if (poi?.address) patch.address = poi.address;
    if (poi?.tag && existingCats.length === 0) patch.categories = [poi.tag];
    // Automatic AI tagging: only when nothing else produced a category (keeps AI
    // usage minimal and needs no manual click). No-op without ANTHROPIC_API_KEY.
    else if (existingCats.length === 0) {
      const ai = await aiEnhance({
        name: (patch.name as string) ?? '',
        lat: p.lat as number,
        lng: p.lng as number,
        poi: poi?.name ?? null,
      });
      if (ai?.category) patch.categories = [ai.category];
    }
    await admin.from('places').update(patch).eq('id', p.id);
    named++;
  }

  return json({ ok: true, considered: places?.length ?? 0, named });
});
