"use client";

import { RefreshOutlined as RefreshIcon } from "@mui/icons-material";
import { Alert, Button, Skeleton, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { CardShell } from "@/frontend/views/students/dashboard/CardShell";

/**
 * Shared Up Next glance-card STATE shells — the skeleton and error branches
 * both role cards render, extracted so the two cards keep identical loading
 * / failure geometry (zero layout-shift target, one retry affordance shape)
 * without re-deriving the same JSX (which jscpd would flag as clones).
 *
 * Component-only exports keep Fast Refresh working; the row chrome lives in
 * the sibling `UpNextRowChrome.tsx` + `upNextRowShell.ts`.
 */

/**
 * The in-flight branch: a skeleton mirroring the settled card geometry,
 * announced as a `role="status"` live region so screen readers hear WHAT
 * is loading, not just that something is.
 */
export function UpNextSkeletonCard({
  loadingLabel,
  testId,
}: Readonly<{ loadingLabel: string; testId: string }>): ReactNode {
  return (
    <CardShell testId={testId} busy busyLabel={loadingLabel}>
      <Skeleton variant="text" sx={{ fontSize: "1.75rem", maxWidth: 220 }} />
      <Skeleton variant="rounded" sx={{ height: 56, borderRadius: 2 }} />
      <Skeleton variant="rounded" sx={{ height: 44, borderRadius: 2 }} />
    </CardShell>
  );
}

/**
 * The failure branch: ONE localized inline Alert + retry button (refetch
 * is the caller's closure — the shell owns only the shape). The label copy
 * comes from the shared `upNext` namespace; the retry verb from `Common`.
 */
export function UpNextErrorCard({
  errorBody,
  retryLabel,
  onRetry,
  testId,
}: Readonly<{
  errorBody: string;
  retryLabel: string;
  onRetry: () => void;
  testId: string;
}>): ReactNode {
  return (
    <CardShell testId={testId}>
      <Stack spacing={2}>
        <Alert severity="error" variant="outlined">
          {errorBody}
        </Alert>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={onRetry} sx={focusVisibleRingSx}>
          {retryLabel}
        </Button>
      </Stack>
    </CardShell>
  );
}
