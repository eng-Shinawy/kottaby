"use client";

import { RefreshOutlined } from "@mui/icons-material";
import { Alert, AlertTitle, Button } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

interface ErrorRetryAlertProps {
  /** Localized heading rendered as the `AlertTitle`. */
  readonly title: string;
  /** Localized retry-button label (`common.retry`). */
  readonly retryLabel: string;
  /** Retry in flight — disables the affordance while pending. */
  readonly retryPending: boolean;
  /** Retry handler — refetches the owning query. */
  readonly onRetry: () => void;
  /** Localized body content (plain `Typography`, stacked rows, etc.). */
  readonly children: ReactNode;
}

/**
 * ErrorRetryAlert — the generic settled-failure surface for inline query
 * errors that are NOT part of a specialized class (auth-denials go to
 * `PermissionDeniedFallback`, `RATE_LIMITED`/`SERVICE_UNAVAILABLE` to
 * `RetryableNotice`). Outlined error `Alert` with a localized title, a
 * caller-supplied body, and a retry affordance wired to `onRetry`.
 */
export function ErrorRetryAlert({
  title,
  retryLabel,
  retryPending,
  onRetry,
  children,
}: Readonly<ErrorRetryAlertProps>): ReactNode {
  return (
    <Alert
      severity="error"
      variant="outlined"
      sx={{
        borderRadius: 2,
        // Tight inline lanes (compact dialog/viewport widths) can squeeze the
        // action wrapper below the button's intrinsic width — the wrapped
        // action drops to its own row instead of overflowing its shrunk box.
        flexWrap: "wrap",
        "& .MuiAlert-message": { minWidth: 0 },
        "& .MuiAlert-action": { flexShrink: 0 },
      }}
      action={
        <Button
          color="error"
          size="small"
          disabled={retryPending}
          onClick={onRetry}
          startIcon={<RefreshOutlined />}
          sx={{ ...focusVisibleRingSx, flexShrink: 0, minHeight: { xs: 44 } }}
        >
          {retryLabel}
        </Button>
      }
    >
      <AlertTitle sx={{ fontWeight: 700 }}>{title}</AlertTitle>
      {children}
    </Alert>
  );
}
