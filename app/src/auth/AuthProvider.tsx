import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { loadCategories } from '../lib/data';
import { clearQueueStorage, resumeUploads } from '../lib/uploadQueue';
import type { Profile } from '../lib/types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * First login after accepting an invite has an authenticated session but no
 * `profiles` row yet. The `invite` Edge Function records the invited role; this
 * RPC promotes the pending invite into a profile on first sight. Safe to call
 * repeatedly (idempotent server-side).
 */
async function ensureProfile(): Promise<Profile | null> {
  const { data, error } = await supabase.rpc('claim_invite');
  if (error) {
    // No pending invite and no existing profile → unauthorized user. Surface
    // null so the app shows the "no access" state rather than a broken map.
    return null;
  }
  return (data as Profile) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setCatsV] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadProfile(s: Session | null) {
      if (!s) {
        if (active) setProfile(null);
        return;
      }
      const p = await ensureProfile();
      if (active) setProfile(p);
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session);
      // Load DB-backed tags into the category registry, then nudge a re-render so
      // any custom tags show up in chips/menus/legend/review headings.
      if (data.session) {
        await loadCategories().catch(() => undefined);
        if (active) setCatsV((v) => v + 1);
        // Resume any uploads a previous session left in durable storage.
        void resumeUploads().catch(() => undefined);
      }
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      void loadProfile(s);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    // Drop persisted uploads so one account's bytes never resume under another login.
    await clearQueueStorage().catch(() => undefined);
    await supabase.auth.signOut();
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ session, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
