"use client";

import ErrorOutlined from "@mui/icons-material/ErrorOutlined";
import { Button, Chip, Stack, Typography } from "@mui/material";
import { alpha, type Palette } from "@mui/material/styles";
import type { ReactNode } from "react";
import type {
  MySubscriptionsQuery_mySubscriptions,
  SubscriptionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  paymentFailedChipLabel,
  statusChipLabel,
} from "@/frontend/views/student/subscriptions/subscriptionsPresentation";
import {
  SUBSCRIPTION_ROW_GUIDANCE_SUFFIX,
  SUBSCRIPTION_ROW_STATUS_SUFFIX,
  SUBSCRIPTION_ROW_TEST_ID_PREFIX,
} from "@/frontend/views/student/subscriptions/subscriptionsViewIds";
import { formatSubscriptionDate } from "@/frontend/views/student/subscriptions/subscriptionsViewLabels";
import type { CheckoutLabels } from "@/shared/locale/types/checkout";

/**
 * The failed-payment row: the subscription row whose lifecycle is still
 * `Pending` while the payment behind it settled as failed. The wire row
 * carries the failure signal through the unset verification stamp — the
 * settled decision never writes `paymentVerifiedAt` on a failed outcome,
 * and `SubscriptionStatus` has no `Failed` member (the failed arm derives
 * from payment-level truth, visible to this view only through the row's
 * own honest pending shape).
 */
function isFailedPaymentRow(row: MySubscriptionsQuery_mySubscriptions): boolean {
  // Record lookup keyed by the enum VALUE (the `no-unsafe-enum-comparison`
  // convention — never `enum === "literal"`).
  return PENDING_CHIP_TONE[row.status] && row.paymentVerifiedAt === null;
}

/** Chip tone per row — the Material 3 container/on-container pair. */
interface SubscriptionChipTone {
  readonly bg: (palette: Palette) => string;
  readonly on: (palette: Palette) => string;
}

/** The pending rows render the amber in-flight tone (the prototype's clock). */
const PENDING_CHIP_TONE: Readonly<Record<string, boolean>> = {
  Pending: true,
};

/** The terminal rows (expired/cancelled/suspended) render the muted neutral tone. */
const TERMINAL_CHIP_TONE: Readonly<Record<string, boolean>> = {
  Expired: true,
  Cancelled: true,
  Suspended: true,
};

/** Resolves the chip tone for one row's lifecycle status (the failed row wins). */
function chipToneFor(status: SubscriptionStatus, failed: boolean): SubscriptionChipTone {
  if (failed) {
    return { bg: palette => palette.errorContainer, on: palette => palette.onErrorContainer };
  }
  if (PENDING_CHIP_TONE[status]) {
    return { bg: palette => palette.warningContainer, on: palette => palette.onWarningContainer };
  }
  if (TERMINAL_CHIP_TONE[status]) {
    return { bg: palette => palette.surfaceContainerHigh, on: palette => palette.onSurfaceVariant };
  }
  return { bg: palette => palette.successContainer, on: palette => palette.onSuccessContainer };
}

interface SubscriptionCardProps {
  readonly row: MySubscriptionsQuery_mySubscriptions;
  readonly t: CheckoutLabels;
  readonly locale: string;
  readonly onRetry: () => void;
}

/**
 * One subscription card: the lifecycle chip in the header, the derived
 * `Payment failed` chip + failed-guidance copy on failed-payment rows, and
 * the validity window (blank placeholder while pending — the wire carries
 * NULL honestly).
 */
export function SubscriptionCard({ row, t, locale, onRetry }: Readonly<SubscriptionCardProps>): ReactNode {
  const failed = isFailedPaymentRow(row);
  const chipTone = chipToneFor(row.status, failed);
  const chipLabel = failed ? paymentFailedChipLabel(t) : statusChipLabel(row.status, t);

  return (
    <Stack
      data-testid={`${SUBSCRIPTION_ROW_TEST_ID_PREFIX}-${row.id}`}
      sx={theme => ({
        gap: 1.5,
        borderRadius: 2,
        border: 1,
        borderColor: theme.palette.divider,
        p: { xs: 2, sm: 2.5 },
      })}
    >
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", gap: 2 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, minWidth: 0 }}>
          {row.plan.title}
        </Typography>
        <Chip
          data-testid={`${SUBSCRIPTION_ROW_TEST_ID_PREFIX}-${row.id}${SUBSCRIPTION_ROW_STATUS_SUFFIX}`}
          label={chipLabel}
          size="small"
          sx={theme => ({
            bgcolor: chipTone.bg(theme.palette),
            color: chipTone.on(theme.palette),
            fontWeight: 600,
            flexShrink: 0,
          })}
        />
      </Stack>
      {failed ? (
        <Stack
          data-testid={`${SUBSCRIPTION_ROW_TEST_ID_PREFIX}-${row.id}${SUBSCRIPTION_ROW_GUIDANCE_SUFFIX}`}
          direction="row"
          sx={theme => ({
            gap: 1.5,
            alignItems: "flex-start",
            borderRadius: 2,
            p: 1.5,
            bgcolor: theme.palette.errorContainer,
            color: theme.palette.onErrorContainer,
          })}
        >
          <ErrorOutlined fontSize="small" sx={{ mt: 0.25 }} />
          <Stack sx={{ gap: 1, alignItems: "flex-start" }}>
            <Typography variant="body2" component="p">
              {t.failedPaymentGuidance}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              onClick={onRetry}
              sx={theme => ({
                minHeight: 44,
                color: "inherit",
                borderColor: alpha(theme.palette.onErrorContainer, 0.5),
              })}
            >
              {t.retryButton}
            </Button>
          </Stack>
        </Stack>
      ) : null}
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "baseline", gap: 2 }}>
        <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.startDateColumn}
        </Typography>
        <Typography variant="body2" component="p" sx={{ fontWeight: 600 }}>
          {row.startDate === null ? t.emptyValue : formatSubscriptionDate(row.startDate, locale)}
        </Typography>
      </Stack>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "baseline", gap: 2 }}>
        <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.endDateColumn}
        </Typography>
        <Typography variant="body2" component="p" sx={{ fontWeight: 600 }}>
          {row.endDate === null ? t.emptyValue : formatSubscriptionDate(row.endDate, locale)}
        </Typography>
      </Stack>
    </Stack>
  );
}
