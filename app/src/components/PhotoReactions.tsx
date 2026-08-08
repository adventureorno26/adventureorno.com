import { useEffect, useState } from 'react';
import {
  fetchPhotoReactions,
  setPhotoCaption,
  togglePhotoReaction,
  type PhotoReaction,
} from '../lib/photos';
import ReactionMark from './ReactionMarks';
import { MARKS, labelFor } from '../lib/reactions';

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

  useEffect(() => {
    let active = true;
    setCap(caption ?? '');
    setEditingCap(false);
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

      {/* Two reactions, always visible — no "+" picker to open first. The eight-emoji
          palette hid everything behind a plus sign; two marks you can hit directly is
          the whole interaction. */}
      <div className="photo-reactions">
        {MARKS.map((m) => {
          const r = reactions.find((x) => x.emoji === m.emoji);
          const n = r?.n ?? 0;
          return (
            <button
              key={m.emoji}
              className={`reaction-chip ${r?.mine ? 'mine' : ''} ${n ? 'has' : ''}`}
              title={n ? r!.who.join(', ') : m.label}
              aria-label={m.label}
              aria-pressed={!!r?.mine}
              onClick={() => void toggle(m.emoji)}
            >
              <ReactionMark emoji={m.emoji} on={n > 0} />
              {n > 0 && <span className="reaction-n">{n}</span>}
            </button>
          );
        })}
        {/* Anything reacted with before the marks existed still shows. */}
        {reactions
          .filter((r) => !MARKS.some((m) => m.emoji === r.emoji))
          .map((r) => (
            <button
              key={r.emoji}
              className={`reaction-chip ${r.mine ? 'mine' : ''} has`}
              title={r.who.join(', ')}
              aria-label={labelFor(r.emoji) ?? r.emoji}
              onClick={() => void toggle(r.emoji)}
            >
              <ReactionMark emoji={r.emoji} on />
              {r.n > 1 && <span className="reaction-n">{r.n}</span>}
            </button>
          ))}
      </div>
    </div>
  );
}
