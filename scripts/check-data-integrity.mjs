// Does production's DATA still make sense?
//
//   SUPABASE_ACCESS_TOKEN=... node scripts/check-data-integrity.mjs
//
// WHY THIS EXISTS. Every other check in this repository guards the SHAPE of things —
// types match the schema, the ledger matches the migrations, the card has no banned
// words. Nothing looked at the data, and on 2026-08-14 a read of production turned up
// four things that no test could have caught, because each one is a perfectly valid row:
//
//   * Washington, DC had `first_visit = 0202-06-19`. A year 202. It is displayed — the
//     card groups dates by year — and it CANNOT CORRECT ITSELF, because
//     recompute_place_stats sets `first_visit = least(first_visit, …)`, so the column
//     only ever moves earlier. A typo there is permanent.
//
//   * Two visits dated 2026-12-25, four months in the future, on the Appalachian Trail
//     and Maryland Heights. Both claimed `source = 'evidence'` and there is no evidence
//     anywhere in the database with that date — no photo, no ping, no activity.
//
//   * Two more visits derived from evidence that no longer exists.
//
//   * places.visit_count said 39 for the Appalachian Trail against 32 real visits
//     (0190). Nothing refreshes that column when a VISIT changes.
//
// None of these break anything loudly. They make the app quietly wrong, which is worse,
// because the numbers still look like numbers.
//
// A WARNING, NOT A FAILURE, and for a real reason: this reads a live database that a
// person is using, so it can go from clean to dirty without anybody touching the code,
// and failing a PR for that would block work that has nothing to do with it. It prints
// loudly and exits 0 unless STRICT=1. Same bargain as check-migration-ledger.mjs.
import { fetchWithRetry } from './lib/retry.mjs';

const PROJECT_REF = 'aanfyhsjbtnqzphuoiem';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (see .env.local).');
  process.exit(1);
}

async function query(sql) {
  const res = await fetchWithRetry(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Cloudflare in front of the Management API rejects an unrecognised
        // User-Agent with 1010; see docs/STATE.md §8.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      },
      body: JSON.stringify({ query: sql }),
    },
    { label: 'Management API' },
  );
  return res.json();
}

/** Each check names what is wrong in Erica's terms, not in column names. */
const CHECKS = [
  {
    name: 'a date no one could have been there on',
    why:
      'first_visit only ever moves EARLIER (least()), so a typo here is permanent and ' +
      'shows up wherever the card groups by year.',
    sql: `select name,
                 first_visit::text as first_visit,
                 last_visit::text  as last_visit
            from public.places
           where deleted_at is null
             and (extract(year from first_visit) < 1990
               or extract(year from last_visit)  < 1990
               or first_visit > current_date + 1
               or last_visit  > current_date + 1)
           order by name`,
  },
  {
    name: 'a visit that has not happened yet',
    why: 'a visit in the future counts in every total as though it had already happened.',
    sql: `select pl.name,
                 v.start_date::text as start_date,
                 v.end_date::text   as end_date,
                 v.source
            from public.visits v
            join public.places pl on pl.id = v.place_id
           where v.start_date > current_date
           order by v.start_date`,
  },
  {
    name: 'a visit derived from evidence that is not there',
    why:
      'these say source=evidence but nothing in the database sits in their dates. A ' +
      "container is EXCLUDED — a trail's evidence legitimately lives on its sections, " +
      'which is 84 of the 87 bare visits and is not a fault.',
    sql: `select pl.name,
                 v.start_date::text as start_date,
                 v.end_date::text   as end_date
            from public.visits v
            join public.places pl on pl.id = v.place_id
           where v.source = 'evidence'
             and not (pl.is_trail or pl.holds_children)
             and not exists (select 1 from public.visit_evidence e where e.visit_id = v.id)
             and not exists (select 1 from public.photos ph
                              where ph.place_id = v.place_id and ph.deleted_at is null
                                and ph.taken_at::date between v.start_date and v.end_date)
             and not exists (select 1 from public.location_pings lp
                              where lp.place_id = v.place_id
                                and lp.recorded_at::date between v.start_date and v.end_date)
             and not exists (select 1 from public.activities a
                              where a.place_id = v.place_id
                                and a.start_date::date between v.start_date and v.end_date)
             -- ENTRIES ARE EVIDENCE, and this check did not know it. 0218: a visit dated
             -- four months in the future could not be corrected by editing the visit,
             -- because rebuild_place_visits rebuilds visit islands from photos,
             -- activities, pings AND public.entries -- a journal entry was the real typo.
             -- (No backticks in here: this SQL lives in a JS template literal, and the
             --  first draft of this comment ended the string.)
             -- This list must name the same sources the rebuild reads or it will one day
             -- report a perfectly well-evidenced visit as bare. Checked when it was added:
             -- neither of the two currently flagged is explained by an entry, so this
             -- changes no answer today — it stops a false alarm tomorrow.
             and not exists (select 1 from public.entries e
                              where e.place_id = v.place_id
                                and e.date between v.start_date and v.end_date)
             -- …including an entry on a place this one CONTAINS, which is how one entry at
             -- Maryland Heights produced a visit on the Appalachian Trail.
             and not exists (select 1 from public.entries e
                              join public.places sec on sec.id = e.place_id
                             where v.place_id = any(sec.part_of)
                               and e.date between v.start_date and v.end_date)
           order by v.start_date`,
  },
  {
    name: 'a file import since 0227 with no artifact behind it',
    why:
      'from 2026-08-20, every uploaded file is hashed, stored and recorded before it is ' +
      'parsed, so an import made after that date has no excuse for missing its artifact. ' +
      'The 539 sources that predate it are LEGACY and deliberately not flagged: nobody ' +
      'kept those files, and inventing a hash for one would be writing down provenance ' +
      'that does not exist. This check is scoped by date for exactly that reason.',
    sql: `select i.id::text,
                 i.disposition,
                 i.external_key,
                 i.created_at::date::text as on_date
            from public.ingest_items i
            join public.ingest_runs r on r.id = i.run_id
           where r.method = 'file-upload'
             and i.artifact_id is null
             and i.created_at > timestamptz '2026-08-20 16:00:00+00'
           order by i.created_at desc
           limit 50`,
  },
  {
    name: 'an activity nobody could have moved that fast',
    why:
      'found on 2026-08-18 while charting how close Erica and Josh came on the same day: ' +
      '"Florida", a Run of 67.8 miles in 502 seconds — 486 mph, with a two-point line. It is ' +
      'a flight, or a GPS jump, recorded as a run. Nothing about it looks wrong in a list: ' +
      'it has a name, a type, a distance and a place. But it counts in her mileage, it ' +
      'placed a visit at a place called Florida, and it single-handedly produced a ' +
      '"831 miles apart" day in the chart. A speed check is the cheapest way to catch a ' +
      'whole class of recording artifact, and there is exactly ONE in the database today.',
    sql: `select a.name,
                 a.type,
                 a.start_date::date::text as on_date,
                 round((a.distance / 1609.344)::numeric, 1)::text as miles,
                 a.moving_time::text as seconds,
                 round(((a.distance / 1609.344) / (a.moving_time / 3600.0))::numeric, 0)::text as mph
            from public.activities a
           where a.moving_time > 60
             and a.distance > 1000
             -- 30 mph is comfortably above any run, hike or ride and comfortably below a
             -- car, a train or a plane. It is a nonsense filter, not a performance one.
             and ((a.distance / 1609.344) / (a.moving_time / 3600.0)) > 30
           order by 6 desc`,
  },
  {
    name: 'an imported activity that cannot say where it came from',
    why:
      'every activity from a connected account should carry an activity_sources row — that ' +
      'row IS the provenance the whole import system exists to keep. On 2026-08-17, 25 of ' +
      "Josh's 90 Strava activities had none: recordStravaSource() upserted with " +
      "onConflict on plain columns while 0202's uniqueness is an EXPRESSION index, so every " +
      'write failed 42P10 and the result was never checked. 0208 had backfilled the older ' +
      'rows by hand, which is exactly what hid it. Nothing looked wrong on screen.',
    sql: `select a.id::text,
                 a.name,
                 a.start_date::date::text as on_date,
                 a.athlete_id::text
            from public.activities a
           where a.athlete_id is not null
             and not exists (select 1 from public.activity_sources s where s.activity_id = a.id)
           order by a.start_date desc
           limit 50`,
  },
  {
    name: 'a place whose stored count disagrees with its visits',
    why:
      'places.visit_count is a mirror nobody refreshes when a visit changes (0190). ' +
      'It decides which place survives a merge. This check retires with the column.',
    sql: `select name,
                 visit_count as stored,
                 (select count(*) from public.visits v where v.place_id = p.id) as actual
            from public.places p
           where deleted_at is null
             and visit_count is distinct from (select count(*) from public.visits v where v.place_id = p.id)
           order by name`,
  },
];

let dirty = 0;

for (const check of CHECKS) {
  const rows = await query(check.sql);
  if (!Array.isArray(rows)) {
    console.error(`  ?  ${check.name}: the Management API did not return rows`);
    console.error(`     ${JSON.stringify(rows).slice(0, 300)}`);
    process.exit(1);
  }
  if (rows.length === 0) {
    console.log(`  ok  ${check.name}`);
    continue;
  }
  dirty += rows.length;
  console.log('');
  console.log(`  !!  ${check.name} — ${rows.length}`);
  console.log(`      ${check.why}`);
  for (const row of rows) {
    console.log(
      `      · ${Object.entries(row)
        .map(([k, v]) => `${k}=${v}`)
        .join('  ')}`,
    );
  }
  console.log('');
}

if (dirty === 0) {
  console.log('\nProduction data is consistent.');
  process.exit(0);
}

console.log(`${dirty} row(s) need a person to decide what is true.`);
console.log('Nothing here is repaired automatically: every one of them is a fact about');
console.log('where Erica has actually been, and guessing is how the wrong thing gets saved.');

if (process.env.STRICT === '1') {
  console.error('STRICT=1 — failing.');
  process.exit(1);
}
process.exit(0);
