// ─── Brand mark (inline SVG — open book + crescent, copper) ─────────

import type { ReactNode } from "react";

export function BrandMark({ size = 40 }: { readonly size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <circle cx="24" cy="24" r="22" stroke="var(--mui-palette-secondary-light)" strokeWidth="1.5" opacity="0.55" />
      <path
        d="M12 16c4-2 8-2 12 0 4-2 8-2 12 0v18c-4-2-8-2-12 0-4-2-8-2-12 0V16z"
        fill="var(--mui-palette-secondary-light)"
        opacity="0.95"
      />
      <path d="M24 16v18" stroke="var(--mui-palette-primary-dark)" strokeWidth="1.5" />
      <path d="M34 12a4 4 0 1 1-3.5 6 3 3 0 1 0 3.5-6z" fill="var(--mui-palette-onPrimary)" opacity="0.9" />
    </svg>
  );
}
