// THE STABILIZATION GATE, ASKED THE WAY THE GATE ASKS IT.
//
// docs/STATE.md has carried these two unticked for weeks:
//
//   "Erica can sign in, open a place card, edit and save a visit, reload, and see the
//    saved result."
//   "Josh can sign in and perform every action allowed to the editor role without seeing
//    an unexplained permission or save failure."
//
// `mutating.spec.ts` covers owner/editor/viewer thoroughly and deliberately does it at
// the API boundary — its own comment says why, and it is right: RLS is what enforces
// authorization, and a UI that merely hides a button would pass a click-based test while
// leaving the endpoint open.
//
// BUT THAT IS A DIFFERENT QUESTION FROM THIS ONE. Seven of its eight mutating tests use
// `{ request }`; the only `{ page }` test is about signing out. So nothing anywhere
// asserted that a person typing into the app gets their words back after a reload — and
// this file's own rule is **when the database and the screen disagree, the screen is
// right**. An RPC returning 200 is not a person seeing their note.
//
// The gap this closes is exactly the shape of 2026-08-16: a thing that was true in the
// database and not true on the screen, believed because the database was asked.
//
// MUTATING, so it is hard-gated to a local disposable stack the same way mutating.spec is.
import { roleTest as test, expect, getRoleToken, supabaseEnv, isLocalSupabase } from './fixtures';
import type { APIRequestContext } from '@playwright/test';

const RUN = isLocalSupabase();

test.skip(
  !RUN,
  'Acceptance flows write, so they require a LOCAL disposable Supabase stack (VITE_SUPABASE_URL must be localhost).',
);

const RUN_ID = Date.now().toString(36);

// THESE FIXTURES ARE REMOVED AFTERWARDS, and that is not tidiness — it is correctness
// for the OTHER specs.
//
// The first version left its places behind, and `nav-obstruction.spec.ts` went red on
// mobile-android: one of these rows ended up under the floating nav on /settings. Every
// spec shares one disposable database in a single run, so a test that permanently adds
// content is quietly changing the fixture every later test is measured against.
//
// It surfaced a real finding on the way — /settings still sets its bottom padding with a
// hardcoded inline `96px` instead of the shared `--pnav-clearance`, and nav-obstruction's
// own comment records that inline-wrapper pattern as the bug the other routes were fixed
// for. That is reported separately rather than fixed here; this file's job is to leave
// the database as it found it.
test.afterAll(async ({ playwright }, testInfo) => {
  if (!RUN) return;
  const { url } = supabaseEnv();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return; // Nothing to clean with; the stack is disposable regardless.

  const api = await playwright.request.newContext();
  try {
    // Children first: a place with visits cannot simply vanish, and the FK would set
    // their parent to NULL without saying so.
    // SCOPED TO THIS PROJECT'S OWN ROWS. The first cleanup matched every
    // "E2E Acceptance *" place, and the four Playwright projects run CONCURRENTLY — so
    // the first project to finish deleted the fixtures the other three were still using,
    // and three unrelated tests went red. A shared disposable database makes "delete my
    // test data" and "delete the test data" two very different statements.
    const mine = `${testInfo.project.name}-${RUN_ID}`;
    const places = await api.get(
      `${url}/rest/v1/places?select=id&name=like.${encodeURIComponent('*' + mine)}`,
      { headers: { apikey: secret, Authorization: `Bearer ${secret}` } },
    );
    if (!places.ok()) return;
    const ids = ((await places.json()) as { id: string }[]).map((p) => p.id);
    if (ids.length === 0) return;

    const inList = `(${ids.join(',')})`;
    const headers = { apikey: secret, Authorization: `Bearer ${secret}` };
    await api.delete(`${url}/rest/v1/visits?place_id=in.${inList}`, { headers });
    await api.delete(`${url}/rest/v1/places?id=in.${inList}`, { headers });
  } finally {
    await api.dispose();
  }
});

/** Create a place with one visit and hand back the visit id, as the given role. */
async function seedVisit(
  request: APIRequestContext,
  role: 'owner' | 'editor',
  project: string,
  label: string,
): Promise<{ placeId: string; visitId: string }> {
  const { url, key } = supabaseEnv();
  const token = await getRoleToken(role);
  const headers = {
    apikey: key,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const res = await request.post(`${url}/rest/v1/rpc/create_experience`, {
    headers,
    data: {
      // Namespaced per run AND per project: create_experience is idempotent by key, and
      // four Playwright projects sharing one key would assert against each other's rows.
      p_key: `e2e-accept-${project}-${RUN_ID}-${label}`,
      p_place: {
        name: `E2E Acceptance ${label} ${project}-${RUN_ID}`,
        lat: 1.4321,
        lng: 2.6543,
        country: 'Testland',
        admin1: 'Test Region',
        categories: ['viewpoint'],
      },
      p_visit: { date: '2026-06-11', who: 'both' },
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  const body = await res.json();
  expect(body.visit_id, 'a visit date was supplied, so a visit must exist').toBeTruthy();
  return { placeId: body.place_id, visitId: body.visit_id };
}

for (const role of ['owner', 'editor'] as const) {
  const who = role === 'owner' ? 'Erica' : 'Josh';

  test.describe(`${who} (${role}) drives the app`, () => {
    test(`${who} edits a visit note, reloads, and the note is still there`, async ({
      page,
      request,
      signInAs,
    }, testInfo) => {
      const { visitId } = await seedVisit(request, role, testInfo.project.name, `note-${role}`);
      await signInAs(role);

      await page.goto(`/visit/${visitId}`);

      // The note is the plainest edit-and-save on the visit page, and it saves on BLUR
      // rather than on a Save button — which is itself worth pinning down: a test that
      // typed and navigated away without blurring would pass while saving nothing.
      const note = page.locator('textarea.visit-note');
      await expect(
        note,
        'an editor role must get the editable note, not read-only text',
      ).toBeVisible();

      const words = `${who} was here — ${RUN_ID}`;
      await note.fill(words);
      await note.blur();

      // Wait for the write to land rather than racing it. `run()` reloads the visit after
      // saving, so the value surviving a re-render is the first real signal.
      await expect(note).toHaveValue(words);

      // THE ACTUAL QUESTION. Not "did the RPC return 200" — did a person get their words
      // back from a cold page.
      await page.reload();
      await expect(
        page.locator('textarea.visit-note'),
        'the note must survive a reload — this is the gate item, verbatim',
      ).toHaveValue(words);
    });

    test(`${who} opens the place card and it shows the visit`, async ({
      page,
      request,
      signInAs,
    }, testInfo) => {
      const { placeId } = await seedVisit(request, role, testInfo.project.name, `card-${role}`);
      await signInAs(role);

      await page.goto(`/place/${placeId}`);

      // "open a place card" from the gate. The card must actually render the place AND
      // know about the visit, not be an empty shell — an empty card passes every "does it
      // show?" check for the wrong reason, which is the trap the 0196 test fell into on
      // its first draft.
      await expect(page.getByText(`E2E Acceptance card-${role}`, { exact: false })).toBeVisible();

      // ASSERT THE COUNT, NOT THE YEAR. The first version of this looked for "2026" and
      // failed against a perfectly good card: the years live inside the Visits <details>,
      // which is COLLAPSED, so the text is in the DOM and hidden. `Visits (1)` is on the
      // summary itself, is always visible, and says more — the card counted the visit
      // rather than merely containing its date somewhere.
      await expect(page.getByText('Visits (1)')).toBeVisible();
      await expect(page.getByText('Visited once')).toBeVisible();
    });

    test(`${who} sees no permission or save failure while doing it`, async ({
      page,
      request,
      signInAs,
    }, testInfo) => {
      const { visitId } = await seedVisit(request, role, testInfo.project.name, `quiet-${role}`);
      await signInAs(role);

      // "without seeing an unexplained permission or save failure" is a real assertion,
      // not a mood: the app surfaces failures through a snack, and `run()` shows
      // "That did not save." for anything it could not write.
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });

      await page.goto(`/visit/${visitId}`);
      const note = page.locator('textarea.visit-note');
      await note.fill(`quiet ${RUN_ID}`);
      await note.blur();
      await expect(note).toHaveValue(`quiet ${RUN_ID}`);

      await expect(page.getByText('That did not save.')).toHaveCount(0);
      await expect(
        page.getByText(/permission denied|not authorized|row-level security/i),
      ).toHaveCount(0);

      const denied = errors.filter((e) => /42501|permission denied|not authorized/i.test(e));
      expect(denied, `${who} hit an authorization error in the console`).toEqual([]);
    });
  });
}
