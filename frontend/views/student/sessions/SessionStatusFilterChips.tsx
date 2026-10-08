"use client";

import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import type { ReactNode } from "react";
import { SessionStickyBar } from "@/frontend/components/ui/sessionList";
import { SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { Sessions, useAppTranslation } from "@/shared/locale";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * SessionStatusFilterChips — the student/teacher sessions list status filter.
 *
 * A single-select (`exclusive`) MUI `ToggleButtonGroup` row rendering the
 * "all statuses" token plus ALL FIVE `SessionStatus` values (the dispute surface made
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
 * Chip order — "all" first, then the lifecycle statuses (the `Disputed` chip has been
 * reachable since the dispute surface landed).
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
 * The row docks into the shared sticky bar (`SessionStickyBar`) pinned just
 * under the dashboard AppBar, so the filter stays reachable while the list
 * scrolls (static styling only — no scroll-conditional border/shadow).
 */
export function SessionStatusFilterChips({ value, onChange }: Readonly<SessionStatusFilterChipsProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const activeToken = tokenForFilterValue(value);

  return (
    <SessionStickyBar>
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
                // Tighter inline padding past mobile keeps all six pills on
                // ONE line at tablet width (visual-loop round-2 finding: the
                // sixth chip wrapped to a ragged second row at 834px).
                px: { xs: 2.5, sm: 2 },
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
                  // Dark-scheme state legibility: the primaryContainer fill
                  // (#1B3358) measures only ~1.34:1 against the paper bar it
                  // sits on — the selected pill reads identical to the
                  // unselected ones. The filled primary tone carries the
                  // active state clearly in the dark scheme (white-on-main
                  // stays 5.4:1); light mode keeps the container pair.
                  ...theme.applyStyles("dark", {
                    bgcolor: "var(--mui-palette-primary-main)",
                    color: "var(--mui-palette-primary-contrastText)",
                    "&:hover": {
                      bgcolor: "var(--mui-palette-primary-main)",
                    },
                  }),
                },
              })}
            >
              {label}
            </ToggleButton>
          );
        })}
      </ToggleButtonGroup>
    </SessionStickyBar>
  );
}
