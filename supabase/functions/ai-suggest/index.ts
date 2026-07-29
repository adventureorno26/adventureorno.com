// ai-suggest — suggest a place's category + a cleaner title from its context,
// using Claude. Cuts manual tagging. Owner/editor only. Returns {configured:false}
// (not an error) when ANTHROPIC_API_KEY isn't set, so the UI can hide the button.
//
// Raw HTTPS fetch to the Anthropic Messages API (Deno edge function; matches how
// the other functions here call Foursquare/MapTiler). Model: claude-opus-4-8.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

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

// The tag vocabulary Claude may choose from (kept in sync with lib/categories).
const CATEGORIES = [
  'hiking', 'walking', 'running', 'biking', 'jeeping', 'camping', 'beach',
  'sunrise', 'sunset', 'dining', 'winery', 'brewery', 'viewpoint', 'stay',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!ANTHROPIC_API_KEY) return json({ configured: false });

  // Verify the caller is a signed-in editor/owner (RLS via their JWT).
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: me } = await asUser.auth.getUser();
  if (!me?.user) return json({ error: 'not authorized' }, 401);
  // Verify a profiles row with an owner/editor role — an Auth user alone isn't enough.
  const { data: prof } = await asUser
    .from('profiles')
    .select('role')
    .eq('id', me.user.id)
    .maybeSingle();
  if (!prof || (prof.role !== 'owner' && prof.role !== 'editor')) {
    return json({ error: 'not authorized' }, 403);
  }

  let body: { name?: string; category?: string; lat?: number; lng?: number;
    address?: string; nearby?: string; activityType?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const context = [
    body.name ? `Current name: ${body.name}` : null,
    body.activityType ? `Recorded activity type: ${body.activityType}` : null,
    body.category ? `Current tag: ${body.category}` : null,
    body.address ? `Address: ${body.address}` : null,
    body.nearby ? `Nearby place of interest: ${body.nearby}` : null,
    body.lat != null && body.lng != null ? `Coordinates: ${body.lat}, ${body.lng}` : null,
  ].filter(Boolean).join('\n');

  const anthropicReq = {
    model: 'claude-opus-4-8',
    max_tokens: 512,
    system:
      'You help label places on a personal travel map. Given a place\'s context, ' +
      'suggest a concise, human title (a real place name, not a road number or a ' +
      'generic label like "Morning Hike") and the single best tag from the allowed ' +
      'list. If nothing fits, leave category null. Be conservative: only rename when ' +
      'you are confident the new title is a real, better name.',
    messages: [{ role: 'user', content: `Place context:\n${context}` }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            category: { type: ['string', 'null'], enum: [...CATEGORIES, null] },
            confidence: { type: 'number' },
          },
          required: ['title', 'category', 'confidence'],
          additionalProperties: false,
        },
      },
    },
  };

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(anthropicReq),
    });
    if (!r.ok) {
      const detail = await r.text();
      return json({ error: `AI request failed (${r.status})`, detail: detail.slice(0, 200) }, 502);
    }
    const data = await r.json();
    // Structured output arrives as a text block containing the JSON object.
    const text = (data.content ?? []).find((b: { type: string }) => b.type === 'text')?.text ?? '{}';
    let parsed: { title?: string; category?: string | null; confidence?: number } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      return json({ error: 'AI returned unparseable output' }, 502);
    }
    return json({
      configured: true,
      title: parsed.title ?? null,
      category: parsed.category ?? null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'AI request error' }, 500);
  }
});
