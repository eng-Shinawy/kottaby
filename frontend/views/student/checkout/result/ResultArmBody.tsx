"use client";

import CheckCircleOutlined from "@mui/icons-material/CheckCircleOutlined";
import ErrorOutlined from "@mui/icons-material/ErrorOutlined";
import ScheduleOutlined from "@mui/icons-material/ScheduleOutlined";
import { Button, CircularProgress, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { MySubscriptionsQuery_mySubscriptions } from "@/frontend/graphql/generated/gql/graphql";
import { ResultSummaryRows } from "@/frontend/views/student/checkout/result/ResultSummaryRows";
import {
  type PaymentResultArm,
  resultArmColor,
  resultArmTone,
} from "@/frontend/views/student/checkout/result/resultPresentation";
import { PAYMENT_RESULT_SUMMARY_TEST_ID } from "@/frontend/views/student/checkout/result/resultViewIds";
import type { CheckoutLabels } from "@/shared/locale/types/checkout";

/**
 * resultArmBody — the result branch body (the sessions-family
 * body-branch-component pattern): the tinted summary panel (icon/title/body
 * + server-provided summary rows) and the per-arm CTAs, rendered for exactly
 * one authoritative arm. Pure presentational — every value is resolved by
 * the container's `mySubscriptions` re-query; no branch decision is made
 * here beyond rendering the arm it was handed.
 */
interface ResultArmBodyProps {
  /** The authoritative arm resolved from server truth. */
  readonly arm: PaymentResultArm;
  /** The newest subscription row (server truth; `undefined` with zero rows). */
  readonly newest: MySubscriptionsQuery_mySubscriptions | undefined;
  /** The checkout namespace labels (pre-resolved by the container). */
  readonly t: CheckoutLabels;
  /** Navigation seam — the CTAs journey to the catalog/subscriptions. */
  readonly onRetry: () => void;
  /** The view-subscriptions CTA's target navigation. */
  readonly onView: () => void;
}

/** The arm → title/body label table over the checkout namespace copy. */
const ARM_TITLES: Readonly<Record<PaymentResultArm, (t: CheckoutLabels) => string>> = {
  success: t => t.resultSuccessTitle,
  pending: t => t.resultPendingTitle,
  failed: t => t.resultFailedTitle,
};

const ARM_BODIES: Readonly<Record<PaymentResultArm, (t: CheckoutLabels) => string>> = {
  success: t => t.resultSuccessBody,
  pending: t => t.resultPendingBody,
  failed: t => t.resultFailedBody,
};

/** The per-arm icon — the panel's status glyph (tone-matched). */
const ARM_ICONS: Readonly<Record<PaymentResultArm, ReactNode>> = {
  success: <CheckCircleOutlined sx={{ fontSize: 48 }} />,
  pending: <ScheduleOutlined sx={{ fontSize: 48 }} />,
  failed: <ErrorOutlined sx={{ fontSize: 48 }} />,
};

/** The per-arm CTA — retry/view navigation targets and variants. */
export function ResultArmBody({ arm, newest, t, onRetry, onView }: Readonly<ResultArmBodyProps>): ReactNode {
  const tone = resultArmTone(arm);
  const color = resultArmColor(arm);
  const title = ARM_TITLES[arm](t);
  const body = ARM_BODIES[arm](t);

  return (
    <Stack sx={{ alignItems: "center", gap: 3, width: "100%", maxWidth: 640 }}>
      <Stack
        data-testid={PAYMENT_RESULT_SUMMARY_TEST_ID}
        sx={theme => ({
          alignItems: "center",
          gap: 2,
          width: "100%",
          borderRadius: 2,
          border: "1px solid",
          borderColor: tone.bg(theme.palette),
          bgcolor: tone.bg(theme.palette),
          color: tone.on(theme.palette),
          px: { xs: 2, sm: 4 },
          py: { xs: 4, sm: 6 },
        })}
      >
        {ARM_ICONS[arm]}
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Typography variant="body1" component="p" sx={{ textAlign: "center" }}>
          {body}
        </Typography>
        {newest !== undefined && <ResultSummaryRows newest={newest} t={t} />}
      </Stack>
      <ArmActions arm={arm} color={color} t={t} onRetry={onRetry} onView={onView} />
    </Stack>
  );
}

/** The CTAs per arm — retry journeys to the catalog; view to the list. */
function ArmActions({
  arm,
  color,
  t,
  onRetry,
  onView,
}: Readonly<{
  arm: PaymentResultArm;
  color: ReturnType<typeof resultArmColor>;
  t: CheckoutLabels;
  onRetry: () => void;
  onView: () => void;
}>): ReactNode {
  if (arm === "pending") {
    return (
      <Stack sx={{ alignItems: "center", gap: 1.5 }}>
        <Button
          variant="contained"
          color={color}
          startIcon={<CircularProgress size={16} color="inherit" />}
          onClick={onRetry}
          sx={{ minHeight: 44 }}
        >
          {t.retryButton}
        </Button>
        <Button variant="text" onClick={onView} sx={{ minHeight: 44 }}>
          {t.viewSubscriptionsButton}
        </Button>
      </Stack>
    );
  }
  if (arm === "failed") {
    return (
      <Stack sx={{ alignItems: "center", gap: 1.5, width: "100%" }}>
        <Button variant="contained" color={color} fullWidth sx={{ maxWidth: 480, minHeight: 44 }} onClick={onRetry}>
          {t.retryButton}
        </Button>
        <Button variant="outlined" fullWidth sx={{ maxWidth: 480, minHeight: 44 }} onClick={onView}>
          {t.viewSubscriptionsButton}
        </Button>
      </Stack>
    );
  }
  return (
    <Button variant="contained" sx={{ width: "100%", maxWidth: 480, minHeight: 44 }} onClick={onView}>
      {t.viewSubscriptionsButton}
    </Button>
  );
}
