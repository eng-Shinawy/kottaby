"use client";

/**
 * TeacherPendingRubricBanner — the sessions page's action-needed strip for
 * the evaluator's outstanding rubric submissions. One control, two jobs:
 * it SUMMARIZES (the honest pending count via the locale's plural rules)
 * and it TOGGLES (pressing activates the client-side pending-only filter
 * over the settled rows — see `filterSessionsAwaitingRubric`). The count
 * derives from the SAME pending id set that gates the rows' submit CTA and
 * pill, so banner, pill, and affordance can never drift apart.
 *
 * `aria-pressed` carries the toggle semantics for assistive tech; the
 * active state re-tints the surface through theme tokens (primary
 * container family) so the pressed state is visible, not just announced —
 * and the state change is echoed twice more in the styling: the sliders
 * icon tilts a quarter turn (filter engaged) and a trailing check fades
 * in. Both echoes are `prefers-reduced-motion`-guarded — the transform /
 * opacity transitions only exist under `no-preference` while the end
 * states apply either way — and both stay `aria-hidden` decoration (the
 * pressed state is already announced; the echoes must not double-speak).
 *
 * MUI v9 discipline: `sx`-only styling, palette callbacks only, RTL-safe
 * logical composition, and the shared keyboard focus ring.
 */

import { CheckOutlined, TuneOutlined } from "@mui/icons-material";
import { ButtonBase, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { Sessions, useAppTranslation } from "@/shared/locale";

interface TeacherPendingRubricBannerProps {
  /** The honest pending-submission count (the pending read's id-set size). */
  readonly count: number;
  /** Whether the pending-only filter is currently active. */
  readonly active: boolean;
  /** Toggle intent — the container owns the filter state. */
  readonly onToggle: () => void;
}

/** The pending-rubric summary + filter toggle strip — see the module docblock. */
export function TeacherPendingRubricBanner({
  count,
  active,
  onToggle,
}: Readonly<TeacherPendingRubricBannerProps>): ReactNode {
  const t = useAppTranslation(Sessions);

  return (
    <ButtonBase
      component="button"
      type="button"
      aria-pressed={active}
      data-testid="teacher-pending-rubric-banner"
      onClick={onToggle}
      sx={theme => ({
        width: "100%",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 2,
        px: 2,
        py: 1.5,
        borderRadius: 3,
        textAlign: "start",
        cursor: "pointer",
        border: "1px solid",
        borderColor: active ? theme.palette.primary.main : theme.palette.outlineVariant,
        bgcolor: active ? theme.palette.primaryContainer : theme.palette.surfaceContainerLowest,
        color: active ? theme.palette.onPrimaryContainer : theme.palette.text.primary,
        boxShadow: "none",
        transition: theme.transitions.create(["background-color", "border-color", "box-shadow"]),
        "&:hover": { boxShadow: theme.shadows[2] },
        ...focusVisibleRingSx,
      })}
    >
      <TuneOutlined
        sx={theme => ({
          p: 1,
          boxSizing: "content-box",
          borderRadius: "50%",
          fontSize: 20,
          bgcolor: active ? theme.palette.surfaceContainerLowest : theme.palette.primaryContainer,
          color: active ? theme.palette.onSurfaceVariant : theme.palette.onPrimaryContainer,
          flexShrink: 0,
          // A quarter turn reads "the filter engaged" — the end state applies
          // regardless, the glide only when motion is welcome.
          transform: active ? "rotate(90deg)" : "rotate(0deg)",
          "@media (prefers-reduced-motion: no-preference)": {
            transition: theme.transitions.create(["transform"]),
          },
        })}
      />
      <Stack sx={{ gap: 0.25, alignItems: "flex-start", minWidth: 0, flex: 1 }}>
        <Typography component="span" sx={{ fontWeight: 700, fontSize: 15 }}>
          {t.pendingRubricCountLine(count)}
        </Typography>
        <Typography component="span" variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {active ? t.pendingRubricFilterActiveCta : t.pendingRubricFilterCta}
        </Typography>
      </Stack>
      <CheckOutlined
        aria-hidden
        sx={theme => ({
          fontSize: 20,
          color: theme.palette.primary.main,
          flexShrink: 0,
          // Occupies its layout slot in both states (no shift on toggle);
          // the fade is the only motion, and only when motion is welcome.
          opacity: active ? 1 : 0,
          "@media (prefers-reduced-motion: no-preference)": {
            transition: theme.transitions.create(["opacity"], { duration: theme.transitions.duration.shorter }),
          },
        })}
      />
    </ButtonBase>
  );
}
