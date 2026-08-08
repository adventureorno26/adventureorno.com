import { useEffect, useState } from 'react';
import { fetchActivityReactions, toggleActivityReaction, type ActivityReaction } from '../lib/data';
import ReactionMark from './ReactionMarks';
import { MARKS } from '../lib/reactions';

/**
 * The same two reaction marks as photos, on an activity — so reacting to a run
 * works exactly like reacting to a picture of one.
 */
export default function ActivityReactions({ activityId }: { activityId: string }) {
  const [rows, setRows] = useState<ActivityReaction[]>([]);

  useEffect(() => {
    let active = true;
    fetchActivityReactions(activityId)
      .then((r) => active && setRows(r))
      .catch(() => active && setRows([]));
    return () => {
      active = false;
    };
  }, [activityId]);

  async function toggle(emoji: string) {
    await toggleActivityReaction(activityId, emoji).catch(() => undefined);
    setRows(await fetchActivityReactions(activityId).catch(() => []));
  }

  return (
    <div className="photo-reactions act-reactions">
      {MARKS.map((m) => {
        const r = rows.find((x) => x.emoji === m.emoji);
        const n = r?.n ?? 0;
        return (
          <button
            key={m.emoji}
            className={`reaction-chip ${r?.mine ? 'mine' : ''} ${n ? 'has' : ''}`}
            title={n ? r!.who.join(', ') : m.label}
            aria-label={m.label}
            aria-pressed={!!r?.mine}
            onClick={(e) => {
              e.stopPropagation();
              void toggle(m.emoji);
            }}
          >
            <ReactionMark emoji={m.emoji} on={n > 0} />
            {n > 0 && <span className="reaction-n">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}
