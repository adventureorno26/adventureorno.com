// The two reactions, drawn in the "sticker" style Erica picked: an outline while
// nobody has reacted, and a solid colour with a light keyline and a coloured shadow
// once someone has.
//
// These ARE the feature (Erica asked for reaction marks), so they are the intended
// exception to the no-icons rule.
import { PATHS, hueFor } from '../lib/reactions';

/**
 * One reaction mark. `on` is whether anyone has reacted with it — filled and
 * coloured — versus the plain outline.
 */
export default function ReactionMark({
  emoji,
  on,
  size = 18,
}: {
  emoji: string;
  on: boolean;
  size?: number;
}) {
  const d = PATHS[emoji];
  // Anything we don't draw (an older reaction) still shows as its character.
  if (!d) return <span className="reaction-emoji">{emoji}</span>;

  return (
    <svg
      className={`rmark ${on ? 'on' : ''}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ '--hue': hueFor(emoji) } as React.CSSProperties}
    >
      <path className="rmark-fill" d={d} />
      <path className="rmark-line" d={d} />
    </svg>
  );
}
