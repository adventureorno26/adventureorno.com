import { useRef, useState } from 'react';
import { googlePhotosEnabled, pickFromGooglePhotos } from '../lib/googlePhotos';
import { useDialog } from '../lib/useDialog';
import type { Place } from '../lib/types';
import type { MapPerson } from '../lib/data';
import NewPlaceDraft from './NewPlaceDraft';

export type AddKind = 'photos' | 'visited' | 'bucket';

/**
 * ONE sheet for adding anything.
 *
 * It replaces four surfaces that were all asking the same question in different
 * words: the map's `+ Add` menu (with its Activity / Trip / Trail / Bucket List /
 * Photo submenus), the five-step `/add` wizard, and the separate "make this a
 * city / region / trail" controls. It asks three questions and no more:
 *
 *   1. What are you adding?   Photos · A place I've been · Somewhere to go later
 *   2. Where does it belong?  nothing, or a trail   (places only)
 *   3. What is it?            tags
 *
 * Questions 2 and 3 live in NewPlaceDraft, which already knew how to search a
 * location, warn about duplicates, and save the place, visit, attribution and
 * photos atomically. Cities and regions are never asked about — they attach
 * spatially by boundary — and a trip is a visit you marked, not a kind of place.
 */
export default function AddSheet({
  at,
  places,
  people,
  meId,
  onSaved,
  onPhotos,
  onClose,
}: {
  /** Where a new place starts. The map passes the point you tapped; the Add tab
   *  passes the centre of the map, and you can search from there. */
  at: { lat: number; lng: number };
  places: Place[];
  people: MapPerson[];
  meId: string | null;
  onSaved: (placeId: string) => void;
  /** Photos chosen from this device or Google Photos, handed to the upload path. */
  onPhotos: (files: File[]) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<AddKind | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const sheetRef = useDialog<HTMLDivElement>(onClose);

  // Google Photos: the ONE place this lives now. It used to be reachable only
  // from the map's `+ Add` button, which is why that button could not just be
  // deleted — removing it orphaned the import entirely.
  async function fromGoogle() {
    setNote('Opening Google Photos…');
    try {
      const files = await pickFromGooglePhotos((s) => setNote(s));
      setNote(null);
      if (files.length) {
        onPhotos(files);
        onClose();
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Google Photos import failed.');
    }
  }

  if (kind === 'visited' || kind === 'bucket') {
    return (
      <NewPlaceDraft
        initialLat={at.lat}
        initialLng={at.lng}
        places={places}
        people={people}
        meId={meId}
        mode={kind === 'bucket' ? 'bucket' : 'visited'}
        onSaved={onSaved}
        onCancel={onClose}
      />
    );
  }

  return (
    <div
      className="npd-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="add-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add"
        tabIndex={-1}
      >
        <div className="npd-head">
          <b>What are you adding?</b>
          <button className="npd-x" onClick={onClose} aria-label="Cancel">
            ×
          </button>
        </div>

        {kind === 'photos' ? (
          <>
            <div className="add-choices">
              <button onClick={() => fileRef.current?.click()}>From this device</button>
              {googlePhotosEnabled() && (
                <button onClick={() => void fromGoogle()}>From Google Photos</button>
              )}
            </div>
            <button className="link-btn" onClick={() => setKind(null)}>
              ‹ Back
            </button>
          </>
        ) : (
          <div className="add-choices">
            <button onClick={() => setKind('photos')}>Photos</button>
            <button onClick={() => setKind('visited')}>A place I’ve been</button>
            <button onClick={() => setKind('bucket')}>Somewhere to go later</button>
          </div>
        )}

        {note && <div className="add-note">{note}</div>}

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/heic,image/heif"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) {
              onPhotos(files);
              onClose();
            }
          }}
        />
      </div>
    </div>
  );
}
