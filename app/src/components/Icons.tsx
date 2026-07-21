// Cohesive modern icon set — clean 24px line/fill glyphs, rounded caps.

interface IconProps {
  size?: number;
}

function line(size: number, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function SearchIcon({ size = 16 }: IconProps) {
  return line(
    size,
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.6" y2="16.6" />
    </>,
  );
}

// Slim modern map pin (outline), lighter than a solid teardrop.
export function PinIcon({ size = 16 }: IconProps) {
  return line(
    size,
    <>
      <path d="M12 21c4.5-4.2 7-7.6 7-11a7 7 0 1 0-14 0c0 3.4 2.5 6.8 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>,
  );
}

// Bucket List motif: a clean rounded bookmark.
export function BucketIcon({ size = 16 }: IconProps) {
  return line(
    size,
    <path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v14.4a.6.6 0 0 1-.94.5L12 16.2l-5.56 3.7A.6.6 0 0 1 5.5 19.4V5A1.5 1.5 0 0 1 7 3.5Z" />,
  );
}

// Modern star with softly rounded points (used by ratings).
export function StarIcon({ size = 18, filled = true }: IconProps & { filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.6c.28 0 .53.16.65.42l2.02 4.36 4.76.6c.6.08.85.82.4 1.23l-3.5 3.25.9 4.7c.11.6-.52 1.05-1.05.76L12 16.98l-4.23 2.3c-.53.29-1.16-.16-1.05-.76l.9-4.7-3.5-3.25c-.45-.41-.2-1.15.4-1.23l4.76-.6 2.02-4.36c.12-.26.37-.42.65-.42Z" />
    </svg>
  );
}
