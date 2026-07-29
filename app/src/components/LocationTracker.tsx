import { useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { startTracking, stopTracking, trackingPref } from '../lib/tracking';

/** Invisible: resumes location tracking on load if the person left it on. The
 *  Settings toggle starts/stops it live; this just restores the preference. */
export default function LocationTracker() {
  const { profile } = useAuth();
  const profileId = profile?.id;
  useEffect(() => {
    if (profileId && trackingPref()) startTracking(profileId);
    return () => stopTracking();
  }, [profileId]);
  return null;
}
