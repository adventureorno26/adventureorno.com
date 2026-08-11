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

// ---------------------------------------------------------------------------
// "Make sure all of the changes we made today are live" (Erica, 2026-08-11).
//
// /version.json has been stamped on every build for months and NOTHING read it.
// So a tab that was already open when a deploy landed had no way to know: the
// service worker only offers a reload when sw.js ITSELF changes, and sw.js does
// not change per deploy — by design, since its caching logic is what is versioned.
//
// The result was the worst kind of wrong: the site was updated, the person looking
// at it was not, and nothing on screen said so. Now the running bundle carries the
// SHA it was built from, and the app compares itself to what is deployed — on boot,
// and whenever the tab is brought back to the front. Different SHA, and the same
// "A new version is ready" snack appears, with Reload.
//
// It never reloads on its own: reloading under someone mid-edit is its own bug.
declare const __BUILD_SHA__: string;

const RUNNING_SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'unknown';
let offering = false;
let lastCheck = 0;

async function deployedSha(): Promise<string | null> {
  try {
    // no-store, or the check itself would be answered from cache.
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { sha?: string };
    return typeof body.sha === 'string' ? body.sha : null;
  } catch {
    return null; // offline: nothing to say
  }
}

async function checkForNewBuild(): Promise<void> {
  if (offering || RUNNING_SHA === 'unknown') return;
  const now = Date.now();
  if (now - lastCheck < 30_000) return; // a tab switch is not a reason to spam
  lastCheck = now;

  const live = await deployedSha();
  if (!live || live === RUNNING_SHA) return;

  offering = true;
  showSnack({
    message: 'A new version is ready.',
    actionLabel: 'Reload',
    onAction: () => {
      // The HTML is network-first, so a plain reload is enough to pick up the new
      // bundle; the hashed assets it names are simply not in the cache yet.
      window.location.reload();
    },
  });
}

/** Watch for a deploy landing while this tab is open. Safe to call once, at boot. */
export function watchForNewBuild(): void {
  if (typeof window === 'undefined') return;
  void checkForNewBuild();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForNewBuild();
  });
}
