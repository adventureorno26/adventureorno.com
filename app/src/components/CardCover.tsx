// EVERY CARD HAS A COVER. The locked card, §"THE CARD — LOCKED, approved 2026-08-11":
//
//   "1. Cover photo, with × to close. No photo and it is an activity → the letter of the
//    activity (H hike, R run, B biking, W walking). Never an icon.
//    2. The name, over the cover.
//    3. Ratings, directly under the name."
//
// WHY THIS COMPONENT EXISTS. Until 2026-08-28 the card drew a hero ONLY when the place had
// a cover photo, and fell back to a small plain header when it did not. 121 of the 166 live
// places have no cover photo, so THREE CARDS IN FOUR opened as something that was not the
// card Erica approved — and the letter cover, which the approved preview specifies for
// exactly this case, had never been written at all. This is that fallback, and it is one
// component so the destination card, the visit card and the blank card cannot drift apart
// again.
//
// A LETTER IS TEXT, NOT AN ICON — which is precisely why it is allowed here, against her
// standing "NO icons" rule. Preview note 15: "A letter is text, not an icon. Which is
// exactly why it is allowed. Nothing on any card is a pictogram."
import type { ReactNode } from 'react';
import AuthedImg from './AuthedImg';

/** The letter for an activity type. Explicit for the four the plan names, first letter
 *  otherwise — production carries Run, Hike, Walk, Ride, Swim and Workout today, and a
 *  new type should get a sensible letter without anyone editing this file.
 *
 *  BIKING IS B, NOT R. Strava calls it "Ride", which would collide with Run; the locked
 *  card says "B biking", and hers is the naming that matters on her card. */
const LETTERS: Record<string, string> = {
  hike: 'H',
  run: 'R',
  walk: 'W',
  ride: 'B',
  bike: 'B',
  biking: 'B',
  cycling: 'B',
};

function activityLetter(type: string | null | undefined): string | null {
  const key = (type ?? '').trim().toLowerCase();
  if (!key) return null;
  return LETTERS[key] ?? key[0]!.toUpperCase();
}

export type CardCoverProps = {
  /** The photo, when there is one. */
  photoId?: string | null;
  /** Vertical framing, 0–100, as the saved card already stores it. */
  coverPos?: number;
  /** The name, over the cover. Rendered as given so the caller keeps its editing affordance. */
  title: ReactNode;
  /** Ratings, directly UNDER the name. Never above it. */
  rating?: ReactNode;
  /** When there is no photo: the activity whose letter becomes the cover. */
  activityType?: string | null;
  /** The × in the corner. Omitted when the card is not dismissable. */
  onClose?: () => void;
  closeLabel?: string;
  /** Tapping the photo adjusts its framing (saved card only). */
  onAdjust?: () => void;
  /** Tapping an empty cover adds one. Its presence is what makes the slot a control. */
  onPickPhoto?: () => void;
  /** The slot's words. The blank card says "Add a cover photo"; a saved place with no
   *  photograph says the same thing, because that is the thing to do about it. */
  slotLabel?: string;
  /** Anything the caller overlays — the framing slider, for one. */
  children?: ReactNode;
};

export default function CardCover({
  photoId,
  coverPos = 50,
  title,
  rating,
  activityType,
  onClose,
  closeLabel = 'Close',
  onAdjust,
  onPickPhoto,
  slotLabel = 'Add a cover photo',
  children,
}: CardCoverProps) {
  const letter = photoId ? null : activityLetter(activityType);
  // Three states, one element. `slot` is the case the card never had: no photograph and
  // no activity to take a letter from — which is 121 places today.
  const kind = photoId ? 'photo' : letter ? 'letter' : 'empty';

  return (
    <div
      className={`panel-hero panel-hero-${kind}`}
      style={{ ['--pos' as string]: `${coverPos}%` }}
    >
      {kind === 'photo' && (
        <AuthedImg
          photoId={photoId!}
          size="full"
          className={`panel-hero-img${onAdjust ? ' adjustable' : ''}`}
          onClick={onAdjust}
        />
      )}

      {kind === 'letter' && (
        // aria-hidden: the letter restates the activity type, which the sub-line already
        // says in words. A screen reader announcing "H" before the name is noise.
        <span className="panel-hero-glyph" aria-hidden="true">
          {letter}
        </span>
      )}

      {kind === 'empty' &&
        (onPickPhoto ? (
          <button type="button" className="panel-hero-slot" onClick={onPickPhoto}>
            {slotLabel}
          </button>
        ) : (
          <span className="panel-hero-slot is-static">{slotLabel}</span>
        ))}

      {onClose && (
        <button className="close hero-close" onClick={onClose} aria-label={closeLabel}>
          ×
        </button>
      )}

      {/* THE NAME, THEN THE RATING UNDER IT — bottom-left of the cover, in every one of
          the three states. The stars used to sit above the name. */}
      <div className="hero-title">
        <h2 className="title-with-rating">{title}</h2>
        {rating != null && <div className="hero-rating">{rating}</div>}
      </div>

      {children}
    </div>
  );
}
