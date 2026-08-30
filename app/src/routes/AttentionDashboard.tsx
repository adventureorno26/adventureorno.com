import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAttention, fetchPlacelessActivities, type Attention } from '../lib/data';
import type { Activity } from '../lib/types';
import Inbox from './Inbox';

interface Row {
  key: keyof Attention;
  label: string;
  hint: string;
  /** A route, or a `#fragment` on this page. */
  to: string;
  action: string;
}

/**
 * EVERY TILE GOES SOMEWHERE THAT SHOWS THE ROWS IT COUNTED.
 *
 * Measured live on 2026-08-30: four of the six tiles were the SAME link. "Name
 * them", "Tag them", "Add dates" and "Review" all pointed at `/places/edit` with no
 * filter, so pressing "Name them" for 10 unnamed places opened a 168-row table with
 * nothing named, sorted or highlighted — and the button appeared to do nothing.
 * "Open map" was worse: the whole map, and none of the outings it had just counted.
 *
 * Each destination now narrows to the exact set. `/places/edit?needs=…` shares its
 * predicates with `fetchAttention` (lib/data), so the number on the tile and the
 * rows at the other end cannot disagree.
 *
 * The `#` destinations are PLAIN ANCHORS, not react-router links, and that is the
 * fix for the fifth one: a `<Link to="#cards">` pushes a location and never
 * scrolls, so "Review them" also did nothing visible on a long page.
 */
const ROWS: Row[] = [
  // THE REVIEW INBOX, FOLDED IN. Erica, 2026-08-18: "Needs Attention and Review Inbox are
  // redundant. Put anything unique in Review Inbox into needs attentions." The cards were
  // also the half she could not find — /inbox redirects here, so nothing on this screen
  // ever pointed at them. They go first because they are the only rows where a person is
  // being ASKED something rather than told a count.
  {
    key: 'reviewCards',
    label: 'Cards waiting for you to decide',
    hint: 'Names to confirm, photos to pin, and outings that may be the same one twice',
    // Down the page, not away to another screen: the cards are rendered below (2026-08-20).
    to: '#cards',
    action: 'Review them',
  },
  {
    key: 'tagsToConfirm',
    label: 'Outings someone says you were on',
    hint: 'Yours to accept or decline — nothing counts as yours until you say so',
    to: '#cards',
    action: 'Answer them',
  },
  {
    key: 'photoTagsToConfirm',
    label: 'Photos someone says you’re in',
    hint: 'Yours to confirm — saying yes records that it’s you, and adds nothing to your outings',
    to: '#cards',
    action: 'Answer them',
  },
  {
    key: 'unassignedPhotos',
    label: 'Photos waiting to be sorted',
    hint: 'Uploaded but not yet placed on the map',
    to: '/photos/sort',
    action: 'Sort them',
  },
  {
    key: 'unnamedPlaces',
    label: 'Unnamed places',
    hint: 'Places still called "New place" or left blank — opens just those rows',
    to: '/places/edit?needs=unnamed',
    action: 'Name them',
  },
  {
    key: 'missingCategories',
    label: 'Places with no tags',
    hint: 'Add a type so they show the right marker + reviews — opens just those rows',
    to: '/places/edit?needs=untagged',
    action: 'Tag them',
  },
  {
    key: 'missingDates',
    label: 'Places with no visit date',
    hint: 'No photos, activities, or dates recorded yet — opens just those rows',
    to: '/places/edit?needs=undated',
    action: 'Add dates',
  },
  {
    key: 'photosNoDate',
    label: 'Photos with no date',
    hint: 'Missing capture time. Opens the places holding them, where Photos ▸ Set date fixes a batch at once',
    to: '/places/edit?needs=photo-dates',
    action: 'Set their dates',
  },
  {
    key: 'activitiesNoPlace',
    label: 'Activities not attached to a place',
    hint: 'Runs/hikes/rides floating without a place — listed below with the day each happened',
    to: '#activities',
    action: 'See them',
  },
  // DUPLICATE PLACES, which the repair queue never mentioned. The screen existed at
  // /duplicates and was reachable only from Settings, so the only way to find out whether
  // anything needed merging was to go and look — on a screen listing everything that needs
  // a decision, that is the one kind of work you had to already know about. Counted with
  // the same function /duplicates lists with, so the number and the rows cannot disagree.
  {
    key: 'duplicatePlaces',
    label: 'Places that may be the same place',
    hint: 'Almost on top of each other, or sharing a name — merge them or keep them separate',
    to: '/duplicates',
    action: 'Compare them',
  },
  // "Trips awaiting confirmation" is gone: auto-detected trip drafts were retired
  // with the trips table (0137). Nothing suggests a trip any more — a trip is a
  // visit a person marked. `Attention.suggestedTrips` was still being computed and
  // returned with no row here to read it; removed from lib/data with this change.
];

function day(iso: string | null): string {
  if (!iso) return 'Undated';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'Undated'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function miles(m: number | null): string {
  return m && m > 0 ? `${(m / 1609.344).toFixed(1)} mi` : '';
}

/** Everything that needs a human touch, in ONE place.
 *
 *  Erica, 2026-08-18: *"Needs Attention and Review Inbox are redundant."* They were, and
 *  worse: this screen listed counts while the actual cards were embedded in the "/add"
 *  page — the one named after creating things. /inbox redirected there too, which is why she asked
 *  where the cards had gone.
 *
 *  The split is by verb now — /add creates, this repairs, /health diagnoses and changes
 *  nothing — so the counts and the work they describe finally sit on the same screen.
 *
 *  It lives at `/settings/data/attention` (the approved contract, 2026-08-20): Needs
 *  Attention is a section of Data & Privacy, not a destination of its own. `/attention`
 *  still works and redirects here. */
export default function AttentionDashboard() {
  const [a, setA] = useState<Attention | null>(null);
  const [placeless, setPlaceless] = useState<Activity[] | null>(null);
  useEffect(() => {
    fetchAttention()
      .then(setA)
      .catch(() => setA(null));
  }, []);
  // Only fetched when there is something to fetch — the count decides.
  useEffect(() => {
    if (!a || a.activitiesNoPlace === 0) return;
    fetchPlacelessActivities()
      .then(setPlaceless)
      .catch(() => setPlaceless([]));
  }, [a]);

  const rows = a ? ROWS.filter((r) => a[r.key] > 0) : [];
  const allClear = a && rows.length === 0;

  return (
    <div className="page attention-page">
      <Link className="back-bar" to="/settings/data">
        <span>Data &amp; Privacy</span>
      </Link>
      <h1>Needs attention</h1>
      {!a ? (
        <p className="label">Checking…</p>
      ) : allClear ? (
        <p className="label">All clear — nothing needs attention right now. 🎉</p>
      ) : (
        <div className="attn-list">
          {rows.map((r) => (
            <div key={r.key} className="attn-row">
              <span className="attn-count">{a[r.key]}</span>
              <div className="attn-main">
                <b>{r.label}</b>
                <span className="label">{r.hint}</span>
              </div>
              {/* A FRAGMENT IS A PLAIN ANCHOR. `<Link to="#cards">` pushes a location
                  and leaves the page exactly where it was, which on a screen this long
                  is indistinguishable from a dead button. */}
              {r.to.startsWith('#') ? (
                <a href={r.to} className="as-button">
                  {r.action}
                </a>
              ) : (
                <Link to={r.to} className="as-button">
                  {r.action}
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      {/* THE OUTINGS THE TILE COUNTED, not the whole map.
          There is no place-picker for these yet — `activities.place_id` has no client
          write path, only the suggestion queue below proposes one — so this shows the
          rows and says plainly where the fix comes from, rather than sending you
          somewhere that cannot do it. */}
      {(a?.activitiesNoPlace ?? 0) > 0 && (
        <section id="activities" className="attn-section">
          <h2>Activities not attached to a place</h2>
          <p className="label">
            {a!.activitiesNoPlace} of them. A place gets attached when you answer its card below —
            the suggester proposes one from the route, and nothing is written until you say so.
          </p>
          {placeless === null ? (
            <p className="label">Loading…</p>
          ) : placeless.length === 0 ? (
            <p className="label">Nothing to list — they may have been attached already.</p>
          ) : (
            <div className="visit-list">
              {placeless.map((act) => (
                <div key={act.id} className="visit-row">
                  <span className="visit-main">{act.name ?? act.type}</span>
                  <span className="label">
                    {[day(act.local_date ?? act.start_date), act.type, miles(act.distance)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* THE CARDS THEMSELVES, not a link to them. A dashboard that only counts things is
          another place to visit before any work can start. */}
      <div id="cards" className="attn-cards">
        <Inbox embedded />
      </div>
    </div>
  );
}
