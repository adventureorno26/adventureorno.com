import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerServiceWorker, watchForNewBuild } from './lib/pwa';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import App from './App';
// MapLibre's stylesheet MUST load before ours so our .map-canvas / route-map
// rules win. It used to ride in with the eager MapView bundle; once MapView
// became lazy it started loading AFTER index.css and MapLibre's
// `.maplibregl-map { position: relative }` overrode our sizing → every map
// (main, route preview, routes view, trail sections) collapsed to 0 height.
import 'maplibre-gl/dist/maplibre-gl.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

// Offline mode. The worker caches the HTML shell network-first and content-hashed
// assets permanently, so a deploy is always picked up while the app still opens on a
// bad connection. `?sw=off` unregisters it and clears every cache — see lib/pwa.ts.
registerServiceWorker();
// And notice when a deploy lands while this tab is open — /version.json was being
// stamped on every build and read by nobody.
watchForNewBuild();
