import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addActivityToVisit,
  addExperience,
  addPlaceToVisit,
  createEntry,
  createPlaceAtomic,
  fetchPoiDetails,
  newExperienceKey,
  setPlaceSolo,
  updatePlace,
  type ActivityOption,
  type PoiDetails,
} from '../lib/data';
import type { MapPerson } from '../lib/data';
import {
  needsVisitRow,
  writeStaged,
  type StagedNote,
  type StagedOuting,
} from '../lib/draftStaging';
import { mapPool, readTakenAt, uploadPhoto } from '../lib/photos';
import { reverseGeocode, type SearchResult } from '../lib/maptiler';
import { localDateOf, prefill, suggestedPlaceName, todayLocalDate } from '../lib/draftPrefill';
import { googlePhotosEnabled, pickFromGooglePhotos } from '../lib/googlePhotos';
import { haversineMeters } from '../lib/geo';
import { MANUAL_CATEGORIES, categoryLabel } from '../lib/categories';
import { whoChoices, whoProfileId } from '../lib/participants';
import { showSnack } from '../lib/snackbar';
import { announceWho } from '../lib/whoWasThere';
import MapSearch from './MapSearch';
import CardCover from './CardCover';
import StarRating from './StarRating';
import AddActivity from './AddActivity';
import EntryEditor from './EntryEditor';
import { useDialog } from '../lib/useDialog';
import type { NewEntry, Place } from '../lib/types';

/** 'both' | 'mine' | a profile id — built from the real members (lib/participants). */
type Who = string;

// How close another place must be to count as a possible duplicate, by type.
// Tight for point venues (a restaurant next door is a different place); wide for
// parks/trails/areas. Fixes photos attaching to a place tens of km away.
const TYPE_RADIUS_M: Record<string, number> = {
  dining: 100,
  winery: 100,
  brewery: 100,
  stay: 120,
  sunrise: 400,
  sunset: 400,
  beach: 1500,
  viewpoint: 2000,
  camping: 2000,
  jeeping: 3000,
  trail: 5000,
};
function dupeRadius(tags: string[]): number {
  if (tags.length === 0) return 300;
  return Math.max(...tags.map((t) => TYPE_RADIUS_M[t] ?? 300));
}

/** Explicit draft for a NEW place — nothing is written to the database until you
 *  press Save. Search or start from a clicked point, review the coordinates and
 *  any nearby duplicates, add photos + a visit date + tags + who, then Save once.
 *  Replaces the old "create a real row immediately, delete it if unused" flow. */
export default function NewPlaceDraft({
  initialLat,
  initialLng,
  presetName,
  places,
  people,
  meId,
  onSaved,
  onCancel,
  mode = 'visited',
}: {
  initialLat: number;
  initialLng: number;
  presetName?: string;
  places: Place[];
  people: MapPerson[];
  meId: string | null;
  // The second argument is the trail's name, and it is only passed when this save
  // made a trail AND the person asked to draw its route now — the caller hands off
  // to the map's draw mode instead of opening the card.
  onSaved: (placeId: string, drawRouteNamed?: string) => void;
  onCancel: () => void;
  // 'visited' = a place I've been (asks when + who). 'bucket' = somewhere to go
  // later, which has no visit and therefore nobody to attribute it to.
  mode?: 'visited' | 'bucket';
}) {
  const wanted = mode === 'bucket';
  const [name, setName] = useState(presetName ?? '');
  // Where does it belong? A TRAIL is the only container ever chosen by hand —
  // cities and regions attach spatially by boundary, so they are never a question.
  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [admin1, setAdmin1] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  // PRE-FILLED TO THE DAY YOU ARE ADDING THE CARD, and to the day the first photo was
  // taken as soon as there is one. Still a plain date input: type over it, or clear it.
  const [visitDate, setVisitDate] = useState(() => todayLocalDate());
  // What the card filled in, so the footer can tell a prefill apart from work she
  // entered — otherwise Cancel would ask "discard everything you've entered?" on a
  // card she has not touched.
  const prefilledDate = useRef(visitDate);
  const dateEdited = useRef(false);
  const [who, setWho] = useState<Who>('both');
  const [website, setWebsite] = useState<string | null>(null);
  // Staged like every other field on this card — nothing is written until Save.
  const [rating, setRating] = useState<number | null>(null);
  // The address is shown as a line with an "edit" that opens the search, exactly as the
  // saved card does it, rather than as a permanently-open search box.
  const [editingAddress, setEditingAddress] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  // Asked once, here only (§0.6): "Is this a trail with sections?" — and having said
  // yes, the offer to draw its reference route straight away.
  const [drawAfter, setDrawAfter] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // ROUTES, RESTAURANTS AND NOTES, STAGED — the answer to the question STATE.md had
  // recorded as open since 2026-08-12 (Erica, 2026-08-30: "it should be fully
  // editable"). They live here until Save, exactly as the name, rating, tags, date and
  // photos already do, so Cancel leaves nothing behind.
  const [outings, setOutings] = useState<StagedOuting[]>([]);
  const [notes, setNotes] = useState<StagedNote[]>([]);
  // The staged items already written, so a Save retried after a failure halfway down
  // the list finishes it instead of doing the whole thing twice.
  const wrote = useRef<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement | null>(null);
  // A name she typed is hers; a name the card guessed is not. Anything that fills the
  // field for her (the reverse geocode, the OpenStreetMap lookup) checks this first.
  // A name handed in by the caller — she searched for it and picked it — counts as
  // typed, so the lookup below leaves it alone.
  const nameEdited = useRef(!!presetName);
  // Nominatim is asked ONCE per opened card and never in a loop (rate limits, and it
  // is a free service). The ref also survives StrictMode's double effect in dev.
  const poiAsked = useRef(false);
  const choices = whoChoices(people, meId);
  // Idempotency keys per save action (reused on retry, reset on success). One for
  // the "create new place" action, one for "add to an existing (duplicate) place".
  const keyNew = useRef<string | null>(null);
  const keyExisting = useRef<string | null>(null);

  // ONE FACT, ONE PLACE. Being a trail IS carrying the `trail` tag — that is what
  // sets `is_trail` on save. The question above reads and writes the tag rather than
  // keeping its own boolean beside it, because a second copy is the bug this codebase
  // keeps having: two mechanisms for one fact, and the screen reading the copy.
  const isTrail = tags.includes('trail');
  function setIsTrail(yes: boolean) {
    setTags((t) =>
      yes ? [...t.filter((c) => c !== 'trail'), 'trail'] : t.filter((c) => c !== 'trail'),
    );
    if (!yes) setDrawAfter(false);
  }

  function stageOuting(picked: {
    option: ActivityOption;
    name: string;
    distanceMeters: number | null;
  }) {
    setOutings((cur) => [
      ...cur,
      {
        key: newExperienceKey(),
        slug: picked.option.slug,
        label: picked.option.label,
        kind: picked.option.kind,
        name: picked.name,
        distanceMeters: picked.distanceMeters,
      },
    ]);
  }
  /** The note form hands back a full NewEntry; the place id in it is a placeholder,
   *  because the place does not exist yet. Save fills the real one in. */
  function stageNote(draft: NewEntry): Promise<void> {
    setNotes((cur) => [
      ...cur,
      {
        key: newExperienceKey(),
        draft: {
          kind: draft.kind,
          title: draft.title,
          body: draft.body,
          rating: draft.rating,
          url: draft.url,
          date: draft.date,
          address: draft.address,
          lat: draft.lat,
          lng: draft.lng,
        },
      },
    ]);
    return Promise.resolve();
  }

  // Map the tri-state Who selector to the create_experience `who` param.
  function whoParam(): string | undefined {
    return whoProfileId(who, meId) ?? undefined; // 'both' — leave attribution unset
  }

  // DOES THIS SAVE LOG A VISIT ROW? It always did with a date and no photos. A staged
  // route or restaurant now asks for one outright, because both attach to a visit id
  // and the photo-derived visit does not exist yet at the moment Save runs. See
  // lib/draftStaging for why that does not double-count.
  const logsAVisit = needsVisitRow({
    wanted,
    visitDate,
    photoCount: files.length,
    stagedOutings: outings.length,
  });
  // PICKING A NEARBY DUPLICATE is "add my visit here" whichever mode the card is in —
  // that path has never asked whether this was somewhere to go later, because choosing
  // an existing place you have been to is the answer to that question.
  const logsAVisitOnExisting = needsVisitRow({
    wanted: false,
    visitDate,
    photoCount: files.length,
    stagedOutings: outings.length,
  });

  /** The writes `writeStaged` performs, bound to the place this save just created.
   *  They are the SAME calls the saved card makes — a note is an entry, a review of a
   *  restaurant is a place grouped under this one (PlacePanel's `addNote`), a route is
   *  an activity on the visit, a restaurant picked from the list is a place on it. */
  function stagingWriters(placeId: string) {
    return {
      createEntry,
      createChildPlace: (draft: Omit<NewEntry, 'place_id'>) =>
        createPlaceAtomic(
          {
            name: draft.title,
            country,
            admin1,
            lat: draft.lat ?? lat,
            lng: draft.lng ?? lng,
            address: draft.address ?? null,
            categories: [draft.kind],
            saved: true,
            part_of: [placeId],
            review: draft.body ?? null,
          },
          { date: draft.date || undefined, rating: draft.rating ?? null },
        ),
      addActivityToVisit,
      addPlaceToVisit,
    };
  }

  // Name/region from the coordinates, unless the caller preset a name.
  useEffect(() => {
    if (presetName) return;
    void reverseGeocode(lng, lat).then((g) => {
      if (!g) return;
      setName((n) => n || g.name);
      setAdmin1(g.admin1);
      setCountry(g.country);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // THE PLACE YOU ARE AT, SUGGESTED — no button to press.
  //
  // Erica, 2026-08-30: "if I am at a restaurant the name of the restaurant will
  // already be in the card after I hit add, then I can change it as needed." This
  // replaces the "Official details / Look up name & website" section, which asked her
  // to press a button to be told the name of the place she was standing in.
  //
  // It is deliberately quiet: one request, no spinner over the card, and NOTHING at
  // all when OpenStreetMap has no named place there or the request fails. A wrong
  // name she has to notice and delete is worse than a blank field, so
  // `suggestedPlaceName` throws away roads, suburbs and county boundaries.
  useEffect(() => {
    if (poiAsked.current) return;
    poiAsked.current = true;
    let live = true;
    void fetchPoiDetails(lat, lng).then((d: PoiDetails | null) => {
      if (!live || !d) return;
      setName((n) => prefill(n, suggestedPlaceName(d), nameEdited.current));
      setWebsite((w) => w ?? d.website);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Possible duplicates: saved places within a type-aware radius of this spot.
  const radius = dupeRadius(tags);
  const dupes = useMemo(
    () =>
      places
        .filter(
          (p) => p.saved && haversineMeters({ lat, lng }, { lat: p.lat, lng: p.lng }) <= radius,
        )
        .sort(
          (a, b) =>
            haversineMeters({ lat, lng }, { lat: a.lat, lng: a.lng }) -
            haversineMeters({ lat, lng }, { lat: b.lat, lng: b.lng }),
        )
        .slice(0, 5),
    [places, lat, lng, radius],
  );

  function pickLocation(r: SearchResult) {
    setLat(r.lat);
    setLng(r.lng);
    setName(r.name);
    setAdmin1(r.admin1);
    setCountry(r.country);
    setAddress(r.address);
    // She searched and picked this one: the name is now a choice, not a guess.
    nameEdited.current = true;
    setEditingAddress(false);
  }

  // Photos carry the day they were taken, and that is a better answer than today.
  // It is applied only while the date is still the one the card filled in — once she
  // has set a date, adding photos does not move it.
  //
  // The date is read from the file's own EXIF, which is why this also covers Google
  // Photos: lib/googlePhotos downloads the ORIGINAL bytes (`=d`), so the capture time
  // is still in them. Google's own `mediaFileMetadata.creationTime` is NOT threaded
  // through — the Picker request in lib/googlePhotos.ts (downloadSession) asks only
  // for `mediaFile`, and the File it builds carries no timestamp — so a photo whose
  // EXIF was stripped before it reached Google keeps today's date.
  function addFiles(added: File[]) {
    if (added.length === 0) return;
    setFiles((cur) => [...cur, ...added]);
    if (dateEdited.current) return;
    void readTakenAt(added[0]).then((takenAt) => {
      const day = localDateOf(takenAt);
      if (!day || dateEdited.current) return;
      prefilledDate.current = day;
      setVisitDate(day);
    });
  }

  // A route or a restaurant hangs off a VISIT, and with no date there is no visit. The
  // card says so rather than dropping them on the floor at Save.
  const outingsNeedADate = outings.length > 0 && !visitDate;
  function refuseWithoutADate(): boolean {
    if (!outingsNeedADate) return false;
    showSnack({ message: 'Give this visit a date — a route or a restaurant belongs to a visit.' });
    return true;
  }

  async function save() {
    if (busy) return;
    if (refuseWithoutADate()) return;
    setBusy('Saving…');
    try {
      if (!keyNew.current) keyNew.current = newExperienceKey();
      // Place + (optional) manual visit + attribution created atomically. A manual
      // visit is only logged when there are NO photos — with photos, the visit is
      // derived from the photo dates (avoids double-counting).
      const res = await addExperience(
        keyNew.current,
        {
          name: name.trim() || 'New place',
          admin1,
          country,
          address,
          lat,
          lng,
          categories: tags,
          saved: true,
          bucket: wanted,
          // Tagging it Trail IS what makes it a trail — there is no separate
          // "make this a trail" control any more.
          is_trail: tags.includes('trail'),
        },
        logsAVisit ? { date: visitDate, who: whoParam() } : {},
      );
      const placeId = res.place_id;

      // Enrichments create_experience doesn't own. The rating is staged on the blank
      // card like everything else, so it is applied here rather than as you tap.
      const extra: { website?: string; rating?: number } = {};
      if (website) extra.website = website;
      if (rating != null) extra.rating = rating;
      if (Object.keys(extra).length) await updatePlace(placeId, extra).catch(() => undefined);
      // Somewhere-to-go-later has no visit, so there is nothing to attribute.
      if (!wanted && who !== 'both') {
        // Not swallowed: losing this silently means the place is saved and
        // attributed to the wrong people, with nothing on screen to say so.
        await setPlaceSolo(placeId, whoProfileId(who, meId))
          .then((outcome) => announceWho(outcome, people))
          .catch((e: unknown) => {
            showSnack({
              message:
                e instanceof Error
                  ? `Saved, but could not set who was there: ${e.message}`
                  : 'Saved, but could not set who was there.',
            });
          });
      }

      // EVERYTHING THE CARD WAS HOLDING, in one place and only here. Before the
      // photos, because these are quick and a photo upload is the slow part.
      if (outings.length || notes.length) {
        setBusy('Adding what you wrote…');
        const { skipped } = await writeStaged({
          placeId,
          visitId: res.visit_id,
          day: visitDate || null,
          outings,
          notes,
          done: wrote.current,
          writers: stagingWriters(placeId),
        });
        if (skipped > 0) {
          showSnack({
            message: `Saved, but ${skipped} route${skipped === 1 ? '' : 's'} or restaurant${
              skipped === 1 ? '' : 's'
            } needed a visit and could not be added.`,
          });
        }
      }

      if (files.length) {
        setBusy(`Adding ${files.length} photo${files.length === 1 ? '' : 's'}…`);
        const takenAt = visitDate ? `${visitDate}T12:00:00Z` : undefined;
        await mapPool(
          files,
          (f) => uploadPhoto(f, { placeId, lat, lng, takenAt, override: true }).catch(() => null),
          4,
        );
      }
      keyNew.current = null;
      // A new trail whose route she asked to draw goes straight to the map's draw
      // mode; everything else opens its card.
      onSaved(placeId, isTrail && drawAfter ? name.trim() || 'New place' : undefined);
    } catch {
      setBusy(null);
    }
  }

  // Picking a nearby duplicate should NOT throw away what you already entered —
  // carry the visit date, who, and photos onto the existing place as a NEW visit,
  // then open it. (Attribution here is per-visit, matching the model.)
  async function addToExisting(p: Place) {
    if (busy) return;
    if (refuseWithoutADate()) return;
    setBusy('Adding your visit…');
    try {
      if (!keyExisting.current) keyExisting.current = newExperienceKey();
      // Same atomic path against an existing place; manual visit only when there
      // are no photos (photos derive their own visit).
      const res = await addExperience(
        keyExisting.current,
        { id: p.id },
        logsAVisitOnExisting ? { date: visitDate, who: whoParam() } : {},
      );
      // The routes, restaurants and notes go where the visit went. Picking a duplicate
      // has never thrown away what you entered, and this is more of what you entered.
      if (outings.length || notes.length) {
        setBusy('Adding what you wrote…');
        await writeStaged({
          placeId: p.id,
          visitId: res.visit_id,
          day: visitDate || null,
          outings,
          notes,
          done: wrote.current,
          writers: stagingWriters(p.id),
        });
      }
      if (files.length) {
        setBusy(`Adding ${files.length} photo${files.length === 1 ? '' : 's'}…`);
        const takenAt = visitDate ? `${visitDate}T12:00:00Z` : undefined;
        await mapPool(
          files,
          (f) =>
            uploadPhoto(f, {
              placeId: p.id,
              lat: p.lat,
              lng: p.lng,
              takenAt,
              override: true,
            }).catch(() => null),
          4,
        );
      }
      keyExisting.current = null;
      onSaved(p.id);
    } catch {
      setBusy(null);
    }
  }

  // Tags you can actually choose. City and Region are NOT offered: they attach
  // spatially by boundary, so asking is meaningless. Trip is not offered either —
  // a trip is a visit you marked, not a kind of place (docs/STATE.md §0.4). Trail is the
  // one container a person sets by hand, and it is set by the question above — asking
  // again here would be asking twice.
  const NOT_A_TAG = new Set(['city', 'region', 'trip', 'trail']);
  // `avail` (the "+ tag" dropdown's remaining options) went with the select: the locked
  // card shows category TAGS AS PILLS, and on a blank card every one of them is still a
  // choice, so the whole palette is offered and each pill toggles itself.

  // Guard against losing ENTERED work: confirm before closing a dirty draft. What the
  // card filled in by itself — today's date, a suggested name, a website found on
  // OpenStreetMap — is not work she would mind losing, and treating it as such would
  // put a "discard everything?" prompt in front of every Cancel.
  const dirty =
    (nameEdited.current && !!name.trim()) ||
    files.length > 0 ||
    visitDate !== prefilledDate.current ||
    tags.length > 0 ||
    rating != null ||
    outings.length > 0 ||
    notes.length > 0;
  function requestCancel() {
    if (busy) return;
    if (dirty && !confirm('Discard this new place and everything you’ve entered?')) return;
    onCancel();
  }
  const cardRef = useDialog<HTMLDivElement>(requestCancel);

  // The staged lists, split into the two sections that hold them.
  const routeRows = outings.filter((o) => o.kind === 'route');
  const placeRows = outings.filter((o) => o.kind === 'place');
  // Both hang off the first visit, so both need one. Bucket places never have a visit;
  // a cleared date means no visit either (a trail can exist before it is walked).
  const canAddOutings = !wanted && !!visitDate;
  const outingsWaitOn = wanted
    ? 'Somewhere to go later has no visit yet — add one after you have been.'
    : 'Give this visit a date above — a route or a restaurant belongs to a visit.';
  function renderStaged(rows: StagedOuting[]) {
    if (rows.length === 0) return null;
    return (
      <div className="npd-staged">
        {rows.map((o) => (
          <div key={o.key} className="npd-staged-row">
            <span className="npd-staged-name">{o.name || o.label}</span>
            <span className="label">
              {o.label}
              {o.distanceMeters ? ` · ${(o.distanceMeters / 1609.344).toFixed(1)} mi` : ''}
            </span>
            <button
              className="link-btn"
              aria-label={`Remove ${o.name || o.label}`}
              onClick={() => setOutings((cur) => cur.filter((x) => x.key !== o.key))}
            >
              remove
            </button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className="npd-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestCancel();
      }}
    >
      {/* THE BLANK CARD IS THE CARD WITH ITS FIELDS EMPTY (rebuilt 2026-08-28).
          §"THE CARD — LOCKED": "The blank (new) card is the same card with the fields
          empty... Its Visits section says 'this is visit one', because saving a new place
          IS its first visit."

          ROUTES, RESTAURANTS AND NOTES BECAME FILLABLE ON 2026-08-30. They read "Added
          once this first visit is saved" until then, which is what the 2026-08-11
          preview showed and what STATE.md recorded as an OPEN question — an activity
          attaches to a visit, and a blank card has no visit until Save. Erica answered
          it: "I also think Add should lead to a card where I can add an activity,
          restaurant, notes, etc — it should be fully editable." So they are staged, like
          every other field here, and written in `save()` once the place and its first
          visit exist. The old words survive only where they are still TRUE: somewhere to
          go later has no visit, and neither does a card whose date has been cleared.

          It used to be a dialog of label-and-input rows — Name, Location, Official details,
          Visit date, What is it? — with no sections at all, and none of that copy anywhere
          in the app. It carries `.panel` now, so it inherits the card's own stylesheet:
          the same cover, the same uppercase blue-rule headings, the same everything. The
          logic underneath is untouched — the duplicate check, the POI lookup, the reverse
          geocode and the atomic save all still do exactly what they did. */}
      <aside
        className="panel npd-card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={wanted ? 'Somewhere to go later' : 'New place'}
        tabIndex={-1}
      >
        {/* 1. THE COVER, 2. THE NAME OVER IT, 3. THE RATING UNDER THE NAME. The same
            component the saved card and the visit card use, so the three cannot drift. */}
        <CardCover
          onClose={requestCancel}
          closeLabel="Cancel"
          onPickPhoto={() => fileRef.current?.click()}
          slotLabel={
            files.length > 0
              ? `${files.length} photo${files.length === 1 ? '' : 's'} — the first is the cover`
              : 'Add a cover photo'
          }
          title={
            <input
              className="title-input hero-name-input"
              value={name}
              onChange={(e) => {
                nameEdited.current = true;
                setName(e.target.value);
              }}
              placeholder="Name this place"
              aria-label="Name this place"
            />
          }
          rating={
            // Dim stars mean not rated yet — the locked card's words. Staged like every
            // other field: nothing is written until Save.
            <StarRating value={rating} size={16} onChange={(n) => setRating(n)} />
          }
        />

        {/* 4. THE ADDRESS, prefilled from where you tapped and editable, then the sub-line
            saying what this is in plain words. */}
        <div className="meta">
          {editingAddress ? (
            <div className="place-locate bucket-search">
              <MapSearch placeholder="Search an address or place…" onPick={pickLocation} />
            </div>
          ) : (
            <span>
              <span className="region-directions">
                {address || [admin1, country].filter(Boolean).join(', ') || 'Where you tapped'}
              </span>
              <button className="link-btn region-edit-btn" onClick={() => setEditingAddress(true)}>
                edit
              </button>
            </span>
          )}
          <div className="npd-coords label">
            {lat.toFixed(5)}, {lng.toFixed(5)} · {wanted ? 'not visited yet' : 'this is visit one'}
          </div>
        </div>

        {dupes.length > 0 && (
          <div className="npd-dupes">
            <b>
              Possible duplicate{dupes.length > 1 ? 's' : ''} within{' '}
              {radius >= 1000
                ? `${(radius / 1000).toFixed(radius % 1000 ? 1 : 0)} km`
                : `${radius} m`}
              :
            </b>
            {dupes.map((p) => (
              <button key={p.id} className="npd-dupe" onClick={() => void addToExisting(p)}>
                {p.name} · {Math.round(haversineMeters({ lat, lng }, { lat: p.lat, lng: p.lng }))} m
                — {visitDate || files.length ? 'add my visit here' : 'use this'}
              </button>
            ))}
            <span className="label">
              …or fill in the fields below and Save to create a separate place.
            </span>
          </div>
        )}

        {/* 5. CATEGORY TAGS AS PILLS — never city or region. The whole palette is offered
            here, because on a blank card every one of them is still a choice. */}
        <div className="cat-pills">
          {MANUAL_CATEGORIES.filter((c) => !NOT_A_TAG.has(c.slug)).map((c) => {
            const on = tags.includes(c.slug);
            return (
              <button
                key={c.slug}
                type="button"
                className={`cat-pill${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() =>
                  setTags((t) => (on ? t.filter((x) => x !== c.slug) : [...t, c.slug]))
                }
              >
                {categoryLabel(c.slug)}
              </button>
            );
          })}
        </div>

        {/* ASKED ONCE, AND ONLY HERE. A trail is the one kind of place that is not obvious
            from where you tapped: it is a container whose SECTIONS are the places that
            count, so answering yes changes what the rest of this card means. The answer is
            not stored twice — it sets the `trail` tag, which is what makes a place a trail,
            and the pills above do not offer it.

            "Part of a trail?" was DELETED here on 2026-08-28 at Erica's instruction: the
            toggle is what labels a trail, and one card asked about trails twice. */}
        <div className="npd-ask">
          <span>Is this a trail with sections?</span>
          <div className="ps-who-toggle">
            <button type="button" className={isTrail ? '' : 'on'} onClick={() => setIsTrail(false)}>
              No
            </button>
            <button type="button" className={isTrail ? 'on' : ''} onClick={() => setIsTrail(true)}>
              Yes
            </button>
          </div>
        </div>
        {isTrail && (
          <span className="label">
            Its sections are the places that count — this one holds them together.
          </span>
        )}

        {/* ───────── THE SECTIONS, in the locked order, each saying what will fill it ───────── */}

        <h3 style={{ marginTop: 22 }}>
          Visits <span className="label">{wanted ? 'none yet' : 'this is visit one'}</span>
        </h3>
        {wanted ? (
          <div className="npd-fill">
            Somewhere to go later has no visit yet — add one after you have been.
          </div>
        ) : (
          <div className="npd-visit-one">
            <label className="npd-field">
              {/* No longer "(optional)": it arrives filled in, and clearing it is a
                  deliberate act rather than the default state. */}
              <span>{isTrail ? 'Date you walked it' : 'Date'}</span>
              <input
                type="date"
                value={visitDate}
                onChange={(e) => {
                  dateEdited.current = true;
                  setVisitDate(e.target.value);
                }}
              />
            </label>
            <div className="npd-field">
              <span>Who was there</span>
              <div className="ps-who-toggle">
                {choices.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={who === c.key ? 'on' : ''}
                    onClick={() => setWho(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <h3 style={{ marginTop: 22 }}>
          Photos and Videos{' '}
          {files.length > 0 && <span className="label">({files.length} to add)</span>}
        </h3>
        <div className="btn-row">
          {googlePhotosEnabled() && (
            <button
              onClick={() =>
                void pickFromGooglePhotos((s) => setBusy(s))
                  .then((f) => {
                    setBusy(null);
                    addFiles(f);
                  })
                  .catch(() => setBusy(null))
              }
            >
              Google Photos
            </button>
          )}
          <button onClick={() => fileRef.current?.click()}>Choose photos</button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const f = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = '';
              addFiles(f);
            }}
          />
        </div>

        <h3 style={{ marginTop: 22 }}>
          Routes{routeRows.length > 0 && <span className="label"> ({routeRows.length})</span>}
        </h3>
        {isTrail && (
          <div className="npd-field">
            <span>Its route</span>
            <div className="ps-who-toggle">
              <button
                type="button"
                className={drawAfter ? '' : 'on'}
                onClick={() => setDrawAfter(false)}
              >
                Not now
              </button>
              <button
                type="button"
                className={drawAfter ? 'on' : ''}
                onClick={() => setDrawAfter(true)}
              >
                Draw it after saving
              </button>
            </div>
          </div>
        )}
        {renderStaged(routeRows)}
        {canAddOutings ? (
          <AddActivity
            only="route"
            addLabel="+ Add a route"
            startDate={visitDate}
            onStage={stageOuting}
          />
        ) : (
          <div className="npd-fill">{outingsWaitOn}</div>
        )}

        <h3 style={{ marginTop: 22 }}>
          Restaurants{placeRows.length > 0 && <span className="label"> ({placeRows.length})</span>}
        </h3>
        {renderStaged(placeRows)}
        {canAddOutings ? (
          <AddActivity
            only="place"
            addLabel="+ Add a restaurant"
            startDate={visitDate}
            onStage={stageOuting}
          />
        ) : (
          <div className="npd-fill">{outingsWaitOn}</div>
        )}

        <h3 style={{ marginTop: 22 }}>NOTES AND REVIEWS</h3>
        {notes.length > 0 && (
          <div className="npd-staged">
            {notes.map((n, i) => (
              <div key={n.key} className="npd-staged-row">
                <span className="npd-staged-name">{n.draft.title}</span>
                <span className="label">
                  {n.draft.kind === 'note' ? 'Note' : categoryLabel(n.draft.kind)}
                  {n.draft.rating ? ` · ${'★'.repeat(n.draft.rating)}` : ''}
                </span>
                <button
                  className="link-btn"
                  aria-label={`Remove ${n.draft.title}`}
                  onClick={() => setNotes((cur) => cur.filter((_, j) => j !== i))}
                >
                  remove
                </button>
              </div>
            ))}
          </div>
        )}
        {/* The SAME form the saved card puts at the bottom of this section. Its Kind is
            what decides the model — a plain note is an entry on this place, and a
            Restaurant is a place of its own grouped under it. Staged either way. */}
        <EntryEditor
          placeId=""
          defaultDate={visitDate || todayLocalDate()}
          autoFocusTitle={false}
          onSave={stageNote}
          onCancel={() => undefined}
        />

        {/* "OFFICIAL DETAILS" WAS DELETED HERE ON 2026-08-30. Erica: "I don't understand
            why official details look up name and website is on the card." It was a
            heading and a "Look up name & website" button that asked her to press
            something to be told the name of the place she was standing in. The card
            does that by itself now, the moment it opens (see the effect above), and the
            website it finds is simply shown. */}
        {website && (
          <div className="npd-current label" style={{ marginTop: 18 }}>
            Website: {website}
          </div>
        )}

        {/* 7. THE FOOTER. On the blank card: Save · Cancel. */}
        {busy && <div className="label">{busy}</div>}
        <div className="btn-row npd-footer">
          <button className="primary" disabled={!!busy} onClick={() => void save()}>
            {wanted ? 'Save to the list' : 'Save'}
          </button>
          <button onClick={requestCancel} disabled={!!busy}>
            Cancel
          </button>
        </div>
      </aside>
    </div>
  );
}
