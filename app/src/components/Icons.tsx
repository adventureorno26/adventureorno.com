// Small inline SVG icons (inherit currentColor) — replaces the dated emoji.

export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  );
}

export function PinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C8.1 2 5 5.05 5 8.86c0 4.9 5.7 11.15 6.28 11.78a1 1 0 0 0 1.44 0C13.3 20 19 13.76 19 8.86 19 5.05 15.9 2 12 2Zm0 9.36a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" />
    </svg>
  );
}

// A bookmark/flag — the Bucket List motif, used on the map button + wishlist pins.
export function BucketIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 3a2 2 0 0 0-2 2v15.2a.8.8 0 0 0 1.26.65L12 16l6.74 4.85A.8.8 0 0 0 20 20.2V5a2 2 0 0 0-2-2H6Z" />
    </svg>
  );
}
