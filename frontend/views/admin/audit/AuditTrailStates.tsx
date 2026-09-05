"use client";

/**
 * Audit-trail state surfaces: the `aria-busy` skeleton card, the honest
 * empty state, and the settled-failure surface (the shared `RetryableNotice`
 * for the rate-limited / service-unavailable classes, else the localized
 * generic notice with a retry affordance wired to `refetch`). The page
 * header and filter bar stay interactive around every settled failure.
 */

import { RefreshOutlined } from "@mui/icons-material";
import { Alert, AlertTitle, Box, Button, Card, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { RetryableNotice, type RetryableNoticeKind } from "@/frontend/components/ui/RetryableNotice";
import { surfaceCardSx } from "@/frontend/views/admin/audit/audit-trail-skin";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";
import type { CommonLabels } from "@/shared/locale/types/common";

const SKELETON_ROW_COUNT = 6;

export function AuditTrailSkeleton(): ReactNode {
  return (
    <Card sx={surfaceCardSx}>
      <Box component="output" aria-busy sx={{ display: "block" }}>
        <Stack spacing={2} sx={{ padding: 2.5 }}>
          {Array.from({ length: SKELETON_ROW_COUNT }, (_unused, index) => `audit-trail-skeleton-row-${index + 1}`).map(
            rowKey => (
              <Skeleton key={rowKey} variant="rounded" height={44} />
            )
          )}
        </Stack>
      </Box>
    </Card>
  );
}

interface AuditTrailEmptyStateProps {
  readonly emptyState: AdminUsersLabels["auditTrail"]["emptyState"];
}

export function AuditTrailEmptyState({ emptyState }: Readonly<AuditTrailEmptyStateProps>): ReactNode {
  return (
    <Card sx={surfaceCardSx}>
      <Stack spacing={1} sx={{ alignItems: "center", padding: 6 }}>
        <Typography variant="h6" component="h2">
          {emptyState.title}
        </Typography>
        <Typography
          variant="body2"
          component="p"
          sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 480, textAlign: "center" })}
        >
          {emptyState.message}
        </Typography>
      </Stack>
    </Card>
  );
}

interface AuditTrailLoadErrorProps {
  readonly labels: AdminUsersLabels["auditTrail"];
  readonly commonLabels: CommonLabels;
  readonly retryableKind: RetryableNoticeKind | null;
  readonly onRetry: () => void;
  readonly retryPending: boolean;
}

export function AuditTrailLoadError({
  labels,
  commonLabels,
  retryableKind,
  onRetry,
  retryPending,
}: Readonly<AuditTrailLoadErrorProps>): ReactNode {
  if (retryableKind !== null) {
    return <RetryableNotice kind={retryableKind} onRetry={onRetry} retryInFlight={retryPending} />;
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
      <AlertTitle sx={{ fontWeight: 700 }}>{labels.errorState.title}</AlertTitle>
      <Typography variant="body2" component="p">
        {labels.errorState.message}
      </Typography>
    </Alert>
  );
}
