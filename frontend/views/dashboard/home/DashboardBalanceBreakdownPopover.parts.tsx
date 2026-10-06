"use client";

/**
 * DashboardBalanceBreakdownPopover.parts — the presentational SURFACE of
 * the student dashboard's balance-card popover (the `*.parts.tsx`
 * convention): the popover title, the FOUR prepaid lane chips (trial /
 * hifz / tajweed / reviews — a SIMPLER sibling of the request-dialog
 * credits strip: outlined chips, label + count, no selected-intent
 * emphasis, no error tint, no insufficiency caption), and ONE muted note
 * stating the honest scope (the caller's own prepaid credits;
 * subscription-covered sessions are out of view).
 *
 * Tri-state over `lanes` (mirrors the balance query exactly):
 *  - `undefined` → four skeleton chips carrying the lane testids (layout
 *    never jumps between fetch and first paint);
 *  - `null` → the chips are replaced by the dashboard namespace's muted
 *    `statUnavailable` marker (the read failed — silent degradation, the
 *    errorLink owns messaging);
 *  - resolved → the four outlined chips with their display counts
 *    (wire-null purchased lanes were already coalesced to 0 upstream).
 *
 * The note renders in EVERY state — it is scope truth, not status.
 * Pure presentational — no hooks, no GraphQL, no popover chrome: the
 * anchor/dismissal behavior lives in the sibling popover wrapper (MUI
 * Popover defaults), so this surface renders to static markup unchanged.
 * MUI v9 `sx`-only, theme-palette colors, RTL-safe (chips wrap, no
 * directional properties).
 */

import { Chip, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { SessionCreditLanes } from "@/frontend/views/dashboard/home/useDashboardStats.helpers";
import type { DashboardLabels } from "@/shared/locale/types/dashboard";

/** The four prepaid lanes the surface renders, in display order — trial first (the debit ladder's head), then the purchased lanes. */
const BALANCE_LANES = ["trial", "hifz", "tajweed", "reviews"] as const;

type BalanceLaneKey = (typeof BALANCE_LANES)[number];

/** Lane → the `DashboardLabels` key holding its localized label. */
const LANE_LABEL_KEY: Record<
  BalanceLaneKey,
  keyof Pick<DashboardLabels, "balanceLaneTrial" | "balanceLaneHifz" | "balanceLaneTajweed" | "balanceLaneReviews">
> = {
  trial: "balanceLaneTrial",
  hifz: "balanceLaneHifz",
  tajweed: "balanceLaneTajweed",
  reviews: "balanceLaneReviews",
};

/** Lane → its display-count accessor (the payload's wire nulls are already coalesced to 0). */
const LANE_COUNT: Record<BalanceLaneKey, (lanes: SessionCreditLanes) => number> = {
  trial: lanes => lanes.trial,
  hifz: lanes => lanes.hifz,
  tajweed: lanes => lanes.tajweed,
  reviews: lanes => lanes.reviews,
};

interface DashboardBalanceBreakdownSurfaceProps {
  /** The lane payload tri-state — `undefined` loading, `null` failed, resolved = four display counts. */
  readonly lanes: SessionCreditLanes | null | undefined;
  /** Compile-time localized copy handles (property access only). */
  readonly labels: DashboardLabels;
  /** The popover title's element id — the wrapper's paper points its `aria-labelledby` here. */
  readonly titleId: string;
}

/**
 * The balance popover's surface — title, tri-state lane chips, and the
 * honest-scope note. The testid contract (`dashboard-balance-breakdown`
 * on the surface, `dashboard-balance-chip-<lane>` on each chip/skeleton)
 * lives here so it is render-testable without a portal.
 */
export function DashboardBalanceBreakdownSurface({
  lanes,
  labels,
  titleId,
}: Readonly<DashboardBalanceBreakdownSurfaceProps>): ReactNode {
  const loading = lanes === undefined;
  const failed = lanes === null;

  // Statement form (sonarjs/no-nested-conditional): the tri-state body is
  // assembled as a plain if/else chain instead of a nested ternary.
  let laneBody: ReactNode;
  if (loading) {
    laneBody = (
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
        {BALANCE_LANES.map(lane => (
          <Skeleton
            key={lane}
            variant="rounded"
            data-testid={`dashboard-balance-chip-${lane}`}
            width={76}
            height={28}
          />
        ))}
      </Stack>
    );
  } else if (failed) {
    laneBody = (
      <Typography
        variant="body2"
        sx={theme => ({ color: theme.palette.text.disabled, fontVariantNumeric: "tabular-nums" })}
      >
        {labels.statUnavailable}
      </Typography>
    );
  } else {
    laneBody = (
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
        {BALANCE_LANES.map(lane => (
          <Chip
            key={lane}
            data-testid={`dashboard-balance-chip-${lane}`}
            label={`${labels[LANE_LABEL_KEY[lane]]} ${LANE_COUNT[lane](lanes)}`}
            variant="outlined"
            sx={theme => ({ borderColor: theme.palette.outlineVariant, color: theme.palette.onSurfaceVariant })}
          />
        ))}
      </Stack>
    );
  }
  return (
    <Stack data-testid="dashboard-balance-breakdown" sx={{ gap: 1.25, p: 2, minWidth: 264 }}>
      <Typography id={titleId} variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.4 }}>
        {labels.balanceBreakdownTitle}
      </Typography>
      {laneBody}
      <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
        {labels.balanceBreakdownNote}
      </Typography>
    </Stack>
  );
}
