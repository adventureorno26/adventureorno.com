import { useEffect, useState } from 'react';
import {
  fetchPhotoReactions,
  setPhotoCaption,
  togglePhotoReaction,
  type PhotoReaction,
} from '../lib/photos';

// The emoji palette for reacting. These ARE the feature (Erica asked for emoji
// reactions), so they're the intended exception to the no-icons rule.
const PALETTE = ['❤️', '😍', '😂', '🔥', '👏', '🥹', '😮', '🙌'];

/** Caption + emoji reactions for one photo, shown under it in the lightbox. */
export default function PhotoReactions({
  photoId,
  caption,
  canEdit,
}: {
  photoId: string;
  caption: string | null;
  canEdit: boolean;
}) {
  const [reactions, setReactions] = useState<PhotoReaction[]>([]);
  const [cap, setCap] = useState(caption ?? '');
  const [editingCap, setEditingCap] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setCap(caption ?? '');
    setEditingCap(false);
    setPickerOpen(false);
    fetchPhotoReactions(photoId)
      .then((r) => active && setReactions(r))
      .catch(() => active && setReactions([]));
    return () => {
      active = false;
    };
  }, [photoId, caption]);

  async function reload() {
    setReactions(await fetchPhotoReactions(photoId).catch(() => []));
  }
  async function toggle(emoji: string) {
    setPickerOpen(false);
    await togglePhotoReaction(photoId, emoji).catch(() => undefined);
    await reload();
  }
  async function saveCaption() {
    setEditingCap(false);
    try {
      await setPhotoCaption(photoId, cap);
    } catch {
      /* leave as typed */
    }
  }

  return (
    <div className="photo-social" onClick={(e) => e.stopPropagation()}>
      {editingCap ? (
        <div className="cap-edit">
          <input
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            placeholder="Add a caption…"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && void saveCaption()}
          />
          <button className="primary" onClick={() => void saveCaption()}>
            Save
          </button>
        </div>
      ) : cap ? (
        <p
          className={`photo-caption ${canEdit ? 'editable' : ''}`}
          onClick={() => canEdit && setEditingCap(true)}
          title={canEdit ? 'Edit caption' : undefined}
        >
          {cap}
        </p>
      ) : canEdit ? (
        <button className="link-btn" onClick={() => setEditingCap(true)}>
          + Add a caption
        </button>
      ) : null}

      <div className="photo-reactions">
        {reactions.map((r) => (
          <button
            key={r.emoji}
            className={`reaction-chip ${r.mine ? 'mine' : ''}`}
            title={r.who.join(', ')}
            onClick={() => void toggle(r.emoji)}
          >
            <span className="reaction-emoji">{r.emoji}</span>
            {r.n > 1 && <span className="reaction-n">{r.n}</span>}
          </button>
        ))}
        <button
          className="reaction-add"
          onClick={() => setPickerOpen((v) => !v)}
          aria-label="Add a reaction"
        >
          ＋
        </button>
        {pickerOpen && (
          <div className="reaction-picker">
            {PALETTE.map((e) => (
              <button key={e} onClick={() => void toggle(e)}>
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
