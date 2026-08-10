// Registering the service worker, and the escape hatch for when that was a mistake.
//
// The app previously UNREGISTERED every worker on boot, because a cached shell had
// served stale code and blocked updates. public/sw.js now caches HTML network-first
// and only treats content-hashed /assets/* as permanent, so that failure cannot
// recur — but the fear was well earned, so the kill switch below is deliberate:
//
//   adventureorno.com/?sw=off
//
// unregisters the worker, deletes every cache, and remembers the choice, so one URL
// gets back to exactly today's behaviour without a deploy. `?sw=on` re-enables it.
import { showSnack } from './snackbar';

const OFF_KEY = 'aon-sw-off';

/** Tear the worker out and clear its caches. Safe to call when none is registered. */
export async function disableServiceWorker(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((regs ?? []).map((r) => r.unregister()));
  } catch {
    /* nothing registered */
  }
  // Clear TWICE, with a tick between. The first pass can race a fetch that the
  // still-controlling worker services and re-caches, which left a cache behind in
  // testing — and a kill switch that half-works is worse than none.
  const clear = async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  };
  try {
    await clear();
    await new Promise((r) => setTimeout(r, 250));
    await clear();
  } catch {
    /* no cache storage */
  }
}

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  const params = new URLSearchParams(window.location.search);
  if (params.get('sw') === 'off') {
    localStorage.setItem(OFF_KEY, '1');
    // Reload afterwards, dropping the flag. Clearing caches while the old worker is
    // still CONTROLLING this page loses the race — it services a fetch and re-caches
    // it. The next load is uncontrolled, and the OFF_KEY branch below clears again
    // with nothing left to fight it.
    void disableServiceWorker().then(() => window.location.replace(window.location.pathname));
    return;
  }
  if (params.get('sw') === 'on') localStorage.removeItem(OFF_KEY);
  if (localStorage.getItem(OFF_KEY)) {
    void disableServiceWorker();
    return;
  }

  // Registration waits for load so it never competes with the first render.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener('statechange', () => {
            // A worker that reaches "installed" while another controls the page is a
            // NEW version waiting. Offer the reload rather than taking it silently —
            // reloading under someone mid-edit is its own bug.
            if (next.state === 'installed' && navigator.serviceWorker.controller) {
              showSnack({
                message: 'A new version is ready.',
                actionLabel: 'Reload',
                onAction: () => {
                  next.postMessage('SKIP_WAITING');
                  window.location.reload();
                },
              });
            }
          });
        });
      })
      .catch(() => {
        /* offline mode is a nicety; never let it break startup */
      });
  });
}
