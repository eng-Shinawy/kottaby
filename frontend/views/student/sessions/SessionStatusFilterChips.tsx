"use client";

import { Box, ToggleButton, ToggleButtonGroup } from "@mui/material";
import type { ReactNode } from "react";
import { SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { Sessions, useAppTranslation } from "@/shared/locale";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * SessionStatusFilterChips — the student/teacher sessions list status filter.
 *
 * A single-select (`exclusive`) MUI `ToggleButtonGroup` row rendering the
 * "all statuses" token plus ALL FIVE `SessionStatus` values (DEV3-005 made
 * `Disputed` reachable on the participant surfaces — a row sits in the
 * disputed state until an admin resolves it, so its filter chip is offered
 * like any other lifecycle status).
 *
 * Token-space design (oxlint `no-unsafe-enum-comparison`): the component
 * works exclusively on plain string TOKENS — the "all" token plus the enum
 * member strings as filter tokens — mapped through `Record<string, string>`
 * lookup tables (label key + filter value). NO `switch` over enum members
 * and NO direct `enum === enum` comparisons appear anywhere.
 *
 * Accessibility: every toggle carries an explicit `aria-pressed` (true on
 * the active token) and the group is a labelled toolbar row; mobile hit
 * areas keep the ≥44px touch target (`minHeight` collapses on `sm+`).
 *
 * MUI v9 discipline: `sx`-only styling, colors resolve through theme-palette
 * callbacks (no hex, no string palette access), `*Outlined` icons only (none
 * needed here), RTL-safe logical composition.
 */

/** Token that clears the status filter (renders `SessionsLabels.statusFilterAll`). */
const ALL_TOKEN = "all";

/**
 * Chip order — "all" first, then the lifecycle statuses (DEV3-005 adds the
 * `Disputed` chip — reachable since the dispute surface landed).
 * Plain string tokens, never enum-typed comparisons.
 */
const FILTER_TOKENS: readonly string[] = [
  ALL_TOKEN,
  SessionStatus.Scheduled,
  SessionStatus.Started,
  SessionStatus.Completed,
  SessionStatus.Cancelled,
  SessionStatus.Disputed,
];

/** Token → `SessionStatus | null` filter value (`null` = no filtering). */
const FILTER_STATUS_BY_TOKEN: Record<string, SessionStatus | null> = {
  [ALL_TOKEN]: null,
  [SessionStatus.Scheduled]: SessionStatus.Scheduled,
  [SessionStatus.Started]: SessionStatus.Started,
  [SessionStatus.Completed]: SessionStatus.Completed,
  [SessionStatus.Cancelled]: SessionStatus.Cancelled,
  [SessionStatus.Disputed]: SessionStatus.Disputed,
};

/**
 * Filter-chip label-key union — the NARROW slice of `SessionsLabels` the
 * toolbar may render. The namespace also carries template-function labels
 * (e.g. `adminDisputesCountLine`) that are NOT renderable as a toggle
 * label, so the lookup table is keyed by this Pick-union, never the full
 * `keyof SessionsLabels`.
 */
type FilterChipLabelKey = keyof Pick<
  SessionsLabels,
  "statusFilterAll" | "statusScheduled" | "statusStarted" | "statusCompleted" | "statusCancelled" | "statusDisputed"
>;

/** Token → compile-time label key into `SessionsLabels` (property access only). */
const FILTER_LABEL_KEY_BY_TOKEN: Record<string, FilterChipLabelKey> = {
  [ALL_TOKEN]: "statusFilterAll",
  [SessionStatus.Scheduled]: "statusScheduled",
  [SessionStatus.Started]: "statusStarted",
  [SessionStatus.Completed]: "statusCompleted",
  [SessionStatus.Cancelled]: "statusCancelled",
  [SessionStatus.Disputed]: "statusDisputed",
};

interface SessionStatusFilterChipsProps {
  /**
   * Active filter value. `null` renders the "all" token selected; any
   * `SessionStatus` member selects the matching status chip.
   */
  readonly value: SessionStatus | null;
  /** Status-change callback (`null` = the caller must clear its filter). */
  readonly onChange: (status: SessionStatus | null) => void;
}

/**
 * Resolves the selected toggle's token for a filter value: enum members map
 * to themselves as tokens; `null` maps to the "all" token.
 */
function tokenForFilterValue(value: SessionStatus | null): string {
  if (value === null) return ALL_TOKEN;
  // The token space REUSES the enum member strings — a Record lookup (not an
  // enum comparison) keeps the unsafe-enum lint table satisfied.
  return FILTER_STATUS_BY_TOKEN[value] ?? ALL_TOKEN;
}

/**
 * Single-select chip row for the sessions status filter.
 *
 * The row docks into a STICKY bar: the dashboard AppBar is sticky at `top: 0`
 * with `minHeight` 56/64 (xs→sm), so the bar pins right under it and the
 * filter stays reachable while the list scrolls (`zIndex.appBar - 1` keeps
 * it beneath the bar). A static hairline bottom edge echoes the AppBar's
 * border without any scroll listener (the scroll-conditional border/shadow
 * variant was declined — static styling only).
 */
export function SessionStatusFilterChips({ value, onChange }: Readonly<SessionStatusFilterChipsProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const activeToken = tokenForFilterValue(value);

  return (
    <Box
      sx={theme => ({
        position: "sticky",
        top: { xs: 56, sm: 64 },
        zIndex: theme.zIndex.appBar - 1,
        bgcolor: theme.palette.surfaceContainer,
        backdropFilter: "blur(8px)",
        borderRadius: 2,
        py: 1,
        px: { xs: 0.5, sm: 1 },
        borderBottom: "1px solid",
        borderBottomColor: theme.palette.outlineVariant,
      })}
    >
      <ToggleButtonGroup
        exclusive
        value={activeToken}
        onChange={(_, token) => {
          if (typeof token !== "string") return;
          onChange(FILTER_STATUS_BY_TOKEN[token] ?? null);
        }}
        sx={{ flexWrap: "wrap", gap: 1 }}
      >
        {FILTER_TOKENS.map(token => {
          const labelKey = FILTER_LABEL_KEY_BY_TOKEN[token];
          const label = labelKey in t ? t[labelKey] : token;
          return (
            <ToggleButton
              key={token}
              value={token}
              aria-pressed={token === activeToken}
              sx={theme => ({
                minHeight: { xs: 44, sm: 36 },
                px: 2.5,
                borderRadius: 999,
                textTransform: "none",
                fontWeight: 600,
                borderColor: theme.palette.outlineVariant,
                // Separated-pill restoration — MUI's grouped (connected) styling
                // zeroes the inner corners, dissolves one border edge to
                // transparent and pulls siblings 1px together. This row is a
                // GAPPED pill group (flexWrap + gap 1), so every grouped slot
                // (`*Button` slot classes, v6+) restores the full pill outline
                // in BOTH directions (the grouped rules carry physical
                // properties that misplace in RTL).
                "&.MuiToggleButtonGroup-firstButton, &.MuiToggleButtonGroup-middleButton, &.MuiToggleButtonGroup-lastButton":
                  {
                    borderRadius: 999,
                    border: "1px solid",
                    borderColor: theme.palette.outlineVariant,
                    marginLeft: 0,
                    marginRight: 0,
                  },
                "&.Mui-selected": {
                  bgcolor: theme.palette.primaryContainer,
                  color: theme.palette.onPrimaryContainer,
                  "&:hover": {
                    bgcolor: theme.palette.primaryContainer,
                  },
                },
              })}
            >
              {label}
            </ToggleButton>
          );
        })}
      </ToggleButtonGroup>
    </Box>
  );
}
