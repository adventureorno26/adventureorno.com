import { lazy, Suspense, useEffect, type ComponentType } from 'react';
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
const PlacesList = lazyWithReload(() => import('./routes/PlacesList'));
const PlacesEditor = lazyWithReload(() => import('./routes/PlacesEditor'));
const PhotoSorter = lazyWithReload(() => import('./routes/PhotoSorter'));
const Trash = lazyWithReload(() => import('./routes/Trash'));
const AttentionDashboard = lazyWithReload(() => import('./routes/AttentionDashboard'));
const SmartAlbums = lazyWithReload(() => import('./routes/SmartAlbums'));
const Timeline = lazyWithReload(() => import('./routes/Timeline'));
const Duplicates = lazyWithReload(() => import('./routes/Duplicates'));
const Compare = lazyWithReload(() => import('./routes/Compare'));
const DataHealth = lazyWithReload(() => import('./routes/DataHealth'));
// The review queue, and the recent-activities page — they are the same screen.
const Inbox = lazyWithReload(() => import('./routes/Inbox'));
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

  if (loading) return <FullScreenMessage>Loading…</FullScreenMessage>;
  if (!session || !profile) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<FullScreenMessage>Loading…</FullScreenMessage>}>
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
            <Route
              path="/places"
              element={
                <RequireAuth>
                  <PlacesList />
                </RequireAuth>
              }
            />
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
            <Route
              path="/timeline"
              element={
                <RequireAuth>
                  <Timeline />
                </RequireAuth>
              }
            />
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
            {/* A machine may only propose; this is where a person decides. */}
            <Route
              path="/inbox"
              element={
                <RequireAuth>
                  <Inbox />
                </RequireAuth>
              }
            />
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
            <Route path="/add" element={<Navigate to="/?add=1" replace />} />
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
