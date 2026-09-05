"use client";

import { Box } from "@mui/material";
import type { ReactNode } from "react";
import { RetryableNotice } from "@/frontend/components/ui/RetryableNotice";
import {
  LinkStatus,
  type MyIncomingParentLinkRequestsQuery_myIncomingParentLinkRequests,
} from "@/frontend/graphql/generated/gql/graphql";
import { displayLinkRequestStatus } from "@/frontend/lib/parent-link-request-status";
import {
  IncomingEmptyState,
  IncomingLoadErrorAlert,
  IncomingShortListHint,
  IncomingSkeletonList,
  IncomingStatusSummary,
} from "@/frontend/views/students/link-requests/IncomingStates";
import { LinkRequestCard, type PendingDecision } from "@/frontend/views/students/link-requests/LinkRequestCard";
import type { CommonLabels } from "@/shared/locale/types/common";
import type { ErrorsLabels } from "@/shared/locale/types/errors";
import type { ParentLinkLabels } from "@/shared/locale/types/parentLink";

/**
 * The retryable `extensions.code` taxonomy covered by the shared
 * `RetryableNotice` (the legacy `RATE_LIMIT_EXCEEDED` producer alias is
 * normalized upstream, kept here as belt-and-braces) — module-private, the
 * same posture as the notifications feed error surface.
 */
const RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  "RATE_LIMITED",
  "RATE_LIMIT_EXCEEDED",
  "SERVICE_UNAVAILABLE",
]);

/** True when the query failure belongs to the shared retryable seam. */
function isRetryableErrorCode(errorCode: string | null): boolean {
  return errorCode !== null && RETRYABLE_ERROR_CODES.has(errorCode);
}

/**
 * A settled list this short (≤2 rows) renders the sparse-inbox composition:
 * the per-status count strip above the list + the friendly hint card below
 * it (both ≥`sm` viewports only — the 375 layout stays untouched).
 */
const SHORT_LIST_MAX_ROWS = 2;

/**
 * Tallies the settled rows by their DISPLAYED status — the same computed
 * `displayLinkRequestStatus` verdict each row card's chip renders, so the
 * summary strip can never disagree with the list it introduces. Presentation
 * only (per-render derivation — no stored state, no write).
 */
function deriveDisplayCounts(
  rows: readonly MyIncomingParentLinkRequestsQuery_myIncomingParentLinkRequests[],
  nowMs: number
): Record<LinkStatus, number> {
  const counts: Record<LinkStatus, number> = {
    [LinkStatus.Pending]: 0,
    [LinkStatus.Confirmed]: 0,
    [LinkStatus.Rejected]: 0,
    [LinkStatus.Expired]: 0,
  };
  for (const row of rows) {
    counts[displayLinkRequestStatus(row.status, row.expiresAt, nowMs)] += 1;
  }
  return counts;
}

interface IncomingBodyProps {
  /** Settled incoming rows (undefined while the query has no data yet). */
  readonly rows: readonly MyIncomingParentLinkRequestsQuery_myIncomingParentLinkRequests[] | undefined;
  /** `extensions.code` of the list-query failure (null = no failure). */
  readonly queryErrorCode: string | null;
  /** List query loading flag (marks the settled list region busy). */
  readonly loading: boolean;
  /** Active app locale (drives the locale-aware timestamp stamps). */
  readonly locale: string;
  /** The mount-captured `now` (computed-expiry parity). */
  readonly nowMs: number;
  /** A respond mutation is in flight (global in-flight disable). */
  readonly respondInFlight: boolean;
  /** Retry-after-query-error refetch in flight. */
  readonly retryPending: boolean;
  /** `parentLink` namespace labels (property access only). */
  readonly labels: ParentLinkLabels;
  /** `errors` namespace labels (generic failure copy). */
  readonly errorLabels: ErrorsLabels;
  /** `common` namespace labels (retry affordance). */
  readonly commonLabels: CommonLabels;
  /** Retry handler — refetches the list query. */
  readonly onRetry: () => void;
  /** Opens the confirm/reject decision dialog for a row. */
  readonly onDecide: (decision: PendingDecision) => void;
}

/**
 * IncomingBody — the settled + unsettled list surface of the student
 * link-requests container. Early-return branches
 * (retryable → generic failure → skeleton → empty → settled list) instead
 * of a nested ternary chain (`sonarjs/no-nested-conditional`), mirroring
 * `NotificationsFeedBody`. The settled region is a `Box component="output"`
 * carrying `aria-busy` while a load/refetch/respond runs (the MUI v9
 * aria-live pattern), holding one `LinkRequestCard` per row in the
 * single-column list (the old two-column grid left a dead half-row under
 * a lone card @768/1440). A SHORT settled list additionally gains the
 * sparse-inbox composition — status-count strip above, hint card below
 * (both ≥`sm`).
 */
export function IncomingBody({
  rows,
  queryErrorCode,
  loading,
  locale,
  nowMs,
  respondInFlight,
  retryPending,
  labels,
  errorLabels,
  commonLabels,
  onRetry,
  onDecide,
}: Readonly<IncomingBodyProps>): ReactNode {
  if (rows === undefined) {
    if (isRetryableErrorCode(queryErrorCode)) {
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
        <IncomingLoadErrorAlert
          errorLabels={errorLabels}
          retryLabel={commonLabels.retry}
          onRetry={onRetry}
          retryPending={retryPending}
        />
      );
    }
    return <IncomingSkeletonList />;
  }
  if (rows.length === 0) {
    return <IncomingEmptyState labels={labels} />;
  }
  // Sparse-inbox composition: with only a row or two settled, a lone card
  // top-anchored in a tall content area reads as dead space (visual QA
  // deduction @768/1440). A short list gains the per-status count strip
  // ABOVE the list and the friendly hint card BELOW it (both ≥`sm` only —
  // the 375 layout stays untouched); the container centers the whole block.
  const isShortList = rows.length <= SHORT_LIST_MAX_ROWS;
  return (
    <>
      {isShortList ? <IncomingStatusSummary counts={deriveDisplayCounts(rows, nowMs)} labels={labels} /> : null}
      <Box
        component="output"
        data-testid="student-link-requests-list"
        aria-label={labels.studentPageTitle}
        aria-busy={loading || respondInFlight}
        // Single-column list inside the container's capped 880px column: the
        // old two-column grid left a dead half-row under a lone request card
        // (visual QA deduction @768/1440) — an inbox list reads cleaner.
        sx={{ display: "grid", gridTemplateColumns: "1fr", gap: 2 }}
      >
        {rows.map(row => (
          <LinkRequestCard
            key={row.id}
            row={row}
            labels={labels}
            locale={locale}
            nowMs={nowMs}
            respondInFlight={respondInFlight}
            onDecide={onDecide}
          />
        ))}
      </Box>
      {isShortList ? <IncomingShortListHint labels={labels} /> : null}
    </>
  );
}
