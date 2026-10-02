"use client";

/**
 * SettledBodyFrame — the shared query-body shell of the academic-tracking
 * containers (dashboard + per-student drill-down): the outer `Stack` that
 * carries the inline error strip whenever a settled snapshot coexists with
 * a load error or a snapshotless retry, plus the `aria-busy` `<output>`
 * block that hosts the settled content once a snapshot exists.
 *
 * The snapshot flows to the content through a render-prop child so the
 * caller's TS narrowing survives the extraction (`settled.stats` and
 * friends type-check without a local guard). The render state matrix —
 * which branch renders the skeleton, which replaces the whole body on a
 * query-context denial — stays in the owning containers; this frame is
 * ONLY the settled/failed-shared middle of it.
 *
 * MUI v9 discipline: `sx`-only styling, no theme-external colors.
 */

import { Box, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { AcademicTrackingErrorState } from "@/frontend/views/admin/academic-tracking/states/error-state";

export interface SettledBodyFrameProps<S> {
  /** The settled Apollo error (or `undefined` while a retry re-attempts). */
  readonly error: unknown;
  /** A retry re-attempted WITHOUT a snapshot on screen — keep the Alert. */
  readonly retryingSnapshotless: boolean;
  /** A refetch is in flight over a settled snapshot — flips `aria-busy`. */
  readonly refreshing: boolean;
  /** Retry in flight — disables the affordance while pending. */
  readonly retryPending: boolean;
  /** Retry handler — refetches the owning query. */
  readonly onRetry: () => void;
  /** The settled snapshot — `undefined` renders no `<output>` block. */
  readonly snapshot: S | undefined;
  /** The settled content — receives the narrowed snapshot. */
  readonly children: (snapshot: S) => ReactNode;
}

export function SettledBodyFrame<S>({
  error,
  retryingSnapshotless,
  refreshing,
  retryPending,
  onRetry,
  snapshot,
  children,
}: Readonly<SettledBodyFrameProps<S>>): ReactNode {
  return (
    <Stack spacing={3}>
      {error !== undefined || retryingSnapshotless ? (
        <AcademicTrackingErrorState error={error} onRetry={onRetry} retryPending={retryPending} />
      ) : null}
      {snapshot !== undefined ? (
        <Box component="output" aria-busy={refreshing || undefined} sx={{ display: "block" }}>
          {children(snapshot)}
        </Box>
      ) : null}
    </Stack>
  );
}
