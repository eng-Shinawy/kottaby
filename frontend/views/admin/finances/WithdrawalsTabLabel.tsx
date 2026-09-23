"use client";

/**
 * WithdrawalsTabLabel — the withdrawals tab's label node: the tab caption
 * wrapped in a LIVE pending-count Badge. Extracted from
 * {@link AdminFinancesContainer} (the oxlint max-lines split — the
 * container keeps the URL wiring and the panels; the tab chrome lives
 * here) so the tab strip and the badge recipe evolve together.
 *
 * The badge is invisible at zero pending (MUI keeps the DOM node but the
 * `invisible` class hides it) and carries the namespace's full count
 * sentence as its native title — the number alone is language-neutral,
 * the hover text is the localized sentence.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors.
 */

import { Badge } from "@mui/material";
import type { ReactNode } from "react";

/** The badge sizing (compact pill, not the default oversized counter). */
const BADGE_SX = {
  "& .MuiBadge-badge": {
    fontWeight: 700,
    fontSize: 11,
    minWidth: 18,
    height: 18,
    paddingInline: 4,
  },
} as const;

/** The withdrawals tab caption + its live pending-count badge. */
export function WithdrawalsTabLabel({
  label,
  count,
  countTitle,
}: Readonly<{
  /** The localized tab caption. */
  readonly label: string;
  /** The pending-queue depth (0 hides the badge). */
  readonly count: number;
  /** The localized count sentence (native title tooltip). */
  readonly countTitle: string;
}>): ReactNode {
  return (
    <Badge badgeContent={count} color="warning" invisible={count === 0} title={countTitle} sx={BADGE_SX}>
      {label}
    </Badge>
  );
}
