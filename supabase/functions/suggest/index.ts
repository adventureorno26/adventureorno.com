// suggest — propose names for activities from where the route actually went.
//
// THIS FUNCTION WRITES ONLY TO `suggestions`. It never touches activities, places,
// visits or photos. That is the whole point: a machine may only propose, and a
// proposal that turns out wrong costs nothing because nothing was changed.
//
// Body: { activity_ids?: uuid[], limit?: number, dry_run?: boolean }
//   activity_ids  explicit targets; omit to sweep the most recent unsuggested routes
//   dry_run       score and return, write nothing (used to verify against the
//                 prototype's recorded output without dirtying the database)
//
// verify_jwt = true — owner or editor, or a service_role token for the nightly sweep.
// Deploy: supabase functions deploy suggest

import { adminClient, usablePlaceName, isGenericActivityName } from '../_shared/strava.ts';
import { decodePolyline } from '../_shared/polyline.ts';
import { samplePoints, buildOverpassQuery, scoreRoute } from '../_shared/routescore.ts';
import type { Candidate } from '../_shared/routescore.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY =
  Deno.env.get('AON_SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
// Overpass rate-limits to 2 concurrent slots PER IP, and an edge function egresses
// from shared Supabase infrastructure — so we are queueing behind strangers, which
// showed up as a burst of 429s and 504s on the very first live run. Rotating over
// independent mirrors turns "the endpoint is busy" into a retry that usually works.
// Measured 2026-08-09: private.coffee answered in 1.0s while the main endpoint 504'd.
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const UA = 'AdventureOrNo/1.0 (personal travel map)';

// The public Overpass endpoint allows ~2 concurrent queries and rate-limits beyond
// that, so a sweep is serialised with a pause between routes. A large backfill is a
// background job run repeatedly, never one enormous request.
const PAUSE_MS = 1100;
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 8;
const SAMPLES = 9;
// A busy mirror can hold a connection open for 30s+ and the edge runtime kills the
// whole invocation on resource limits — which is how the first live run died, losing
// the work it had already done. So: hard-abort a slow mirror, and stop starting new
// routes once we are close to the wall. Whatever finished is returned and recorded;
// the caller re-runs for the rest.
const ATTEMPT_TIMEOUT_MS = 25_000;
const DEADLINE_MS = 110_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function jwtRole(jwt: string): string | null {
  try {
    return JSON.parse(atob(jwt.split('.')[1])).role ?? null;
  } catch {
    return null;
  }
}

interface ActivityRow {
  id: string;
  name: string | null;
  type: string | null;
  summary_polyline: string | null;
  start_date: string | null;
  place_id: string | null;
}

/**
 * One Overpass call, with bounded retries.
 *
 * One call in fourteen returned 504 during testing — the public endpoint is
 * best-effort. Failing is cheap here precisely because nothing has been written, so
 * we retry a little, then give up and record it rather than guessing.
 */
async function overpass(
  query: string,
  notes: Record<string, number>,
): Promise<{ elements: unknown[] } | null> {
  // One attempt per mirror. Rotating beats retrying the same busy server.
  const attempts = OVERPASS_MIRRORS.length;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const endpoint = OVERPASS_MIRRORS[attempt % OVERPASS_MIRRORS.length];
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: new URLSearchParams({ data: query }),
        signal: ctl.signal,
      });
      if (res.ok) return await res.json();
      notes[`overpass_${res.status}`] = (notes[`overpass_${res.status}`] ?? 0) + 1;
      // 4xx other than 429 is our query being wrong, not the server being busy —
      // and no mirror will answer a bad query differently.
      if (res.status !== 429 && res.status >= 400 && res.status < 500) return null;
    } catch {
      notes.overpass_network = (notes.overpass_network ?? 0) + 1;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Last resort: the geocoder, at the route MIDPOINT, through the plausibility filter. */
async function maptilerFallback(lat: number, lng: number): Promise<string | null> {
  const key = Deno.env.get('MAPTILER_KEY');
  if (!key) return null;
  for (const types of ['poi', 'address', 'municipality']) {
    try {
      const r = await fetch(
        `https://api.maptiler.com/geocoding/${lng},${lat}.json?key=${key}&limit=1&types=${types}`,
      );
      if (!r.ok) continue;
      const text: string | undefined = (await r.json())?.features?.[0]?.text;
      // usablePlaceName is what rejects "-", storage lots, odor-abatement plants and
      // bare road names. Reused, not reimplemented.
      if (usablePlaceName(text)) return text;
    } catch {
      /* try the next granularity */
    }
  }
  return null;
}

/** Which activities to look at: the explicit list, or the recent unsuggested ones. */
async function targets(
  admin: SupabaseClient,
  ids: string[] | undefined,
  limit: number,
): Promise<ActivityRow[]> {
  const cols = 'id, name, type, summary_polyline, start_date, place_id';
  if (ids?.length) {
    const { data } = await admin.from('activities').select(cols).in('id', ids.slice(0, MAX_LIMIT));
    return (data ?? []) as ActivityRow[];
  }

  const { data } = await admin
    .from('activities')
    .select(cols)
    .not('summary_polyline', 'is', null)
    .order('start_date', { ascending: false })
    .limit(300);
  const rows = (data ?? []) as ActivityRow[];
  if (!rows.length) return [];

  // Skip anything already decided, and anything already proposed or turned down —
  // never ask the same question twice.
  const [{ data: locked }, { data: proposed }] = await Promise.all([
    admin
      .from('approved_fields')
      .select('subject_id')
      .eq('subject_type', 'activity')
      .eq('field', 'name'),
    admin
      .from('suggestions')
      .select('subject_id')
      .eq('subject_type', 'activity')
      .eq('field', 'name')
      .in('status', ['pending', 'rejected']),
  ]);
  const skip = new Set<string>([
    ...(locked ?? []).map((r: { subject_id: string }) => r.subject_id),
    ...(proposed ?? []).map((r: { subject_id: string }) => r.subject_id),
  ]);
  return rows.filter((r) => !skip.has(r.id)).slice(0, limit);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const admin = adminClient();

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
    if (prof?.role !== 'owner' && prof?.role !== 'editor') {
      return json({ error: 'owner or editor required' }, 403);
    }
  }

  let body: { activity_ids?: string[]; limit?: number; dry_run?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, body.limit ?? DEFAULT_LIMIT));
  const dryRun = body.dry_run === true;

  const notes: Record<string, number> = {};
  let runId: string | null = null;
  if (!dryRun) {
    const { data: run } = await admin
      .from('ingest_runs')
      .insert({ source: 'suggester' })
      .select('id')
      .maybeSingle();
    runId = (run?.id as string) ?? null;
  }

  let ok = 0;
  let failed = 0;
  let remaining = 0;
  const results: unknown[] = [];

  try {
    const rows = await targets(admin, body.activity_ids, limit);
    const startedAt = Date.now();

    for (const [index, row] of rows.entries()) {
      if (Date.now() - startedAt > DEADLINE_MS) {
        remaining = rows.length - index;
        notes.deadline_reached = remaining;
        break;
      }
      if (index > 0) await sleep(PAUSE_MS);

      const pts = decodePolyline(row.summary_polyline);
      if (pts.length < 2) {
        notes.no_polyline = (notes.no_polyline ?? 0) + 1;
        results.push({ activity_id: row.id, skipped: 'no usable polyline' });
        continue;
      }

      const samples = samplePoints(pts, SAMPLES);
      const res = await overpass(buildOverpassQuery(samples), notes);

      let candidates: Candidate[] = [];
      let source = 'osm';
      let evidenceBase: Record<string, unknown> = {};

      if (res) {
        const score = scoreRoute(
          (res.elements ?? []) as { type: string; tags?: Record<string, string> }[],
          samples.length,
        );
        candidates = score.candidates;
        evidenceBase = {
          samples: score.samples,
          strength: score.strength,
          trails: score.trails.slice(0, 5),
          parks: score.parks.slice(0, 5),
        };
      } else {
        failed++;
      }

      // THE RED ROCK CASE. Overpass returns nothing at all for Red Rock / Lake of the
      // Red Rocks — 97 activities, her most-used place, no OSM polygon in existence.
      //
      // The design says to fall back to the geocoder when OSM is silent (§5.1), and
      // also that Red Rock must produce nothing (§5.4). Those collide, because
      // MapTiler will cheerfully return a nearby town there. It is resolved by what
      // the fallback is FOR: filling a void, not arguing with a name that is already
      // good. So the geocoder is only consulted when the activity has no real name to
      // lose. Red Rock's activities are correctly named today, so they get no card —
      // and replacing a correct name with a town name would be worse than the bug
      // this replaces.
      if (!candidates.length && isGenericActivityName(row.name)) {
        const mid = samples[Math.floor(samples.length / 2)];
        const name = await maptilerFallback(mid[0], mid[1]);
        if (name) {
          source = 'maptiler';
          candidates = [{ name, kind: 'park', count: 0, rank: 0, confidence: 0.3 }];
          evidenceBase = { samples: samples.length, via: 'maptiler midpoint' };
        }
      }

      // A LEARNED RULE, ONLY IF THE ROUTE AGREES.
      //
      // Erica's rule is "Washington & Old Dominion Trail" within 1500 m of her house.
      // On the geofence alone that would have renamed 76 activities, most of them
      // neighbourhood street runs. So the rule is offered the names the scorer
      // actually found, and applies only if its own name is among them. It costs an
      // Overpass call we used to skip; correctness is worth more than the call.
      if (!dryRun && candidates.length) {
        const { data: ruled } = await admin.rpc('apply_naming_rule', {
          p_activity: row.id,
          p_candidates: candidates.map((c) => c.name),
        });
        const rr = ruled as { applied?: boolean; changed?: boolean; name?: string } | null;
        if (rr?.applied) {
          notes.rule_applied = (notes.rule_applied ?? 0) + 1;
          results.push({
            activity_id: row.id,
            current: row.name,
            source: 'rule',
            applied: rr.name,
            changed: rr.changed === true,
          });
          ok++;
          continue;
        }
      }

      if (!candidates.length) {
        notes.no_suggestion = (notes.no_suggestion ?? 0) + 1;
        results.push({ activity_id: row.id, current: row.name, suggestions: [] });
        continue;
      }

      // A decision already made is never re-litigated.
      const { data: mayWrite } = await admin.rpc('may_autowrite', {
        p_type: 'activity',
        p_id: row.id,
        p_field: 'name',
      });
      if (mayWrite === false) {
        notes.already_decided = (notes.already_decided ?? 0) + 1;
        results.push({ activity_id: row.id, skipped: 'name already approved' });
        continue;
      }

      const current = (row.name ?? '').trim();
      // ALREADY ON ONE OF THE RIGHT ANSWERS — say nothing.
      //
      // Today's hike is called "Seneca Regional Park" because Erica corrected it
      // herself, and the scorer ranks Potomac Heritage Trail (10 hits) above it
      // (8 hits). Both are true (§5.3). Offering to rename a name she just chose is
      // asking her to decide the same thing twice, which is the one thing this design
      // promised not to do. So if the current name is ANY of the candidates, the
      // question is already settled — not merely the top one.
      const fresh = candidates.some((c) => c.name.trim() === current)
        ? []
        : candidates.filter((c) => c.name.trim() !== current);
      if (!fresh.length) {
        notes.already_correct = (notes.already_correct ?? 0) + 1;
        results.push({ activity_id: row.id, current, suggestions: [] });
        continue;
      }

      results.push({
        activity_id: row.id,
        current,
        source,
        suggestions: fresh.map((c) => ({
          name: c.name,
          kind: c.kind,
          rank: c.rank,
          hits: c.count,
          confidence: c.confidence,
        })),
      });

      if (!dryRun) {
        // Inserted one at a time on purpose. The no-repeats guarantee is a PARTIAL
        // index over an expression (md5 of the proposed value, where status is
        // pending or rejected), which PostgREST's upsert cannot target — and a batch
        // insert would lose all five rows because one of them was already offered.
        // A duplicate here is the index doing its job: she already saw this, so it is
        // skipped quietly rather than counted as a failure.
        let wrote = 0;
        for (const c of fresh) {
          const { error } = await admin.from('suggestions').insert({
            subject_type: 'activity',
            subject_id: row.id,
            field: 'name',
            current_value: row.name,
            proposed_value: c.name,
            label: `Call it ${c.name}`,
            source,
            confidence: c.confidence,
            evidence: { ...evidenceBase, kind: c.kind, hits: c.count },
            group_key: `activity:${row.id}`,
            rank: c.rank,
          });
          if (!error) {
            wrote++;
          } else if (error.code === '23505') {
            notes.already_offered = (notes.already_offered ?? 0) + 1;
          } else {
            notes.insert_failed = (notes.insert_failed ?? 0) + 1;
          }
        }
        if (wrote === 0 && (notes.insert_failed ?? 0) > 0) {
          failed++;
          continue;
        }
      }
      ok++;
    }
  } catch (e) {
    console.error('suggest error', String(e));
    if (runId) {
      await admin
        .from('ingest_runs')
        .update({
          finished_at: new Date().toISOString(),
          ok,
          failed: failed + 1,
          notes: { ...notes, error: String(e).slice(0, 200) },
        })
        .eq('id', runId);
    }
    return json({ error: String(e).slice(0, 200) }, 500);
  }

  if (runId) {
    await admin
      .from('ingest_runs')
      .update({ finished_at: new Date().toISOString(), ok, failed, notes })
      .eq('id', runId);
  }

  // `remaining` is how many targets the deadline cut short — the caller re-runs
  // rather than silently assuming everything was covered.
  return json({ ok, failed, remaining, dry_run: dryRun, notes, results });
});
