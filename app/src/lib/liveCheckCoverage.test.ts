// A ROUTE MAY NOT SHIP WITHOUT A LIVE CHECK — AND THE LIST OF EXCEPTIONS MAY ONLY SHRINK.
//
// Erica, 2026-08-30: *"i have asked for several things today and you keep doing halfass
// work then checking shit off as done. write some guardrails to stop yourself from doing
// bullshit work."*
//
// THE FAILURE THIS EXISTS FOR, and it is recent and specific. §"CONNECTING TO SOMEONE —
// approved 2026-08-30" shipped to production across PRs #188, #192, #193 and #194: a
// people directory at `/people`, a public profile at `/profile/:handle`, add/remove/block,
// and invite codes at `/settings/account/invites`. `e2e/erica-asked-for.spec.ts` — the file
// whose rule 1 says *"A new request from Erica gets a check here BEFORE the work starts"* —
// had THIRTY checks and not one of them mentioned people, profiles, handles, blocking or
// invites. Nothing was red, so `docs/STATE.md` went on calling item 7 *queued* while it was
// live and working, and nobody could tell the difference from inside the repo.
//
// A count of zero checks proves nothing until something asserts it should be non-zero.
// That is this file.
//
// WHY A RATCHET RATHER THAN A BAN. Seventeen of the thirty-seven routes had no live check
// on the day this was written, and pretending otherwise by allow-listing them silently
// would be the same defect in a new place. So they are listed BELOW, by name, each with the
// reason it is not covered — and the test fails if the list grows, if a route is added to
// the router without either a check or an entry here, or if a listed route GAINS a check
// and is not removed from the list. The only direction it can move is down.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const APP = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const SPEC = readFileSync(new URL('../../e2e/erica-asked-for.spec.ts', import.meta.url), 'utf8');

/** Every `path="…"` the router declares. */
export function routesOf(appSource: string): string[] {
  return [...new Set([...appSource.matchAll(/path="([^"]+)"/g)].map((m) => m[1]))]
    .filter((p) => p !== '*')
    .sort();
}

/** The part of a route before its first parameter — what a check would actually type. */
export function matchableBase(route: string): string {
  return route.split('/:')[0];
}

/** Source with its comments removed.
 *
 *  A ROUTE NAMED IN A COMMENT IS NOT A CHECKED ROUTE, and the first version of this file
 *  counted one as covered. On 2026-08-30 a comment explaining that `/inbox` redirects to
 *  `/settings/data/attention` made THREE listed routes look checked, and the ratchet
 *  demanded they be struck off the exception list — which would have recorded them as
 *  covered when nothing asserts anything about them. That is precisely the "checked off
 *  without being checked" this file exists to stop, arriving inside the guard itself.
 *  `participants.test.ts` had already learned the same lesson and strips comments before
 *  applying its rule; so does this now. */
const stripComments = (src: string) =>
  src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Does the live spec actually GO to this route — in code, not in prose? */
export function isCovered(route: string, specSource: string): boolean {
  const base = matchableBase(route);
  if (!base || base === '/') return true; // the map is the root and every check loads it
  return stripComments(specSource).includes(base);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE EXCEPTIONS, each with the reason it has no live check. Shrink this list;
// never extend it without a reason that would survive being read aloud.
// ─────────────────────────────────────────────────────────────────────────────
export const UNCOVERED: Record<string, string> = {
  '/login': 'signed-out screen; `verify:live` is signed in as the test bot throughout',
  '/health': 'an operator diagnostic, not something Erica asked for',
  '/wrapped': 'seasonal summary; nothing in STATE.md asks for it to be checked live',
  '/albums': 'no request recorded against it',
  '/places/edit': 'the bulk editor; item 4s strings are superseded and need re-measuring first',
  '/duplicates': 'reached from an Attention tile that IS checked; the page itself is not',
  '/photos/sort': 'covered indirectly by the Move-Import-and-Sort check, not by its own',
  '/photos/import/complete': 'an OAuth landing page; needs a real Google round trip',
  '/settings/import': 'legacy alias kept for saved URLs',
  '/settings/data/attention':
    'the destination of a checked redirect; its contents are not asserted',
  '/settings/data/export': 'the destination of a checked redirect; its contents are not asserted',
  '/settings/data/trash': 'the destination of a checked redirect; its contents are not asserted',
  '/attention': 'legacy route; the redirect is asserted by item 10s check, the target is not',
  '/export': 'legacy route; the redirect is asserted by item 10s check, the target is not',
  '/inbox': 'legacy route; the redirect is asserted by item 10s check, the target is not',
  '/trash': 'legacy route; the redirect is asserted by item 10s check, the target is not',
};

describe('every route is either live-checked or listed as a known gap', () => {
  const routes = routesOf(APP);

  it('the router still has routes to check', () => {
    // The positive first: without this, "nothing is uncovered" is also true of a parse
    // that silently matched nothing — the same trap the live spec is built around.
    expect(routes.length).toBeGreaterThan(20);
  });

  it('no route ships without either a live check or a written reason', () => {
    const unexplained = routes.filter((r) => !isCovered(r, SPEC) && !(r in UNCOVERED));
    expect(
      unexplained,
      `These routes exist in App.tsx with no check in e2e/erica-asked-for.spec.ts and no ` +
        `entry in UNCOVERED. Add a live check (preferred) or an honest reason:\n  ` +
        unexplained.join('\n  '),
    ).toEqual([]);
  });

  it('the exception list only shrinks — a covered route may not stay on it', () => {
    const nowCovered = Object.keys(UNCOVERED).filter((r) => isCovered(r, SPEC));
    expect(
      nowCovered,
      `These routes are now referenced by the live spec, so delete them from UNCOVERED:\n  ` +
        nowCovered.join('\n  '),
    ).toEqual([]);
  });

  it('the exception list names only real routes', () => {
    // A stale entry would quietly buy back a slot for a route that no longer exists.
    const ghosts = Object.keys(UNCOVERED).filter((r) => !routes.includes(r));
    expect(
      ghosts,
      `UNCOVERED names routes the router does not have:\n  ${ghosts.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the social screens are checked — the gap that caused this file', () => {
    // Named explicitly rather than left to the general rule, because these are the ones
    // that shipped uncovered and the general rule would let them slide back into UNCOVERED.
    for (const route of ['/people', '/profile', '/settings/account/invites']) {
      expect(SPEC, `${route} lost its live check`).toContain(route);
      expect(Object.keys(UNCOVERED)).not.toContain(route);
    }
  });
});
