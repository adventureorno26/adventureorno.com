import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local.',
  );
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // required for magic-link login
    // Magic links (and admin-generated links) deliver tokens in the URL hash.
    // Implicit flow consumes those and works even if the link is opened on a
    // different device than it was requested from — PKCE would not.
    flowType: 'implicit',
  },
});
