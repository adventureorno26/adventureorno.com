// A SQL test that reasons about which space a row belongs to must install PRODUCTION'S
// `default_space()` first, because CI's is a different function.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
//
// `0292` §8 replaces `default_space()` with `select current_space()` INSIDE the branch that
// actually forks — a considered choice, because an empty-schema replay seeds five reference
// tables before any profile exists and removing the fallback unconditionally would break
// `db-bootstrap.sh` on every push.
//
// The cost is that **CI replays a schema whose `default_space()` still has 0289's "biggest
// space" fallback**, while production runs the newer body. That fallback fills `space_id`
// NON-NULL and, once there are two spaces, fills it WRONG — it hands every caller-less row
// to whichever space has the most members. `0295`'s trigger only fires on NULL, so under the
// fallback it never runs at all.
//
// `0297`'s test was written without the preamble and failed: Ben's ping landed in Ann's
// space, so of course her fog covered his ground. That was CI's schema talking, not
// production's, and it cost an hour of chasing a bug that did not exist.
//
// ---------------------------------------------------------------------------
// THE RULE, AND THAT IT IS A PROXY
// ---------------------------------------------------------------------------
//
// The thing that actually matters is "does this test assert where a row LANDS", and no
// regular expression can answer that. `home_space_of(` is the proxy: a test that asks which
// space a profile belongs to is reasoning about the same thing, and every test that has ever
// needed the preamble calls it. It is a proxy and it is named as one — if a test ever
// asserts about `space_id` without calling it, this will not catch it.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'tests');

/** Production's body, as 0292 §8 writes it. Matched loosely on the one line that matters. */
const PREAMBLE = /create\s+or\s+replace\s+function\s+public\.default_space\(\)[\s\S]{0,400}?select\s+public\.current_space\(\)/i;

const files = readdirSync(TESTS)
  .filter((f) => f.endsWith('.test.sql'))
  .map((f) => [f, readFileSync(join(TESTS, f), 'utf8')]);

describe('a SQL test that reasons about spaces installs production’s default_space()', () => {
  it('finds the test files at all', () => {
    expect(files.length, 'supabase/tests/*.test.sql should be readable').toBeGreaterThan(10);
  });

  const reasoners = files.filter(([, sql]) => /home_space_of\(/.test(sql));

  it('has some tests that reason about spaces, or this guard is vacuous', () => {
    expect(reasoners.length, 'no test calls home_space_of — has the proxy stopped holding?').toBeGreaterThan(0);
  });

  for (const [name, sql] of reasoners) {
    it(`${name} installs production's default_space()`, () => {
      expect(
        PREAMBLE.test(sql),
        `${name} calls home_space_of() but never installs production's default_space().\n` +
          "CI's copy still has 0289's \"biggest space\" fallback, which fills space_id " +
          'non-null and — with two spaces — WRONG, so 0295\'s trigger never fires and the ' +
          'test measures CI\'s schema rather than production\'s. Add:\n\n' +
          '  create or replace function public.default_space()\n' +
          "  returns uuid language sql stable security definer set search_path to 'public' as $fn$\n" +
          '    select public.current_space();\n' +
          '  $fn$;\n',
      ).toBe(true);
    });
  }
});
