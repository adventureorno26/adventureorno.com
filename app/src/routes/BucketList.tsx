import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  createPlaceAtomic,
  dateNightPick,
  fetchBucketPlaces,
  fetchMapPeople,
  fetchWishes,
  toggleWish,
  type MapPerson,
  type WishInfo,
} from '../lib/data';
import { whoLabel } from '../lib/participants';
import { retrieveResult, type SearchResult } from '../lib/maptiler';
import { categoryIcon, categoryLabel, effectiveCategories } from '../lib/categories';
import type { Place } from '../lib/types';
import { BucketIcon, PinIcon } from '../components/Icons';
import MapSearch from '../components/MapSearch';
import BucketMap from '../components/BucketMap';
import { showSnack } from '../lib/snackbar';

export default function BucketList() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wishes, setWishes] = useState<Record<string, WishInfo>>({});
  const [onlyEveryone, setOnlyEveryone] = useState(false);
  // THERE IS NO WORD FOR "ALL OF US" ON THIS PAGE ANY MORE. It said "Both" twice — in the
  // filter and on every row — long after 2026-08-15 retired that word (*"the view is
  // Together so investigate why you are saying Both"*); then it said "Together", which
  // §0.2 retired in turn. Each fix replaced one word with the next, because the badge was
  // trying to name a GROUP. It names the PEOPLE now, the same way every other control that
  // used to carry one of those words does (Erica, 2026-08-30: *"yes, people picker"*) —
  // and a badge reading "You and Josh" cannot go stale when a third person joins.
  const [people, setPeople] = useState<MapPerson[]>([]);

  function load() {
    fetchBucketPlaces()
      .then(setPlaces)
      .catch(() => setMsg('Could not load your bucket list'));
    fetchWishes()
      .then(setWishes)
      .catch(() => undefined);
    fetchMapPeople()
      .then(setPeople)
      .catch(() => undefined);
  }
  useEffect(load, []);

  async function toggleWant(placeId: string) {
    // optimistic: flip my membership in this place's wanters
    const myId = profile?.id;
    if (!myId) return;
    setWishes((prev) => {
      const cur = prev[placeId] ?? { wanters: [], n: 0, everyone: false };
      const mine = cur.wanters.includes(myId);
      const wanters = mine ? cur.wanters.filter((w) => w !== myId) : [...cur.wanters, myId];
      return { ...prev, [placeId]: { ...cur, wanters, n: wanters.length } };
    });
    try {
      await toggleWish(placeId);
    } catch (e) {
      // There was no catch here at all: the optimistic update stood, the failure
      // surfaced as an unhandled rejection, and only the reconcile below hinted
      // that anything had gone wrong.
      showSnack({
        message: e instanceof Error ? `Could not save that: ${e.message}` : 'Could not save that.',
      });
    } finally {
      fetchWishes()
        .then(setWishes)
        .catch(() => undefined); // reconcile "everyone"
    }
  }

  async function spin() {
    setMsg(null);
    const id = await dateNightPick();
    if (id) navigate(`/place/${id}`);
    // "you both" was the same retired two-person assumption in prose.
    else setMsg('Pick a place you all want to go first — tap “Want to go” on a few.');
  }

  const everyoneCount = Object.values(wishes).filter((w) => w.everyone).length;

  // Group by US state, or by country for everywhere else; both sorted A→Z.
  const groups = useMemo(() => {
    const map = new Map<string, { items: Place[]; isState: boolean }>();
    for (const p of places ?? []) {
      if (onlyEveryone && !wishes[p.id]?.everyone) continue;
      const isUS = (p.country ?? '').match(/^(United States|USA|US)$/i);
      const key = isUS ? (p.admin1 ?? 'United States') : (p.country ?? 'Other');
      if (!map.has(key)) map.set(key, { items: [], isState: Boolean(isUS) });
      map.get(key)!.items.push(p);
    }
    // US states first (A→Z), then other countries at the bottom (A→Z).
    return [...map.entries()]
      .sort((a, b) => {
        if (a[1].isState !== b[1].isState) return a[1].isState ? -1 : 1;
        return a[0].localeCompare(b[0]);
      })
      .map(([label, g]) => ({
        label,
        items: g.items.sort((x, y) => x.name.localeCompare(y.name)),
      }));
  }, [places, onlyEveryone, wishes]);

  // Search → add a want-to-go place (flagged bucket = true; distinct map pin).
  async function addFromSearch(r: SearchResult) {
    setBusy(true);
    setMsg(null);
    try {
      const full = r.mapbox_id ? await retrieveResult(r).catch(() => r) : r;
      if (full.lat === 0 && full.lng === 0) {
        setMsg("Couldn't resolve that place — try another.");
        return;
      }
      await createPlaceAtomic({
        name: full.name,
        country: full.country,
        admin1: full.admin1,
        address: full.address,
        lat: full.lat,
        lng: full.lng,
        bucket: true,
        saved: true,
      });
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not add to bucket list');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <Link className="back-bar" to="/">
        <span>Map</span>
      </Link>
      <h1 className="bucket-title">
        <span className="bucket-title-ico">
          <BucketIcon size={22} />
        </span>
        Bucket List
      </h1>

      <BucketMap places={places ?? []} onAdded={load} />

      <div className="bucket-toolbar">
        <button
          className="primary spin-btn"
          onClick={() => void spin()}
          disabled={everyoneCount === 0}
        >
          🎲 Date night — surprise us
        </button>
        {/* ONE SWITCH, AND NO WORD FOR A GROUP. This was a chip reading "Both want to
            go", then a pair reading "Anyone / Together" — three attempts to name the set
            of us, each retired in turn. Off shows the whole list; on narrows it to the
            places nobody has said no to, which is a fact about the wishes rather than a
            scope, and says so in ordinary English. */}
        <span className="label">Want to go</span>
        <div className="pe-personfilter">
          <button
            type="button"
            className={onlyEveryone ? 'on' : ''}
            aria-pressed={onlyEveryone}
            onClick={() => setOnlyEveryone(!onlyEveryone)}
          >
            Only what we all want
            {everyoneCount > 0 ? ` (${everyoneCount})` : ''}
          </button>
        </div>
      </div>

      {canEdit && (
        <div className="card" style={{ margin: '14px 0 20px' }}>
          <div className="bucket-search">
            <MapSearch onPick={addFromSearch} />
          </div>
          {busy && <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>Adding…</div>}
        </div>
      )}

      {msg && <div className="banner">{msg}</div>}

      {places === null ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : places.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>Nothing here yet.</p>
      ) : (
        groups.map((g) => (
          <section key={g.label} style={{ marginTop: 18 }}>
            <h3 className="bucket-group-head">{g.label}</h3>
            <div className="trip-places">
              {g.items.map((p) => {
                const w = wishes[p.id];
                const mine = profile ? (w?.wanters.includes(profile.id) ?? false) : false;
                return (
                  <div key={p.id} className="bucket-row">
                    <Link className="trip-place" to={`/place/${p.id}`}>
                      <span className="result-pin bucket">
                        <PinIcon size={14} />
                      </span>{' '}
                      {p.name}
                      <span className="place-row-cats" style={{ marginLeft: 6 }}>
                        {effectiveCategories(p).map((s) => (
                          <span key={s} title={categoryLabel(s)}>
                            {categoryIcon(s)}
                          </span>
                        ))}
                      </span>
                    </Link>
                    {/* Keeps the `both-badge` class on purpose — the styling is written
                        against that name — while the badge itself now names who. */}
                    {w?.everyone && (
                      <span className="both-badge">{whoLabel(w.wanters, people, profile?.id)}</span>
                    )}
                    {canEdit && (
                      <button
                        className={`want-btn ${mine ? 'on' : ''}`}
                        onClick={() => void toggleWant(p.id)}
                      >
                        {mine ? '♥ Want to go' : 'Want to go'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
