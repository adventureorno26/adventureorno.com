// Keep .env.example honest about the CLIENT variable inventory
// (COMPLETION-PLAN Phase 5).
//
// Every `import.meta.env.VITE_*` the app reads must be documented in .env.example.
// VITE_* values are baked into the bundle at BUILD time, so an undocumented one
// does not fail loudly at runtime — it silently ships as `undefined` and the
// feature it gates just quietly disappears. That is exactly how VITE_GOOGLE_CLIENT_ID
// and VITE_MAPBOX_TOKEN came to be used by the app but absent from the example.
//
// The reverse direction is a WARNING, not a failure: a documented-but-unused
// variable is usually a feature that was removed or not wired up yet, which is
// worth seeing but should not block a build.
//
// Server-only secrets are deliberately NOT enforced. They vary per environment and
// are supplied through Supabase/Wrangler secrets; requiring an exact match would
// mean editing this file every time a script reads a new env var.
//
// Usage: node scripts/check-env-example.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const SRC = 'app/src';
const EXAMPLE = '.env.example';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (['.ts', '.tsx'].includes(extname(p))) out.push(p);
  }
  return out;
}

const used = new Map(); // VAR -> first file that reads it
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) {
    if (!used.has(m[1])) used.set(m[1], file);
  }
}

const exampleText = readFileSync(EXAMPLE, 'utf8');
const documented = new Set(
  [...exampleText.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
);

const missing = [...used.keys()].filter((v) => !documented.has(v)).sort();
const unused = [...documented].filter((v) => v.startsWith('VITE_') && !used.has(v)).sort();

console.log(`App reads ${used.size} VITE_* variable(s); ${EXAMPLE} documents ${documented.size}.`);

if (unused.length) {
  console.log(
    `Note: documented but not read by app/src (may be intentional): ${unused.join(', ')}`,
  );
}

if (missing.length) {
  console.error(
    `\n${EXAMPLE} is missing ${missing.length} client variable(s) the app actually reads:\n` +
      missing.map((v) => `  - ${v}  (first used in ${used.get(v)})`).join('\n') +
      '\n\nAdd each with a comment explaining what it enables and what happens when it is blank.' +
      '\nAn undocumented VITE_* is baked in as `undefined` at build time and its feature silently' +
      '\ndisappears — it does not fail loudly.',
  );
  process.exit(1);
}

console.log('Env example check passed: every VITE_* the app reads is documented.');
