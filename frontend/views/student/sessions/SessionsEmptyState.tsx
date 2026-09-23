"use client";

import type { SvgIconComponent } from "@mui/icons-material";
import { Avatar, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/**
 * SessionsEmptyState — the shared list-empty surface for BOTH sessions
 * containers (the student/teacher twin of `SessionRow` +
 * `SessionStatusFilterChips` living in this folder).
 *
 * One centered stack: a tinted icon medallion (`Avatar variant="rounded"`
 * on the `secondaryContainer`/`onSecondaryContainer` pair, ringed by the
 * outline tone and a whisper of elevation so it lifts off both themes'
 * canvases), the localized heading and the explanatory body. The caller
 * picks the vocabulary and the icon so the SAME primitive renders both
 * variants:
 *  - generic empty (`studentEmpty*` / `teacherEmpty*`) — calendar/school
 *    `*Outlined` icon;
 *  - FILTERED empty (`filteredEmpty*`) — `FilterListOutlined`, signalling
 *    that the filter (not the list) is why the page is bare.
 *
 * The stack's entrance is a small rise+fade — `prefers-reduced-motion`-
 * guarded: the keyframes exist regardless, the animation only runs when
 * motion is welcome, so the resting composition is identical either way.
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
  /** Outlined icon filling the tinted medallion (per surface + variant). */
  readonly icon: SvgIconComponent;
  /** Localized heading — generic or filtered-empty copy. */
  readonly title: string;
  /** Localized explanatory body — generic or filtered-empty copy. */
  readonly body: string;
}

/** Centered tinted-icon empty state for the sessions lists. */
export function SessionsEmptyState({ testId, icon: Icon, title, body }: Readonly<SessionsEmptyStateProps>): ReactNode {
  return (
    <Stack
      data-testid={testId}
      sx={{
        alignItems: "center",
        justifyContent: "center",
        gap: 1.5,
        py: { xs: 8, sm: 12 },
        // Fill + center within the content region on tall viewports so the
        // composition sits in the vertical middle instead of hugging the top
        // above a dead band. Viewport-relative (svh) — no magic px constants.
        minHeight: { xs: "55svh", sm: "62svh" },
        textAlign: "center",
        // Registered globally, referenced under the motion gate below — the
        // resting state is identical with or without animation support.
        "@keyframes sessionsEmptyEnter": {
          from: { opacity: 0, transform: "translateY(12px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
        "@media (prefers-reduced-motion: no-preference)": {
          animation: "sessionsEmptyEnter 420ms ease-out both",
        },
      }}
    >
      <Avatar
        variant="rounded"
        sx={theme => ({
          bgcolor: theme.palette.secondaryContainer,
          color: theme.palette.onSecondaryContainer,
          width: 72,
          height: 72,
          borderRadius: 4,
          border: "1px solid",
          borderColor: theme.palette.outlineVariant,
          boxShadow: theme.shadows[1],
          mb: 1,
        })}
      >
        <Icon sx={{ fontSize: 34, display: "block" }} />
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
