// /inbox — one card, one button, and the decision is permanent.
//
// This is also the "recent activities" page Erica asked for; they are the same
// screen. What happened recently, and what the machine would like to call it.
//
// Rules this screen keeps, all of them hers:
//   - NO ICONS. Text controls only.
//   - The evidence is on the face of the card ("underfoot at 7 of 9 route points").
//     A suggestion you cannot check is just another guess.
//   - One button finishes a card, and everything commits together.
//   - Skip is free: it writes nothing and the card comes back.
//   - Undo is offered immediately, and every decision stays reversible later.
import { useCallback, useEffect, useState } from 'react';
import {
  approveCard,
  evidenceLine,
  fetchInbox,
  miles,
  rejectSuggestion,
  undoApproval,
  ruleOffer,
  learnRule,
  type Choice,
  type RuleOffer,
  type PhotoCandidate,
  type InboxCard,
  type SuggestionOption,
} from '../lib/inbox';
import { showSnack } from '../lib/snackbar';
import AuthedImg from '../components/AuthedImg';
import { useAuth } from '../auth/AuthProvider';

const CUSTOM = '__custom__';

function dayLabel(iso: string | null): string {
  if (!iso) return '';
  // A DATE-ONLY string ("2026-07-14") parses as UTC midnight, which renders as the
  // PREVIOUS day anywhere west of Greenwich — a visit on the 14th showed as the 13th.
  // Visits carry dates; activities carry timestamps, which are correct as-is. This is
  // the same class of bug migrations 0143/0144 fixed on the server side.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const when = ymd ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])) : new Date(iso);
  return when.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** The line under the title: when, what, how far. */
function subtitle(card: InboxCard): string {
  if (card.visit) {
    const n = card.photos?.length ?? 0;
    return [dayLabel(card.visit.start_date), `${n} photo${n === 1 ? '' : 's'} from that day`]
      .filter(Boolean)
      .join(' · ');
  }
  const a = card.activity;
  if (!a) return '';
  return [dayLabel(a.start_date), a.type, miles(a.distance)].filter(Boolean).join(' · ');
}

/** Why this photo is on this card, in words. */
function photoWhy(ph: PhotoCandidate): string {
  if (ph.distance_m == null) return 'Taken that day';
  if (ph.distance_m < 100) return 'Taken that day, right there';
  if (ph.distance_m < 1000) return `Taken that day, ${ph.distance_m} m away`;
  return `Taken that day, ${(ph.distance_m / 1000).toFixed(1)} km away`;
}

export default function Inbox() {
  const { profile } = useAuth();
  const canDecide = profile?.role === 'owner' || profile?.role === 'editor';

  const [cards, setCards] = useState<InboxCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-card, per-field: which option id is picked (or CUSTOM), and the typed words.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  // "You've called routes here X three times — always call them that?"
  const [offer, setOffer] = useState<(RuleOffer & { activityId: string }) | null>(null);
  // Ticked photo candidates, by suggestion id. Photos default to ON: the card only
  // exists because they were taken that day in that place, and un-ticking the odd
  // wrong one is less work than ticking eight right ones.
  const [pickedPhotos, setPickedPhotos] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await fetchInbox();
      setCards(rows);
      // Pre-select rank 0 per field — the recommendation, not a decision.
      const initial: Record<string, string> = {};
      for (const c of rows) {
        for (const f of c.fields) {
          const key = `${c.group_key}:${f.field}`;
          if (!(key in initial)) initial[key] = f.id;
        }
      }
      setPicked((p) => ({ ...initial, ...p }));
      const photos: Record<string, boolean> = {};
      for (const c of rows) for (const ph of c.photos ?? []) photos[ph.id] = true;
      setPickedPhotos((p) => ({ ...photos, ...p }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the inbox');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = (cards ?? []).filter((c) => !skipped.has(c.group_key));

  async function onApprove(card: InboxCard) {
    const fields = [...new Set(card.fields.map((f) => f.field))];
    const choices: Record<string, Choice | string[]> = {};

    const ticked = (card.photos ?? []).filter((ph) => pickedPhotos[ph.id]).map((ph) => ph.id);
    if (ticked.length) choices.photos = ticked;
    else if ((card.photos ?? []).length && !card.fields.length) {
      showSnack({ message: 'Tick at least one photo, or skip the card.' });
      return;
    }
    for (const field of fields) {
      const key = `${card.group_key}:${field}`;
      const sel = picked[key];
      if (!sel) continue;
      if (sel === CUSTOM) {
        const words = (typed[key] ?? '').trim();
        if (!words) {
          showSnack({ message: 'Type a name, or pick one of the suggestions.' });
          return;
        }
        choices[field] = { value: words };
      } else {
        choices[field] = { suggestion_id: sel };
      }
    }
    if (!Object.keys(choices).length) return;

    setBusy(card.group_key);
    try {
      const token = await approveCard(card.group_key, choices);
      setCards((cs) => (cs ?? []).filter((c) => c.group_key !== card.group_key));
      // Has she now said the same thing about this area three times? If so, offer to
      // stop asking. Never block the approval on it — this is a nicety.
      if (card.subject_type === 'activity') {
        void ruleOffer(card.subject_id)
          .then((o) => {
            if (o.offer && o.name) setOffer({ ...o, activityId: card.subject_id });
          })
          .catch(() => {});
      }
      showSnack({
        message: 'Saved. It will not be changed again.',
        actionLabel: 'Undo',
        onAction: async () => {
          try {
            await undoApproval(token);
            showSnack({ message: 'Put back.' });
            await load();
          } catch {
            showSnack({ message: 'Could not undo that.' });
          }
        },
      });
    } catch (e) {
      // A stale card fails whole rather than half-applying — reload and let her retry.
      showSnack({ message: e instanceof Error ? e.message : 'Could not save that.' });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function onReject(option: SuggestionOption) {
    try {
      await rejectSuggestion(option.id);
      showSnack({ message: `Won't suggest "${option.proposed}" again.` });
      await load();
    } catch {
      showSnack({ message: 'Could not do that.' });
    }
  }

  return (
    <div className="page inbox-page">
      <div className="page-head">
        <h1>Inbox</h1>
        <p className="muted">
          Suggestions from the map data. Nothing here has changed anything yet — a name is only
          written when you say so, and once you do, nothing overwrites it.
        </p>
      </div>

      {offer?.offer && offer.name && (
        <div className="inbox-rule-offer">
          <p>
            You’ve called routes around here <strong>{offer.name}</strong> {offer.learned_from}{' '}
            times. Always call them that?
          </p>
          <div className="ic-actions">
            <button
              className="btn btn-primary"
              onClick={async () => {
                try {
                  await learnRule(offer.activityId, offer.name);
                  setOffer(null);
                  showSnack({ message: `Routes around there will be called ${offer.name}.` });
                  await load();
                } catch {
                  showSnack({ message: 'Could not save that rule.' });
                }
              }}
            >
              Always call them that
            </button>
            <button className="btn" onClick={() => setOffer(null)}>
              Keep asking
            </button>
          </div>
          <p className="muted">
            It still records every automatic name, and you can undo any of them.
          </p>
        </div>
      )}

      {error && (
        <div className="inbox-state">
          <p>{error}</p>
          <button className="btn" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {!error && cards === null && <div className="inbox-state">Loading…</div>}

      {!error && cards !== null && visible.length === 0 && (
        <div className="inbox-state">
          <p>Nothing to review.</p>
          <p className="muted">
            When an activity is recorded somewhere the map data recognises, it will show up here to
            be named.
          </p>
        </div>
      )}

      {visible.map((card) => {
        const fields = [...new Set(card.fields.map((f) => f.field))];
        return (
          <article className="inbox-card" key={card.group_key}>
            <header className="ic-head">
              <h2>
                {card.visit
                  ? (card.visit.place ?? 'That visit')
                  : (card.activity?.name ?? 'Something to name')}
              </h2>
              <p className="muted">{subtitle(card)}</p>
            </header>

            {fields.map((field) => {
              const options = card.fields
                .filter((f) => f.field === field)
                .sort((a, b) => a.rank - b.rank);
              const key = `${card.group_key}:${field}`;
              return (
                <section className="ic-field" key={field}>
                  <h3>{field === 'name' ? 'Call it' : field}</h3>
                  {options.map((o) => (
                    <label className="ic-option" key={o.id}>
                      <input
                        type="radio"
                        name={key}
                        checked={picked[key] === o.id}
                        onChange={() => setPicked((p) => ({ ...p, [key]: o.id }))}
                      />
                      <span className="ic-option-body">
                        <span className="ic-option-name">{o.proposed}</span>
                        <span className="ic-option-why">{evidenceLine(o)}</span>
                      </span>
                      {canDecide && (
                        <button
                          type="button"
                          className="ic-never"
                          onClick={() => void onReject(o)}
                          aria-label={`Never suggest ${o.proposed} again`}
                        >
                          Never
                        </button>
                      )}
                    </label>
                  ))}

                  <label className="ic-option">
                    <input
                      type="radio"
                      name={key}
                      checked={picked[key] === CUSTOM}
                      onChange={() => setPicked((p) => ({ ...p, [key]: CUSTOM }))}
                    />
                    <span className="ic-option-body">
                      <span className="ic-option-name">Your own words</span>
                      <input
                        type="text"
                        className="ic-custom"
                        value={typed[key] ?? ''}
                        placeholder={card.activity?.name ?? ''}
                        aria-label="Your own name for this"
                        onFocus={() => setPicked((p) => ({ ...p, [key]: CUSTOM }))}
                        onChange={(e) => setTyped((t) => ({ ...t, [key]: e.target.value }))}
                      />
                    </span>
                  </label>

                  {options[0]?.current != null && (
                    <p className="ic-current muted">Currently called “{options[0].current}”</p>
                  )}
                </section>
              );
            })}

            {(card.photos?.length ?? 0) > 0 && (
              <section className="ic-field">
                <h3>Photos from that day</h3>
                <div className="ic-photos">
                  {card.photos.map((ph) => {
                    const on = pickedPhotos[ph.id] !== false;
                    return (
                      <label
                        key={ph.id}
                        className={`ic-photo${on ? ' on' : ''}`}
                        title={photoWhy(ph)}
                      >
                        <AuthedImg photoId={ph.photo_id} size="thumb" alt="" />
                        <input
                          type="checkbox"
                          checked={on}
                          aria-label={`Include this photo — ${photoWhy(ph)}`}
                          onChange={(e) =>
                            setPickedPhotos((s2) => ({ ...s2, [ph.id]: e.target.checked }))
                          }
                        />
                        <span className="ic-photo-why">{photoWhy(ph)}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="ic-current muted">
                  Their dates stay exactly as they are — pinning only says where they belong.
                </p>
              </section>
            )}

            <footer className="ic-actions">
              <button
                className="btn btn-primary"
                disabled={!canDecide || busy === card.group_key}
                onClick={() => void onApprove(card)}
              >
                {busy === card.group_key ? 'Saving…' : 'Looks right'}
              </button>
              <button
                className="btn"
                onClick={() => setSkipped((s) => new Set(s).add(card.group_key))}
              >
                Skip
              </button>
            </footer>
          </article>
        );
      })}

      {/* Required by the OpenStreetMap licence wherever its data is shown, and it is
          shown on every card above. Visible without interaction — not behind a menu. */}
      <p className="osm-credit">
        Place and trail names from{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap contributors
        </a>
      </p>
    </div>
  );
}
