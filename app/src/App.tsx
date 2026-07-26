import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import Login from './routes/Login';
// MapView is the landing view and owns the MapLibre map + all its markers. It is
// imported EAGERLY on purpose: lazy-loading it split MapLibre's CSS/JS into a
// chunk that loaded after our styles (maps collapsed to 0 height, markers/route
// maps broke) and made the map appear only after a second chunk download (slow).
// Eager keeps the map instant and correct; the login shell paying for MapLibre is
// an acceptable trade for the map actually working.
import MapView from './routes/MapView';
import LocationTracker from './components/LocationTracker';
import ErrorBoundary from './components/ErrorBoundary';
import Snackbar from './components/Snackbar';

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
const Settings = lazyWithReload(() => import('./routes/Settings'));
const Trips = lazyWithReload(() => import('./routes/Trips'));
const Wrapped = lazyWithReload(() => import('./routes/Wrapped'));
const BucketList = lazyWithReload(() => import('./routes/BucketList'));
const ImportTimeline = lazyWithReload(() => import('./routes/ImportTimeline'));

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return <div className="center-screen">{children}</div>;
}

/** Gate: no authenticated session OR no profile row → bounce to /login. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

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
          path="/trips"
          element={
            <RequireAuth>
              <Trips />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Snackbar />
      </Suspense>
    </ErrorBoundary>
  );
}
