// The heart and the flame as they sit ON a carousel thumbnail.
//
// This exists as ONE component because the strip is rendered in two places — the
// place card's gallery and the visit card's photo section — and Erica's rule is
// that every section looks exactly the same on both. Two hand-rolled copies is
// precisely how the marks came to exist in one place and not the other.
//
// The parent owns the fetching (one request for a whole strip, 0158) and the
// toggling; this only draws.
import type { PhotoReaction } from '../lib/photos';
import ReactionMark from './ReactionMarks';
import { MARKS } from '../lib/reactions';

export default function ThumbMarks({
  reactions,
  onToggle,
}: {
  reactions: PhotoReaction[];
  onToggle: (emoji: string) => void;
}) {
  return (
    <div className="thumb-marks">
      {MARKS.map((m) => {
        const r = reactions.find((x) => x.emoji === m.emoji);
        const n = r?.n ?? 0;
        return (
          <button
            key={m.emoji}
            className={`thumb-mark ${r?.mine ? 'mine' : ''} ${n ? 'has' : ''}`}
            title={r && n ? r.who.join(', ') : m.label}
            aria-label={m.label}
            aria-pressed={!!r?.mine}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(m.emoji);
            }}
          >
            <ReactionMark emoji={m.emoji} on={n > 0} size={15} />
            {n > 1 && <span className="reaction-n">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}
