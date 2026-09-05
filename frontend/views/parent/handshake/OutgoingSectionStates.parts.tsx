"use client";

import { Alert, Button, Skeleton, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { RetryableNotice } from "@/frontend/components/ui/RetryableNotice";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * Unsettled-branch states of the parent outgoing link-requests section
 * (DEV1-014 task 4.3) — the retryable/generic-failure/skeleton chain split
 * out of `OutgoingSectionStates.tsx` to honor the 150-line view budget.
 * Presentational only: every label arrives as an already-resolved namespace
 * handle (property access only).
 */

/**
 * The retryable `extensions.code` taxonomy covered by the shared
 * `RetryableNotice` (the legacy `RATE_LIMIT_EXCEEDED` producer alias is
 * normalized upstream, kept here as belt-and-braces).
 */
const OUTGOING_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "RATE_LIMITED",
  "RATE_LIMIT_EXCEEDED",
  "SERVICE_UNAVAILABLE",
]);

/** True when the query failure belongs to the shared retryable seam. */
function isRetryableOutgoingCode(errorCode: string | null): boolean {
  return errorCode !== null && OUTGOING_RETRYABLE_CODES.has(errorCode);
}

/** Skeleton row identities — stable decorative keys (never the array index). */
const OUTGOING_SKELETON_KEYS: readonly string[] = ["outgoing-skeleton-1", "outgoing-skeleton-2"];

/** Cold-load branch — full-width rounded placeholders (§5.5 card rhythm). */
export function OutgoingSkeletonList(): ReactNode {
  return (
    <Stack component="output" data-testid="parent-outgoing-skeleton" aria-busy="true" spacing={2}>
      {OUTGOING_SKELETON_KEYS.map(key => (
        <Skeleton
          key={key}
          variant="rounded"
          sx={theme => ({ height: 132, borderRadius: 2, bgcolor: theme.palette.surfaceContainerHigh })}
        />
      ))}
    </Stack>
  );
}

/**
 * Generic (non-retryable, non-denial) query failure — localized
 * `errors.internalServerError` copy with the retry affordance BESIDE the
 * alert (not nested in its action slot). Module-private helper of the
 * unsettled branch chain below.
 */
function OutgoingLoadErrorAlert({
  errorLabels,
  retryLabel,
  onRetry,
  retryPending,
}: Readonly<{
  readonly errorLabels: ErrorsLabels;
  readonly retryLabel: string;
  readonly onRetry: () => void;
  readonly retryPending: boolean;
}>): ReactNode {
  return (
    <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
      <Alert severity="error" variant="outlined" sx={{ borderRadius: 2 }}>
        {errorLabels.internalServerError}
      </Alert>
      <Button
        type="button"
        color="error"
        size="small"
        disabled={retryPending}
        onClick={onRetry}
        sx={{ ...focusVisibleRingSx, minHeight: { xs: 44 } }}
      >
        {retryLabel}
      </Button>
    </Stack>
  );
}

/**
 * The unsettled branch chain (flat early-returns — no nested ternary):
 * retryable seam → generic failure + retry → cold-load skeleton.
 */
export function OutgoingUnsettledBody({
  queryErrorCode,
  errorLabels,
  retryLabel,
  onRetry,
  retryPending,
}: Readonly<{
  readonly queryErrorCode: string | null;
  readonly errorLabels: ErrorsLabels;
  readonly retryLabel: string;
  readonly onRetry: () => void;
  readonly retryPending: boolean;
}>): ReactNode {
  if (isRetryableOutgoingCode(queryErrorCode)) {
    return (
      <RetryableNotice
        kind={queryErrorCode === "SERVICE_UNAVAILABLE" ? "SERVICE_UNAVAILABLE" : "RATE_LIMITED"}
        onRetry={onRetry}
        retryInFlight={retryPending}
      />
    );
  }
  if (queryErrorCode !== null) {
    return (
      <OutgoingLoadErrorAlert
        errorLabels={errorLabels}
        retryLabel={retryLabel}
        onRetry={onRetry}
        retryPending={retryPending}
      />
    );
  }
  return <OutgoingSkeletonList />;
}
