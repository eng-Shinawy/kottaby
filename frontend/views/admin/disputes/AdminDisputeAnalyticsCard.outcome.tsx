"use client";

/**
 * AdminDisputeAnalyticsCard outcome parts — the five-member outcome chip
 * breakdown (the full outcome vocabulary, always rendered) plus the honest
 * loading skeleton, carved out of `AdminDisputeAnalyticsCard.parts` for the
 * file-size tier. The supplementary-by-contract honesty (no fabricated
 * zeros) rides the same components.
 */

import {
  CancelOutlined as CancelIcon,
  CheckCircleOutlined as CompleteIcon,
  CallSplitOutlined as PartialRefundIcon,
  AssignmentReturnOutlined as RefundIcon,
  type SvgIconComponent,
  GavelOutlined as UpholdIcon,
} from "@mui/icons-material";
import { Card, Chip, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminDisputeAnalyticsQuery_adminDisputeAnalytics } from "@/frontend/graphql/generated/gql/graphql";
import { type StatusTone, TONE_COLORS } from "@/frontend/views/student/sessions/sessionRowPresentation";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/** One outcome chip's presentation row: icon + localized label + tone + count key. */
interface OutcomePresentation {
  readonly icon: SvgIconComponent;
  readonly labelKey: keyof Pick<
    SessionsLabels,
    "outcomeCancel" | "outcomeComplete" | "outcomeRefund" | "outcomePartialRefund" | "outcomeUphold"
  >;
  readonly tone: StatusTone;
  readonly countKey: keyof AdminDisputeAnalyticsQuery_adminDisputeAnalytics;
  readonly testid: string;
}

const OUTCOME_PRESENTATION: readonly OutcomePresentation[] = [
  {
    icon: CancelIcon,
    labelKey: "outcomeCancel",
    tone: "error",
    countKey: "cancelCount",
    testid: "admin-dispute-analytics-outcome-Cancel",
  },
  {
    icon: CompleteIcon,
    labelKey: "outcomeComplete",
    tone: "success",
    countKey: "completeCount",
    testid: "admin-dispute-analytics-outcome-Complete",
  },
  {
    icon: RefundIcon,
    labelKey: "outcomeRefund",
    tone: "info",
    countKey: "refundCount",
    testid: "admin-dispute-analytics-outcome-Refund",
  },
  {
    icon: PartialRefundIcon,
    labelKey: "outcomePartialRefund",
    tone: "warning",
    countKey: "partialRefundCount",
    testid: "admin-dispute-analytics-outcome-PartialRefund",
  },
  {
    icon: UpholdIcon,
    labelKey: "outcomeUphold",
    tone: "success",
    countKey: "upholdCount",
    testid: "admin-dispute-analytics-outcome-Uphold",
  },
];

/** The analytics card's honest loading skeleton — no fabricated zero snapshot. */
export function AnalyticsLoadingCard(): ReactNode {
  return (
    <Card
      variant="outlined"
      data-testid="admin-dispute-analytics-loading"
      sx={theme => ({ borderColor: theme.palette.outlineVariant })}
    >
      <Stack sx={{ gap: 2, p: 3 }}>
        <Skeleton variant="rectangular" width={220} height={28} />
        <Stack direction="row" sx={{ gap: 3 }}>
          <Skeleton variant="rectangular" width={140} height={56} />
          <Skeleton variant="rectangular" width={140} height={56} />
        </Stack>
        <Skeleton variant="rectangular" height={32} />
      </Stack>
    </Card>
  );
}

/** The per-outcome chip breakdown — the full five-member vocabulary, always. */
export function AnalyticsOutcomeBreakdown({
  analytics,
  t,
}: Readonly<{
  analytics: AdminDisputeAnalyticsQuery_adminDisputeAnalytics;
  t: SessionsLabels;
}>): ReactNode {
  return (
    <Stack sx={{ gap: 1.5 }}>
      <Typography
        variant="overline"
        component="h3"
        sx={theme => ({ color: theme.palette.text.secondary, lineHeight: 1.5 })}
      >
        {t.adminDisputeAnalyticsOutcomes}
      </Typography>
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
        {OUTCOME_PRESENTATION.map(outcome => {
          const count = analytics[outcome.countKey];
          const toneColors = TONE_COLORS[outcome.tone] ?? TONE_COLORS.info;
          const Icon = outcome.icon;
          return (
            <Chip
              key={outcome.testid}
              icon={<Icon fontSize="small" />}
              label={`${t[outcome.labelKey]} · ${count}`}
              size="small"
              data-testid={outcome.testid}
              sx={theme => ({
                fontWeight: 600,
                bgcolor: toneColors.bg(theme.palette),
                color: toneColors.fg(theme.palette),
                border: "1px solid",
                borderColor: theme.palette.outlineVariant,
                "& .MuiChip-icon": {
                  color: toneColors.fg(theme.palette),
                },
              })}
            />
          );
        })}
      </Stack>
    </Stack>
  );
}
