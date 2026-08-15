import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  mapAppearance,
  setMapAppearance,
  usingSelfHosted,
  type MapAppearance,
} from '../lib/basemap';
import {
  addCategory,
  fetchClimbingStats,
  fetchGeoCoverage,
  fetchMapPeople,
  fetchPeaksBagged,
  fetchPlacePeople,
  type MapPerson,
  type Peak,
  fetchMapProjection,
  fetchPlaces,
  fetchSettingsStats,
  fetchTrackingStatus,
  setMapProjection,
  triggerGeocode,
  type GeoCoverage,
  type MapProjection,
  type SettingsStats,
  type TrackingStatus,
} from '../lib/data';
import {
  setTrackingPref,
  startTracking,
  stopTracking,
  trackingPref,
  trackingSupported,
} from '../lib/tracking';
import { fetchShareLocation, setShareLocation } from '../lib/lastSeen';
import { CATEGORIES } from '../lib/categories';
import type { Place } from '../lib/types';
import { exportCsv, exportGpx, exportKml } from '../lib/exports';
import { showSnack } from '../lib/snackbar';
import {
  backfillPage,
  beginStravaLink,
  fetchTripsList,
  isMyStravaConnected,
  type TripRow,
} from '../lib/strava';
import { visitDates } from '../lib/visitDates';
import { importFileActivity, parseActivityFile, parseFitActivity } from '../lib/importFile';
import PeopleCard from '../components/PeopleCard';
import SharedHub from '../components/SharedHub';
import { runClusteringNow } from '../lib/timeline';
import {
  approveJoinRequest,
  denyJoinRequest,
  fetchPendingJoinRequests,
  type JoinRequest,
} from '../lib/join';

const TAG_COLORS = [
  '#38bdf8',
  '#22c55e',
  '#f97316',
  '#a855f7',
  '#ec4899',
  '#eab308',
  '#06b6d4',
  '#ef4444',
];

/** Create custom tags. New tags populate everywhere tags appear (chips on place
 *  cards, the map legend, review-section headings). */
function TagsCard() {
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // re-render after a tag is added

  async function submit() {
    if (!label.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      // No icon — Erica's standing rule is no icons unless asked.
      await addCategory(label.trim(), '', color);
      setLabel('');
      setColor(TAG_COLORS[0]);
      setTick((t) => t + 1);
      setMsg('Added — it now shows everywhere tags appear.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not add tag');
    }
    setBusy(false);
  }

  return (
    <div className="card">
      <b>Tags</b>
      <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 10px' }}>
        Add your own tags. A new tag appears everywhere tags do — the chips on a place, the map
        legend, and its own review section heading (e.g. “Spa Reviews”).
      </div>
      <div className="our-stats" key={tick} style={{ marginBottom: 10 }}>
        {CATEGORIES.map((c) => (
          <span key={c.slug} className="stat">
            {c.label}
          </span>
        ))}
      </div>
      <div className="btn-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          style={{ flex: '1 1 140px' }}
          placeholder="New tag name (e.g. Spa)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {TAG_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              title={c}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: c,
                border: color === c ? '2px solid var(--fg)' : '2px solid transparent',
                padding: 0,
                cursor: 'pointer',
              }}
            />
          ))}
        </span>
        <button className="primary" disabled={busy || !label.trim()} onClick={() => void submit()}>
          {busy ? 'Adding…' : 'Add tag'}
        </button>
      </div>
      {msg && (
        <div className="banner" style={{ marginTop: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}

function JoinRequestsCard() {
  const [reqs, setReqs] = useState<JoinRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    fetchPendingJoinRequests()
      .then(setReqs)
      .catch(() => setReqs([]));
  }
  useEffect(load, []);

  async function act(r: JoinRequest, action: 'viewer' | 'editor' | 'deny') {
    setBusy(r.id);
    setMsg(null);
    try {
      if (action === 'deny') await denyJoinRequest(r.id);
      else await approveJoinRequest(r.id, action);
      setMsg(
        action === 'deny'
          ? `Denied ${r.email ?? 'request'}.`
          : `Approved ${r.email ?? 'request'} as ${action === 'editor' ? 'contributor' : 'viewer'}.`,
      );
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not update request');
    }
    setBusy(null);
  }

  if (reqs === null) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;
  return (
    <div className="card">
      {reqs.length === 0 ? (
        <p style={{ color: 'var(--muted)', margin: 0 }}>No pending requests.</p>
      ) : (
        reqs.map((r) => (
          <div key={r.id} className="join-req">
            <div>
              <b>{r.display_name ?? r.email ?? 'Someone'}</b>
              {r.email && r.display_name ? <span className="muted"> · {r.email}</span> : null}
              {r.note ? (
                <div className="muted" style={{ fontSize: 13 }}>
                  “{r.note}”
                </div>
              ) : null}
            </div>
            <div className="join-req-actions">
              <button
                className="primary"
                disabled={busy === r.id}
                onClick={() => void act(r, 'editor')}
              >
                Approve · Contributor
              </button>
              <button disabled={busy === r.id} onClick={() => void act(r, 'viewer')}>
                Viewer
              </button>
              <button
                className="danger"
                disabled={busy === r.id}
                onClick={() => void act(r, 'deny')}
              >
                Deny
              </button>
            </div>
          </div>
        ))
      )}
      {msg && (
        <div className="banner" style={{ marginTop: 10 }}>
          {msg}
        </div>
      )}
    </div>
  );
}

function GeocodeCard() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function name() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await triggerGeocode();
      setMsg(`Named ${r.named} of ${r.considered} pending place(s).`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    }
    setBusy(false);
  }
  async function cluster() {
    setBusy(true);
    setMsg(null);
    try {
      const c = await runClusteringNow();
      setMsg(
        `Clustered ${c.points} points → ${c.clusters_created} new, ${c.clusters_attached} attached.`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    }
    setBusy(false);
  }
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <b>Auto-created places</b>
      <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 8px' }}>
        The nightly job clusters photos + location pings into places and names them. Run it now
        after a backfill or import.
      </div>
      <div className="btn-row" style={{ marginTop: 0 }}>
        <button disabled={busy} onClick={() => void cluster()}>
          {busy ? 'Working…' : 'Cluster now'}
        </button>
        <button disabled={busy} onClick={() => void name()}>
          Name new places
        </button>
        <Link to="/settings/import">
          <button>Import Google Timeline…</button>
        </Link>
      </div>
      {msg && (
        <div className="banner" style={{ marginTop: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Our stats — same pill style as the map. National Parks lands with that feature. */
function OurStatsCard({ personId }: { personId: string | null }) {
  const [s, setS] = useState<SettingsStats | null>(null);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [showTrips, setShowTrips] = useState(false);
  useEffect(() => {
    fetchTripsList(personId)
      .then(setTrips)
      .catch(() => setTrips([]));
  }, [personId]);
  useEffect(() => {
    // Discard a stale response if the person toggle changed before it resolved.
    let live = true;
    fetchSettingsStats(personId)
      .then((r) => live && setS(r))
      .catch(() => live && setS(null));
    return () => {
      live = false;
    };
  }, [personId]);
  if (!s) return null;
  const pills = [
    { label: 'Trails Taken', value: s.trails_taken },
    { label: 'Camping', value: s.camping },
    { label: 'Dining', value: s.dining },
    { label: 'Wineries', value: s.winery },
  ];
  return (
    <div className="card">
      <details className="stats-dropdown">
        <summary>Stats</summary>
        <div className="our-stats">
          {/* TRIPS LIVES HERE, not in the map's toggle row (Erica, 2026-08-11).
              The count comes from the same canonical definition the list does, so
              they cannot disagree. */}
          <button
            className={`stat stat-open ${showTrips ? 'on' : ''}`}
            onClick={() => setShowTrips((v) => !v)}
            aria-expanded={showTrips}
          >
            <b>{trips.length}</b> <span className="label">Trips</span>
          </button>
          {pills.map((p) => (
            <div key={p.label} className="stat">
              <b>{p.value}</b> <span className="label">{p.label}</span>
            </div>
          ))}
        </div>

        {showTrips && (
          <div className="trip-list">
            {trips.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                No trips yet. A visit of more than one day counts as one.
              </p>
            ) : (
              trips.map((t) => (
                // THE WHOLE ROW OPENS THE VISIT (Erica: "instead of an edit link just
                // make the trips click to edit"). The dates are editable there.
                <Link key={t.visit_id} className="trip-row" to={`/visit/${t.visit_id}`}>
                  <span className="trip-name">{t.name}</span>
                  <span className="label">
                    {visitDates(t.start_date, t.end_date)} ·{' '}
                    {t.nights === 1 ? '1 night' : `${t.nights} nights`}
                  </span>
                </Link>
              ))
            )}
            {/* "Add a trip should open the same card as everywhere else" — a trip is
                just a visit of more than one day, so there is nothing extra to fill in. */}
            <Link className="btn-add-trip" to="/add">
              + Add a trip
            </Link>
          </div>
        )}
      </details>
    </div>
  );
}

/** Cities & States — the geography count that used to sit in the map stats bar.
 *  Each state/country is a dropdown listing the cities (places) within it. */
function PlacesByStateCard({
  personId,
  placePeople,
}: {
  personId: string | null;
  placePeople: Map<string, Set<string>>;
}) {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [cov, setCov] = useState<GeoCoverage | null>(null);
  useEffect(() => {
    let live = true;
    fetchPlaces()
      .then((r) => live && setPlaces(r))
      .catch(() => live && setPlaces([]));
    fetchGeoCoverage(personId)
      .then((r) => live && setCov(r))
      .catch(() => live && setCov(null));
    return () => {
      live = false;
    };
  }, [personId]);
  if (!places) return null;

  // Top-level, saved, non-bucket places grouped by state (US) or country.
  const groups = new Map<string, { isState: boolean; cities: Place[] }>();
  for (const p of places) {
    if (p.bucket || !p.saved) continue;
    if (personId && !(placePeople.get(p.id)?.has(personId) ?? false)) continue;
    const isUS = (p.country ?? '').match(/^(United States|USA|US)$/i);
    const key = isUS ? (p.admin1 ?? 'United States') : (p.country ?? 'Other');
    if (!groups.has(key)) groups.set(key, { isState: Boolean(isUS), cities: [] });
    groups.get(key)!.cities.push(p);
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    if (a[1].isState !== b[1].isState) return a[1].isState ? -1 : 1;
    return a[0].localeCompare(b[0]);
  });
  // Accurate counts from the server (DC excluded from the 50, US/US-States
  // spellings normalized); fall back to the client grouping until it loads.
  const stateCount =
    cov?.us_state_count ??
    ordered.filter((g) => g[1].isState && g[0] !== 'District of Columbia').length;
  const countryCount = cov?.country_count ?? ordered.filter((g) => !g[1].isState).length;
  const statePct = Math.round((stateCount / 50) * 100);

  return (
    <div className="card">
      <details className="stats-dropdown">
        <summary>Cities and states</summary>
        <div className="our-stats" style={{ marginBottom: 10 }}>
          <div className="stat">
            <b>{stateCount}</b>{' '}
            <span className="label">of 50 states{cov?.has_dc ? ' + DC' : ''}</span>
          </div>
          <div className="stat">
            <b>{statePct}%</b> <span className="label">of the US</span>
          </div>
          <div className="stat">
            <b>{countryCount}</b> <span className="label">countries</span>
          </div>
        </div>
        <div className="us-progress" title={`${stateCount} of 50 states`}>
          <div className="us-progress-fill" style={{ width: `${statePct}%` }} />
        </div>
        {ordered.map(([label, g]) => (
          <details key={label} className="spot-cat">
            <summary>
              {label} <span className="label">· {g.cities.length}</span>
            </summary>
            <div className="visit-list">
              {g.cities
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <Link key={c.id} className="visit-row" to={`/place/${c.id}`}>
                    <span className="visit-main">{c.name}</span>
                  </Link>
                ))}
            </div>
          </details>
        ))}
      </details>
    </div>
  );
}

/** National Parks visited — grouped by the park a place FALLS INSIDE.
 *
 *  This used to match the place's NAME against /national (park|monument|…)/, which
 *  counted zero of the 15 places that are actually inside one: Archangel Falls and
 *  Zion Lodge are in Zion, Old Rag is in Shenandoah, and none of them are *called*
 *  "national park". `places.park` is set by a spatial join against the park
 *  boundaries (trg_place_park), and it is the truth. */
function NationalParksCard({
  personId,
  placePeople,
}: {
  personId: string | null;
  placePeople: Map<string, Set<string>>;
}) {
  const [places, setPlaces] = useState<Place[] | null>(null);
  useEffect(() => {
    fetchPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]));
  }, []);
  if (!places) return null;

  const inside = places.filter(
    (p) =>
      p.saved &&
      !p.bucket &&
      Boolean(p.park) &&
      (!personId || (placePeople.get(p.id)?.has(personId) ?? false)),
  );
  // One row per PARK, listing the places you have been inside it.
  const byPark = new Map<string, Place[]>();
  for (const p of inside) {
    const key = p.park as string;
    byPark.set(key, [...(byPark.get(key) ?? []), p]);
  }
  const parks = [...byPark.entries()]
    .map(([park, places_]) => ({
      park,
      places: places_.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.park.localeCompare(b.park));

  return (
    <div className="card">
      <details className="stats-dropdown">
        <summary>National Parks</summary>
        <div className="our-stats" style={{ marginBottom: 10 }}>
          <div className="stat">
            <b>{parks.length}</b> <span className="label">visited</span>
          </div>
        </div>
        {parks.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>None logged yet.</p>
        ) : (
          <div className="visit-list">
            {parks.map((g) => (
              <div key={g.park}>
                <div className="visit-row">
                  <span className="visit-main">
                    <b>{g.park}</b>
                  </span>
                  <span className="label">
                    {' '}
                    · {g.places.length} {g.places.length === 1 ? 'place' : 'places'}
                  </span>
                </div>
                {g.places.map((pl) => (
                  <Link
                    key={pl.id}
                    className="visit-row"
                    to={`/place/${pl.id}`}
                    style={{ paddingLeft: 18 }}
                  >
                    <span className="visit-main">{pl.name}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </details>
    </div>
  );
}

/** Location tracking — turn on in-app tracking + show each person's last ping. */
function TrackingCard({ myId }: { myId: string }) {
  const [on, setOn] = useState(trackingPref());
  const [rows, setRows] = useState<TrackingStatus[] | null>(null);
  // Ghost mode. Separate from tracking on purpose: recording where you have been
  // and showing the other person where you are now are two different consents.
  const [sharing, setSharing] = useState<boolean | null>(null);
  const [sharingBusy, setSharingBusy] = useState(false);
  useEffect(() => {
    fetchTrackingStatus()
      .then(setRows)
      .catch(() => setRows([]));
    fetchShareLocation()
      .then(setSharing)
      .catch(() => setSharing(true));
  }, []);
  async function toggleSharing() {
    if (sharing === null || sharingBusy) return;
    const next = !sharing;
    setSharingBusy(true);
    setSharing(next);
    try {
      await setShareLocation(next);
    } catch (e) {
      setSharing(!next); // put the switch back rather than lie about it
      // ...and say why. A switch that silently flips back looks like the app
      // ignoring you.
      showSnack({
        message:
          e instanceof Error
            ? `Could not change location sharing: ${e.message}`
            : 'Could not change location sharing.',
      });
    } finally {
      setSharingBusy(false);
    }
  }
  function toggle() {
    const next = !on;
    setOn(next);
    setTrackingPref(next);
    if (next) startTracking(myId);
    else stopTracking();
  }
  const rel = (iso: string | null): string => {
    if (!iso) return 'never';
    const ms = Date.now() - new Date(iso).getTime();
    const d = Math.floor(ms / 86400000);
    if (d > 0) return `${d}d ago`;
    const h = Math.floor(ms / 3600000);
    if (h > 0) return `${h}h ago`;
    const m = Math.floor(ms / 60000);
    return m > 0 ? `${m}m ago` : 'just now';
  };
  return (
    <div className="card">
      <b>Location tracking</b>
      <p className="label" style={{ margin: '6px 0 10px' }}>
        Records your location while the app is open — powers the map fog, heatmap, and matching
        photos to places. Phones only track while the app is open (no background tracking on
        iPhone).
      </p>
      {trackingSupported() ? (
        <button className={on ? 'primary' : ''} onClick={toggle}>
          {on ? 'Tracking on — tap to stop' : 'Turn on tracking'}
        </button>
      ) : (
        <p className="label">This device can’t share its location.</p>
      )}
      {/* GHOST MODE. Off means nobody else sees where you are — you still do. */}
      <div style={{ marginTop: 14, borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
        <b>Where we are</b>
        <p className="label" style={{ margin: '6px 0 10px' }}>
          Puts your last known location on the map for the other person, with how long ago it was.
          Because a phone only pings while the app is open, it is usually hours old — it says so,
          and never pretends to be live.
        </p>
        {sharing === null ? (
          <p className="label">Checking…</p>
        ) : (
          <button
            className={sharing ? 'primary' : ''}
            disabled={sharingBusy}
            onClick={() => void toggleSharing()}
          >
            {sharing ? 'Sharing my location — tap to hide it' : 'Hidden — tap to share my location'}
          </button>
        )}
      </div>
      {rows && (
        <div className="our-stats" style={{ marginTop: 10 }}>
          {rows
            .filter((r) => r.display_name !== 'Test Bot')
            .map((r) => (
              <div key={r.profile_id} className="stat">
                <b>{r.display_name ?? 'You'}</b>{' '}
                <span className="label">last {rel(r.last_ping)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/** Peaks bagged — summits reached, matched from hike GPS tracks against OSM peaks. */
function PeaksCard({ personId }: { personId: string | null }) {
  const [peaks, setPeaks] = useState<Peak[] | null>(null);
  const [climb, setClimb] = useState<{ total_ft: number; everests: number } | null>(null);
  useEffect(() => {
    let live = true;
    fetchPeaksBagged(personId)
      .then((r) => live && setPeaks(r))
      .catch(() => live && setPeaks([]));
    fetchClimbingStats(personId)
      .then((r) => live && setClimb(r))
      .catch(() => live && setClimb(null));
    return () => {
      live = false;
    };
  }, [personId]);
  if (!peaks) return null;
  return (
    <div className="card">
      <details className="stats-dropdown">
        <summary>Peaks &amp; climbing</summary>
        <div className="our-stats" style={{ marginBottom: 10 }}>
          <div className="stat">
            <b>{peaks.length}</b> <span className="label">summits</span>
          </div>
          {climb && climb.total_ft > 0 && (
            <>
              <div className="stat">
                <b>{climb.total_ft.toLocaleString()}</b> <span className="label">ft climbed</span>
              </div>
              <div className="stat">
                <b>{climb.everests}</b> <span className="label">Everests</span>
              </div>
            </>
          )}
        </div>
        {peaks.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>No summits matched yet.</p>
        ) : (
          <div className="visit-list">
            {peaks.map((p) =>
              p.place_id ? (
                <Link key={p.id} className="visit-row peak-row" to={`/place/${p.place_id}`}>
                  <span className="visit-main">{p.name}</span>
                  {p.ele_ft ? (
                    <span className="label"> · {p.ele_ft.toLocaleString()} ft</span>
                  ) : null}
                </Link>
              ) : (
                <div key={p.id} className="visit-row peak-row">
                  <span className="visit-main">{p.name}</span>
                  {p.ele_ft ? (
                    <span className="label"> · {p.ele_ft.toLocaleString()} ft</span>
                  ) : null}
                </div>
              ),
            )}
          </div>
        )}
      </details>
    </div>
  );
}

/**
 * DARK OR LIGHT, per person and per browser.
 *
 * The map is ours now — tiles, glyphs and both styles come from our own R2 through
 * adventureorno.com/basemap — so a theme is a style swap rather than a different
 * provider. Changing it reloads the page: MapLibre can accept a new style at
 * runtime, but every map in the app would need to re-add its own sources and
 * layers in the right order, and getting that wrong is how a map ends up blank
 * with nothing in the console.
 */
function MapAppearanceSection() {
  const [choice, setChoice] = useState<MapAppearance>(mapAppearance());

  const CHOICES: { key: MapAppearance; label: string; hint: string }[] = [
    { key: 'dark', label: 'Dark', hint: 'Matches the place cards' },
    { key: 'light', label: 'Light', hint: 'Bright, for daylight' },
    { key: 'auto', label: 'Match my device', hint: 'Follows your phone or laptop' },
  ];

  function pick(v: MapAppearance) {
    if (v === choice) return;
    setMapAppearance(v);
    setChoice(v);
    window.location.reload();
  }

  return (
    <div className="card">
      <div className="ps-who-toggle" style={{ marginBottom: 10 }}>
        {CHOICES.map((c) => (
          <button
            key={c.key}
            type="button"
            className={choice === c.key ? 'on' : ''}
            onClick={() => pick(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
        {CHOICES.find((c) => c.key === choice)?.hint}. The map reloads when this changes.
      </p>
      {!usingSelfHosted && (
        <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 13 }}>
          The app is on the old Mapbox basemap at the moment, which has one appearance — this
          setting takes effect when it is back on our own map.
        </p>
      )}
    </div>
  );
}

/** The whole Stats section with one Me / Josh / Both toggle that drives every
 *  pill (each card refetches/refilters for the selected person). */
function StatsSection() {
  const [people, setPeople] = useState<MapPerson[]>([]);
  const [placePeople, setPlacePeople] = useState<Map<string, Set<string>>>(new Map());
  const [person, setPerson] = useState<string | null>(null); // null = Both
  useEffect(() => {
    fetchMapPeople()
      .then(setPeople)
      .catch(() => undefined);
    fetchPlacePeople()
      .then(setPlacePeople)
      .catch(() => undefined);
  }, []);
  const real = people.filter((p) => p.display_name !== 'Test Bot');
  return (
    <>
      <div className="stats-toggle">
        <button
          className={person === null ? 'on' : ''}
          onClick={() => setPerson(null)}
          type="button"
        >
          Both
        </button>
        {real.map((pp) => (
          <button
            key={pp.id}
            className={person === pp.id ? 'on' : ''}
            onClick={() => setPerson(pp.id)}
            type="button"
          >
            {pp.display_name ?? 'Me'}
          </button>
        ))}
      </div>
      <div className="stats-row">
        <OurStatsCard personId={person} />
        <PlacesByStateCard personId={person} placePeople={placePeople} />
        <NationalParksCard personId={person} placePeople={placePeople} />
        <PeaksCard personId={person} />
        <Link className="card stat-navcard" to="/wrapped">
          Years
        </Link>
      </div>
    </>
  );
}

/** Owner toggle: globe vs Mercator projection (falls back without a deploy). */
function ProjectionCard() {
  const [proj, setProj] = useState<MapProjection | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetchMapProjection()
      .then(setProj)
      .catch(() => setProj('globe'));
  }, []);
  async function choose(t: MapProjection) {
    if (t === proj) return;
    setBusy(true);
    try {
      await setMapProjection(t);
      setProj(t);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card">
      <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 13 }}>
        Map projection — reload the map to see the change.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          disabled={busy}
          className={proj === 'globe' ? 'primary' : ''}
          onClick={() => void choose('globe')}
        >
          Globe
        </button>
        <button
          disabled={busy}
          className={proj === 'mercator' ? 'primary' : ''}
          onClick={() => void choose('mercator')}
        >
          Flat (Mercator)
        </button>
      </div>
    </div>
  );
}

/** Export all our places as CSV / GPX / KML (generated in the browser). */
function ExportCard() {
  const [places, setPlaces] = useState<Place[] | null>(null);
  useEffect(() => {
    fetchPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]));
  }, []);
  const n = (places ?? []).filter((p) => p.saved && !p.bucket && p.name.trim()).length;
  return (
    <div className="card">
      <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 13 }}>
        Download all {n} places — CSV for spreadsheets, GPX/KML for maps &amp; Google Earth.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button disabled={!places} onClick={() => places && exportCsv(places)}>
          CSV
        </button>
        <button disabled={!places} onClick={() => places && exportGpx(places)}>
          GPX
        </button>
        <button disabled={!places} onClick={() => places && exportKml(places)}>
          KML
        </button>
      </div>
    </div>
  );
}

/** Upload Garmin (or any) GPX/TCX activity files — the Strava-limit workaround.
 *  Parses each client-side and imports it, attributed to whoever's signed in. */
function GarminImportCard() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onFiles(files: FileList) {
    setBusy(true);
    let added = 0;
    const problems: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const parsed = /\.fit$/i.test(file.name)
          ? await parseFitActivity(await file.arrayBuffer(), file.name)
          : parseActivityFile(await file.text(), file.name);
        if (!parsed) {
          problems.push(`${file.name}: no GPS track found`);
          continue;
        }
        await importFileActivity(parsed);
        added++;
      } catch (e) {
        // Surface the real reason instead of a silent "couldn't be read".
        problems.push(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
      }
      setMsg(`Imported ${added}${problems.length ? `, ${problems.length} failed` : ''}…`);
    }
    setMsg(
      `Done — ${added} activit${added === 1 ? 'y' : 'ies'} imported.` +
        (problems.length ? ` Couldn't import: ${problems.join('; ')}` : '') +
        ' Re-importing the same file is safe (duplicates are ignored).',
    );
    setBusy(false);
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <b>Import from Garmin (GPX / TCX / FIT)</b>
      <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 10px' }}>
        Strava only lets one athlete connect, so bring your Garmin activities in as files instead.
        You can upload the <b>.FIT</b> files straight from your watch/Garmin Connect, or export an
        activity as GPX/TCX (gear icon → <b>Export</b>). They're attributed to you, and importing
        the same file twice is safe.
      </div>
      <button className="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? 'Importing…' : 'Choose GPX / TCX / FIT files'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".gpx,.tcx,.fit,application/gpx+xml,application/xml,text/xml,application/octet-stream"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files && e.target.files.length) void onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {msg && (
        <div className="banner" style={{ marginTop: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}

function StravaCard({ isOwner }: { isOwner: boolean }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const clientId = import.meta.env.VITE_STRAVA_CLIENT_ID;

  async function connectStrava() {
    if (!clientId) return;
    setLinkErr(null);
    setLinking(true);
    try {
      window.location.href = await beginStravaLink(clientId);
    } catch {
      setLinkErr('Could not start the Strava link. Please try again.');
      setLinking(false);
    }
  }

  useEffect(() => {
    isMyStravaConnected().then(setConnected);
    const params = new URLSearchParams(window.location.search);
    if (params.get('strava') === 'connected') setConnected(true);
  }, []);

  async function runBackfill(days: number) {
    setRunning(true);
    setProgress('Starting…');
    const before = Math.floor(Date.now() / 1000);
    const after = before - days * 86400;
    let page = 1;
    let stored = 0;
    let processed = 0;
    let anyFailed = false;
    try {
      for (;;) {
        const r = await backfillPage(after, before, page);
        stored += r.stored;
        processed += r.processed;
        if (r.failed && r.failed.length) anyFailed = true;
        setProgress(`Page ${page}: ${processed} activities scanned, ${stored} stored…`);
        if (!r.hasMore) break;
        page++;
        await sleep(1500); // gentle pacing under the 100/15min limit
      }
      setProgress(
        `Done — ${stored} activities stored from the last ${days} days.` +
          (anyFailed
            ? ' Some pages could not be fetched — run backfill again to fill the gaps.'
            : ''),
      );
    } catch (e) {
      setProgress(e instanceof Error ? e.message : 'Backfill failed');
    }
    setRunning(false);
  }

  if (!clientId) {
    return (
      <div className="card">
        <b>Strava</b>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
          Set <code>VITE_STRAVA_CLIENT_ID</code> (and the server secrets) after creating the Strava
          API app — see MANUAL-SETUP §6.
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <b>Strava</b>
      {connected === null ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>Checking…</div>
      ) : connected ? (
        <>
          <div style={{ color: '#4dd07a', fontSize: 13, margin: '4px 0 10px' }}>
            ✓ Your Strava is connected. New activities import automatically.
          </div>
          {isOwner && (
            <>
              <div className="btn-row" style={{ marginTop: 0 }}>
                <button disabled={running} onClick={() => void runBackfill(3650)}>
                  {running ? 'Importing…' : 'Backfill all history (both of you)'}
                </button>
                <button disabled={running} onClick={() => void runBackfill(365)}>
                  Last 12 months
                </button>
              </div>
              {progress && (
                <div className="banner" style={{ marginTop: 8 }}>
                  {progress}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 10px' }}>
            Connect your Strava to auto-import your hikes, walks, runs, and rides. To pull in Garmin
            activities, turn on <b>Garmin Connect → Strava</b> in Garmin Connect — they'll flow in
            through Strava, no separate Garmin connection needed.
          </div>
          <button className="primary" onClick={connectStrava} disabled={linking}>
            {linking ? 'Starting…' : 'Connect Strava'}
          </button>
          {linkErr && (
            <div style={{ color: 'var(--danger, #c00)', fontSize: 13, marginTop: 8 }}>
              {linkErr}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Settings() {
  const { profile, signOut } = useAuth();
  const [members, setMembers] = useState<MapPerson[]>([]);
  useEffect(() => {
    fetchMapPeople()
      .then(setMembers)
      .catch(() => undefined);
  }, []);
  const memberNames = members
    .map((m) => m.display_name)
    .filter(Boolean)
    .join(' & ');

  // ONE PAGE, not five tabs. Erica, 2026-08-11: "everything from account,
  // connections, privacy, data, and advanced should [be] extracted and added to one
  // page, nicely styled... I don't need the labels like Account etc make it look
  // like a seamless page."
  //
  // Every card that was behind a tab is still here, in the same order, just
  // continuous — and the group labels the tabs implied are gone with them.

  return (
    <div
      className="settings-page"
      style={{ maxWidth: 640, margin: '40px auto', padding: '0 20px 96px' }}
    >
      <Link className="back-bar" to="/">
        <span>Map</span>
      </Link>
      <h1>Settings</h1>
      <p style={{ color: 'var(--muted)' }}>
        Signed in as <b>{profile?.display_name ?? 'you'}</b> · role <b>{profile?.role}</b>
      </p>

      {
        <>
          <button onClick={() => void signOut()}>Sign out</button>

          {profile?.role === 'owner' && (
            <>
              {/* Join requests are PART OF People, not a section of their own
                  (Erica, 2026-08-11) — someone asking to join is a person, and
                  the page reads as one thing instead of two stacked lists. */}
              <h2 style={{ marginTop: 28 }}>People</h2>
              <JoinRequestsCard />
              <PeopleCard meId={profile.id} />
            </>
          )}
        </>
      }

      {profile && (
        <>
          <h2 style={{ marginTop: 20 }}>Strava &amp; Garmin</h2>
          <StravaCard isOwner={profile.role === 'owner'} />
          <GarminImportCard />
        </>
      )}

      {
        <>
          <h2 style={{ marginTop: 20 }}>{memberNames ? `Shared — ${memberNames}` : 'Shared'}</h2>
          <SharedHub />

          {profile && (
            <>
              <h2 style={{ marginTop: 28 }}>Location tracking</h2>
              <TrackingCard myId={profile.id} />
            </>
          )}
        </>
      }

      {
        <>
          <h2 style={{ marginTop: 20 }}>Map appearance</h2>
          <MapAppearanceSection />

          <h2 style={{ marginTop: 20 }}>Stats</h2>
          <StatsSection />

          {(profile?.role === 'owner' || profile?.role === 'editor') && (
            <>
              <h2 style={{ marginTop: 28 }}>Manage data</h2>
              <div className="card">
                <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 14 }}>
                  Tools for tidying everything up — edit every place in one table, sort photos,
                  review what needs attention, merge duplicates, and check the health of your data.
                </p>
                <div className="settings-tools">
                  {/* The nav tab only appears when something is waiting, so an empty
                      inbox needs a permanent way in. */}
                  <Link to="/inbox">
                    <button>Review inbox</button>
                  </Link>
                  <Link to="/places/edit">
                    <button className="primary">Edit all places</button>
                  </Link>
                  {/* Importing and sorting photos, and importing activity files, live
                      HERE now — Erica: "Move Import and Sort Photos into Settings. Move
                      import activities to settings." The sorter is both: it pulls from
                      the device and Google Photos, then sorts what arrives. */}
                  <Link to="/photos/sort">
                    <button>Import &amp; sort photos</button>
                  </Link>
                  <Link to="/import/timeline">
                    <button>Import an activity file</button>
                  </Link>
                  <Link to="/attention">
                    <button>Needs attention</button>
                  </Link>
                  <Link to="/albums">
                    <button>Smart albums</button>
                  </Link>
                  <Link to="/timeline">
                    <button>Timeline</button>
                  </Link>
                  <Link to="/duplicates">
                    <button>Duplicate places</button>
                  </Link>
                  <Link to="/health">
                    <button>Data health</button>
                  </Link>
                  <Link to="/trash">
                    <button>Trash</button>
                  </Link>
                </div>
              </div>
            </>
          )}

          <h2 style={{ marginTop: 28 }}>Tags</h2>
          <TagsCard />

          <h2 style={{ marginTop: 28 }}>Export our data</h2>
          <ExportCard />
        </>
      }

      {profile?.role === 'owner' && (
        <>
          <h2 style={{ marginTop: 20 }}>Map</h2>
          <ProjectionCard />

          <h2 style={{ marginTop: 28 }}>Places &amp; location</h2>
          <GeocodeCard />
        </>
      )}
    </div>
  );
}
