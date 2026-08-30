import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local.',
  );
}

// TYPED WITH THE GENERATED SCHEMA — on purpose, and it was not before.
//
// `database.types.ts` has been generated from the live database, committed, and drift
// -checked by CI for months, and NONE of it reached the code: without this generic,
// `.from()` and `.rpc()` take any string at all. A table that does not exist and an RPC
// that does not exist both typechecked. That is how `fetchTripTimeline` shipped calling
// `trip_timeline`, which has never existed in this database, and swallowed the error.
//
// With the generic, a renamed column or a removed function is a BUILD failure instead
// of a silent empty list at runtime.
export const supabase = createClient<Database>(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // required for magic-link login
    flowType: 'pkce',
  },
});

/**
 * Pass SQL NULL for an argument the generated types call non-nullable.
 *
 * The type generator describes an argument by its SQL TYPE and never by its
 * NULLABILITY, so a `uuid` argument is typed `string` even when passing NULL is the
 * documented way to use it — `set_my_rating(null)` clears the rating and
 * `set_photo_visit(null)` lets the photo's own date decide again.
 *
 * Named and greppable rather than `as any` scattered about: every use marks a place
 * where NULL is deliberate, not a place where the types were switched off.
 */
export const sqlNull = <T>(v: T | null): T => v as T;
