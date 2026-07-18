/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_MAPTILER_KEY: string;
  // Base URL of the deployed photo-gateway Worker. Unset until R2 is provisioned
  // (Phase 2 human step) — the UI degrades gracefully when empty.
  readonly VITE_PHOTO_GATEWAY_URL?: string;
  // Strava OAuth client id (public). Unset until the Strava app is created.
  readonly VITE_STRAVA_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
