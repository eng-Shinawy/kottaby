"use client";

/**
 * TeacherDirectoryBody — the swapping body below the always-on chrome of
 * the student teacher directory (the `StudentSessionsBody` /
 * `PlansCatalogBody` pattern: the chrome never disappears, only the body
 * resolves). The render-branch matrix lives in the container's docblock;
 * the early-return chain here IS that matrix, ordered skeleton → denial →
 * retryable → other-error → empty → results.
 *
 * Errors classify through the `extensions.code` taxonomy the container
 * already extracted (never the server `message`). All copy arrives
 * pre-resolved via the compile-time label bundles — this component adds
 * no translation hooks of its own beyond the shared error/notice seams.
 * The results branch passes the card-level request intent upward to the
 * container's single request-dialog instance.
 */

import { Alert, Button, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import { RetryableNotice } from "@/frontend/components/ui/RetryableNotice";
import type { BrowseAvailableTeachersQuery_browseAvailableTeachers } from "@/frontend/graphql/generated/gql/graphql";
import { TeacherDirectoryEmptyState } from "@/frontend/views/student/teachers/TeacherDirectoryEmptyState";
import { TeacherDirectoryGrid } from "@/frontend/views/student/teachers/TeacherDirectoryGrid";
import { TeacherDirectoryLoadingSkeleton } from "@/frontend/views/student/teachers/TeacherDirectoryLoadingSkeleton";
import { TeacherDirectoryPagination } from "@/frontend/views/student/teachers/TeacherDirectoryPagination";
import { TeacherDirectoryResultsHeader } from "@/frontend/views/student/teachers/TeacherDirectoryResultsHeader";
import type { TeacherDirectoryLabels } from "@/shared/locale/types/teacherDirectory";

interface TeacherDirectoryBodyProps {
  /** Query in flight (no settled payload yet) → the skeleton branch. */
  readonly loading: boolean;
  /** Settled page envelope (`undefined` until the first successful read). */
  readonly envelope?: BrowseAvailableTeachersQuery_browseAvailableTeachers;
  /** Extracted `extensions.code` of the settled query error (`null` = none). */
  readonly queryErrorCode: string | null;
  /** Retry-after-error refetch in flight (disables the retry affordances). */
  readonly retryPending: boolean;
  /** Pre-resolved `teacherDirectory` copy. */
  readonly labels: TeacherDirectoryLabels;
  /** The generic-error inline alert copy (`errors.internalServerError`). */
  readonly genericErrorLabel: string;
  /** The generic retry CTA copy (`common.retry`). */
  readonly retryLabel: string;
  /** Retry intent — refetches the settled query. */
  readonly onRetry: () => void;
  /** Page-change intent (1-based). */
  readonly onPageChange: (page: number) => void;
  /** Request intent from a card CTA — opens the grid-level request dialog. */
  readonly onRequestSession: (teacher: BrowseAvailableTeachersQuery_browseAvailableTeachers["items"][number]) => void;
}

/** The swapping body: skeleton / denial / retryable / error / empty / results. */
export function TeacherDirectoryBody({
  loading,
  envelope,
  queryErrorCode,
  retryPending,
  labels,
  genericErrorLabel,
  retryLabel,
  onRetry,
  onPageChange,
  onRequestSession,
}: Readonly<TeacherDirectoryBodyProps>): ReactNode {
  const items = envelope?.items ?? [];
  if (loading && items.length === 0) {
    return <TeacherDirectoryLoadingSkeleton />;
  }
  if (queryErrorCode === "UNAUTHORIZED" || queryErrorCode === "FORBIDDEN") {
    return <PermissionDeniedFallback />;
  }
  if (queryErrorCode === "RATE_LIMITED" || queryErrorCode === "SERVICE_UNAVAILABLE") {
    const kind = queryErrorCode === "SERVICE_UNAVAILABLE" ? "SERVICE_UNAVAILABLE" : "RATE_LIMITED";
    return <RetryableNotice kind={kind} onRetry={onRetry} retryInFlight={retryPending} />;
  }
  if (queryErrorCode !== null) {
    return (
      <Stack data-testid="student-teachers-error" sx={{ alignItems: { sm: "flex-start" }, gap: 2, py: 4 }}>
        <Alert severity="error" variant="outlined" sx={{ width: "100%", borderRadius: 2 }}>
          {genericErrorLabel}
        </Alert>
        <Button
          variant="outlined"
          color="error"
          onClick={onRetry}
          disabled={retryPending}
          sx={{ minHeight: 44, px: 2 }}
        >
          {retryLabel}
        </Button>
      </Stack>
    );
  }
  if (envelope === undefined) {
    // Settled without a payload and without an error — nothing honest to
    // render yet (the next refetch repopulates).
    return null;
  }
  if (items.length === 0) {
    // An honest empty page — zero eligible teachers is a valid browse state.
    return <TeacherDirectoryEmptyState />;
  }
  return (
    <>
      <TeacherDirectoryResultsHeader total={envelope.total} page={envelope.page} pageSize={envelope.pageSize} />
      <TeacherDirectoryGrid items={items} onRequestSession={onRequestSession} />
      <TeacherDirectoryPagination
        ariaLabel={labels.paginationLabel}
        previousPageLabel={labels.previousPage}
        nextPageLabel={labels.nextPage}
        pageWordLabel={labels.pageWord}
        page={envelope.page}
        pageCount={envelope.pageCount}
        onPageChange={onPageChange}
      />
    </>
  );
}
