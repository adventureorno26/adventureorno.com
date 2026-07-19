import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import App from './App';
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

// Stale service-worker caches were serving old code and blocking updates.
// Unregister any existing worker and clear all caches so the app ALWAYS loads
// the latest code from the network.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => undefined);
}
if ('caches' in window) {
  caches
    .keys()
    .then((keys) => keys.forEach((k) => caches.delete(k)))
    .catch(() => undefined);
}
