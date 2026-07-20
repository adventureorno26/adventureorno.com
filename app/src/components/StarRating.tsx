import { StarIcon } from './Icons';

interface Props {
  value: number | null;
  onChange?: (n: number | null) => void;
  readOnly?: boolean;
  size?: number;
}

/** Interactive 1–5 star rating (modern SVG stars). Click a lit star again to clear. */
export default function StarRating({ value, onChange, readOnly, size = 20 }: Props) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <span className="star-rating">
      {stars.map((n) => {
        const on = value != null && n <= value;
        return (
          <button
            key={n}
            type="button"
            className={`star ${on ? 'on' : ''} ${readOnly ? 'ro' : ''}`}
            disabled={readOnly}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            onClick={() => onChange?.(value === n ? null : n)}
          >
            <StarIcon size={size} filled={on} />
          </button>
        );
      })}
    </span>
  );
}
