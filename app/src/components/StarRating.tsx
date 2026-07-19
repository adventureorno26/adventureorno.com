interface Props {
  value: number | null;
  onChange?: (n: number | null) => void;
  readOnly?: boolean;
  size?: number;
}

/** Interactive 1–5 star rating. Click the same star again to clear it. */
export default function StarRating({ value, onChange, readOnly, size = 22 }: Props) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <span className="star-rating" style={{ fontSize: size }}>
      {stars.map((n) => (
        <button
          key={n}
          type="button"
          className={`star ${value != null && n <= value ? 'on' : ''} ${readOnly ? 'ro' : ''}`}
          disabled={readOnly}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={() => onChange?.(value === n ? null : n)}
        >
          {value != null && n <= value ? '★' : '☆'}
        </button>
      ))}
    </span>
  );
}
