// Bundle budgets for the LOGIN entry graph (COMPLETION-PLAN Phase 4).
//
// The login shell is what an unauthenticated visitor — and Erica on a cold phone —
// downloads before anything renders. Two heavy optional chunks must never end up
// in it: MapLibre (~1.0 MB) and heic2any (~1.3 MB). Both are legitimately large;
// they just have to stay behind the authenticated routes that need them.
//
// This is a REGRESSION GUARD, not an optimisation. It has already happened once
// in the other direction: making MapView `lazy()` to shrink this shell moved
// maplibre-gl's CSS after index.css, which collapsed every map on the site to
// zero height (see the note in CLAUDE.md / the gotchas). MapView is therefore
// EAGER on purpose. The budget exists so that staying eager cannot quietly start
// dragging MapLibre into the login graph, and so the shell cannot creep upward
// unnoticed.
//
// `dist/index.html` is the right thing to inspect: Vite emits a <script> for the
// entry plus <link rel="modulepreload"> for everything statically reachable from
// it, which is exactly the set the browser fetches on /login. Verified against a
// real browser waterfall — the runtime fetched precisely these files and nothing
// else.
//
// Usage: node scripts/check-bundle-budget.mjs [dist-dir]
import { readFileSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, basename } from 'node:path';

const dist = process.argv[2] || 'app/dist';
const indexHtml = join(dist, 'index.html');

if (!existsSync(indexHtml)) {
  console.error(`Bundle budget FAILED: ${indexHtml} not found. Run the build first.`);
  process.exit(1);
}

// Chunks that must never be reachable from the login entry graph.
const FORBIDDEN_IN_LOGIN = [/maplibre/i, /heic2any/i];

// Budgets in KB of GZIPPED bytes — what actually travels over the wire.
// Headroom is deliberate: tight enough to catch a big new dependency, loose
// enough that ordinary feature work does not trip it. Raise a number only when
// you have decided the increase is worth it, in the same commit that causes it.
const BUDGETS = {
  totalLoginGzipKb: 200, // currently ~177
  perFileGzipKb: {
    'index-*.js': 60, // app entry, currently ~41
    'index-*.css': 40, // all styles, currently ~25
    'react-*.js': 75, // react + react-dom, currently ~57
    'supabase-*.js': 70, // supabase-js, currently ~54
  },
};

const html = readFileSync(indexHtml, 'utf8');
const assets = [...new Set([...html.matchAll(/\/assets\/[A-Za-z0-9._-]+/g)].map((m) => m[0]))];

if (assets.length === 0) {
  console.error('Bundle budget FAILED: no /assets/* references found in index.html.');
  process.exit(1);
}

const problems = [];
let totalGzip = 0;
const rows = [];

for (const asset of assets) {
  const file = join(dist, asset);
  if (!existsSync(file)) {
    problems.push(`${asset} is referenced by index.html but missing from ${dist}.`);
    continue;
  }
  const name = basename(asset);

  for (const pattern of FORBIDDEN_IN_LOGIN) {
    if (pattern.test(name)) {
      problems.push(
        `${name} is in the LOGIN entry graph. MapLibre and heic2any must stay behind ` +
          'authenticated routes — an unauthenticated visitor should never download them.',
      );
    }
  }

  const raw = statSync(file).size;
  const gzip = gzipSync(readFileSync(file)).length;
  const gzipKb = Math.round(gzip / 1024);
  totalGzip += gzipKb;
  rows.push({ name, rawKb: Math.round(raw / 1024), gzipKb });

  for (const [glob, limit] of Object.entries(BUDGETS.perFileGzipKb)) {
    const re = new RegExp('^' + glob.replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$');
    if (re.test(name) && gzipKb > limit) {
      problems.push(`${name} is ${gzipKb} KB gzipped, over its ${limit} KB budget.`);
    }
  }
}

if (totalGzip > BUDGETS.totalLoginGzipKb) {
  problems.push(
    `The login shell is ${totalGzip} KB gzipped, over the ${BUDGETS.totalLoginGzipKb} KB budget.`,
  );
}

console.log(`Login entry graph (${rows.length} files, ${totalGzip} KB gzipped):`);
for (const r of rows.sort((a, b) => b.gzipKb - a.gzipKb)) {
  console.log(`  ${String(r.gzipKb).padStart(4)} KB gzip  (${String(r.rawKb).padStart(5)} KB raw)  ${r.name}`);
}

if (problems.length) {
  console.error(`\nBundle budget FAILED:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

console.log(
  `\nBundle budget passed: ${totalGzip}/${BUDGETS.totalLoginGzipKb} KB gzipped, ` +
    'and neither MapLibre nor heic2any is in the login graph.',
);
