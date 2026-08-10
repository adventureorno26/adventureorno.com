// Service worker for adventureorno.com.
//
// THE HISTORY MATTERS. This worker was registered once, cached the SPA shell, and
// then served old code while blocking updates — so registration was ripped out and
// replaced with code that unregisters any worker and deletes every cache. That was
// the right emergency fix, and it left the app with no offline mode at all.
//
// The reason it went wrong is worth stating, because it dictates the design: the old
// worker cached EVERYTHING the same way, including index.html. A stale index.html
// points at hashed asset files that no longer exist, which is the "white screen /
// missing CSS" failure Erica already hates from CDN edge caching.
//
// So this worker treats two kinds of request completely differently:
//
//   NAVIGATIONS / HTML  -> network first, always. The cache is ONLY a fallback for
//                          being offline. You can never be served stale HTML online.
//   /assets/<hash>.*    -> cache first. Vite content-hashes these, so a given URL's
//                          bytes can never change. Caching them forever is not a
//                          risk, it is the definition of the file.
//
// And two things it will not do:
//
//   CROSS-ORIGIN        -> untouched. Supabase, the photo gateway and MapTiler are
//                          all other origins, so private photo bytes and authed API
//                          responses are never written to a cache. That is rule #8
//                          holding by construction rather than by care.
//   NON-GET             -> untouched.
//
// Kill switch: load any page with ?sw=off and the app unregisters this worker and
// clears its caches (see app/src/lib/pwa.ts). If this ever misbehaves, that is the
// one-step escape.

// Bump when the worker's LOGIC changes. Hashed assets are immutable, so the cache
// does not need a new name per deploy — only a change in how caching works does.
const VERSION = 'v4';
const SHELL = `aon-shell-${VERSION}`;
const ASSETS = `aon-assets-${VERSION}`;
const OFFLINE_URL = '/index.html';
// Assets are immutable, so entries are only ever evicted to bound disk use.
const MAX_ASSETS = 220;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll([OFFLINE_URL, '/manifest.webmanifest']))
      .catch(() => undefined)
      // Take over promptly; the page decides when to reload (pwa.ts).
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Keep the immutable-asset cache from growing without bound. */
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never touch another origin: no Supabase responses, no signed photo bytes, no
  // tiles. Those go straight to the network as though this worker did not exist.
  if (url.origin !== self.location.origin) return;

  // Content-hashed and immutable: cache first, and a hit is always correct.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches
                .open(ASSETS)
                .then((c) => c.put(request, copy))
                .then(() => trim(ASSETS, MAX_ASSETS))
                .catch(() => undefined);
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else on this origin — the HTML shell, the manifest, icons,
  // version.json — is network first so a deploy is picked up immediately.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && (request.mode === 'navigate' || url.pathname === OFFLINE_URL)) {
          const copy = res.clone();
          caches
            .open(SHELL)
            .then((c) => c.put(OFFLINE_URL, copy))
            .catch(() => undefined);
        }
        return res;
      })
      .catch(async () => {
        // Offline. Serve the app shell for a navigation so the SPA can boot and show
        // its own offline state, rather than the browser's dinosaur.
        if (request.mode === 'navigate') {
          return (await caches.match(OFFLINE_URL)) ?? Response.error();
        }
        return (await caches.match(request)) ?? Response.error();
      }),
  );
});

// The page asks for the waiting worker to take over after she accepts an update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
