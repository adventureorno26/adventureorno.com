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

const login = await get('/login');
const html = await login.text();
if (!html.includes('<div id="root">')) throw new Error('/login did not return the SPA shell.');
if (login.headers.get('access-control-allow-origin') === '*') {
  throw new Error('/login still exposes wildcard Access-Control-Allow-Origin.');
}

const unknown = await get('/phase-1-smoke-unknown-route');
if (!(await unknown.text()).includes('<div id="root">')) {
  throw new Error('Unknown-route SPA fallback did not return the app shell.');
}

const assetPath = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
if (!assetPath) throw new Error('No built asset was referenced by /login.');
await get(assetPath);

const version = await (await get('/version.json')).json();
if (version.sha !== expectedSha) {
  throw new Error(`Production SHA mismatch: expected ${expectedSha}, received ${version.sha || 'none'}.`);
}

console.log(`Pages smoke passed for ${expectedSha}: routes, asset, headers, and provenance verified.`);
