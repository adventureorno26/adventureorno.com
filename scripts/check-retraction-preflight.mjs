// PREFLIGHT FOR "RETRACT, NOT DELETE" — §"AN ACCEPTED TAG IS MINE", item 2b.
//
//   SUPABASE_ACCESS_TOKEN=… node scripts/check-retraction-preflight.mjs
//
// READ-ONLY. It runs four counting queries against production and changes nothing.
//
// WHY IT EXISTS. The approved fix turns the removal in `set_visit_participants`,
// `set_place_solo` and `set_activity_solo` from a DELETE into a retraction, so that taking
// somebody off a card is a decision with a record rather than an erasure. Photos already
// work that way (`0248`).
//
// That change has a second half which is easy to miss and is the whole risk: **nothing
// filters these rows by status today.** `visit_profiles` and `activity_profiles` have been
// VIEWS over `memory_people` since `0266`, and neither view mentions
// `participation_status`. So if the writers start marking rows `retracted` and the views
// are left alone, a removed person keeps counting in every statistic — the exact opposite
// of what removal means. The views therefore have to exclude retracted rows in the same
// migration, and because 41 readers go through those two views, that one line is what
// makes the change tractable instead of a 34-function sweep.
//
// AND THAT IS WHY THIS SCRIPT EXISTS: adding the filter changes what the views return for
// any row that is ALREADY `retracted`. `respond_to_memory_tag` has been able to set that
// status since 0248. If such rows exist for `visit` or `outing` subjects, then applying the
// migration silently moves Erica's live numbers, and the size of that move has to be known
// and approved BEFORE it is applied, not discovered afterwards in a stat that disagrees
// with itself. That is the defect class 0280 already cost a day to.
//
// A NON-ZERO ANSWER IS NOT A BLOCKER. It is a number that has to be shown to her first.
import { fetchWithRetry } from "./lib/retry.mjs";

const PROJECT_REF = "aanfyhsjbtnqzphuoiem";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("Missing SUPABASE_ACCESS_TOKEN (see .env.local).");
  process.exit(1);
}

async function query(sql) {
  const res = await fetchWithRetry(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Cloudflare in front of the Management API rejects an unrecognised User-Agent
        // with 1010; see docs/STATE.md §8.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      },
      body: JSON.stringify({ query: sql }),
    },
    { label: "Management API" },
  );
  return res.json();
}

const QUERIES = [
  [
    "participations by subject kind and status",
    `select s.kind, mp.participation_status, count(*) as n
       from public.memory_people mp
       join public.memory_subjects s on s.id = mp.subject_id
      group by 1, 2
      order by 1, 2`,
  ],
  [
    "ROWS THE VIEW FILTER WOULD HIDE (the number that gates this change)",
    `select s.kind, count(*) as n
       from public.memory_people mp
       join public.memory_subjects s on s.id = mp.subject_id
       join public.people pe on pe.id = mp.person_id
      where mp.participation_status = 'retracted'
        and s.kind in ('visit', 'outing')
        and pe.linked_profile is not null
      group by 1`,
  ],
  [
    // EXPECT ZERO HERE, AND IT IS NOT A FAULT. `0290` added `is_member(s.space_id)` to both
    // views, and this script talks to the Management API as an admin connection with no
    // `auth.uid()` — so `is_member()` is false and the views correctly return nothing. The
    // counts that matter are taken from `memory_people` directly, above, which is why the
    // gating query does not go through the views.
    "what the two views return TO AN ADMIN CONNECTION (0 is correct — see note in source)",
    `select 'visit_profiles' as view, count(*) as n from public.visit_profiles
     union all
     select 'activity_profiles', count(*) from public.activity_profiles`,
  ],
  [
    "WHY: people.linked_profile, which both views require to be non-null",
    `select count(*) as people_total,
            count(linked_profile) as with_linked_profile,
            count(*) filter (where linked_profile is null) as without
       from public.people`,
  ],
  [
    "the LIVE definition of visit_profiles (not the one in 0266)",
    `select pg_get_viewdef('public.visit_profiles'::regclass, true) as def`,
  ],
  [
    "claim_status spread inside those views",
    `select 'visit' as view, claim_status, count(*) as n from public.visit_profiles group by 1,2
     union all
     select 'activity', claim_status, count(*) from public.activity_profiles group by 1,2
     order by 1, 2`,
  ],
];

const rows = [];
for (const [label, sql] of QUERIES) {
  const out = await query(sql);
  console.log(`\n── ${label}`);
  if (!Array.isArray(out)) {
    console.log("   " + JSON.stringify(out));
    continue;
  }
  if (out.length === 0) console.log("   (none)");
  for (const r of out) console.log("   " + JSON.stringify(r));
  rows.push([label, out]);
}

const hidden = rows[1]?.[1] ?? [];
const total = Array.isArray(hidden)
  ? hidden.reduce((s, r) => s + Number(r.n || 0), 0)
  : 0;
console.log("\n────────────────────────────────────────────────────────");
if (total === 0) {
  console.log(
    "PREFLIGHT CLEAR: no visit/outing participation is retracted today, so adding the\n" +
      "view filter changes NO existing number. The migration only affects removals made\n" +
      "after it is applied.",
  );
} else {
  console.log(
    `PREFLIGHT: ${total} existing row(s) would be hidden by the view filter, so applying\n` +
      "the migration WOULD move live numbers. Show this to Erica and get the change\n" +
      "approved before applying.",
  );
}
