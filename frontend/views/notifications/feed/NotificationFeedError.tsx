"use client";

import { RefreshOutlined } from "@mui/icons-material";
import { Alert, AlertTitle, Button, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
// audit-R4: shared keyboard-focus ring (v9 ButtonBase ships none).
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import { RetryableNotice } from "@/frontend/components/ui/RetryableNotice";
import type { CommonLabels } from "@/shared/locale/types/common";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";

interface NotificationFeedErrorProps {
  /** `notifications` namespace labels (property access only). */
  readonly labels: NotificationsLabels;
  /** `common` namespace labels (retry affordance). */
  readonly commonLabels: CommonLabels;
  /** `extensions.code` extracted through `extractErrorCode` (REQ-068). */
  readonly errorCode: string | null;
  /** Retry handler — refetches the feed query. */
  readonly onRetry: () => void;
  /** Retry in flight (disables the affordance while pending). */
  readonly retryPending?: boolean;
}

/**
 * NotificationFeedError — the feed's settled-failure surface (REQ-063b /
 * REQ-068): branches on `extensions.code` ONLY (extracted upstream through
 * `extractErrorCode` — the same extraction path the production error-link
 * uses), never HTTP status.
 *
 *  - `UNAUTHORIZED` / `FORBIDDEN` → shared `PermissionDeniedFallback`
 *    (auth-denial class; never bare `null`).
 *  - `RATE_LIMITED` / `SERVICE_UNAVAILABLE` → shared `RetryableNotice`
 *    (the canonical retryable seam).
 *  - anything else (masked 500s, network faults) → localized inline notice
 *    (`loadErrorTitle` / `loadErrorBody`) with a retry button; the page
 *    around it stays interactive.
 */
export function NotificationFeedError({
  labels,
  commonLabels,
  errorCode,
  onRetry,
  retryPending = false,
}: Readonly<NotificationFeedErrorProps>): ReactNode {
  if (errorCode === "UNAUTHORIZED" || errorCode === "FORBIDDEN") {
    return <PermissionDeniedFallback />;
  }
  if (errorCode === "RATE_LIMITED" || errorCode === "RATE_LIMIT_EXCEEDED" || errorCode === "SERVICE_UNAVAILABLE") {
    return (
      <RetryableNotice
        kind={errorCode === "SERVICE_UNAVAILABLE" ? "SERVICE_UNAVAILABLE" : "RATE_LIMITED"}
        onRetry={onRetry}
        retryInFlight={retryPending}
      />
    );
  }
  return (
    <Alert
      severity="error"
      variant="outlined"
      sx={{ borderRadius: 2 }}
      action={
        <Button
          color="error"
          size="small"
          disabled={retryPending}
          onClick={onRetry}
          startIcon={<RefreshOutlined />}
          sx={{ ...focusVisibleRingSx, flexShrink: 0, minHeight: { xs: 44 } }}
        >
          {commonLabels.retry}
        </Button>
      }
    >
      <AlertTitle sx={{ fontWeight: 700 }}>{labels.loadErrorTitle}</AlertTitle>
      <Stack spacing={1} sx={{ alignItems: "flex-start", marginTop: 1 }}>
        <Typography variant="body2">{labels.loadErrorBody}</Typography>
      </Stack>
    </Alert>
  );
}
