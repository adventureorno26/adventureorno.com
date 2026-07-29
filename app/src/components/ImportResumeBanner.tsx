import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { clearPendingImport, readPendingImport } from '../lib/googlePhotos';

// Safety net for the Google Photos return flow: if an import was started but the
// tab was backgrounded/reloaded (common on mobile, where the picker opens as a
// full tab), a pending import lingers in storage. This banner surfaces the
// moment the user is back in the app — one tap finishes the import on the
// completion route. Re-checks on focus / tab-visibility so it appears right when
// they return from the Google Photos tab.
export default function ImportResumeBanner() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [has, setHas] = useState(false);

  const recheck = useCallback(() => setHas(!!readPendingImport()), []);

  useEffect(() => {
    recheck();
    const onFocus = () => recheck();
    const onVis = () => document.visibilityState === 'visible' && recheck();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [recheck]);

  // Re-check on every route change too (cheap; keeps state honest after finishing).
  useEffect(recheck, [pathname, recheck]);

  // Don't nag on the completion route itself.
  if (!has || pathname === '/photos/import/complete') return null;

  return (
    <div className="import-resume" role="status">
      <span>Finish importing your Google Photos</span>
      <div className="ir-actions">
        <button className="primary" onClick={() => navigate('/photos/import/complete')}>
          Finish
        </button>
        <button
          className="ir-dismiss"
          aria-label="Dismiss"
          onClick={() => {
            clearPendingImport();
            setHas(false);
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
