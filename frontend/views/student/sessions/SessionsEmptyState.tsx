"use client";

import type { SvgIconComponent } from "@mui/icons-material";
import { Avatar, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/**
 * SessionsEmptyState — the shared list-empty surface for BOTH sessions
 * containers (the student/teacher twin of `SessionRow` +
 * `SessionStatusFilterChips` living in this folder).
 *
 * One centered stack: a tinted icon circle (`Avatar variant="rounded"` on
 * the `secondaryContainer`/`onSecondaryContainer` pair), the localized
 * heading and the explanatory body. The caller picks the vocabulary and the
 * icon so the SAME primitive renders both variants:
 *  - generic empty (`studentEmpty*` / `teacherEmpty*`) — calendar/school
 *    `*Outlined` icon;
 *  - FILTERED empty (`filteredEmpty*`) — `FilterListOutlined`, signalling
 *    that the filter (not the list) is why the page is bare.
 *
 * The containers keep their OWN `data-testid` (`student-sessions-empty` /
 * `teacher-sessions-empty`) so the component suites stay byte-stable.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors through
 * callbacks (no hex, no string palette access), `*Outlined` icons only,
 * RTL-safe logical composition.
 */

interface SessionsEmptyStateProps {
  /** The container-owned empty-state testid (suite anchor). */
  readonly testId: string;
  /** Outlined icon filling the tinted circle (per surface + variant). */
  readonly icon: SvgIconComponent;
  /** Localized heading — generic or filtered-empty copy. */
  readonly title: string;
  /** Localized explanatory body — generic or filtered-empty copy. */
  readonly body: string;
}

/** Centered tinted-icon empty state for the sessions lists. */
export function SessionsEmptyState({ testId, icon: Icon, title, body }: Readonly<SessionsEmptyStateProps>): ReactNode {
  return (
    <Stack data-testid={testId} sx={{ alignItems: "center", gap: 2, py: { xs: 8, sm: 12 }, textAlign: "center" }}>
      <Avatar
        variant="rounded"
        sx={theme => ({
          bgcolor: theme.palette.secondaryContainer,
          color: theme.palette.onSecondaryContainer,
          width: 56,
          height: 56,
          borderRadius: 3,
        })}
      >
        <Icon sx={{ fontSize: 28 }} />
      </Avatar>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 420 })}>
        {body}
      </Typography>
    </Stack>
  );
}
