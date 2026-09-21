"use client";

import type { SchoolOutlined as SchoolIcon } from "@mui/icons-material";
import { Box, Card, CardContent, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

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
 */
export function DashboardStatCard({ stat, selected = false }: Readonly<DashboardStatCardProps>): ReactNode {
  const { label, value, Icon, loading = false, loadingLabel, unavailable = false } = stat;
  const ariaLabel = loading ? `${label}: ${loadingLabel ?? "…"}` : `${label}: ${value}`;

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
              height: 44,
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
    </Card>
  );
}
