import { useEffect, useRef, useState } from 'react';
import {
  addActivityOption,
  addActivityToVisit,
  addPlaceToVisit,
  fetchActivityOptions,
  newExperienceKey,
  type ActivityOption,
} from '../lib/data';
import { importFileActivity, parseActivityFile, parseFitActivity } from '../lib/importFile';
import { showSnack } from '../lib/snackbar';

/**
 * "+ Add an activity" — the control Erica asked for, on the visit card.
 *
 *   "instead of add a restuarant, it should be add an activity and open to a dropdown
 *    to select run, walk, hike, bike, winery, brewery, restaurant, bar, import
 *    activity, add a new activity"
 *
 * PREVIEW APPROVED 2026-08-14: a native dropdown, then a name before saving.
 *
 * A native <select> on purpose. It matches the Who and "+ tag" controls already on the
 * card, adds no new dropdown component to maintain, and on a phone it opens the system
 * picker — which is the most reliable control there is, and the one place this card is
 * mostly used. No icons anywhere (her rule; the photo heart and flame are the only ones).
 *
 * THE LIST IS DATA. It comes from `activity_options`, so adding an option is a row
 * rather than a deploy — which is what makes "add a new activity" possible at all.
 *
 * The two halves of that list are not cosmetic. A Run is a ROUTE recorded on this
 * visit. A Winery is a PLACE: "A restaurant is a place. A winery is a place. the dates
 * are visits to those places." So picking one creates a place, groups it under this
 * one, and gives it its own visit on the day you choose.
 */
export default function AddActivity({
  visitId,
  startDate,
  endDate,
  onAdded,
  onStage,
  only,
  addLabel = '+ Add an activity',
}: {
  /** The visit to write to. Omitted on the BLANK card, which has no visit yet. */
  visitId?: string;
  startDate: string;
  endDate?: string | null;
  onAdded?: () => void | Promise<void>;
  /**
   * THE BLANK CARD. Given this, the control STAGES instead of writing: the picked
   * option is handed back and nothing reaches the database until that card's Save.
   * It is the same dropdown and the same little form — one control, two homes —
   * because two of them is how the two stop looking the same.
   */
  onStage?: (staged: {
    option: ActivityOption;
    name: string;
    distanceMeters: number | null;
  }) => void;
  /** Show only routes, or only places. The blank card's Routes and Restaurants
   *  sections are separate headings, so each offers only what belongs under it. */
  only?: 'route' | 'place';
  /** The dropdown's own first line. */
  addLabel?: string;
}) {
  const [options, setOptions] = useState<ActivityOption[] | null>(null);
  /** The option being filled in, or one of the two actions. */
  const [picked, setPicked] = useState<ActivityOption | null>(null);
  const [newKind, setNewKind] = useState<'route' | 'place' | null>(null);
  const [name, setName] = useState('');
  const [miles, setMiles] = useState('');
  const [day, setDay] = useState(startDate);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** One idempotency key per attempt: a retry after a dropped connection must not
   *  log the same thing twice. Reset only on success. */
  const keyRef = useRef<string>(newExperienceKey());

  useEffect(() => {
    let active = true;
    fetchActivityOptions()
      .then((rows) => active && setOptions(rows))
      .catch((e: unknown) => {
        if (!active) return;
        setOptions([]);
        showSnack({
          message:
            e instanceof Error
              ? `Could not load the activity list: ${e.message}`
              : 'Could not load the activity list.',
        });
      });
    return () => {
      active = false;
    };
  }, []);

  function reset() {
    setPicked(null);
    setNewKind(null);
    setName('');
    setMiles('');
    setDay(startDate);
  }

  function choose(value: string) {
    if (!value) return;
    if (value === '__import') {
      fileRef.current?.click();
      return;
    }
    if (value === '__new') {
      setPicked(null);
      setNewKind('route');
      setName('');
      return;
    }
    const opt = (options ?? []).find((o) => o.slug === value);
    if (!opt) return;
    setNewKind(null);
    setPicked(opt);
    setName('');
    setMiles('');
    setDay(startDate);
  }

  async function save() {
    if (!picked) return;
    const trimmed = name.trim();
    // A place must be named — it becomes a card of its own, and "Restaurant" is not a
    // name. A route may be unnamed; the RPC names it from its type.
    if (picked.kind === 'place' && !trimmed) {
      showSnack({ message: `Give the ${picked.label.toLowerCase()} a name.` });
      return;
    }
    // STAGED (the blank card): hand it back and write nothing. This return is the
    // whole of the promise — every write below it is unreachable without a visit.
    if (onStage) {
      const mi = Number(miles);
      onStage({
        option: picked,
        name: trimmed,
        distanceMeters: Number.isFinite(mi) && mi > 0 ? mi * 1609.344 : null,
      });
      reset();
      return;
    }
    if (!visitId) return;
    setBusy(true);
    try {
      if (picked.kind === 'route') {
        const mi = Number(miles);
        await addActivityToVisit({
          visitId,
          option: picked.slug,
          name: trimmed || null,
          distanceMeters: Number.isFinite(mi) && mi > 0 ? mi * 1609.344 : null,
          clientKey: keyRef.current,
          day,
        });
      } else {
        await addPlaceToVisit({
          visitId,
          option: picked.slug,
          name: trimmed,
          clientKey: keyRef.current,
          day,
        });
      }
      keyRef.current = newExperienceKey();
      reset();
      await onAdded?.();
    } catch (e) {
      // Never silent: a save that vanishes looks exactly like one that worked.
      showSnack({
        message: e instanceof Error ? `Could not add that: ${e.message}` : 'Could not add that.',
      });
    }
    setBusy(false);
  }

  async function saveNewOption() {
    const trimmed = name.trim();
    if (!trimmed || !newKind) {
      showSnack({ message: 'Give the activity a name.' });
      return;
    }
    setBusy(true);
    try {
      const opt = await addActivityOption(trimmed, newKind);
      setOptions((prev) => [...(prev ?? []).filter((o) => o.slug !== opt.slug), opt]);
      // Straight into filling it in — adding "Paddle" almost always means
      // "...and I did one on this visit".
      setNewKind(null);
      setPicked(opt);
      setName('');
    } catch (e) {
      showSnack({
        message:
          e instanceof Error ? `Could not add that activity: ${e.message}` : 'Could not add that.',
      });
    }
    setBusy(false);
  }

  async function importFile(file: File) {
    setBusy(true);
    try {
      const parsed = /\.fit$/i.test(file.name)
        ? await parseFitActivity(await file.arrayBuffer(), file.name)
        : parseActivityFile(await file.text(), file.name);
      if (!parsed) throw new Error('that file did not contain a route');
      const out = await importFileActivity(parsed);
      await onAdded?.();
      // Say what actually happened. "Imported" for a file we already had is how a person
      // ends up importing the same run four times looking for the one that stuck.
      showSnack({
        message:
          out.disposition === 'duplicate'
            ? `You already had ${parsed.name}.`
            : out.disposition === 'proposed'
              ? `Imported ${parsed.name} — it looks like one you already have, so it is waiting for you to confirm.`
              : `Imported ${parsed.name}.`,
      });
    } catch (e) {
      showSnack({
        message:
          e instanceof Error ? `Could not import that: ${e.message}` : 'Could not import that.',
      });
    }
    setBusy(false);
  }

  const last = endDate || startDate;
  // What this instance offers. IMPORT and "add a new activity" both write the moment
  // they are chosen — a file becomes an activities row, a new option becomes an
  // activity_options row — so neither is offered while staging.
  const offered = (options ?? []).filter((o) => !only || o.kind === only);

  return (
    <div className="add-activity">
      <input
        ref={fileRef}
        type="file"
        accept=".gpx,.tcx,.fit"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importFile(f);
        }}
      />

      {!picked && !newKind && (
        <select
          className="kind-select"
          value=""
          disabled={busy || options === null}
          onChange={(e) => choose(e.target.value)}
          aria-label={addLabel.replace(/^\+\s*/, '')}
        >
          <option value="">{addLabel}</option>
          {offered.map((o) => (
            <option key={o.slug} value={o.slug}>
              {o.label}
            </option>
          ))}
          {!onStage && <option value="__import">Import activity</option>}
          {!onStage && <option value="__new">Add a new activity</option>}
        </select>
      )}

      {/* Filling in the one that was picked. */}
      {picked && (
        <div className="aa-form">
          <label>
            <span>Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              /* AN ACTIVITY HAS NEVER NEEDED A TITLE, and the form never said so.
                 Erica, 2026-08-31: "to add an activity I have to give it a title."
                 She did not — `save()` already sends `name: trimmed || null` for a route
                 and `add_activity_to_visit` does `coalesce(p_name, v_opt.label)` — but the
                 label read "Name", the placeholder read "Kayaking", and Miles directly
                 below it said "optional". Every signal on screen said required. A field
                 that is optional and does not say so is a field that is required.
                 A PLACE still must be named: it becomes a card of its own. */
              placeholder={
                picked.kind === 'place'
                  ? `Name this ${picked.label.toLowerCase()}`
                  : `optional — we'll call it ${picked.label}`
              }
            />
          </label>
          {picked.kind === 'route' && (
            <label>
              <span>Miles</span>
              <input
                value={miles}
                onChange={(e) => setMiles(e.target.value)}
                inputMode="decimal"
                placeholder="optional"
              />
            </label>
          )}
          {/* A blank card's first visit is ONE day — the date in its Visits section —
              so there is no day to choose between and the field would be a control
              with a single value. */}
          {!onStage && (
            <label>
              <span>Date</span>
              <input
                type="date"
                value={day}
                min={startDate}
                max={last}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
          )}
          <div className="aa-actions">
            <button type="button" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="link" disabled={busy} onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Adding a new option to the list itself. */}
      {newKind && (
        <div className="aa-form">
          <label>
            <span>Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Paddle, Climb, Distillery…"
            />
          </label>
          {/* The one question that cannot be guessed, in her words rather than
              the schema's. It decides whether this becomes a route on a visit or
              a place with a card of its own. */}
          <label>
            <span>Is it</span>
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as 'route' | 'place')}
            >
              <option value="route">Something we did</option>
              <option value="place">Somewhere we went</option>
            </select>
          </label>
          <div className="aa-actions">
            <button type="button" disabled={busy} onClick={() => void saveNewOption()}>
              {busy ? 'Adding…' : 'Add'}
            </button>
            <button type="button" className="link" disabled={busy} onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
