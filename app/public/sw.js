// Service worker — NETWORK-FIRST so the app always loads the latest code when
// online (cache is only a fallback for offline). It must never cache photo bytes
// (private, signed reads) or the Supabase/worker APIs — those are cross-origin
// and skipped entirely.

const CACHE = 'aon-v3';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/index.html']).catch(() => undefined)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Only handle our own origin; never touch cross-origin (Supabase, photo
  // gateway, MapTiler) so uploads/reads always go straight to the network.
  if (url.origin !== self.location.origin) return;

  // Network-first: fetch fresh, cache a copy, fall back to cache only if offline.
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => undefined);
        return res;
      })
      .catch(() =>
        caches.match(request).then((hit) => hit ?? caches.match('/index.html')),
      ),
  );
});
