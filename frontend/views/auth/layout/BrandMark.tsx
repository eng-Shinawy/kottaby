/** Brand mark — an inline SVG monogram (open book + crescent) in copper. */
export function BrandMark({ size = 40 }: { readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      {/* Outer circle (copper ring) */}
      <circle cx="24" cy="24" r="22" stroke="var(--mui-palette-secondary-light)" strokeWidth="1.5" opacity="0.55" />
      {/* Open book pages */}
      <path
        d="M12 16c4-2 8-2 12 0 4-2 8-2 12 0v18c-4-2-8-2-12 0-4-2-8-2-12 0V16z"
        fill="var(--mui-palette-secondary-light)"
        opacity="0.95"
      />
      {/* Book spine */}
      <path d="M24 16v18" stroke="var(--mui-palette-primary-dark)" strokeWidth="1.5" />
      {/* Crescent accent (top-right) */}
      <path d="M34 12a4 4 0 1 1-3.5 6 3 3 0 1 0 3.5-6z" fill="var(--mui-palette-onPrimary)" opacity="0.9" />
    </svg>
  );
}

/** Large decorative book + 8-pointed-star (khatam) motif for the brand panel. */
export function BookMotif() {
  return (
    <svg
      width="84"
      height="84"
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ opacity: 0.95 }}
    >
      {/* Geometric 8-pointed star (khatam) — two overlapping squares */}
      <rect
        x="20"
        y="20"
        width="56"
        height="56"
        stroke="var(--mui-palette-secondary-light)"
        strokeWidth="1.5"
        opacity="0.7"
        transform="rotate(45 48 48)"
      />
      <rect
        x="20"
        y="20"
        width="56"
        height="56"
        stroke="var(--mui-palette-secondary-light)"
        strokeWidth="1.5"
        opacity="0.7"
      />
      {/* Central book icon */}
      <path
        d="M24 36c8-4 16-4 24 0 8-4 16-4 24 0v32c-8-4-16-4-24 0-8-4-16-4-24 0V36z"
        fill="var(--mui-palette-secondary-main)"
        opacity="0.9"
      />
      <path d="M48 36v32" stroke="var(--mui-palette-primary-dark)" strokeWidth="2" />
      {/* Decorative dots */}
      <circle cx="48" cy="20" r="3" fill="var(--mui-palette-secondary-light)" />
      <circle cx="48" cy="76" r="3" fill="var(--mui-palette-secondary-light)" />
    </svg>
  );
}
