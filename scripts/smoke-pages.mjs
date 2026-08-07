// Smoke a deployed Pages URL: routing, SPA fallback, assets, security headers and
// exact build provenance. Used for BOTH the pull-request preview deployment and the
// post-production check, so a merge candidate is proven before it can be promoted
// (COMPLETION-PLAN Phase 1, blockers 3–4).
//
// Env:
//   SMOKE_BASE_URL  required — the deployment to check
//   EXPECTED_SHA    required — the exact commit the build claims to be
const baseUrl = process.env.SMOKE_BASE_URL;
const expectedSha = process.env.EXPECTED_SHA;

if (!baseUrl || !expectedSha) {
  throw new Error('SMOKE_BASE_URL and EXPECTED_SHA are required.');
}

async function get(path) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(new URL(path, baseUrl), { redirect: 'follow' });
      if (response.ok) return response;
      lastError = new Error(`${path} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
  throw lastError;
}

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// --- Routing + SPA shell ------------------------------------------------------
const login = await get('/login');
const html = await login.text();
check(html.includes('<div id="root">'), '/login did not return the SPA shell.');

const unknown = await get('/phase-1-smoke-unknown-route');
check(
  (await unknown.text()).includes('<div id="root">'),
  'Unknown-route SPA fallback did not return the app shell.',
);

// --- Assets -------------------------------------------------------------------
const assetPath = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
if (!assetPath) {
  failures.push('No built asset was referenced by /login.');
} else {
  const asset = await get(assetPath);
  check(
    /max-age=31536000/.test(asset.headers.get('cache-control') || ''),
    `Hashed asset ${assetPath} is not immutably cached (cache-control: ${asset.headers.get('cache-control')}).`,
  );
}

// --- Security headers ---------------------------------------------------------
// Previously only the CORS wildcard was checked, so a dropped CSP or HSTS would
// have sailed through a green smoke run.
const acao = login.headers.get('access-control-allow-origin');
check(acao !== '*', '/login still exposes wildcard Access-Control-Allow-Origin.');

const required = {
  'content-security-policy': /default-src 'self'/,
  'strict-transport-security': /max-age=\d+/,
  'x-frame-options': /DENY/i,
  'x-content-type-options': /nosniff/i,
  'referrer-policy': /strict-origin-when-cross-origin/i,
  'permissions-policy': /geolocation=/i,
  'cross-origin-opener-policy': /same-origin/i,
};
for (const [header, pattern] of Object.entries(required)) {
  const value = login.headers.get(header);
  if (!value) failures.push(`Missing security header: ${header}.`);
  else if (!pattern.test(value)) failures.push(`Header ${header} did not match expectation: ${value}`);
}

// The SPA shell must never be cached, or a new deploy serves stale HTML against
// new hashed assets (the "unstyled page" failure mode).
check(
  /no-cache/.test(login.headers.get('cache-control') || ''),
  `/login HTML must not be cached (cache-control: ${login.headers.get('cache-control')}).`,
);

// --- Build provenance ---------------------------------------------------------
const version = await (await get('/version.json')).json();
check(
  version.sha === expectedSha,
  `SHA mismatch: expected ${expectedSha}, received ${version.sha || 'none'}.`,
);

if (failures.length) {
  console.error(`Pages smoke FAILED for ${baseUrl}:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(
  `Pages smoke passed for ${expectedSha} at ${baseUrl}: routing, SPA fallback, asset caching, ` +
    `security headers, and provenance verified.`,
);
