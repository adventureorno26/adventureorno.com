import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  addExperience,
  createPerson,
  fetchMapPeople,
  fetchPeople,
  fetchPlaces,
  newExperienceKey,
  updatePlace,
  type ExperiencePlaceInput,
  type MapPerson,
  type Person,
} from '../lib/data';
import type { Place } from '../lib/types';
import { mapPool, photosEnabled, uploadPhoto } from '../lib/photos';
import { googlePhotosEnabled, pickFromGooglePhotos } from '../lib/googlePhotos';
import { haversineMeters } from '../lib/geo';
import { MANUAL_CATEGORIES, categoryLabel } from '../lib/categories';
import { showSnack } from '../lib/snackbar';
import { useAuth } from '../auth/AuthProvider';
import MapSearch from '../components/MapSearch';
import StarRating from '../components/StarRating';

type Step = 'place' | 'when' | 'details' | 'photos' | 'review';
const STEPS: Step[] = ['place', 'when', 'details', 'photos', 'review'];
const STEP_TITLE: Record<Step, string> = {
  place: 'Where?',
  when: 'When & who?',
  details: 'Details',
  photos: 'Photos',
  review: 'Review & save',
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * One guided flow to add to the map: pick an existing place OR create a new one,
 * then log a visit (date + who), optional details (tags/rating/notes), optional
 * photos, and review before saving. Steps after the first can be skipped, and
 * nothing entered is discarded when moving between steps. No database terms.
 */
export default function AddWizard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [step, setStep] = useState<Step>('place');

  const [allPlaces, setAllPlaces] = useState<Place[]>([]);
  const [people, setPeople] = useState<MapPerson[]>([]);
  useEffect(() => {
    fetchPlaces()
      .then((p) => setAllPlaces(p.filter((x) => x.saved && !x.bucket)))
      .catch(() => undefined);
    fetchMapPeople()
      .then(setPeople)
      .catch(() => undefined);
  }, []);

  // Chosen target: an existing place, or the fields for a brand-new one.
  const [existing, setExisting] = useState<Place | null>(null);
  const [mode, setMode] = useState<'existing' | 'new' | null>(null);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [admin1, setAdmin1] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  // Visit + details + media.
  const [visitDate, setVisitDate] = useState(today());
  const [multi, setMulti] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [who, setWho] = useState(''); // '' = both; else a profile id
  // Non-login people (children) present on this visit.
  const [kids, setKids] = useState<Person[]>([]);
  const [selKids, setSelKids] = useState<string[]>([]);
  const [newKid, setNewKid] = useState('');
  useEffect(() => {
    fetchPeople()
      .then(setKids)
      .catch(() => undefined);
  }, []);
  // One idempotency key per save action; reused across retries, reset on success.
  const keyRef = useRef<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [rating, setRating] = useState<number | null>(null);
  const [review, setReview] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return allPlaces.filter((p) => p.name.toLowerCase().includes(s)).slice(0, 8);
  }, [q, allPlaces]);

  // Nearby existing places when creating a new one (search-before-create).
  const nearby = useMemo(() => {
    if (mode !== 'new' || lat == null || lng == null) return [];
    return allPlaces
      .map((p) => ({ p, d: haversineMeters({ lat, lng }, { lat: p.lat, lng: p.lng }) }))
      .filter((x) => x.d <= 400)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
  }, [mode, lat, lng, allPlaces]);

  const stepIdx = STEPS.indexOf(step);
  const canContinue =
    step === 'place' ? mode === 'existing' || (mode === 'new' && lat != null) : true;

  function chooseExisting(p: Place) {
    setExisting(p);
    setMode('existing');
    setName(p.name);
    setStep('when');
  }

  function next() {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1]);
  }
  function back() {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]);
    else navigate('/');
  }

  async function importGoogle() {
    try {
      const picked = await pickFromGooglePhotos((s) => setNote(s), {
        returnTo: '/add',
        label: 'adding',
      });
      setNote(null);
      if (picked.length) setFiles((f) => [...f, ...picked]);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Google Photos import failed.');
    }
  }

  async function save() {
    if (busy) return;
    setBusy('Saving…');
    try {
      // The place graph (place + visit + attribution + rating + people) is written
      // atomically by one idempotent service. Reuse the key across retries so a
      // second attempt after a partial failure returns the same records.
      if (!keyRef.current) keyRef.current = newExperienceKey();

      let placeInput: ExperiencePlaceInput;
      let pLat: number;
      let pLng: number;
      if (mode === 'new') {
        placeInput = {
          name: name.trim() || 'New place',
          admin1,
          country,
          address,
          lat: lat!,
          lng: lng!,
          categories: tags,
          saved: true,
        };
        pLat = lat!;
        pLng = lng!;
      } else if (existing) {
        placeInput = { id: existing.id };
        pLat = existing.lat;
        pLng = existing.lng;
      } else {
        setBusy(null);
        return;
      }

      const end = visitDate && multi && endDate && endDate >= visitDate ? endDate : visitDate;
      const res = await addExperience(
        keyRef.current,
        placeInput,
        visitDate
          ? {
              date: visitDate,
              end_date: end || undefined,
              who: who || undefined,
              rating: rating ?? undefined,
              person_ids: selKids.length ? selKids : undefined,
            }
          : { rating: rating ?? undefined },
      );
      const placeId = res.place_id;

      // Enrichments create_experience doesn't own (kept as compatibility writes):
      if (mode === 'new') {
        if (review.trim()) await updatePlace(placeId, { review: review.trim() });
      } else if (existing) {
        // Merge tags additively; don't clobber an existing review.
        if (tags.length) {
          const merged = Array.from(new Set([...(existing.categories ?? []), ...tags]));
          await updatePlace(placeId, { categories: merged });
        }
        if (review.trim() && !existing.review)
          await updatePlace(placeId, { review: review.trim() });
      }

      if (files.length) {
        setBusy(`Adding ${files.length} photo${files.length === 1 ? '' : 's'}…`);
        const takenAt = visitDate ? `${visitDate}T12:00:00Z` : undefined;
        await mapPool(
          files,
          (f) =>
            uploadPhoto(f, { placeId, lat: pLat, lng: pLng, takenAt, override: true }).catch(
              () => null,
            ),
          4,
        );
      }
      keyRef.current = null; // saved — a later save is a new action
      showSnack({ message: 'Saved!' });
      navigate(`/place/${placeId}`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not save.');
      setBusy(null);
    }
  }

  const targetName = mode === 'existing' ? existing?.name : name.trim() || 'New place';

  return (
    <div className="add-wizard">
      <div className="aw-top">
        <button className="aw-back" onClick={back}>
          {step === 'place' ? 'Cancel' : 'Back'}
        </button>
        <span className="aw-step">
          {stepIdx + 1} of {STEPS.length} · {STEP_TITLE[step]}
        </span>
      </div>
      <div className="aw-progress" aria-hidden>
        <span style={{ width: `${((stepIdx + 1) / STEPS.length) * 100}%` }} />
      </div>

      {note && <div className="aw-note">{note}</div>}

      {step === 'place' && (
        <div className="aw-body">
          <label className="aw-label">Search your places</label>
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setMode(null);
            }}
            placeholder="Start typing a place name…"
          />
          {matches.length > 0 && (
            <div className="aw-matches">
              {matches.map((p) => (
                <button key={p.id} className="aw-match" onClick={() => chooseExisting(p)}>
                  <b>{p.name}</b>
                  <span>{[p.city, p.admin1, p.country].filter(Boolean).join(', ')}</span>
                </button>
              ))}
            </div>
          )}

          <div className="aw-or">or add a new place</div>
          <MapSearch
            placeholder="Search an address or place…"
            onPick={(r) => {
              setLat(r.lat);
              setLng(r.lng);
              setName(r.name);
              setAdmin1(r.admin1);
              setCountry(r.country);
              setAddress(r.address);
              setExisting(null);
              setMode('new');
            }}
          />
          {mode === 'new' && lat != null && (
            <div className="aw-newplace">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
              <div className="label">
                {lat.toFixed(4)}, {lng?.toFixed(4)}
                {[admin1, country].filter(Boolean).length
                  ? ` · ${[admin1, country].filter(Boolean).join(', ')}`
                  : ''}
              </div>
              {nearby.length > 0 && (
                <div className="aw-nearby">
                  <b>Already have one of these nearby?</b>
                  {nearby.map(({ p, d }) => (
                    <button key={p.id} className="aw-match" onClick={() => chooseExisting(p)}>
                      <b>{p.name}</b>
                      <span>{Math.round(d)} m away — use this instead</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {step === 'when' && (
        <div className="aw-body">
          <p className="aw-target">
            Logging a visit to <b>{targetName}</b>
          </p>
          <label className="aw-label">Date{multi ? ' — from' : ''}</label>
          <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
          {multi && (
            <>
              <label className="aw-label">to</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </>
          )}
          <label className="check-row">
            <input
              type="checkbox"
              checked={multi}
              onChange={(e) => setMulti(e.target.checked)}
              style={{ width: 'auto' }}
            />
            Multiple days
          </label>
          {people.length >= 2 && (
            <>
              <label className="aw-label">Who was there</label>
              <select
                className="attribution-select"
                value={who}
                onChange={(e) => setWho(e.target.value)}
                aria-label="Who was there"
              >
                <option value="">Both of us</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === profile?.id ? 'Just me' : `Just ${p.display_name}`}
                  </option>
                ))}
              </select>
            </>
          )}

          <label className="aw-label">Kids along (optional)</label>
          <div className="pe-chips">
            {kids.map((k) => (
              <button
                key={k.id}
                type="button"
                className={`pe-chip${selKids.includes(k.id) ? ' on' : ''}`}
                onClick={() =>
                  setSelKids((s) => (s.includes(k.id) ? s.filter((x) => x !== k.id) : [...s, k.id]))
                }
              >
                {k.display_name}
              </button>
            ))}
          </div>
          <div className="aw-addkid">
            <input
              type="text"
              value={newKid}
              placeholder="Add a child…"
              onChange={(e) => setNewKid(e.target.value)}
            />
            <button
              type="button"
              className="aw-addkid-btn"
              disabled={!newKid.trim()}
              onClick={async () => {
                const name = newKid.trim();
                if (!name) return;
                try {
                  const person = await createPerson(name);
                  setKids((k) =>
                    [...k, person].sort((a, b) => a.display_name.localeCompare(b.display_name)),
                  );
                  setSelKids((s) => [...s, person.id]);
                  setNewKid('');
                } catch {
                  setNote('Could not add that person.');
                }
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {step === 'details' && (
        <div className="aw-body">
          <label className="aw-label">Tags</label>
          <div className="pe-chips">
            {MANUAL_CATEGORIES.map((c) => (
              <button
                key={c.slug}
                className={`pe-chip${tags.includes(c.slug) ? ' on' : ''}`}
                onClick={() =>
                  setTags((t) =>
                    t.includes(c.slug) ? t.filter((x) => x !== c.slug) : [...t, c.slug],
                  )
                }
              >
                {categoryLabel(c.slug)}
              </button>
            ))}
          </div>
          <label className="aw-label">Your rating</label>
          <StarRating value={rating} onChange={setRating} />
          <label className="aw-label">Notes</label>
          <textarea
            value={review}
            onChange={(e) => setReview(e.target.value)}
            placeholder="Anything you want to remember…"
            rows={3}
          />
          {mode === 'existing' && existing?.review && (
            <p className="label">
              This place already has a review — your notes won’t overwrite it.
            </p>
          )}
        </div>
      )}

      {step === 'photos' && (
        <div className="aw-body">
          <label className="aw-label">Photos {files.length > 0 && `(${files.length})`}</label>
          {photosEnabled() ? (
            <div className="btn-row">
              <label className="primary aw-filebtn">
                Choose photos
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])])}
                />
              </label>
              {googlePhotosEnabled() && (
                <button onClick={() => void importGoogle()}>Google Photos</button>
              )}
            </div>
          ) : (
            <p className="label">Photo uploads aren’t set up yet.</p>
          )}
          {files.length > 0 && (
            <button className="link-btn" onClick={() => setFiles([])}>
              Clear
            </button>
          )}
        </div>
      )}

      {step === 'review' && (
        <div className="aw-body">
          <div className="aw-summary">
            <div>
              <span className="label">Place</span>
              <b>{targetName}</b> {mode === 'new' && <em>(new)</em>}
            </div>
            <div>
              <span className="label">Visit</span>
              <b>
                {visitDate}
                {multi && endDate ? ` → ${endDate}` : ''}
              </b>
            </div>
            {who && (
              <div>
                <span className="label">Who</span>
                <b>
                  {who === profile?.id
                    ? 'Just me'
                    : `Just ${people.find((p) => p.id === who)?.display_name}`}
                </b>
              </div>
            )}
            {tags.length > 0 && (
              <div>
                <span className="label">Tags</span>
                <b>{tags.map(categoryLabel).join(', ')}</b>
              </div>
            )}
            {rating != null && (
              <div>
                <span className="label">Rating</span>
                <b>{rating}★</b>
              </div>
            )}
            {files.length > 0 && (
              <div>
                <span className="label">Photos</span>
                <b>{files.length}</b>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="aw-actions">
        {step !== 'review' ? (
          <>
            <button className="primary" disabled={!canContinue} onClick={next}>
              Continue
            </button>
            {step !== 'place' && step !== 'when' && <button onClick={next}>Skip</button>}
          </>
        ) : (
          <button className="primary" disabled={!!busy} onClick={() => void save()}>
            {busy ?? 'Save'}
          </button>
        )}
      </div>

      <Link className="aw-exit" to="/">
        Go to map
      </Link>
    </div>
  );
}
