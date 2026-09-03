"use client";

/**
 * AuditTrailView — the admin audit-trail client surface mounted at `/audit`
 * by the server-guarded route (the only consumer; imported directly from the
 * route, no views barrel hop). Decomposed across this directory (the repo's
 * 150-line view-file convention):
 *
 *  - `audit-trail-filters.ts` — filter contract + pure UTC-day/enum plumbing;
 *  - `AuditTrailFilterBar` / `AuditTrailFilterFields` — the form filter bar
 *    (draft state internal; queries fire ONLY on submit);
 *  - `AuditTrailStates` — `aria-busy` skeleton, honest empty state, settled
 *    failure surfaces;
 *  - `AuditTrailResults` + `AuditTrailRow` — the raw-MUI `Table` trail
 *    with per-row verbatim `details` expansion and the pagination footer.
 *
 * Query: stateful `useQuery` over the shared `adminAuditLogsQueryDocument`
 * (hooks from `@apollo/client/react`; no `useLazyQuery`). Error seams
 * (branch on `extensions.code` ONLY, via `extractErrorCode`):
 * `UNAUTHORIZED`/`FORBIDDEN` → `PermissionDeniedFallback` (never bare null);
 * `RATE_LIMITED` (incl. the legacy alias) / `SERVICE_UNAVAILABLE` →
 * `RetryableNotice`; anything else → the localized generic notice with a
 * retry affordance wired to `refetch`.
 *
 * Filter state is two-layered: the bar's draft inputs (what the user types)
 * and the applied-filter record (what the query carries). Applying rebuilds
 * the applied record so the GraphQL `filters` variable carries ONLY
 * non-empty values, and pagination resets to the first page. The deep-link
 * `initialFilters` seed (already sanitized by the server route) pre-fills
 * both layers; malformed values normalize to "unfiltered" instead of
 * erroring.
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` callbacks (no hex/rgb, no string palette access),
 * `*Outlined` icons, RTL-safe logical composition, `React.SubmitEvent` for
 * the form submit, and every user-facing string resolved through the
 * compile-time i18n handle (`useAppTranslation(AdminUsers)` property access
 * — never literal copy). A pure read surface: emits nothing to the logger.
 */

import { useQuery } from "@apollo/client/react";
import { Stack, Typography } from "@mui/material";
import { type ReactNode, useState } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import type { RetryableNoticeKind } from "@/frontend/components/ui/RetryableNotice";
import { adminAuditLogsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { AuditTrailFilterBar } from "@/frontend/views/admin/audit/AuditTrailFilterBar";
import { AuditTrailResults } from "@/frontend/views/admin/audit/AuditTrailResults";
import { AuditTrailLoadError, AuditTrailSkeleton } from "@/frontend/views/admin/audit/AuditTrailStates";
import {
  type AppliedAuditTrailFilters,
  type AuditTrailFiltersSeed,
  actionLabelsOf,
  appliedFiltersFromSubmitInput,
  buildFiltersInput,
} from "@/frontend/views/admin/audit/audit-trail-filters";
import { AdminUsers, Common, useAppLocale, useAppTranslation } from "@/shared/locale";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

export type { AuditTrailFiltersSeed };

const DEFAULT_PAGE_SIZE = 10;

/** Retryable-failure classification for the shared notice seam; `null` = generic. */
function retryableKindOf(errorCode: string | null): RetryableNoticeKind | null {
  if (errorCode === "RATE_LIMITED" || errorCode === "RATE_LIMIT_EXCEEDED") return "RATE_LIMITED";
  if (errorCode === "SERVICE_UNAVAILABLE") return "SERVICE_UNAVAILABLE";
  return null;
}

interface AuditTrailViewProps {
  /**
   * Sanitized deep-link filter seed. The server route has already dropped
   * hostile/unparseable query-string values; the view seeds its draft state
   * AND the applied-filter query variables from it, then owns all later
   * edits. Undefined renders the unfiltered first page.
   */
  readonly initialFilters?: AuditTrailFiltersSeed;
}

/**
 * Page heading: the localized title with its secondary subtitle (the only
 * inline typography of the view — everything else lives in the slices).
 */
function AuditTrailHeading({ labels }: Readonly<{ labels: AdminUsersLabels["auditTrail"] }>): ReactNode {
  return (
    <Stack spacing={0.5}>
      <Typography variant="h4" component="h1">
        {labels.pageTitle}
      </Typography>
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {labels.pageSubtitle}
      </Typography>
    </Stack>
  );
}

/**
 * AuditTrailView — see the module docblock for the full composition and
 * state contract.
 */
export function AuditTrailView({ initialFilters }: Readonly<AuditTrailViewProps>): ReactNode {
  const t = useAppTranslation(AdminUsers);
  const commonT = useAppTranslation(Common);
  const locale = useAppLocale();

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [appliedFilters, setAppliedFilters] = useState<AppliedAuditTrailFilters>(() =>
    appliedFiltersFromSubmitInput(initialFilters)
  );
  const [expandedDetailsId, setExpandedDetailsId] = useState<string | null>(null);

  const { data, loading, error, refetch } = useQuery(adminAuditLogsQueryDocument, {
    variables: {
      filters: buildFiltersInput(appliedFilters),
      page: page + 1,
      pageSize,
    },
  });

  const errorCode = error ? extractErrorCode(error) : null;

  // Denial class replaces the whole view — never bare null.
  if (error && (errorCode === "UNAUTHORIZED" || errorCode === "FORBIDDEN")) {
    return <PermissionDeniedFallback />;
  }

  const items = data?.adminAuditLogs.items ?? [];
  const totalCount = data?.adminAuditLogs.totalCount ?? 0;
  // Honest echo: the pagination display is fed from the server's resolved
  // envelope, falling back to the requested window while it is in flight.
  const resolvedPage = data?.adminAuditLogs.page ?? page + 1;
  const resolvedPageSize = data?.adminAuditLogs.pageSize ?? pageSize;
  const hasNoDataYet = loading && data === undefined;

  const handleApply = (applied: AppliedAuditTrailFilters): void => {
    setAppliedFilters(applied);
    setPage(0);
    setExpandedDetailsId(null);
  };

  const handleClear = (): void => {
    setAppliedFilters(appliedFiltersFromSubmitInput(undefined));
    setPage(0);
    setExpandedDetailsId(null);
  };

  const handleRetry = (): void => {
    void refetch();
  };

  const handlePageChange = (nextPage: number): void => {
    setPage(nextPage);
    setExpandedDetailsId(null);
  };

  const handlePageSizeChange = (nextPageSize: number): void => {
    setPageSize(nextPageSize);
    setPage(0);
  };

  const handleToggleDetails = (entryId: string): void => {
    setExpandedDetailsId(current => (current === entryId ? null : entryId));
  };

  // Skeleton, failure notice, or trail — statements, not a nested ternary.
  let body: ReactNode;
  if (hasNoDataYet) {
    body = <AuditTrailSkeleton />;
  } else if (error) {
    body = (
      <AuditTrailLoadError
        labels={t.auditTrail}
        commonLabels={commonT}
        retryableKind={retryableKindOf(errorCode)}
        onRetry={handleRetry}
        retryPending={loading}
      />
    );
  } else {
    body = (
      <AuditTrailResults
        labels={t.auditTrail}
        paginationLabels={t.pagination}
        locale={locale}
        items={items}
        totalCount={totalCount}
        resolvedPage={resolvedPage}
        resolvedPageSize={resolvedPageSize}
        expandedDetailsId={expandedDetailsId}
        actionLabels={actionLabelsOf(t.activity)}
        onToggleDetails={handleToggleDetails}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      />
    );
  }

  return (
    <Stack spacing={3} sx={{ width: "100%", p: { xs: 2, md: 3 } }}>
      <AuditTrailHeading labels={t.auditTrail} />

      <AuditTrailFilterBar
        initialFilters={initialFilters}
        labels={t.auditTrail.filters}
        allActionsOption={t.auditTrail.table.allActionsOption}
        actionLabels={actionLabelsOf(t.activity)}
        fieldsDisabled={hasNoDataYet}
        applyInFlight={loading}
        locale={locale}
        onApply={handleApply}
        onClear={handleClear}
      />

      {body}
    </Stack>
  );
}
