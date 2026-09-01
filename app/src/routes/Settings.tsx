import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  mapAppearance,
  setMapAppearance,
  usingSelfHosted,
  type MapAppearance,
} from '../lib/basemap';
import {
  addCategory,
  fetchAttention,
  fetchClimbingStatsForPeople,
  fetchGeoCoverageForPeople,
  fetchImportRuns,
  fetchSpaceMembers,
  fetchPeaksBaggedForPeople,
  fetchPlaceIdsForPeople,
  type Attention,
  type ImportRun,
  type Peak,
  fetchMapProjection,
  fetchPlaces,
  fetchSettingsStatsForPeople,
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
import PeopleFilter from '../components/PeopleFilter';
import { myStats, scopeLabel, scopeSentence, type PeopleSelection } from '../lib/statsScope';
import {
  fetchMemoryTagsToConfirm,
  fetchMyPeople,
  respondToMemoryTag,
  type MemoryTagToConfirm,
  type PersonContact,
} from '../lib/memoryPeople';
import { nextOpenPanel, panelIsOpen, type OpenPanel } from '../lib/disclosure';
import type { Place } from '../lib/types';
import { showSnack } from '../lib/snackbar';
import { whyItFailed } from '../lib/whyItFailed';
import {
  BIO_MAX,
  claimHandle,
  savePublicProfile,
  suggestHandle,
  whatAStrangerSees,
  whyHandleIsInvalid,
} from '../lib/publicProfile';
import {
  backfillPage,
  beginStravaLink,
  fetchTripsListForPeople,
  isMyStravaConnected,
  type TripRow,
} from '../lib/strava';
import { visitDates } from '../lib/visitDates';
import {
  beginImportRun,
  recordArtifact,
  recordImportFailure,
  finishImportRun,
  importActivityFile,
  parseActivityFile,
  parseFitActivity,
} from '../lib/importFile';
import PeopleCard from '../components/PeopleCard';
import YourPeopleCard from '../components/YourPeopleCard';
import SharedHub from '../components/SharedHub';
import { runClusteringNow } from '../lib/timeline';

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
        <Link to="/settings/import" className="as-button">
          Import Google Timeline…
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

/** What every stats panel needs to sit in its group. */
interface PanelProps {
  /** This panel's key within its group. */
  panelKey: string;
  open: boolean;
  onToggle: (key: string) => void;
}

/**
 * THE disclosure in the Stats section — the only one.
 *
 * There used to be four of these written out longhand, one per card, plus a fifth
 * spelling (`.spot-cat`) for the states nested inside Cities and states. All of them
 * were independent: open all four and nothing shut them again, and because the
 * summaries hid the native marker without drawing a replacement, an open panel looked
 * exactly like a closed one. Erica, 2026-08-29: "The dropdowns under stats in settings
 * need work. They don't disappear and are redundant."
 *
 * `open` is driven from React rather than left to the browser, because the panels are a
 * GROUP (lib/disclosure): opening one closes the last, so four can never sit open at
 * once. That means suppressing the native toggle on click — otherwise the element and
 * the state disagree — which also keeps Enter/Space working, since the browser fires a
 * click for those on a summary.
 */
function StatsPanel({
  panelKey,
  open,
  onToggle,
  summary,
  meta,
  sub,
  children,
}: PanelProps & {
  summary: string;
  /** A count shown beside the title, e.g. the number of cities in a state. */
  meta?: string;
  /** Second level — the states inside Cities and states. */
  sub?: boolean;
  children: ReactNode;
}) {
  const details = (
    <details className={`stats-dropdown${sub ? ' stats-dropdown-sub' : ''}`} open={open}>
      <summary
        onClick={(e) => {
          e.preventDefault();
          onToggle(panelKey);
        }}
      >
        {summary}
        {meta ? <span className="label"> · {meta}</span> : null}
      </summary>
      {children}
    </details>
  );
  // The top level is a card in the stats grid; a nested one is just the control.
  return sub ? details : <div className="card">{details}</div>;
}

/** The stats pills — the same reader, the same scope and the same words as /insights.
 *
 *  UNTIL 0280 THIS CARD CALLED `trips_list(p_profile)` with a null and printed **17
 *  Trips**, while /insights called `trips_list_for_people('{}')` and printed **56**. Live,
 *  the same account, the same moment. Neither was miscounting: a null there means "only
 *  what we were BOTH on" and an empty list here means "no filter", so the two screens were
 *  answering opposite questions under one label. */
function StatsCard({
  scope,
  contacts,
  panelKey,
  open,
  onToggle,
}: { scope: PeopleSelection; contacts: PersonContact[] } & PanelProps) {
  const [s, setS] = useState<SettingsStats | null>(null);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [showTrips, setShowTrips] = useState(false);
  useEffect(() => {
    // Discard a stale response if the scope changed before it resolved.
    let live = true;
    fetchTripsListForPeople(scope.people, scope.mode)
      .then((r) => live && setTrips(r))
      .catch(() => live && setTrips([]));
    fetchSettingsStatsForPeople(scope.people, scope.mode)
      .then((r) => live && setS(r))
      .catch(() => live && setS(null));
    return () => {
      live = false;
    };
  }, [scope]);
  if (!s) return null;
  const pills = [
    { label: 'Trails Taken', value: s.trails_taken },
    { label: 'Camping', value: s.camping },
    { label: 'Dining', value: s.dining },
    { label: 'Wineries', value: s.winery },
  ];
  return (
    <StatsPanel
      panelKey={panelKey}
      open={open}
      onToggle={onToggle}
      summary={scopeLabel(scope, contacts)}
      meta={scopeSentence(scope, contacts)}
    >
      <>
        <div className="our-stats">
          {/* TRIPS LIVES HERE, not in the map's toggle row (Erica, 2026-08-11).
              The count comes from the same canonical definition the list does, so
              they cannot disagree.

              AND IT STAYS A PILL. This is the one disclosure in the section that is
              not a `<details>`, which looks like the inconsistency the rest of this
              change removed — it is not. Erica asked for this exact control twice
              ("I wanted it under Stats", "clicking on the Trips should pull up a
              list of trips that I can edit"): a stat pill, sitting in the row of
              stat pills, that happens to open. Turning it into another summary would
              lift the number out of the row she asked to have it in. */}
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
      </>
    </StatsPanel>
  );
}

/** Cities & States — the geography count that used to sit in the map stats bar.
 *  Each state/country is a dropdown listing the cities (places) within it. */
function PlacesByStateCard({
  scope,
  scopePlaceIds,
  panelKey,
  open,
  onToggle,
}: {
  scope: PeopleSelection;
  /** The places in the current scope — `place_ids_for_people`, the very set the map draws
   *  pins for. This used to be `place_people()`, which answers who TOUCHED the record
   *  (created it, uploaded a photo, has an activity there) rather than who was there, so
   *  this list and the map could disagree about the same state. Null while loading. */
  scopePlaceIds: Set<string> | null;
} & PanelProps) {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [cov, setCov] = useState<GeoCoverage | null>(null);
  // The states are their OWN one-open-at-a-time group, nested inside this panel.
  const [openState, setOpenState] = useState<OpenPanel>(null);
  useEffect(() => {
    let live = true;
    fetchPlaces()
      .then((r) => live && setPlaces(r))
      .catch(() => live && setPlaces([]));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    fetchGeoCoverageForPeople(scope.people, scope.mode)
      .then((r) => live && setCov(r))
      .catch(() => live && setCov(null));
    return () => {
      live = false;
    };
  }, [scope]);
  if (!places || !scopePlaceIds) return null;

  // Top-level, saved, non-bucket places grouped by state (US) or country.
  const groups = new Map<string, { isState: boolean; cities: Place[] }>();
  for (const p of places) {
    if (p.bucket || !p.saved) continue;
    if (!scopePlaceIds.has(p.id)) continue;
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
    <StatsPanel panelKey={panelKey} open={open} onToggle={onToggle} summary="Cities and states">
      <>
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
          <StatsPanel
            key={label}
            sub
            panelKey={label}
            open={panelIsOpen(openState, label)}
            onToggle={(k) => setOpenState((cur) => nextOpenPanel(cur, k))}
            summary={label}
            meta={String(g.cities.length)}
          >
            <div className="visit-list">
              {g.cities
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <Link key={c.id} className="visit-row" to={`/place/${c.id}`}>
                    <span className="visit-main">{c.name}</span>
                  </Link>
                ))}
            </div>
          </StatsPanel>
        ))}
      </>
    </StatsPanel>
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
  scopePlaceIds,
  panelKey,
  open,
  onToggle,
}: {
  scopePlaceIds: Set<string> | null;
} & PanelProps) {
  const [places, setPlaces] = useState<Place[] | null>(null);
  useEffect(() => {
    fetchPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]));
  }, []);
  if (!places || !scopePlaceIds) return null;

  const inside = places.filter(
    (p) => p.saved && !p.bucket && Boolean(p.park) && scopePlaceIds.has(p.id),
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
    <StatsPanel panelKey={panelKey} open={open} onToggle={onToggle} summary="National Parks">
      <>
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
      </>
    </StatsPanel>
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
function PeaksCard({ scope, panelKey, open, onToggle }: { scope: PeopleSelection } & PanelProps) {
  const [peaks, setPeaks] = useState<Peak[] | null>(null);
  const [climb, setClimb] = useState<{ total_ft: number; everests: number } | null>(null);
  useEffect(() => {
    let live = true;
    fetchPeaksBaggedForPeople(scope.people, scope.mode)
      .then((r) => live && setPeaks(r))
      .catch(() => live && setPeaks([]));
    fetchClimbingStatsForPeople(scope.people, scope.mode)
      .then((r) => live && setClimb(r))
      .catch(() => live && setClimb(null));
    return () => {
      live = false;
    };
  }, [scope]);
  if (!peaks) return null;
  return (
    <StatsPanel panelKey={panelKey} open={open} onToggle={onToggle} summary="Peaks & climbing">
      <>
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
      </>
    </StatsPanel>
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
/**
 * YOUR PUBLIC PROFILE — built 2026-08-30, and it is the missing half of item 7.
 *
 * `/people` and `/profile/:handle` shipped and worked, and both were empty for everybody:
 * `0283` defaults `profile_visibility` to `private` with all three switches `false`, and
 * there was no way anywhere in the app to change any of them. `find_profiles()` only ever
 * matches a public row, so the directory could find nobody — not because search was
 * broken, but because nobody could publish themselves. This card is the door.
 *
 * NO MIGRATION. `set_handle()` and `save_public_profile()` have been applied since 0283;
 * both are SECURITY DEFINER on `auth.uid()`, which is what lets a member edit their own
 * card when `profiles` itself is owner-only for writes (0286).
 *
 * THE HANDLE IS CLAIMED ONCE and the field says so before you commit, because 0283's guard
 * holds a claimed handle still afterwards — a link to a person has to keep meaning that
 * person.
 *
 * THE OUTCOME IS STATED, not left to be added up from four switches: `whatAStrangerSees()`
 * turns them into one sentence, so the card answers "who can see what" rather than asking
 * her to work it out. Privacy is the user's own choice (Erica, 2026-08-30: *"it's fine for
 * users to share their home address and whatever else they want to share"*), so nothing
 * here is hidden on her behalf and the default stays private.
 */
function PublicProfileCard() {
  const { profile, refreshProfile } = useAuth();
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    // The assigned handle is the honest starting point: it is what people would find you
    // by right now. `suggestHandle` is only for the case where somehow there is none.
    setHandle(profile.handle ?? suggestHandle(profile.display_name));
    setBio(profile.bio ?? '');
  }, [profile]);

  async function run(what: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await refreshProfile();
    } catch (e) {
      // The reason, not a generic fallback — PostgrestError is a plain object, so
      // `e instanceof Error` is false for it (the defect item 6 removed everywhere else).
      setErr(whyItFailed(what, e, { online: navigator.onLine }));
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return null;

  // CLAIMED MEANS CHOSEN, NOT PRESENT — and getting this wrong shipped a dead field.
  //
  // 0283 gives EVERYBODY a handle on sight (`assign_handle`, so "findable" is never a
  // state you have to opt into), and the guard that freezes it fires only when
  // `old.handle_claimed_at is not null`. Keying off `profile.handle` therefore treated
  // every account as already claimed, so the input never rendered and nobody could choose
  // their own handle — the exact defect this card was built to remove, rebuilt one level
  // down. Caught by this file's own live check within an hour of deploying: `.pub-profile`
  // was visible and `getByLabel(/^Handle$/)` found nothing.
  const claimed = !!profile.handle_claimed_at;
  const isPublic = profile.profile_visibility === 'public';
  const handleProblem = claimed ? null : whyHandleIsInvalid(handle);

  return (
    <div className="card pub-profile">
      <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 13 }}>
        {whatAStrangerSees(profile)}
      </p>

      {/* 1. THE HANDLE — the thing a person can type and say out loud. */}
      <label className="npd-field">
        <span>Handle</span>
        {claimed ? (
          <div className="pub-handle-fixed">
            <b>@{profile.handle}</b>{' '}
            <span className="label">chosen — a handle cannot be changed</span>
          </div>
        ) : (
          <>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="your_handle"
              aria-label="Handle"
              disabled={busy}
            />
            <span className="label">
              {handleProblem ??
                'This one was picked for you. Change it if you like — but you can only choose once, so pick one you will keep.'}
            </span>
            <button
              className="primary"
              disabled={busy || !!handleProblem}
              onClick={() => void run('Couldn’t claim that handle', () => claimHandle(handle))}
            >
              Claim @{handle || '…'}
            </button>
          </>
        )}
      </label>

      {/* 2. THE ONE SWITCH THAT MATTERS. Everything below it is moot while this is off,
             and the copy says so rather than leaving three live-looking toggles. */}
      <label className="npd-field pub-visible">
        <input
          type="checkbox"
          checked={isPublic}
          disabled={busy}
          onChange={(e) =>
            void run('Couldn’t change your visibility', () =>
              savePublicProfile({ visibility: e.target.checked ? 'public' : 'private' }),
            )
          }
        />
        <span>Let people find me</span>
        <span className="label">
          {/* NOT GATED ON CLAIMING. Everybody already has a handle (0283), so there is
              always something to be found by — making this wait for a claim would have
              hidden the one switch that matters behind a step nobody needs to take. */}
          Off, and searching for you finds nothing at all.
        </span>
      </label>

      {/* 3. WHAT THEY SEE, each one hers to decide. */}
      <fieldset className="pub-switches" disabled={busy || !isPublic}>
        <legend className="label">And they may see</legend>
        {(
          [
            ['stats', 'public_stats', 'My totals'],
            ['places', 'public_places', 'My places'],
            ['activity', 'public_activity', 'My recent outings'],
          ] as const
        ).map(([key, col, label]) => (
          <label key={key} className="npd-field">
            <input
              type="checkbox"
              checked={!!profile[col]}
              onChange={(e) =>
                void run(`Couldn’t change ${label.toLowerCase()}`, () =>
                  savePublicProfile({ [key]: e.target.checked }),
                )
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      {/* 4. A LINE ABOUT YOU. */}
      <label className="npd-field">
        <span>Bio</span>
        <textarea
          value={bio}
          maxLength={BIO_MAX}
          rows={2}
          disabled={busy}
          onChange={(e) => setBio(e.target.value)}
          aria-label="Bio"
        />
        <span className="label">
          {bio.length}/{BIO_MAX}
        </span>
        <button
          disabled={busy || bio === (profile.bio ?? '')}
          onClick={() => void run('Couldn’t save your bio', () => savePublicProfile({ bio }))}
        >
          Save bio
        </button>
      </label>

      {err && <div className="pub-error">{err}</div>}
      {claimed && isPublic && (
        <Link to={`/profile/${profile.handle}`} className="as-button">
          See what they see
        </Link>
      )}
    </div>
  );
}

/**
 * TAG APPROVALS — built 2026-08-30, because the heading above it had been lying.
 *
 * §"AN ACCEPTED TAG IS MINE" and §0.2 both turn on a person being ASKED before somebody
 * else's claim about them counts: *"Only accepted tags count in Our Stats. A proposed tag
 * is a claim, not shared history."* The whole flow was BUILT and APPLIED — `0248` gives
 * `my_memory_tags_to_confirm()` and `respond_to_memory_tag()`, and `lib/memoryPeople.ts`
 * has wrapped them for months.
 *
 * IT WAS UNREACHABLE. Its only surface was `routes/Inbox.tsx`, which **nothing imports** —
 * `App.tsx` mounts no `/inbox` route, and `/inbox` REDIRECTS to `/settings/data/attention`
 * (measured live 2026-08-30). So the file is dead code, and the one screen that could
 * answer a tag could not be opened. Meanwhile the section header here has read *"People
 * and tag approvals"* the whole time and rendered join requests — account access, a
 * different question entirely — so the page promised a control it did not contain.
 *
 * NOT OWNER-GATED, and that is the point. Anybody can be tagged, so anybody must be able
 * to answer. The join-request card beside it stays owner-only because who may SIGN IN is
 * the account owner's business; who is in YOUR photograph is yours. §8b-i keeps account
 * access and memory participation apart on purpose, and this is that line.
 */
function TagApprovalsCard() {
  const [tags, setTags] = useState<MemoryTagToConfirm[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    fetchMemoryTagsToConfirm()
      .then(setTags)
      .catch(() => setTags([]));
  }
  useEffect(load, []);

  async function answer(t: MemoryTagToConfirm, accept: boolean) {
    setBusy(t.subject_id);
    setErr(null);
    try {
      await respondToMemoryTag(t.subject_id, accept);
      setTags((ts) => (ts ?? []).filter((x) => x.subject_id !== t.subject_id));
      showSnack({ message: accept ? 'Confirmed it’s you.' : 'Removed you from that.' });
    } catch (e) {
      setErr(
        whyItFailed(accept ? 'Couldn’t confirm that' : 'Couldn’t remove you from that', e, {
          online: navigator.onLine,
        }),
      );
    } finally {
      setBusy(null);
    }
  }

  // Nothing to answer is the normal state, and it says so rather than rendering an
  // empty box — the same rule the Trips list follows.
  if (tags === null) return null;

  return (
    <div className="card tag-approvals">
      <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 13 }}>
        {tags.length === 0
          ? 'Nothing to answer. When somebody says you were somewhere, or that you are in a photo, it waits here until you say so.'
          : 'Somebody says you were part of these. Until you accept, they are their claim and not your history.'}
      </p>
      {tags.map((t) => (
        <div key={t.subject_id} className="tag-approval-row">
          <span className="tag-approval-what">
            {/* NAME THE CARD. Erica, 2026-08-31: "I don't want anything to say somewhere
                you were. You can see the full card if you add someone." 0301 returns the
                card's name, gated on sharing a space or having added the tagger, and NULL
                when neither holds — so this says what it is rather than gesturing at it. */}
            {t.card
              ? t.card
              : t.kind === 'photo'
                ? 'A photo you are in'
                : t.kind === 'visit'
                  ? 'A place you were tagged at'
                  : 'An outing you were tagged on'}
            <span className="label"> · {new Date(t.created_at).toLocaleDateString()}</span>
          </span>
          <span className="btn-row">
            <button
              className="primary"
              disabled={busy === t.subject_id}
              onClick={() => void answer(t, true)}
            >
              Yes, that’s me
            </button>
            <button disabled={busy === t.subject_id} onClick={() => void answer(t, false)}>
              No
            </button>
          </span>
        </div>
      ))}
      {err && <div className="pub-error">{err}</div>}
    </div>
  );
}

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

/** The whole Stats section: ONE scope control driving every pill.
 *
 *  IT IS THE SAME CONTROL THE MAP AND /INSIGHTS USE, and that is the fix (§0.2, 0280).
 *  This section used to have a private one — `whoChoices()` pills whose "everyone" answer
 *  resolved to a null profile, which the old readers take as *only what we were BOTH on*.
 *  The identical-looking control on /insights resolved to an empty people list, which the
 *  new readers take as *no filter*. So the two screens sat one tap apart in the same app
 *  reporting 17 Trips and 56 Trips for the same account, and nothing on either screen said
 *  they were answering different questions.
 *
 *  Now there is one control, one vocabulary and one generation of reader, so the numbers
 *  cannot drift apart again without the control itself being wrong. */
function StatsSection() {
  const [contacts, setContacts] = useState<PersonContact[]>([]);
  // Null until the contacts arrive — see myStats(). A scope guessed as "no people" is the
  // retired everybody-question, and showing its answer for a frame is how a number appears
  // to change while you are reading it.
  const [scope, setScope] = useState<PeopleSelection | null>(null);
  // The places in the current scope, fetched ONCE for the two cards that group places
  // themselves. Both used to filter client-side against `place_people()`.
  const [scopePlaceIds, setScopePlaceIds] = useState<Set<string> | null>(null);
  // ONE panel open at a time across the whole row (lib/disclosure). Four independent
  // <details> that never shut each other is the state Erica was looking at.
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  useEffect(() => {
    fetchMyPeople()
      .then((c) => {
        setContacts(c);
        setScope(myStats(c));
      })
      .catch(() => setContacts([]));
  }, []);
  useEffect(() => {
    if (!scope) return;
    let live = true;
    setScopePlaceIds(null);
    fetchPlaceIdsForPeople(scope.people, scope.mode)
      .then((r) => live && setScopePlaceIds(r))
      .catch(() => live && setScopePlaceIds(new Set()));
    return () => {
      live = false;
    };
  }, [scope]);
  const toggle = (key: string) => setOpenPanel((cur) => nextOpenPanel(cur, key));
  const panel = (key: string) => ({
    panelKey: key,
    open: panelIsOpen(openPanel, key),
    onToggle: toggle,
  });
  if (!scope) return null;
  return (
    <>
      <PeopleFilter people={contacts} value={scope} onChange={setScope} inline />
      <div className="stats-row">
        <StatsCard scope={scope} contacts={contacts} {...panel('stats')} />
        <PlacesByStateCard scope={scope} scopePlaceIds={scopePlaceIds} {...panel('places')} />
        <NationalParksCard scopePlaceIds={scopePlaceIds} {...panel('parks')} />
        <PeaksCard scope={scope} {...panel('peaks')} />
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

/** Upload Garmin (or any) GPX/TCX activity files — the Strava-limit workaround.
 *  Parses each client-side and imports it, attributed to whoever's signed in. */
function GarminImportCard() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onFiles(files: FileList) {
    setBusy(true);
    let added = 0;
    let already = 0;
    const problems: string[] = [];
    const chosen = Array.from(files);
    const total = chosen.length;
    // ONE RUN for the whole selection: a run is a person's action, not a file. Every item
    // below lands under it, so "what did that import do?" has an answer afterwards.
    const run = await beginImportRun('file-upload');
    for (const file of chosen) {
      // EVERY FILE IS HASHED AND KEPT, whatever happens to it next (0227). Until now an
      // import recorded that an activity came from "a file" — not which file, not its
      // bytes, and nothing at all about the ones that failed. A batch of 184 with 3
      // unreadable ones left 181 successes and no trace of the rest.
      let artifact: Awaited<ReturnType<typeof recordArtifact>> | null = null;
      try {
        artifact = await recordArtifact(file);
      } catch {
        // Provenance is worth having; it is not worth blocking an import for.
        artifact = null;
      }
      try {
        // Name the format problem as a format problem. A .zip read as text parses to null
        // and used to be reported as "no GPS track found", which sends a person looking at
        // their watch instead of at the zip they need to unpack.
        if (!/\.(fit|gpx|tcx)$/i.test(file.name)) {
          const why =
            'not a GPX, TCX or FIT file' +
            (/\.zip$/i.test(file.name) ? ' — unzip Garmin’s export and pick the files inside' : '');
          problems.push(`${file.name}: ${why}`);
          await recordImportFailure(run, why, artifact?.id, file.name).catch(() => {});
          continue;
        }
        const parsed = /\.fit$/i.test(file.name)
          ? await parseFitActivity(await file.arrayBuffer(), file.name)
          : parseActivityFile(await file.text(), file.name);
        if (!parsed) {
          problems.push(`${file.name}: no GPS track in the file`);
          await recordImportFailure(run, 'no GPS track in the file', artifact?.id, file.name).catch(
            () => {},
          );
          continue;
        }
        const out = await importActivityFile(run, parsed, artifact?.id);
        // The old RPC returned an id whether it stored anything or not, so a duplicate and
        // a new activity were indistinguishable and both counted as "Imported".
        if (out.disposition === 'duplicate') already++;
        else added++;
      } catch (e) {
        // Surface the real reason instead of a silent "couldn't be read" — and write it
        // into the ledger, because a failure is a fact about this import too.
        const why = e instanceof Error ? e.message : 'upload failed';
        problems.push(`${file.name}: ${why}`);
        await recordImportFailure(run, why, artifact?.id, file.name).catch(() => {});
      }
      setMsg(
        `Imported ${added}` +
          (already ? `, ${already} already had` : '') +
          (problems.length ? `, ${problems.length} failed` : '') +
          '…',
      );
    }
    await finishImportRun(run);
    // SAY WHAT HAPPENED TO EVERY FILE. The previous wording dropped `already` entirely and
    // ended with "Re-importing the same file is safe (duplicates are ignored)" no matter
    // what — so on 2026-08-17 Erica uploaded Garmin files she had never uploaded before,
    // got "Done — 0 activities imported. Re-importing the same file is safe (duplicates
    // are ignored)", and reasonably read it as "we think you already had these". The ledger
    // showed zero items: nothing had reached the database at all. A summary that cannot
    // distinguish "you already had it" from "I could not read it" from "I did nothing"
    // sends the person looking in the wrong place, and it sent me looking too.
    const parts: string[] = [];
    if (added) parts.push(`${added} imported`);
    if (already) parts.push(`${already} you already had`);
    if (problems.length) parts.push(`${problems.length} couldn't be read`);
    setMsg(
      (parts.length
        ? `Done — ${parts.join(', ')}, out of ${total} file${total === 1 ? '' : 's'}.`
        : `Nothing was imported from ${total} file${total === 1 ? '' : 's'} — the import ran but found no activities to add.`) +
        (problems.length ? ` ${problems.join('; ')}.` : '') +
        (added ? ' Importing the same file again is safe.' : ''),
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

  const [stravaProblem, setStravaProblem] = useState<string | null>(null);

  useEffect(() => {
    isMyStravaConnected().then(setConnected);
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('strava');
    if (outcome === 'connected') setConnected(true);
    // EVERY OTHER OUTCOME WAS SILENT UNTIL NOW, and that is how Josh came to believe he
    // had connected Strava when nothing had landed. `strava-auth` has always redirected
    // here with ?strava=invalid_state / denied / missing_code / error — and this screen
    // only ever read 'connected', so a failed link looked exactly like a successful one.
    else if (outcome) {
      setStravaProblem(
        outcome === 'invalid_state'
          ? 'That link expired before Strava sent you back. Start it again and finish within 30 minutes — signing in to Strava first makes it quicker.'
          : outcome === 'denied'
            ? 'Strava did not get permission, so nothing was connected.'
            : outcome === 'missing_code' || outcome === 'missing_state'
              ? 'Strava sent us back without everything we needed. Please try connecting again.'
              : 'Strava could not be connected. Nothing was changed.',
      );
    }
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
      {/* A failed link used to look exactly like a successful one — this is the whole
          reason Josh believed his Strava was connected for a week. */}
      {stravaProblem && (
        <div className="banner" style={{ marginTop: 6, fontSize: 13 }} role="status">
          {stravaProblem}
        </div>
      )}
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

/**
 * IMPORT HISTORY — the ledger every import already writes to, finally readable.
 *
 * The approved contract (2026-08-20) puts "connection state and import history"
 * under Integrations. `ingest_runs` has recorded every run since 0148 and members
 * have been able to SELECT it since 0202; nothing in the app ever showed one, so
 * "what did that import actually do?" had no answer outside SQL.
 */
function ImportHistoryCard() {
  const [runs, setRuns] = useState<ImportRun[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    fetchImportRuns()
      .then(setRuns)
      .catch((e) =>
        setProblem(
          whyItFailed('Couldn’t read the import history', e, { online: navigator.onLine }),
        ),
      );
  }, []);
  const when = (iso: string): string =>
    new Date(iso).toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <b>Import history</b>
      <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 10px' }}>
        Every import writes to a ledger — what came in, what was already there, and what could not
        be read. This is that ledger.
      </div>
      {problem ? (
        <div className="banner">{problem}</div>
      ) : runs === null ? (
        <p className="label">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="label">No imports recorded yet.</p>
      ) : (
        <div className="visit-list">
          {runs.map((r) => (
            <div key={r.id} className="visit-row">
              <span className="visit-main">
                {r.source}
                {r.method ? ` · ${r.method}` : ''}
              </span>
              <span className="label">
                {when(r.started_at)} · {r.ok} in{r.failed > 0 ? `, ${r.failed} failed` : ''}
                {r.finished_at ? '' : ' · still running'}
                {r.status && r.status !== 'ok' ? ` · ${r.status}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * MESSAGING AND EVENT PRIVACY — named by the contract, backed by nothing yet.
 *
 * The approved section list includes it, and there are no events and no messages in
 * this app: no tables, no routes, no screens. Rendering plausible-looking switches
 * would be inventing controls that do nothing, which is the exact class of defect
 * the rest of this change exists to remove. So the section is here, under its
 * approved name, saying what is true.
 */
function MessagingPrivacyCard() {
  return (
    <div className="card">
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
        Nothing to set yet — there are no events and no messages in the app, so there is no privacy
        to choose for them. This section is here because the approved plan puts these settings here;
        the controls arrive with the features, not before them.
      </p>
    </div>
  );
}

/** What is waiting in the repair queue, counted here so the section says something
 *  true rather than being a label over a link. Same counts as the queue itself. */
function NeedsAttentionCard() {
  const [a, setA] = useState<Attention | null>(null);
  useEffect(() => {
    fetchAttention()
      .then(setA)
      .catch(() => setA(null));
  }, []);
  const total = a
    ? a.reviewCards +
      a.tagsToConfirm +
      a.photoTagsToConfirm +
      a.unassignedPhotos +
      a.photosNoDate +
      a.unnamedPlaces +
      a.missingCategories +
      a.missingDates +
      a.activitiesNoPlace +
      a.duplicatePlaces
    : null;
  return (
    <div className="card">
      <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 14 }}>
        The only repair queue: names to confirm, photos to sort, tags to answer and places that may
        be the same place. Every row opens the exact records it counted.
      </p>
      <p className="label" style={{ margin: '0 0 10px' }}>
        {total === null
          ? 'Checking…'
          : total === 0
            ? 'All clear — nothing is waiting.'
            : `${total} thing${total === 1 ? '' : 's'} waiting.`}
      </p>
      <Link to="/settings/data/attention" className="as-button primary">
        Needs attention
      </Link>
    </div>
  );
}

/** Data Management — the tools for tidying everything up, on their own destination
 *  (`/settings/data/manage`) as the approved route table names it. */
function DataManagementCard() {
  return (
    <div className="card">
      <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 14 }}>
        Tools for tidying everything up — edit every place in one table, sort photos, merge
        duplicates, and check the health of your data.
      </p>
      <div className="settings-tools">
        {/* "Review inbox" USED TO BE A SECOND BUTTON HERE, pointing at /inbox
            (which redirects to the repair queue). Erica, 2026-08-18: "Needs Attention
            and Review Inbox are redundant. Put anything unique in Review Inbox into
            needs attentions." Two screens listing what is waiting is one too many, and
            the cards are now the first rows of Needs attention. */}
        <Link to="/places/edit" className="as-button primary">
          Edit all places
        </Link>
        {/* Importing and sorting photos lives HERE — Erica: "Move Import and Sort
            Photos into Settings." The sorter is both: it pulls from the device and
            Google Photos, then sorts what arrives. */}
        <Link to="/photos/sort" className="as-button">
          Import &amp; sort photos
        </Link>
        <Link to="/albums" className="as-button">
          Smart albums
        </Link>
        <Link to="/insights?tab=timeline" className="as-button">
          Timeline
        </Link>
        <Link to="/duplicates" className="as-button">
          Duplicate places
        </Link>
        <Link to="/health" className="as-button">
          Data health
        </Link>
      </div>
    </div>
  );
}

/**
 * SETTINGS HAS EXACTLY THREE DESTINATIONS.
 *
 *   Account | Integrations | Data & Privacy
 *
 * Approved 2026-08-20 and RULED DEFINITIVE by Erica on 2026-08-30, which settled a
 * contradiction that had been sitting in docs/STATE.md unresolved:
 *
 *   - 2026-08-11: "One continuous page … No section labels — not 'Account', not
 *     'People'." (This is the instruction the previous version of this file obeyed.)
 *   - 2026-08-20: Settings has exactly three destinations.
 *
 * Her ruling: use the 08-20 plan. The 08-11 "no section labels" instruction is
 * retired and must not be cited again. So the labels are back, and they are
 * destinations rather than the five-tab bar that 08-11 removed — every card that was
 * on the one long page is still here, under the destination whose written definition
 * covers it, and nothing was dropped.
 *
 * `Data & Privacy` is deliberately still ONE CONTINUOUS PAGE, not pills or sub-tabs:
 * the contract says so in as many words. Its deeper screens (`/settings/data/attention`,
 * `/manage`, `/export`, `/trash`) are the work, not a second level of navigation.
 */
export type SettingsDestination = 'account' | 'integrations' | 'data' | 'data-manage';

const DESTINATIONS: { to: string; label: string }[] = [
  { to: '/settings/account', label: 'Account' },
  { to: '/settings/integrations', label: 'Integrations' },
  { to: '/settings/data', label: 'Data & Privacy' },
];

/** Back-bar, title and the three destinations — the frame every one of them sits in. */
function SettingsShell({ children }: { children: ReactNode }) {
  return (
    <div className="settings-page">
      <Link className="back-bar" to="/">
        <span>Map</span>
      </Link>
      <h1>Settings</h1>
      {/* NOT `.settings-tabs`. That class was the five-tab bar Erica had removed on
          2026-08-11, and it stays gone — these are the three approved DESTINATIONS,
          which is a different thing with a different contract. */}
      <nav className="settings-dests" aria-label="Settings">
        {DESTINATIONS.map((d) => (
          <NavLink
            key={d.to}
            to={d.to}
            // Data & Privacy stays lit on its own deeper screens.
            end={d.to !== '/settings/data'}
            className={({ isActive }) => (isActive ? 'on' : '')}
          >
            {d.label}
          </NavLink>
        ))}
      </nav>
      {children}
    </div>
  );
}

/** Identity, preferences, and Map Appearance. */
function AccountDestination() {
  const { profile, signOut } = useAuth();
  return (
    <>
      <p style={{ color: 'var(--muted)' }}>
        Signed in as <b>{profile?.display_name ?? 'you'}</b> · role <b>{profile?.role}</b>
      </p>
      <button onClick={() => void signOut()}>Sign out</button>

      {/* PEOPLE — the door to searching for somebody, and to what people are waiting on
          you to answer. It sits under Account rather than in the primary nav because the
          approved navigation has exactly four destinations and this is not one of them;
          a connection is about you, beside the other things that are. */}
      <h2 style={{ marginTop: 28 }}>People</h2>
      <div className="card">
        <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 13 }}>
          Find somebody by handle or name, add them, or follow them. An add is mutual — they decide
          too. A follow is one-way and shows you only what they made public.
        </p>
        <Link to="/people" className="as-button primary">
          Find people
        </Link>
      </div>

      {/* BEING FINDABLE IS THE OTHER HALF OF People, so it sits directly under it: that
          card is how you find somebody, this is how somebody finds you. Built 2026-08-30
          — until then nothing in the app could set a handle or make a profile public, so
          `/people` searched a directory that could not contain anyone. */}
      <h2 style={{ marginTop: 28 }}>Your public profile</h2>
      <PublicProfileCard />

      {/* THE DOOR. Joining takes a code from somebody already here (0288), so every
          member needs somewhere to make one. It is a deeper screen, not a fourth
          destination — same shape as Data & Privacy ▸ Trash. */}
      <h2 style={{ marginTop: 28 }}>Inviting people</h2>
      <div className="card">
        <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 14 }}>
          Nobody can join without a code from you. Each code lets in one person, once.
        </p>
        <Link to="/settings/account/invites" className="as-button">
          Invite codes
        </Link>
      </div>

      <h2 style={{ marginTop: 28 }}>Map appearance</h2>
      <MapAppearanceSection />
      {profile?.role === 'owner' && <ProjectionCard />}

      <h2 style={{ marginTop: 28 }}>Tags</h2>
      <TagsCard />

      {/* STATS LIVES UNDER ACCOUNT, and this is the one placement the approved
          section list does not name — reported rather than quietly filed.
          Erica moved Stats onto Settings herself ("No stats bar on Places",
          2026-08-15) and asked twice for Trips to sit inside it. It is not an
          integration and it is not a privacy control, so of the three destinations
          Account is the honest one: a personal summary, beside the other things
          that are about you. */}
      <h2 style={{ marginTop: 28 }}>Stats</h2>
      <StatsSection />
    </>
  );
}

/** Connected sources, connection state and import history. */
function IntegrationsDestination() {
  const { profile } = useAuth();
  return (
    <>
      <h2 style={{ marginTop: 28 }}>Strava &amp; Garmin</h2>
      {profile ? (
        <>
          <StravaCard isOwner={profile.role === 'owner'} />
          <GarminImportCard />
        </>
      ) : null}

      <h2 style={{ marginTop: 28 }}>Google Timeline</h2>
      <div className="card">
        <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 13 }}>
          Bring a Google Timeline export in as location history. It feeds the map fog and the places
          that get created from where you have actually been.
        </p>
        {/* MOVED HERE FROM "Places & location". It is a source you connect, which is
            this destination's whole definition — the clustering and naming JOBS that
            run over the result stayed under Data & Privacy ▸ Location. */}
        <Link to="/settings/import" className="as-button">
          Import Google Timeline…
        </Link>
      </div>

      <h2 style={{ marginTop: 28 }}>Import history</h2>
      <ImportHistoryCard />
    </>
  );
}

/**
 * ONE DESTINATION AND ONE CONTINUOUS PAGE — not pills, not sub-tabs.
 *
 * Sections in the order the contract sets them out: Location, Sharing, People and
 * tag approvals, Messaging and event privacy, Needs attention, Your data.
 */
function DataPrivacyDestination() {
  const { profile } = useAuth();
  // WHO YOU ARE SHARING WITH IS WHO IS IN YOUR SPACE — not who is on your map.
  // These were the same list until the fork (0292) and are not any more: Josh still
  // appears on Erica's map through the cards they are both tagged on, while no longer
  // being a member of her space. Reading fetchMapPeople() here printed
  // "Sharing — Erica & Josh" the day his membership ended.
  const [members, setMembers] = useState<{ display_name: string | null }[]>([]);
  useEffect(() => {
    fetchSpaceMembers()
      .then(setMembers)
      .catch(() => undefined);
  }, []);
  const memberNames = members
    .map((m) => m.display_name)
    .filter(Boolean)
    .join(' & ');
  const canManage = profile?.role === 'owner' || profile?.role === 'editor';

  return (
    <>
      <h2 style={{ marginTop: 28 }}>Location</h2>
      {profile && <TrackingCard myId={profile.id} />}
      {profile?.role === 'owner' && <GeocodeCard />}

      <h2 style={{ marginTop: 28 }}>Sharing{memberNames ? ` — ${memberNames}` : ''}</h2>
      <SharedHub />

      {/* TAG APPROVALS COME FIRST AND ARE NOT OWNER-GATED. Anybody can be tagged, so
          anybody must be able to answer — §8b-i keeps account access and memory
          participation apart, and this is that line. Until 2026-08-30 the only surface
          for this was `routes/Inbox.tsx`, which nothing imports and whose `/inbox` route
          redirects away, so the heading below said "tag approvals" over a card that
          answered join requests instead. */}
      <h2 style={{ marginTop: 28 }}>Tag approvals</h2>
      <TagApprovalsCard />

      {profile?.role === 'owner' && (
        <>
          {/* TWO DIFFERENT LISTS, and the order says which is which. Membership is who
              can SIGN IN; below it are the people you can TAG, who need no account —
              §8b-i keeps account access and memory participation apart on purpose.

              THE JOIN-REQUEST CARD IS GONE (0298). It offered "Approve · Contributor",
              which called `approve_join_request` and, after 0298, gave that person their
              OWN space rather than membership of this one — the control did not do what
              it said. Erica, 2026-08-31: "Retire it — tagging is the link. Nobody ever
              joins someone else's space." Nothing could make a request either: there was
              no request-to-join screen anywhere, so the page offered to approve something
              nobody could ask for, into a space nobody could join. */}
          <h2 style={{ marginTop: 28 }}>People and membership</h2>
          <PeopleCard meId={profile.id} />
          <h3 style={{ margin: '20px 0 8px' }}>Your people</h3>
          <YourPeopleCard />
        </>
      )}

      <h2 style={{ marginTop: 28 }}>Messaging and event privacy</h2>
      <MessagingPrivacyCard />

      <h2 style={{ marginTop: 28 }}>Needs attention</h2>
      <NeedsAttentionCard />

      <h2 style={{ marginTop: 28 }}>Your data</h2>
      <div className="card">
        <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 14 }}>
          Everything you can tidy, take with you, or put back.
        </p>
        <div className="settings-tools">
          {canManage && (
            <Link to="/settings/data/manage" className="as-button primary">
              Data Management
            </Link>
          )}
          {/* A POINTER TO /export, NOT A SECOND EXPORT. This card WAS the export: three
              buttons, "Download all 162 places", and nothing about the outings, visits,
              photos or the journal. Both screens point at one now (§3e Step 7). */}
          <Link to="/settings/data/export" className="as-button">
            Export &amp; backup
          </Link>
          <Link to="/settings/data/trash" className="as-button">
            Trash
          </Link>
        </div>
      </div>
    </>
  );
}

/** Which destination the URL is asking for. Read from the path rather than passed
 *  as a prop: the routes are lazily loaded through `lazyWithReload`, whose signature
 *  takes no props, and the path IS the destination. */
function destFromPath(pathname: string): SettingsDestination {
  if (pathname.startsWith('/settings/integrations')) return 'integrations';
  if (pathname.startsWith('/settings/data/manage')) return 'data-manage';
  if (pathname.startsWith('/settings/data')) return 'data';
  return 'account';
}

export default function Settings() {
  const dest = destFromPath(useLocation().pathname);
  if (dest === 'data-manage') {
    return (
      <SettingsShell>
        <h2 style={{ marginTop: 28 }}>Data Management</h2>
        <DataManagementCard />
      </SettingsShell>
    );
  }
  return (
    <SettingsShell>
      {dest === 'account' && <AccountDestination />}
      {dest === 'integrations' && <IntegrationsDestination />}
      {dest === 'data' && <DataPrivacyDestination />}
    </SettingsShell>
  );
}
