"use client";

/**
 * AdminAcademicTrackingContainer — the admin academic-tracking dashboard
 * client surface mounted at `/admin/academic-tracking` by the
 * server-guarded route (the only consumer; imported directly from the
 * route, no views barrel hop).
 *
 * Data: stateful `useQuery` over `adminAcademicDashboardQueryDocument`
 * (hooks from `@apollo/client/react`; no `useLazyQuery`) with the honest
 * pagination state mirroring the wire contract — `page` starts at 1 and
 * `pageSize` stays inside the API's 1..100 bounds (the surface ships no
 * page-size control; the default 25 is the wire default) — plus the
 * debounced `search` term (300ms; empty draft applies `null` so the
 * backend filter drops out). Every search/setPage change restarts at page
 * 1, so a new result set never opens on a stale page index. Pagination
 * controls echo the ENVELOPE's effective `page`/`pageCount` — never a
 * client-local counter.
 *
 * Render state matrix:
 *  - initial load → the `aria-busy` skeleton (states/loading-state);
 *  - populated → the advancement-statistics block + the all-students
 *    listing (desktop table ≥md, stacked cards below) with per-row
 *    attention chips and drill-down links; zero rows render the
 *    cause-split empty state (no students vs. no search matches);
 *  - load error → the inline localized Alert + Retry (stale data stays on
 *    screen when one exists);
 *  - query-context FORBIDDEN → `PermissionDeniedFallback` through the
 *    error state (the governed-admin edge the page guard cannot see),
 *    classified through the SINGLE `mapGraphQLErrorByCode` table over
 *    `extractErrorCode` — the raw server `message` is NEVER rendered, and
 *    zero data is disclosed.
 *
 * The settled pieces render through the colocated dashboard parts (deep
 * imports). A pure read surface: emits nothing to the logger. MUI v9
 * discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*`, `*Outlined` icons only, ≥44px touch targets, RTL-safe
 * logical composition, `useAppTranslation(AdminAcademic)` property access
 * for every label (no literal copy anywhere).
 */

import { NetworkStatus } from "@apollo/client";
import { useQuery } from "@apollo/client/react";
import { Stack, Typography } from "@mui/material";
import { type ReactNode, useState } from "react";
import { adminAcademicDashboardQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode } from "@/frontend/providers/apollo/error-link.map";
import {
  DashboardListingSection,
  DashboardStatsCard,
  DashboardToolbar,
} from "@/frontend/views/admin/academic-tracking/academic-tracking-dashboard.parts";
import { normalizeDashboardSearch } from "@/frontend/views/admin/academic-tracking/academic-tracking-display";
import { AcademicTrackingErrorState } from "@/frontend/views/admin/academic-tracking/states/error-state";
import { AcademicTrackingLoadingState } from "@/frontend/views/admin/academic-tracking/states/loading-state";
import { SettledBodyFrame } from "@/frontend/views/admin/academic-tracking/states/settled-frame";
import { useAppLocale, useAppTranslation } from "@/shared/locale";
import { AdminAcademic } from "@/shared/locale/namespaces/adminAcademic";

/** Search debounce window — the same 300ms posture as the admin directories. */
const SEARCH_DEBOUNCE_MS = 300;

/** The wire default page size — inside the API's 1..100 contract. */
const DEFAULT_PAGE_SIZE = 25;

/**
 * AdminAcademicTrackingContainer — see the module docblock for the full
 * composition and state contract.
 */
export function AdminAcademicTrackingContainer(): ReactNode {
  const t = useAppTranslation(AdminAcademic);
  const locale = useAppLocale();

  const [searchInput, setSearchInput] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);

  // Debounce the search draft (300ms) — the render-time pattern the admin
  // directory hooks use: a timeout is scheduled while the draft differs
  // from the applied value, and the applied value settles once typing
  // pauses. The applied value is what reaches the wire variables.
  if (searchInput !== searchDebounced) {
    setTimeout(() => setSearchDebounced(searchInput), SEARCH_DEBOUNCE_MS);
  }

  const appliedSearch = normalizeDashboardSearch(searchDebounced);

  const { data, loading, error, refetch, networkStatus } = useQuery(adminAcademicDashboardQueryDocument, {
    variables: { page, pageSize, search: appliedSearch },
    notifyOnNetworkStatusChange: true,
  });

  const snapshot = data?.adminAcademicDashboard;
  // Skeleton ONLY for the one-and-only first fetch: Apollo drops the
  // settled `error` the moment a re-attempt starts, so `loading` alone
  // cannot distinguish the initial load from a retry — `networkStatus`
  // can. A snapshotless retry keeps the error Alert on screen instead of
  // flipping Alert→Skeleton while the endpoint is down.
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

  const handleSearchChange = (value: string): void => {
    setSearchInput(value);
    setPage(1);
  };

  const handleClearSearch = (): void => {
    handleSearchChange("");
  };

  const handleRefresh = (): void => {
    void refetch();
  };

  // Skeleton, denial, or settled content — statements, not a nested ternary.
  let body: ReactNode;
  if (denied) {
    body = <AcademicTrackingErrorState error={error} onRetry={handleRefresh} retryPending={loading} />;
  } else if (initialLoad) {
    body = <AcademicTrackingLoadingState variant="dashboard" loadingLabel={t.loadingLabel} />;
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
        {settled => (
          <Stack spacing={3}>
            <DashboardStatsCard stats={settled.stats} labels={t} locale={locale} />
            <DashboardListingSection
              snapshot={settled}
              searchApplied={appliedSearch}
              labels={t}
              locale={locale}
              onPrevious={() => {
                setPage(current => Math.max(1, current - 1));
              }}
              onNext={() => {
                setPage(current => Math.min(settled.pageCount, current + 1));
              }}
            />
          </Stack>
        )}
      </SettledBodyFrame>
    );
  }

  return (
    <Stack spacing={3} sx={{ width: "100%" }}>
      <Stack spacing={1}>
        <Typography variant="h4" component="h2">
          {t.dashboardPageTitle}
        </Typography>
        <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.dashboardPageSubtitle}
        </Typography>
      </Stack>
      <DashboardToolbar
        searchInput={searchInput}
        onSearchChange={handleSearchChange}
        onClearSearch={handleClearSearch}
        onRefresh={handleRefresh}
        refreshDisabled={initialLoad || denied}
        refreshing={refreshing}
        labels={t}
      />
      {body}
    </Stack>
  );
}
