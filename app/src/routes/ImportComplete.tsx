import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  clearPendingImport,
  readPendingImport,
  resumePendingImport,
  type PendingImport,
} from '../lib/googlePhotos';
import { enqueueUpload, retryFailed } from '../lib/uploadQueue';

type Phase = 'working' | 'not-ready' | 'summary' | 'nothing' | 'error';

interface Tally {
  added: number;
  review: number; // uploaded but not attached to a place (lands in the inbox)
  duplicate: number;
  skipped: number;
  failed: number;
}
const zero: Tally = { added: 0, review: 0, duplicate: 0, skipped: 0, failed: 0 };

/**
 * Completion route for a Google Photos import (`/photos/import/complete`). It
 * restores the persisted import context, downloads the picked photos, feeds them
 * to the GLOBAL upload queue (so the user can navigate away while they finish),
 * and shows live counts. This is the reliable return point on mobile, where the
 * picker opens full-tab and the originating tab can't bring the user back.
 */
export default function ImportComplete() {
  const navigate = useNavigate();
  const [pending] = useState<PendingImport | null>(() => readPendingImport());
  const [phase, setPhase] = useState<Phase>('working');
  const [status, setStatus] = useState('Getting your photos…');
  const [total, setTotal] = useState(0);
  const [tally, setTally] = useState<Tally>(zero);
  const [errMsg, setErrMsg] = useState('');
  const started = useRef(false);

  const returnTo = pending?.returnTo || '/';
  const label = pending?.label;

  const run = useCallback(async () => {
    if (!pending) {
      setPhase('nothing');
      return;
    }
    setPhase('working');
    setStatus('Getting your photos…');
    try {
      const files = await resumePendingImport(pending, setStatus);
      if (files === null) {
        setPhase('not-ready');
        return;
      }
      if (files.length === 0) {
        clearPendingImport();
        setPhase('summary');
        return;
      }
      setTotal(files.length);
      setStatus(`Uploading ${files.length} photo${files.length === 1 ? '' : 's'}…`);
      // Enqueue everything to the global queue, then tally as each resolves — the
      // user can leave this page; uploads continue in the background.
      clearPendingImport();
      setPhase('summary');
      files.forEach((file) => {
        enqueueUpload(file, {
          placeId: pending.placeId ?? undefined,
          override: true,
        })
          .then((r) => {
            setTally((t) => {
              if (r.ok && r.place_id) return { ...t, added: t.added + 1 };
              if (r.ok) return { ...t, review: t.review + 1 };
              const why = (r.skipped ?? '').toLowerCase();
              if (why.includes('dup')) return { ...t, duplicate: t.duplicate + 1 };
              if (why) return { ...t, skipped: t.skipped + 1 };
              return { ...t, failed: t.failed + 1 };
            });
          })
          .catch(() => setTally((t) => ({ ...t, failed: t.failed + 1 })));
      });
    } catch (e) {
      const m = (e as Error).message || 'Import failed.';
      if (m === 'Cancelled.') {
        clearPendingImport();
        navigate(returnTo);
        return;
      }
      setErrMsg(m);
      setPhase('error');
    }
  }, [pending, navigate, returnTo]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  const done = tally.added + tally.review + tally.duplicate + tally.skipped + tally.failed;
  const goBack = () => navigate(returnTo);

  return (
    <div className="import-complete">
      <h1>Import from Google Photos</h1>

      {phase === 'working' && (
        <div className="ic-card">
          <div className="ic-spinner" aria-hidden />
          <p aria-live="polite">{status}</p>
        </div>
      )}

      {phase === 'not-ready' && (
        <div className="ic-card">
          <p>Your photos aren’t ready yet — finish selecting them in the Google Photos tab.</p>
          <div className="btn-row">
            <button className="primary" onClick={() => void run()}>
              I’ve finished picking
            </button>
            <button
              onClick={() => {
                clearPendingImport();
                goBack();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'nothing' && (
        <div className="ic-card">
          <p>There’s no import to finish.</p>
          <button className="primary" onClick={() => navigate('/?add=1')}>
            Add photos
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="ic-card">
          <p className="ic-err">{errMsg}</p>
          <div className="btn-row">
            <button className="primary" onClick={() => void run()}>
              Retry
            </button>
            <button
              onClick={() => {
                clearPendingImport();
                goBack();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'summary' && (
        <div className="ic-card">
          <p aria-live="polite">
            {done < total
              ? `Uploading… ${done} of ${total} done`
              : total === 0
                ? 'Nothing new to import.'
                : 'All done!'}
          </p>
          <div className="ic-counts">
            {tally.added > 0 && (
              <span className="ic-count ok">{tally.added} added to the place</span>
            )}
            {tally.review > 0 && <span className="ic-count">{tally.review} to sort</span>}
            {tally.duplicate > 0 && <span className="ic-count">{tally.duplicate} already had</span>}
            {tally.skipped > 0 && <span className="ic-count">{tally.skipped} skipped</span>}
            {tally.failed > 0 && <span className="ic-count bad">{tally.failed} failed</span>}
          </div>
          <div className="btn-row">
            <button className="primary" onClick={goBack}>
              {label ? `Back to ${label}` : 'Back to AdventureOrNo'}
            </button>
            {tally.review > 0 && (
              <button onClick={() => navigate('/photos/sort')}>Sort photos</button>
            )}
            {tally.failed > 0 && <button onClick={() => retryFailed()}>Retry failed</button>}
          </div>
        </div>
      )}
    </div>
  );
}
