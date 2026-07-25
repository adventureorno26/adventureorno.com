import { useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { startTracking, stopTracking, trackingPref } from '../lib/tracking';

/** Invisible: resumes location tracking on load if the person left it on. The
 *  Settings toggle starts/stops it live; this just restores the preference. */
export default function LocationTracker() {
  const { profile } = useAuth();
  useEffect(() => {
    if (profile && trackingPref()) startTracking(profile.id);
    return () => stopTracking();
  }, [profile?.id]);
  return null;
}
