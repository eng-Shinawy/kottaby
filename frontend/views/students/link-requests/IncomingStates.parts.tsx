"use client";

import { LinkOutlined } from "@mui/icons-material";
import { Alert, Box, Button, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { ErrorsLabels } from "@/shared/locale/types/errors";
import type { ParentLinkLabels } from "@/shared/locale/types/parentLink";

/**
 * List-replacement branch states of the student incoming link-requests page —
 * the cold-load skeleton, the generic failure alert, and the zero-rows
 * composition split out of `IncomingStates.tsx` to honor the 150-line view
 * budget (the parent side's `OutgoingSectionStates.parts.tsx` precedent).
 * Presentational only: every label arrives as an already-resolved namespace
 * handle (property access only); the names flow back through the
 * `IncomingStates` re-export so import paths stay stable.
 */

/**
 * Stable identities for the skeleton rows — decorative placeholders that
 * never reorder; module-level keys keep React keys OFF the bare array index
 * (biome `noArrayIndexKey`).
 */
const SKELETON_ROW_KEYS: readonly string[] = ["skeleton-row-1", "skeleton-row-2", "skeleton-row-3"];

/**
 * IncomingSkeletonList — the cold-load branch: skeleton rows matching the
 * final card geometry. The region announces itself politely through
 * `Box component="output"` + `aria-busy` (the MUI v9 aria-live pattern from
 * `frontend/AGENTS.md`).
 */
export function IncomingSkeletonList(): ReactNode {
  return (
    <Box
      component="output"
      data-testid="student-link-requests-skeleton"
      aria-busy="true"
      sx={{ display: "grid", gridTemplateColumns: "1fr", gap: 2 }}
    >
      {SKELETON_ROW_KEYS.map(key => (
        <Stack
          key={key}
          spacing={1.5}
          sx={theme => ({ p: { xs: 2, sm: 2.5 }, borderRadius: 2, border: 1, borderColor: theme.palette.border.main })}
        >
          <Skeleton variant="text" sx={{ fontSize: "0.75rem", width: 64 }} />
          <Skeleton variant="text" sx={{ fontSize: "1.25rem", maxWidth: 280 }} />
          <Skeleton variant="text" sx={{ fontSize: "0.875rem", maxWidth: 320 }} />
          <Skeleton variant="rounded" sx={{ height: 28, width: 180, borderRadius: 999 }} />
        </Stack>
      ))}
    </Box>
  );
}

/**
 * IncomingLoadErrorAlert — the generic (non-retryable, non-denial) query
 * failure: localized `errors.internalServerError` copy with a retry
 * affordance; the page around it stays interactive.
 */
export function IncomingLoadErrorAlert({
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
          sx={{ ...focusVisibleRingSx, flexShrink: 0, minHeight: { xs: 44 } }}
        >
          {retryLabel}
        </Button>
      }
    >
      {errorLabels.internalServerError}
    </Alert>
  );
}

/**
 * IncomingEmptyState — the zero-rows branch: a centered, generously-spaced
 * composition (link icon in a tinted circle + `incomingEmptyTitle` /
 * `incomingEmptyBody`). No action buttons render here.
 */
export function IncomingEmptyState({ labels }: Readonly<{ readonly labels: ParentLinkLabels }>): ReactNode {
  return (
    <Stack
      spacing={2}
      data-testid="student-link-requests-empty"
      sx={{ alignItems: "center", justifyContent: "center", py: { xs: 6, sm: 10 }, px: 2, textAlign: "center" }}
    >
      <Box
        aria-hidden
        sx={theme => ({
          width: 72,
          height: 72,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          bgcolor: theme.palette.secondaryContainer,
          color: theme.palette.onSecondaryContainer,
        })}
      >
        <LinkOutlined sx={{ fontSize: 36 }} />
      </Box>
      <Typography variant="h6" component="p" sx={{ fontWeight: 700 }}>
        {labels.incomingEmptyTitle}
      </Typography>
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 420 })}>
        {labels.incomingEmptyBody}
      </Typography>
    </Stack>
  );
}
