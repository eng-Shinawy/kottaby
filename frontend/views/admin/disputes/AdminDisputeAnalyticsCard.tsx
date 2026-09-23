"use client";

/**
 * AdminDisputeAnalyticsCard — the aggregate dispute snapshot on the admin
 * arbitration queue (`/disputes`): the open (queued) count, the resolved
 * total, and the per-outcome breakdown across BOTH escrow generations.
 *
 * The card is SUPPLEMENTARY by contract: the queue above it must keep
 * working when analytics fails, so an error renders NOTHING here (the
 * container decides via `hasError`) — never a fabricated zero snapshot.
 * While loading it renders an honest skeleton; while loaded every value
 * is the server's honest count — a zero outcome chip is a legitimate
 * state, and the full five-member vocabulary renders ALWAYS (a
 * vocabulary-stability display: the analytics snapshot is the one surface
 * where "zero Cancel arbitrations ever" is itself the fact).
 *
 * Styling (MUI v9 discipline: `sx`-only, `theme.palette.*` exclusively):
 * the two headline stats paint the shared session-row tone pairs
 * (`TONE_COLORS` — warning for the awaiting work, success for the decided
 * total) as quiet value blocks; the outcome chips reuse the same
 * Material 3 container/on-container pairing as the escrow chip, each
 * keyed to its outcome's financial direction (refunds land on the
 * error/warning family, standing decisions on success). RTL-safe logical
 * composition throughout — no direction-dependent CSS.
 */

import { Analytics as AnalyticsIcon, CheckCircle as CompleteIcon, Pending as OpenIcon } from "@mui/icons-material";
import { Box, Card, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminDisputeAnalyticsQuery_adminDisputeAnalytics } from "@/frontend/graphql/generated/gql/graphql";
import {
  AnalyticsLoadingCard,
  AnalyticsOutcomeBreakdown,
} from "@/frontend/views/admin/disputes/AdminDisputeAnalyticsCard.outcome";
import { StatBlock } from "@/frontend/views/admin/disputes/AdminDisputeAnalyticsCard.parts";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

interface AdminDisputeAnalyticsCardProps {
  /** The settled analytics snapshot (honest zeros included). */
  readonly analytics: AdminDisputeAnalyticsQuery_adminDisputeAnalytics | null | undefined;
  /** True while the snapshot query is in flight — renders the skeleton. */
  readonly loading: boolean;
  /** True when the snapshot query failed — renders NOTHING (supplementary by contract). */
  readonly hasError: boolean;
  /** Localized sessions-namespace labels. */
  readonly t: SessionsLabels;
}

/** The aggregate dispute snapshot card on the admin arbitration queue. */
export function AdminDisputeAnalyticsCard({
  analytics,
  loading,
  hasError,
  t,
}: Readonly<AdminDisputeAnalyticsCardProps>): ReactNode {
  // Supplementary-by-contract: an analytics failure must never paint a
  // fabricated zero snapshot next to a working queue — it simply renders
  // nothing.
  if (hasError) {
    return null;
  }

  if (loading || analytics === null || analytics === undefined) {
    return <AnalyticsLoadingCard />;
  }

  return (
    <Card
      variant="outlined"
      data-testid="admin-dispute-analytics"
      aria-label={t.adminDisputeAnalyticsTitle}
      sx={theme => ({ borderColor: theme.palette.outlineVariant })}
    >
      <Stack sx={{ gap: 2.5, p: 3 }}>
        {/* Title row */}
        <Stack direction="row" sx={{ gap: 1.5, alignItems: "center" }}>
          <Box
            sx={theme => ({
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 2,
              bgcolor: theme.palette.primaryContainer,
              color: theme.palette.onPrimaryContainer,
            })}
          >
            <AnalyticsIcon fontSize="small" />
          </Box>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
            {t.adminDisputeAnalyticsTitle}
          </Typography>
        </Stack>

        {/* Headline stats: the open work + the decided total */}
        <Stack direction="row" sx={{ gap: 2, flexWrap: "wrap" }}>
          <StatBlock
            testid="admin-dispute-analytics-open"
            value={analytics.openDisputes}
            label={t.adminDisputeAnalyticsOpen}
            tone="warning"
            icon={OpenIcon}
          />
          <StatBlock
            testid="admin-dispute-analytics-resolved"
            value={analytics.resolvedDisputes}
            label={t.adminDisputeAnalyticsResolved}
            tone="success"
            icon={CompleteIcon}
          />
        </Stack>

        <Divider sx={theme => ({ borderColor: theme.palette.outlineVariant })} />

        <Divider sx={theme => ({ borderColor: theme.palette.outlineVariant })} />

        <AnalyticsOutcomeBreakdown analytics={analytics} t={t} />
      </Stack>
    </Card>
  );
}
