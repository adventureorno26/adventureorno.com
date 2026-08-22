import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import Login from './routes/Login';
import LocationTracker from './components/LocationTracker';
import ErrorBoundary from './components/ErrorBoundary';
import Snackbar from './components/Snackbar';
import UploadQueue from './components/UploadQueue';
import PrimaryNav from './components/PrimaryNav';
import ImportResumeBanner from './components/ImportResumeBanner';
import { googlePhotosEnabled, prewarmGooglePhotos } from './lib/googlePhotos';

// After a redeploy, a browser holding a STALE index.html asks for old chunk
// hashes that no longer exist (404) → the dynamic import rejects and the page
// looks broken (e.g. "the map didn't load"). Self-heal: on the first such
// failure, reload ONCE to fetch fresh assets (guarded so we never loop). Erica
// dislikes manual hard-refreshes — this makes the app recover on its own.
function lazyWithReload<T extends ComponentType<unknown>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    const KEY = 'ao-chunk-reloaded';
    try {
      const mod = await factory();
      sessionStorage.removeItem(KEY); // healthy load → allow a future retry
      return mod;
    } catch (e) {
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, '1');
        window.location.reload();
        return new Promise<{ default: T }>(() => {}); // hold render while reloading
      }
      throw e; // already retried once — surface the real error
    }
  });
}

// Secondary routes stay code-split (their JS loads only when visited).
// MapView owns MapLibre (~the largest dependency). Lazy-loaded so the login shell
// does NOT download the MapLibre JS chunk; only the small maplibre-gl.css stays eager
// in main.tsx (it must load before index.css or the map collapses to 0 height). The
// map's Suspense fallback covers the one-time chunk fetch on the authenticated landing.
const MapView = lazyWithReload(() => import('./routes/MapView'));
const RoutesView = lazyWithReload(() => import('./routes/RoutesView'));
const DayView = lazyWithReload(() => import('./routes/DayView'));
const PlacesEditor = lazyWithReload(() => import('./routes/PlacesEditor'));
const PhotoSorter = lazyWithReload(() => import('./routes/PhotoSorter'));
const Trash = lazyWithReload(() => import('./routes/Trash'));
const AttentionDashboard = lazyWithReload(() => import('./routes/AttentionDashboard'));
const SmartAlbums = lazyWithReload(() => import('./routes/SmartAlbums'));
// PlacesList and Timeline are no longer routed from here: they are TABS inside Insights
// (2026-08-22), which imports them directly. /places and /timeline redirect there.
const Insights = lazyWithReload(() => import('./routes/Insights'));
const Duplicates = lazyWithReload(() => import('./routes/Duplicates'));
const Compare = lazyWithReload(() => import('./routes/Compare'));
const DataHealth = lazyWithReload(() => import('./routes/DataHealth'));
const ExportPage = lazyWithReload(() => import('./routes/ExportPage'));
const PersonPage = lazyWithReload(() => import('./routes/PersonPage'));
// The review queue, and the recent-activities page — they are the same screen.
// ONE door for getting things in: add, import, sort, and the review queue.
const AddPage = lazyWithReload(() => import('./routes/AddPage'));
const ImportComplete = lazyWithReload(() => import('./routes/ImportComplete'));
const Settings = lazyWithReload(() => import('./routes/Settings'));
const Wrapped = lazyWithReload(() => import('./routes/Wrapped'));
const BucketList = lazyWithReload(() => import('./routes/BucketList'));
const ImportTimeline = lazyWithReload(() => import('./routes/ImportTimeline'));
const VisitPage = lazyWithReload(() => import('./routes/VisitPage'));

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return <div className="center-screen">{children}</div>;
}

/** Gate: no authenticated session OR no profile row → bounce to /login. */
/** "Loading…" that eventually admits something is wrong instead of spinning forever.
 *
 *  Deliberately NOT driven by navigator.onLine alone: with the network cut, Chromium
 *  still reported onLine === true in testing, and captive portals lie the same way.
 *  A timer measures what actually matters — nothing has arrived — so this is honest
 *  whether the cause is being offline, a captive portal, or a dead backend. */
function LoadingOrOffline() {
  const [stalled, setStalled] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const t = setTimeout(() => setStalled(true), 6000);
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      clearTimeout(t);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (offline)
    return (
      <FullScreenMessage>
        You&rsquo;re offline — this will load when you&rsquo;re back.
      </FullScreenMessage>
    );
  if (stalled) {
    return (
      <FullScreenMessage>
        Still trying — you may be offline. This will load when the connection is back.
      </FullScreenMessage>
    );
  }
  return <FullScreenMessage>Loading…</FullScreenMessage>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  // Ask once, on sign-in, whether Google Photos is already connected. A click can
  // only open ONE pop-up, so the picker flow has to know the answer before the tap
  // rather than discovering it half a second too late.
  const signedIn = Boolean(session && profile);
  useEffect(() => {
    if (!signedIn || !googlePhotosEnabled()) return;
    void prewarmGooglePhotos().catch(() => undefined);
  }, [signedIn]);

  // Offline, the session check cannot complete, so "Loading…" would spin forever.
  // The shell is cached and boots fine; say what is actually wrong instead.
  if (loading) return <LoadingOrOffline />;
  if (!session || !profile) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingOrOffline />}>
        <LocationTracker />
        {/* Main landmark — display:contents adds the semantic landmark for screen
            readers without introducing any box/layout change. */}
        <main style={{ display: 'contents' }}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <MapView />
                </RequireAuth>
              }
            />
            {/* Place panel is rendered inside MapView; deep-link routes to the same view. */}
            <Route
              path="/place/:id"
              element={
                <RequireAuth>
                  <MapView />
                </RequireAuth>
              }
            />
            <Route
              path="/place/:id/routes"
              element={
                <RequireAuth>
                  <RoutesView />
                </RequireAuth>
              }
            />
            <Route
              path="/place/:id/day/:date"
              element={
                <RequireAuth>
                  <DayView />
                </RequireAuth>
              }
            />
            <Route
              path="/wrapped"
              element={
                <RequireAuth>
                  <Wrapped />
                </RequireAuth>
              }
            />
            {/* INSIGHTS — Overview | Places | Timeline, one people/time scope for all three.
                The approved third destination (2026-08-22). */}
            <Route
              path="/insights"
              element={
                <RequireAuth>
                  <Insights />
                </RequireAuth>
              }
            />
            {/* The two old destinations keep working: "old routes redirect until links and
                saved URLs have migrated". They land on the tab they used to be. */}
            <Route path="/places" element={<Navigate to="/insights?tab=places" replace />} />
            <Route
              path="/places/edit"
              element={
                <RequireAuth>
                  <PlacesEditor />
                </RequireAuth>
              }
            />
            <Route
              path="/photos/sort"
              element={
                <RequireAuth>
                  <PhotoSorter />
                </RequireAuth>
              }
            />
            <Route
              path="/bucket"
              element={
                <RequireAuth>
                  <BucketList />
                </RequireAuth>
              }
            />
            <Route
              path="/settings/import"
              element={
                <RequireAuth>
                  <ImportTimeline />
                </RequireAuth>
              }
            />
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <Settings />
                </RequireAuth>
              }
            />
            <Route
              path="/trash"
              element={
                <RequireAuth>
                  <Trash />
                </RequireAuth>
              }
            />
            <Route
              path="/attention"
              element={
                <RequireAuth>
                  <AttentionDashboard />
                </RequireAuth>
              }
            />
            <Route
              path="/albums"
              element={
                <RequireAuth>
                  <SmartAlbums />
                </RequireAuth>
              }
            />
            <Route path="/timeline" element={<Navigate to="/insights?tab=timeline" replace />} />
            <Route
              path="/duplicates"
              element={
                <RequireAuth>
                  <Duplicates />
                </RequireAuth>
              }
            />
            <Route
              path="/place/:id/compare"
              element={
                <RequireAuth>
                  <Compare />
                </RequireAuth>
              }
            />
            <Route
              path="/health"
              element={
                <RequireAuth>
                  <DataHealth />
                </RequireAuth>
              }
            />
            {/* Export & backup. Settings and Data health each offered an "export" that
                was 162 places and said it was everything; both now point here, where
                the places, the outings and the whole archive are three separate things
                that each say what they contain (§3e Step 7). */}
            <Route
              path="/export"
              element={
                <RequireAuth>
                  <ExportPage />
                </RequireAuth>
              }
            />
            {/* One person's memories — a target route in the approved navigation, and the
                other half of §8b-i: tagging without retrieval is half a feature. */}
            <Route
              path="/people/:personId"
              element={
                <RequireAuth>
                  <PersonPage />
                </RequireAuth>
              }
            />
            {/* The review queue lives inside /add now; keep the old path working. */}
            {/* /inbox redirects to the REPAIR screen. It used to land on /add, which is where
                the cards happened to be embedded — a link named for reviewing that opened the
                page named for creating. One verb per screen (2026-08-20). */}
            <Route path="/inbox" element={<Navigate to="/attention" replace />} />
            {/* A visit is a thing you can open: what you did, its photos, a note,
                and the corrections for when something landed in the wrong place. */}
            <Route
              path="/visit/:id"
              element={
                <RequireAuth>
                  <VisitPage />
                </RequireAuth>
              }
            />
            {/* /trips, /trip/:id and /trips/review/:id are gone with the trips
                table (migration 0137). A trip is a visit you marked, shown on the
                place's own card. */}
            {/* /add was a five-step wizard that could add neither photos nor a
                Google Photos import. It is one sheet over the map now; the old
                path still works so bookmarks and the import-return flow don't
                dead-end. */}
            <Route
              path="/add"
              element={
                <RequireAuth>
                  <AddPage />
                </RequireAuth>
              }
            />
            <Route
              path="/photos/import/complete"
              element={
                <RequireAuth>
                  <ImportComplete />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <PrimaryNav />
        <ImportResumeBanner />
        <Snackbar />
        <UploadQueue />
      </Suspense>
    </ErrorBoundary>
  );
}
