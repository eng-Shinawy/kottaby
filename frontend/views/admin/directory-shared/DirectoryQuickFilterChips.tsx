"use client";

/**
 * DirectoryQuickFilterChips — the horizontally scrollable quick-filter chip
 * strip shared by the admin directory surfaces (the users directory's
 * mobile-only role/governance strip and the applicant queue's all-breakpoint
 * status strip): a row of toggle chips mapping onto the SAME filter state
 * the toolbar's selects drive (composing with it, never replacing it).
 *
 * Chip anatomy (identical on every surface): selected chips render filled
 * `primary`/`onPrimary` at weight 600 with a same-color hover; unselected
 * chips are outlined with the `outlineVariant` border and `text.primary`
 * ink. Every chip is a ≥44px touch target with `flexShrink: 0` so the
 * scroll row never squeezes it. All colors resolve through theme-callback
 * sx; nothing is hardcoded — labels arrive precomposed from the caller.
 */

import { Box, Chip } from "@mui/material";
import type { ReactNode } from "react";

/** One toggle chip of the strip (label precomposed by the caller). */
export interface DirectoryQuickChip {
  /** Stable React key. */
  readonly key: string;
  /** The chip's label (compose counts into it upstream if needed). */
  readonly label: string;
  /** Whether the chip's filter value is currently selected. */
  readonly selected: boolean;
  /** Toggle handler (chips are single-select toggles). */
  readonly onSelect: () => void;
}

interface DirectoryQuickFilterChipsProps {
  readonly chips: readonly DirectoryQuickChip[];
  /** The strip's accessible name (omitted keeps the container unlabeled). */
  readonly ariaLabel?: string;
  /**
   * When the strip renders: `"always"` keeps it visible at every breakpoint
   * (the applicant queue); `"mobileOnly"` hides it at `md` and up, where the
   * desktop toolbar takes over (the users directory).
   */
  readonly display: "always" | "mobileOnly";
}

export function DirectoryQuickFilterChips({ chips, ariaLabel, display }: DirectoryQuickFilterChipsProps): ReactNode {
  return (
    <Box
      {...(ariaLabel === undefined ? {} : { "aria-label": ariaLabel })}
      sx={{
        display: display === "mobileOnly" ? { xs: "flex", md: "none" } : "flex",
        gap: 1,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        py: 0.5,
      }}
    >
      {chips.map(chip => (
        <Chip
          key={chip.key}
          label={chip.label}
          clickable
          onClick={chip.onSelect}
          variant={chip.selected ? "filled" : "outlined"}
          aria-pressed={chip.selected}
          sx={theme =>
            chip.selected
              ? {
                  flexShrink: 0,
                  minHeight: 44,
                  fontWeight: 600,
                  bgcolor: theme.palette.primary.main,
                  color: theme.palette.onPrimary,
                  "&:hover": { bgcolor: theme.palette.primary.main },
                }
              : {
                  flexShrink: 0,
                  minHeight: 44,
                  borderColor: theme.palette.outlineVariant,
                  color: theme.palette.text.primary,
                }
          }
        />
      ))}
    </Box>
  );
}
