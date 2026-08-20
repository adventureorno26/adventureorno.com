import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  fetchVisitDetail,
  setPhotoVisit,
  setVisitNote,
  setVisitPlace,
  type VisitDetail,
} from '../lib/visitDetail';
import {
  deleteVisit,
  isTripNotEmpty,
  restoreVisit,
  fetchMapPeople,
  fetchPlaces,
  setVisitDates,
  setVisitIsTrip,
  setVisitSolo,
  type MapPerson,
} from '../lib/data';
import { reassignActivity } from '../lib/strava';
import {
  fetchReactionsForPhotos,
  togglePhotoReaction,
  uploadPhoto,
  type PhotoReaction,
} from '../lib/photos';
import { showSnack } from '../lib/snackbar';
import { announceWho } from '../lib/whoWasThere';
import { useAuth } from '../auth/AuthProvider';
import type { Place } from '../lib/types';
import AuthedImg from '../components/AuthedImg';
import ThumbMarks from '../components/ThumbMarks';

/** "Aug 2 – 7, 2026", or a single day. */
function fmtSpan(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const full: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' };
  if (start === end) return s.toLocaleDateString(undefined, full);
  const sameYear = s.getFullYear() === e.getFullYear();
  return `${s.toLocaleDateString(undefined, sameYear ? { month: 'long', day: 'numeric' } : full)} – ${e.toLocaleDateString(undefined, full)}`;
}
const fmtDay = (d: string | null): string =>
  d
    ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';
const miles = (m: number): string => `${(m / 1609.344).toFixed(1)} mi`;

/**
 * ONE VISIT, on its own page.
 *
 * Marking a visit used to get you a dropdown, two dates and Delete — there was
 * nowhere to put the photos, nowhere to say what you did, and no way to move
 * something that landed wrong. This is that page: what you did, the photos, a
 * note, and the two corrections that matter (move one activity, or move the whole
 * visit).
 */
export default function VisitPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';

  const [d, setD] = useState<VisitDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [people, setPeople] = useState<MapPerson[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [movingAct, setMovingAct] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // The same marks the place card's carousel carries — this section has to look
  // exactly like that one, so it uses the same component and the same one-call read.
  const [marks, setMarks] = useState<Map<string, PhotoReaction[]>>(new Map());

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const v = await fetchVisitDetail(id);
      if (!v) {
        setError('That visit no longer exists.');
        return;
      }
      setD(v);
      setNote(v.visit.note ?? '');
      void fetchReactionsForPhotos(v.photos.map((ph) => ph.id))
        .then(setMarks)
        .catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this visit.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchPlaces()
      .then(setPlaces)
      .catch(() => undefined);
    void fetchMapPeople()
      .then(setPeople)
      .catch(() => undefined);
  }, []);

  async function toggleMark(photoId: string, emoji: string) {
    await togglePhotoReaction(photoId, emoji).catch(() => undefined);
    const fresh = await fetchReactionsForPhotos([photoId]).catch(
      () => new Map<string, PhotoReaction[]>(),
    );
    setMarks((prev) => new Map(prev).set(photoId, fresh.get(photoId) ?? []));
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
      await load();
    } catch (e) {
      showSnack({ message: e instanceof Error ? e.message : 'That did not save.' });
    }
    setBusy(null);
  }

  /** Delete this visit, and never quietly free what it contained.
   *
   *  `delete_visit` refuses when the visit still holds others, because the foreign key
   *  would set their parent to NULL with no error and nothing to say it happened. Undo
   *  restores the whole snapshot, not just the row. */
  async function removeThisVisit(children: 'refuse' | 'detach' = 'refuse') {
    // Declared above the render guards, so it cannot assume the visit has loaded.
    if (!d) return;
    const visitId = d.visit.id;
    const placeId = d.place.id;
    setBusy('Removing…');
    try {
      const snapshot = await deleteVisit(visitId, children);
      showSnack({
        message:
          children === 'detach'
            ? 'Trip removed — the visits inside it are on their own now.'
            : 'Visit removed.',
        actionLabel: 'Undo',
        onAction: async () => {
          try {
            await restoreVisit(snapshot);
          } catch (e) {
            showSnack({
              message:
                e instanceof Error
                  ? `Could not undo: ${e.message}`
                  : 'Could not undo — the visit is still removed.',
            });
          }
        },
      });
      navigate(`/place/${placeId}`);
    } catch (e) {
      if (isTripNotEmpty(e)) {
        showSnack({
          message: 'This trip still holds other visits.',
          actionLabel: 'Remove it anyway',
          onAction: () => void removeThisVisit('detach'),
        });
      } else {
        showSnack({ message: e instanceof Error ? e.message : 'Could not delete visit' });
      }
    }
    setBusy(null);
  }

  if (error) {
    return (
      <div className="page">
        <Link className="back-bar" to="/">
          Back to the map
        </Link>
        <p style={{ color: 'var(--muted)' }}>{error}</p>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="page">
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      </div>
    );
  }

  const v = d.visit;
  const otherPlaces = places
    .filter((p) => p.id !== d.place.id && p.name.trim() !== '')
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="page visit-page">
      <Link className="back-bar" to={`/place/${d.place.id}`}>
        {d.place.name}
      </Link>

      <header className="visit-head">
        <h1>{fmtSpan(v.start_date, v.end_date)}</h1>
        <div className="visit-sub">
          <Link to={`/place/${d.place.id}`}>{d.place.name}</Link>
          {d.place.admin1 ? <span className="muted"> · {d.place.admin1}</span> : null}
        </div>

        {canEdit && (
          <div className="visit-controls">
            <input
              type="date"
              value={v.start_date}
              aria-label="Start date"
              onChange={(e) =>
                void run('Saving dates…', () =>
                  setVisitDates(
                    v.id,
                    e.target.value,
                    v.end_date < e.target.value ? e.target.value : v.end_date,
                  ),
                )
              }
            />
            <span className="ve-to">to</span>
            <input
              type="date"
              value={v.end_date}
              aria-label="End date"
              onChange={(e) =>
                void run('Saving dates…', () => setVisitDates(v.id, v.start_date, e.target.value))
              }
            />
            <button
              // The switch is the DECISION a person made — trip_marked — not whether
              // the visit counts as a trip. A multi-day visit counts either way (§0.4),
              // so showing it as "on" would make the switch look stuck.
              className={v.trip_marked ? 've-btn on' : 've-btn'}
              aria-pressed={v.trip_marked}
              onClick={() => void run('Saving…', () => setVisitIsTrip(v.id, !v.trip_marked))}
            >
              Trip
            </button>
            {people.length >= 2 && (
              <select
                className="attribution-select"
                // From the participant ROWS: exactly one person means that person,
                // anything else means everyone. That is what solo_profile's null used
                // to mean, said in a way that can also describe three (§0.3).
                value={d.people.length === 1 ? d.people[0].id : ''}
                aria-label="Who was here"
                onChange={(e) =>
                  void run('Saving…', async () => {
                    // Naming somebody else asks them; it does not put them on the day
                    // (0240). The reload below shows what is actually true.
                    announceWho(await setVisitSolo(v.id, e.target.value || null), people);
                  })
                }
              >
                <option value="">{people.length > 2 ? 'Everyone' : 'Together'}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === profile?.id ? 'Just me' : `Just ${p.display_name}`}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </header>

      {/* WHAT WE DID ---------------------------------------------------------- */}
      <h2>What we did</h2>
      {d.activities.length === 0 && d.contents.length === 0 ? (
        <p className="muted">Nothing recorded during this visit yet.</p>
      ) : (
        <ul className="visit-list">
          {d.activities.map((a) => (
            <li key={a.id}>
              <div className="vl-main">
                <span className="vl-title">{a.name || a.type}</span>
                <span className="muted">
                  {[a.type, miles(a.distance), fmtDay(a.local_date)].filter(Boolean).join(' · ')}
                </span>
              </div>
              {canEdit &&
                (movingAct === a.id ? (
                  <select
                    autoFocus
                    className="kind-select"
                    defaultValue=""
                    onChange={(e) => {
                      const to = e.target.value;
                      setMovingAct(null);
                      if (to) void run('Moving…', () => reassignActivity(a.id, to));
                    }}
                    onBlur={() => setMovingAct(null)}
                  >
                    <option value="">Move to…</option>
                    {otherPlaces.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button className="link-btn" onClick={() => setMovingAct(a.id)}>
                    Wrong place?
                  </button>
                ))}
            </li>
          ))}
          {/* On a marked trip: the places you went to during it. */}
          {d.contents.map((c) => (
            <li key={c.visit_id}>
              <div className="vl-main">
                <Link className="vl-title" to={`/visit/${c.visit_id}`}>
                  {c.place_name}
                </Link>
                <span className="muted">{fmtDay(c.start_date)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* PHOTOS --------------------------------------------------------------- */}
      <h2>
        Photos{d.photos.length ? ` (${d.photos.length})` : ''}
        {canEdit && (
          <button
            className="link-btn"
            style={{ marginLeft: 10 }}
            onClick={() => fileRef.current?.click()}
          >
            + Add
          </button>
        )}
      </h2>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/heic,image/heif"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (!files.length) return;
          void run(`Adding ${files.length} photo${files.length > 1 ? 's' : ''}…`, async () => {
            for (const f of files) {
              // The photo keeps its own date; pinning is what puts it on this visit.
              const r = await uploadPhoto(f, {
                placeId: d.place.id,
                lat: d.place.lat,
                lng: d.place.lng,
                override: true,
              });
              if (r?.ok && r.id) await setPhotoVisit(r.id, v.id);
            }
          });
        }}
      />
      {d.photos.length === 0 ? (
        <p className="muted">No photos on this visit yet.</p>
      ) : (
        <div className="gallery carousel">
          {d.photos.map((ph) => (
            <div className="thumb" key={ph.id}>
              <AuthedImg photoId={ph.id} size="thumb" />
              <ThumbMarks
                reactions={marks.get(ph.id) ?? []}
                onToggle={(emoji) => void toggleMark(ph.id, emoji)}
              />
              {ph.pinned && canEdit && (
                <button
                  className="thumb-date"
                  title="Added to this visit by hand — put it back on its own date"
                  onClick={() => void run('Unpinning…', () => setPhotoVisit(ph.id, null))}
                >
                  Unpin
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* NOTES ---------------------------------------------------------------- */}
      <h2>Notes</h2>
      {canEdit ? (
        <textarea
          className="visit-note"
          rows={3}
          value={note}
          placeholder="What happened?"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() =>
            note !== (v.note ?? '') && void run('Saving note…', () => setVisitNote(v.id, note))
          }
        />
      ) : (
        <p className={v.note ? '' : 'muted'}>{v.note || 'No notes.'}</p>
      )}

      {/* CORRECTIONS ---------------------------------------------------------- */}
      {canEdit && (
        <div className="btn-row" style={{ marginTop: 22 }}>
          <button onClick={() => setMoving((m) => !m)}>Move this visit</button>
          <button className="danger" onClick={() => void removeThisVisit()}>
            Delete
          </button>
        </div>
      )}
      {moving && (
        <div className="entry">
          <label>Move this whole visit — and everything on it — to:</label>
          <select
            className="kind-select"
            defaultValue=""
            onChange={(e) => {
              const to = e.target.value;
              setMoving(false);
              if (to) void run('Moving the visit…', () => setVisitPlace(v.id, to));
            }}
          >
            <option value="">Choose a place…</option>
            {otherPlaces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.admin1 ? ` — ${p.admin1}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {busy && <div className="label">{busy}</div>}
    </div>
  );
}
