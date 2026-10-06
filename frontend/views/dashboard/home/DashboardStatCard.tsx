"use client";

import type { SchoolOutlined as SchoolIcon } from "@mui/icons-material";
import { Box, ButtonBase, Card, CardContent, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

/** Stat card shape — the dashboard's role-aware stat strip. */
export interface DashboardStat {
  readonly label: string;
  readonly value: string;
  readonly Icon: typeof SchoolIcon;
  /**
   * True while the stat's underlying query is still resolving — the value
   * slot renders an inline skeleton and the card announces `aria-busy`.
   * The view maps the hook's empty-value loading sentinel to this flag.
   */
  readonly loading?: boolean;
  /**
   * Localized "loading" announcement composed into the card's accessible
   * name while `loading` is true ("<label>: Loading statistics…").
   */
  readonly loadingLabel?: string;
  /**
   * True when the stat's query FAILED — the value renders as the muted
   * localized unavailable marker (silent degradation; the errorLink owns
   * error messaging).
   */
  readonly unavailable?: boolean;
}

interface DashboardStatCardProps {
  readonly stat: DashboardStat;
  /**
   * Selection ring (the student homework strip's filter toggle): a
   * primary border + container tint marking the ACTIVE bucket. Purely
   * visual — the wrapping button owns the `aria-pressed` semantics.
   */
  readonly selected?: boolean;
  /**
   * Interactive seam — when present, the card renders as ONE large
   * button-shaped surface (the STUDENT balance card opens its prepaid
   * credits breakdown popover through it). Purely additive: the value
   * states, the hover lift, and the card's own accessible-name/`status`
   * semantics are untouched, and an inner MUI `ButtonBase` (a native
   * button element — pointer, Enter and Space activation, the shared
   * `focusVisibleRingSx` keyboard ring, `aria-haspopup="dialog"` since the
   * activation opens a popover) wraps the card body. The card body stays
   * well past the 44px touch minimum. The handler receives the activated
   * element itself (the caller's popover anchor — read from the event, so
   * no caller-side ref has to be dereferenced during render). Absent for
   * every other stat card — those stay static.
   */
  readonly onActivate?: (anchor: HTMLElement) => void;
  /**
   * Localized affordance hint composed into the interactive surface's
   * accessible name ("<card name> — <hint>", the hint naming the popover
   * the activation opens). Only read when `onActivate` is set; the static
   * arm never renders a button, so it never needs one.
   */
  readonly popoverAriaLabel?: string;
}

/**
 * The card body — label + value slot (skeleton while loading, muted dash
 * while unavailable) and the tinted icon chip. Extracted so the static and
 * interactive arms render the IDENTICAL body (the icon chip's
 * `.MuiCard-root:hover &` selector keeps working in both).
 */
function StatCardBody({ stat, selected }: Readonly<{ stat: DashboardStat; selected: boolean }>): ReactNode {
  const { label, value, Icon, loading = false, unavailable = false } = stat;
  return (
    <CardContent sx={{ p: 3 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="caption"
            sx={theme => ({
              color: theme.palette.text.secondary,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
            })}
          >
            {label}
          </Typography>
          <Typography
            variant="h4"
            aria-busy={loading}
            sx={theme => ({
              fontWeight: 700,
              color: unavailable ? theme.palette.text.disabled : theme.palette.text.primary,
              mt: 0.5,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.2,
              overflowWrap: "anywhere",
            })}
          >
            {loading ? <Skeleton variant="text" width={64} sx={{ fontSize: "inherit" }} /> : value}
          </Typography>
        </Box>
        <Box
          sx={theme => ({
            width: 44,
            minHeight: 54,
            borderRadius: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            bgcolor: selected ? theme.palette.primary.main : theme.palette.primaryContainer,
            color: selected ? theme.palette.primary.contrastText : theme.palette.onPrimaryContainer,
            transition: theme.transitions.create(["background-color", "color"], {
              duration: theme.transitions.duration.short,
              easing: theme.transitions.easing.easeOut,
            }),
            ".MuiCard-root:hover &": {
              bgcolor: theme.palette.primary.main,
              color: theme.palette.primary.contrastText,
            },
          })}
        >
          <Icon fontSize="medium" />
        </Box>
      </Stack>
    </CardContent>
  );
}

/**
 * Renders a single live stat card.
 *
 * Value states:
 *  - resolved → the value in tabular numerals (stable digit widths stop
 *    live counts from jittering horizontally as they change).
 *  - loading (`stat.loading`) → an inline skeleton bar with the card
 *    marked `aria-busy`, so the layout never jumps between fetch and
 *    first paint.
 *  - unavailable (`stat.unavailable`) → a muted em dash — silent
 *    degradation for a failed stat query; the errorLink surface owns
 *    error messaging.
 *
 * Hover lift: a soft shadow + 2px raise gives the previously static cards
 * interactive feedback (pure `sx` transition — no motion library). The
 * icon chip tints to the primary surface on hover to echo the lift.
 *
 * Interactive arm (`onActivate` set): the body is wrapped in a native
 * button element (MUI `ButtonBase`) whose accessible name composes the
 * card's own name with the caller's affordance hint, so a screen reader
 * hears both what the card shows AND what activation reveals. The card
 * root keeps its name/`status` semantics untouched — the button is purely
 * additive.
 */
export function DashboardStatCard({
  stat,
  selected = false,
  onActivate,
  popoverAriaLabel,
}: Readonly<DashboardStatCardProps>): ReactNode {
  const { label, value, loading = false, loadingLabel } = stat;
  const ariaLabel = loading ? `${label}: ${loadingLabel ?? "…"}` : `${label}: ${value}`;
  const body = <StatCardBody stat={stat} selected={selected} />;

  return (
    <Card
      elevation={0}
      // While loading, the card doubles as a `status` live region:
      // `aria-busy` alone announces nothing, so the localized loading
      // label only reaches screen readers through the role's implicit
      // live semantics + this accessible name.
      role={loading ? "status" : undefined}
      aria-label={ariaLabel}
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: selected ? theme.palette.primary.main : theme.palette.outlineVariant,
        bgcolor: selected ? theme.palette.primaryContainer : theme.palette.surfaceContainerLow,
        transition: theme.transitions.create(["box-shadow", "transform", "border-color", "background-color"], {
          duration: theme.transitions.duration.short,
          easing: theme.transitions.easing.easeOut,
        }),
        "&:hover": {
          boxShadow: theme.shadows[4],
          transform: "translateY(-2px)",
          borderColor: selected ? theme.palette.primary.main : theme.palette.outline,
        },
      })}
    >
      {onActivate === undefined ? (
        body
      ) : (
        <ButtonBase
          component="button"
          type="button"
          onClick={event => onActivate(event.currentTarget)}
          aria-haspopup="dialog"
          aria-label={popoverAriaLabel === undefined ? ariaLabel : `${ariaLabel} — ${popoverAriaLabel}`}
          sx={{
            width: "100%",
            display: "block",
            textAlign: "start",
            borderRadius: 3,
            cursor: "pointer",
            ...focusVisibleRingSx,
          }}
        >
          {body}
        </ButtonBase>
      )}
    </Card>
  );
}
