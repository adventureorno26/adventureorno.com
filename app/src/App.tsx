import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import Login from './routes/Login';
import MapView from './routes/MapView';

// Non-landing routes are code-split so their JS (and @mapbox/polyline in the
// routes view) stays out of the initial map bundle.
const RoutesView = lazy(() => import('./routes/RoutesView'));
const DayView = lazy(() => import('./routes/DayView'));
const Settings = lazy(() => import('./routes/Settings'));
const Trips = lazy(() => import('./routes/Trips'));
const ImportTimeline = lazy(() => import('./routes/ImportTimeline'));

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
    <Suspense fallback={<FullScreenMessage>Loading…</FullScreenMessage>}>
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
