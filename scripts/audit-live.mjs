// Read-only audit of a DEPLOYED, authenticated build. Drives real routes at real
// viewports and reports what a green build cannot see: console errors, failed
// requests, blank pages, horizontal overflow, broken images, controls covered by
// other chrome, tiny touch targets and clipped text.
//
// This is how the "Log a visit was untappable on iPhone" defect was found — the
// build was green and the button passed `toBeVisible()`; only hit-testing the
// rendered page caught it. It later found the same defect on five more routes.
//
// READ-ONLY: it never writes. Safe against production.
//
// Usage:
//   AUDIT_BASE_URL=https://adventureorno.com \
//   AUDIT_SESSION='<supabase session json>' \
//   node scripts/audit-live.mjs
//
// Get a session with the dedicated test bot (NEVER Erica's account — a password
// change drops all her refresh tokens and kills her live session):
//   POST $VITE_SUPABASE_URL/auth/v1/token?grant_type=password
//     {"email":"testbot@adventureorno.dev","password":"<current>"}
//
// Known non-defects it still reports, deliberately left for a human decision:
//   * map attribution + Fog/Heat controls under the floating nav — repositioning
//     map chrome is a locked design decision, not an agent's call;
//   * /places/edit controls scrolled out of a 1200px-wide bulk table on a phone;
//   * "tiny-target" on text links, which is Phase 4 touch-target work.
import { chromium, devices } from '@playwright/test';

const BASE = process.env.AUDIT_BASE_URL || 'https://adventureorno.com';
const SESSION = JSON.parse(process.env.AUDIT_SESSION);
const STORAGE_KEY = 'sb-aanfyhsjbtnqzphuoiem-auth-token';

const ROUTES = [
  '/', '/places', '/timeline', '/add', '/settings', '/health',
  '/bucket', '/wrapped', '/photos/sort', '/places/edit',
];

const VIEWPORTS = [
  { name: 'iphone', ...devices['iPhone 13'].viewport },
  { name: 'android', ...devices['Pixel 7'].viewport },
  { name: 'desktop', width: 1440, height: 900 },
];

const findings = [];
const add = (route, viewport, kind, detail) =>
  findings.push({ route, viewport, kind, detail });

const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  await context.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [STORAGE_KEY, JSON.stringify(SESSION)],
  );

  for (const route of ROUTES) {
    const page = await context.newPage();
    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
    });
    page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + String(e).slice(0, 200)));
    page.on('requestfailed', (r) => {
      const u = r.url();
      // Map tiles/analytics noise is not a product defect.
      if (/cloudflareinsights|maptiler|openstreetmap/.test(u)) return;
      failedRequests.push(`${r.failure()?.errorText} ${u.slice(0, 120)}`);
    });

    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 });
    } catch {
      add(route, vp.name, 'navigation', 'did not reach networkidle in 45s');
    }
    await page.waitForTimeout(2500);

    // Did we get bounced to login? That means the session broke, not a real result.
    const url = page.url();
    if (/\/login/.test(url) && route !== '/login') {
      add(route, vp.name, 'auth', `redirected to /login (session not applied)`);
      await page.close();
      continue;
    }

    const probe = await page.evaluate(() => {
      const out = {};
      out.horizontalOverflow =
        document.documentElement.scrollWidth - document.documentElement.clientWidth;

      // Broken images (loaded but zero natural size).
      out.brokenImages = [...document.querySelectorAll('img')]
        .filter((i) => i.complete && i.naturalWidth === 0)
        .map((i) => (i.currentSrc || i.src || '').slice(0, 100))
        .slice(0, 5);

      // Interactive elements whose centre is covered by something else, AFTER
      // scrolling everything to the end (mid-scroll overlap is normal).
      const scrollAll = () => {
        window.scrollTo(0, document.body.scrollHeight);
        for (const el of document.querySelectorAll('*')) {
          const s = getComputedStyle(el);
          if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight)
            el.scrollTop = el.scrollHeight;
        }
      };
      scrollAll();

      const obscured = [];
      for (const el of document.querySelectorAll('button, a[href], input, select, textarea')) {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (r.bottom <= 0 || r.top >= innerHeight) continue;
        const s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') continue;
        const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
        const top = document.elementFromPoint(cx, cy);
        if (!top || el.contains(top) || el === top) continue;
        obscured.push({
          label: (el.textContent || el.getAttribute('aria-label') || '(no label)').trim().slice(0, 40),
          cls: (el.className || '').toString().slice(0, 40),
          coveredBy: (top.className || top.tagName || '').toString().slice(0, 40),
        });
      }
      out.obscured = obscured.slice(0, 6);

      // Controls smaller than a comfortable touch target.
      out.tinyTargets = [...document.querySelectorAll('button, a[href]')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24))
        .map(({ el, r }) => `${(el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`)
        .slice(0, 6);

      // Any visible element whose text is clipped by its own box.
      out.clipped = [...document.querySelectorAll('h1,h2,h3,.place-row-name,.stat-value,button')]
        .filter((el) => el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0)
        .map((el) => (el.textContent || '').trim().slice(0, 30))
        .slice(0, 5);

      out.rootEmpty = (document.querySelector('#root')?.textContent || '').trim().length < 20;
      return out;
    });

    if (probe.rootEmpty) add(route, vp.name, 'blank-page', 'the app rendered nothing');
    if (probe.horizontalOverflow > 1)
      add(route, vp.name, 'overflow', `${probe.horizontalOverflow}px horizontal overflow`);
    for (const img of probe.brokenImages) add(route, vp.name, 'broken-image', img);
    for (const o of probe.obscured)
      add(route, vp.name, 'obscured-control', `"${o.label}" (${o.cls}) covered by ${o.coveredBy}`);
    for (const t of probe.tinyTargets) add(route, vp.name, 'tiny-target', t);
    for (const c of probe.clipped) add(route, vp.name, 'clipped-text', c);
    for (const e of consoleErrors) add(route, vp.name, 'console-error', e);
    for (const f of failedRequests) add(route, vp.name, 'failed-request', f);

    await page.close();
  }
  await context.close();
}

await browser.close();

// Group for a readable report.
const byKind = {};
for (const f of findings) (byKind[f.kind] ||= []).push(f);
console.log(`\n=== AUDIT of ${BASE} — ${findings.length} finding(s) ===\n`);
for (const [kind, list] of Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`## ${kind} (${list.length})`);
  const seen = new Set();
  for (const f of list) {
    const line = `${f.route} @${f.viewport}: ${f.detail}`;
    if (seen.has(line)) continue;
    seen.add(line);
    console.log('   ' + line);
  }
  console.log('');
}
