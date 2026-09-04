"use client";

import { Box, CircularProgress, useTheme } from "@mui/material";
import type { RecitationReading } from "@/frontend/graphql/generated/gql/graphql";
import { RecitationCard } from "@/frontend/views/auth/register";
import type { RecitationLabels } from "@/shared/locale/types/recitation";

/**
 * RecitationSelector — premium card-based Qira'ah selector.
 *
 * Replaces the basic MUI Select dropdown with a responsive grid of selectable
 * cards. Each card shows the reading name (translated), a short description
 * (region/context), and a radio indicator. The first reading (Hafs `an Asim)
 * gets a "Most popular" badge.
 *
 * Design (MUI v9 + theme palette):
 *  - Card grid: 2 columns on desktop, 1 on mobile.
 *  - Selected card: primary-color border + primaryContainer background.
 *  - Hover: subtle elevation + border tint.
 *  - Radio icon: RadioChecked (primary) / RadioButtonUnchecked (muted).
 *  - MenuBookOutlined icon on each card header.
 *  - "Most popular" chip on Hafs (secondary color).
 *  - Loading state: centered CircularProgress.
 *  - All colors from `theme.palette.*` — no hardcoded hex.
 *
 * Cards are composed from `RecitationCard` + `RecitationCardContent` in this
 * directory. All labels come from `RecitationLabels`; MUI v9 `sx` only.
 */
export interface RecitationSelectorProps {
  /** Currently selected reading (or "" for none). */
  readonly value: RecitationReading | "";
  /** Called when the user selects a reading. */
  readonly onChange: (value: RecitationReading) => void;
  /** Translated labels for the recitation namespace. */
  readonly labels: RecitationLabels;
  /** Available readings from the GraphQL catalog query. */
  readonly options: ReadonlyArray<RecitationReading>;
  /** Whether the catalog query is loading. */
  readonly loading: boolean;
}

export function RecitationSelector({ value, onChange, labels, options, loading }: RecitationSelectorProps) {
  const theme = useTheme();

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  return (
    <Box
      aria-label={labels.selectTitle}
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
        alignItems: "stretch",
        gap: 1.5,
        // Scroll cap only once the grid goes 2-column: in the single-column
        // mobile stack the cap clips the last card (page scrolls instead).
        maxHeight: { xs: "none", sm: 360 },
        overflowY: { xs: "visible", sm: "auto" },
        pr: 1,
        // Custom scrollbar for the grid
        "&::-webkit-scrollbar": { width: 6 },
        "&::-webkit-scrollbar-thumb": {
          backgroundColor: theme.palette.divider,
          borderRadius: 3,
        },
        "&::-webkit-scrollbar-track": { background: "transparent" },
      }}
    >
      {options.map((reading, index) => (
        <RecitationCard
          key={reading}
          reading={reading}
          isSelected={value === reading}
          isPopular={index === 0}
          labels={labels}
          onSelect={onChange}
        />
      ))}
    </Box>
  );
}
