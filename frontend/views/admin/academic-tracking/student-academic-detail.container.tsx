"use client";

/**
 * AdminStudentAcademicDetailContainer — the per-student academic
 * drill-down client surface mounted at
 * `/admin/academic-tracking/[studentId]` by the server-guarded route (the
 * only consumer; imported directly from the route, no views barrel hop).
 * `studentId` arrives exclusively as the route-derived prop the shell
 * coerces — the container never touches location state for identity.
 *
 * Data: stateful `useQuery` over `adminStudentAcademicDetailQueryDocument`
 * (hooks from `@apollo/client/react`; no `useLazyQuery`) re-keyed on the
 * `studentId` prop so Apollo re-fetches whenever the route's student
 * changes — and the shared history page index resets to 1 with it, so a
 * new student never opens on the previous student's page. ONE
 * `page`/`pageSize` pair drives both history envelopes (the wire contract:
 * one bounds pair per request); each pager echoes its OWN envelope's
 * effective `page`/`pageCount` — never a client-local counter. The
 * `pageSize` stays inside the API's 1..100 bounds (the default 25 is the
 * wire default; the surface ships no page-size control).
 *
 * Render state matrix:
 *  - initial load → the `aria-busy` skeleton (states/loading-state,
 *    `detail` variant: header + the two history sections);
 *  - populated → the settled body (student header, soft-delete governance
 *    banner, progress summary, newest-first homework and session-report
 *    histories) through the colocated parts/body modules;
 *  - load error → the inline localized Alert + Retry (stale data stays on
 *    screen when one exists);
 *  - query-context FORBIDDEN → `PermissionDeniedFallback` through the
 *    error state (the governed-admin edge the page guard cannot see) with
 *    the back-to-dashboard recovery affordance — classified through the
 *    SINGLE `mapGraphQLErrorByCode` table over `extractErrorCode`, the raw
 *    server `message` is NEVER rendered, and zero data is disclosed.
 *
 * A pure read surface: emits nothing to the logger. MUI v9 discipline:
 * `sx`-only styling, colors exclusively through `theme.palette.*`,
 * `*Outlined` icons only, ≥44px touch targets, RTL-safe logical
 * composition, `useAppTranslation(AdminAcademic)` property access for
 * every label (no literal copy anywhere).
 */

import { NetworkStatus } from "@apollo/client";
import { useQuery } from "@apollo/client/react";
import { Stack } from "@mui/material";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { adminStudentAcademicDetailQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode } from "@/frontend/providers/apollo/error-link.map";
import { ACADEMIC_TRACKING_DASHBOARD_ROUTE } from "@/frontend/views/admin/academic-tracking/academic-tracking-routes";
import { AcademicTrackingErrorState } from "@/frontend/views/admin/academic-tracking/states/error-state";
import { AcademicTrackingLoadingState } from "@/frontend/views/admin/academic-tracking/states/loading-state";
import { SettledBodyFrame } from "@/frontend/views/admin/academic-tracking/states/settled-frame";
import { DetailSettledBody } from "@/frontend/views/admin/academic-tracking/student-academic-detail.body";
import { DetailToolbar } from "@/frontend/views/admin/academic-tracking/student-academic-detail.parts";
import { useAppLocale, useAppTranslation } from "@/shared/locale";
import { AdminAcademic } from "@/shared/locale/namespaces/adminAcademic";

/** The wire default page size — inside the API's 1..100 contract. */
const DEFAULT_PAGE_SIZE = 25;

export interface AdminStudentAcademicDetailContainerProps {
  /** The route-derived, shell-coerced positive student id (the read scope). */
  readonly studentId: number;
}

/**
 * AdminStudentAcademicDetailContainer — see the module docblock for the
 * full composition and state contract.
 */
export function AdminStudentAcademicDetailContainer(
  props: Readonly<AdminStudentAcademicDetailContainerProps>
): ReactNode {
  const t = useAppTranslation(AdminAcademic);
  const locale = useAppLocale();
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);

  // Per-student re-key: when the route's student changes without a remount,
  // reset the shared history page index so the new student's histories open
  // on page 1 (the same render-time state adjustment posture the dashboard
  // container uses for its debounced search draft).
  const [renderedStudentId, setRenderedStudentId] = useState(props.studentId);
  if (renderedStudentId !== props.studentId) {
    setRenderedStudentId(props.studentId);
    setPage(1);
  }

  const { data, loading, error, refetch, networkStatus } = useQuery(adminStudentAcademicDetailQueryDocument, {
    variables: { studentId: props.studentId, page, pageSize },
    notifyOnNetworkStatusChange: true,
  });

  const snapshot = data?.adminStudentAcademicDetail;
  // Skeleton ONLY while no snapshot exists and the very first fetch is in
  // flight: Apollo drops the settled `error` the moment a re-attempt starts,
  // so `networkStatus` (not `loading` alone) distinguishes the initial load
  // from a snapshotless retry — the error Alert stays on screen for the
  // retry instead of flipping Alert→Skeleton while the endpoint is down.
  const initialLoad = snapshot === undefined && networkStatus === NetworkStatus.loading;
  const retryingSnapshotless = snapshot === undefined && loading && !initialLoad;
  const refreshing = snapshot !== undefined && loading;

  // Query-context denial classification — FORBIDDEN in query context maps
  // to the `permission-fallback` kind (every other code, incl. UNAUTHORIZED
  // whose auth-recovery UX the errorLink owns, falls to the generic error).
  // The denial discloses ZERO data: the whole body is replaced.
  const errorCode = error ? extractErrorCode(error) : null;
  const denied =
    errorCode !== null &&
    mapGraphQLErrorByCode(errorCode, { contextKind: "query", hasForm: false })?.kind === "permission-fallback";

  const handleBackToDashboard = (): void => {
    router.push(ACADEMIC_TRACKING_DASHBOARD_ROUTE);
  };

  const handleRefresh = (): void => {
    void refetch();
  };

  // The wire carries ONE page bounds pair for both history envelopes; the
  // delta is bounded by the navigating section's own echoed ceiling.
  const navigateHistoryPage = (delta: -1 | 1, ceiling: number): void => {
    setPage(current => (delta === -1 ? Math.max(1, current - 1) : Math.min(ceiling, current + 1)));
  };

  // Skeleton, denial, or settled content — statements, not a nested ternary.
  let body: ReactNode;
  if (denied) {
    body = (
      <AcademicTrackingErrorState
        error={error}
        onRetry={handleRefresh}
        retryPending={loading}
        deniedActionLabel={t.backToDashboardAction}
        onDeniedAction={handleBackToDashboard}
      />
    );
  } else if (initialLoad) {
    body = <AcademicTrackingLoadingState variant="detail" loadingLabel={t.loadingLabel} />;
  } else {
    body = (
      <SettledBodyFrame
        error={error}
        retryingSnapshotless={retryingSnapshotless}
        refreshing={refreshing}
        retryPending={loading}
        onRetry={handleRefresh}
        snapshot={snapshot}
      >
        {settled => <DetailSettledBody snapshot={settled} labels={t} locale={locale} onPage={navigateHistoryPage} />}
      </SettledBodyFrame>
    );
  }

  return (
    <Stack spacing={3} sx={{ width: "100%" }}>
      <DetailToolbar
        backLabel={t.backToDashboardAction}
        refreshLabel={t.refreshLabel}
        refreshDisabled={initialLoad || denied}
        refreshing={refreshing}
        onRefresh={handleRefresh}
      />
      {body}
    </Stack>
  );
}
