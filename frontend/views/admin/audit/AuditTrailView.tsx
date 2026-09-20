"use client";

/**
 * AuditTrailView — the admin audit-trail client surface mounted at `/audit`
 * by the server-guarded route (the only consumer; imported directly from the
 * route, no views barrel hop). Decomposed across this directory (the repo's
 * 150-line view-file convention):
 *
 *  - `audit-trail-filters.ts` — filter contract + pure UTC-day/enum plumbing;
 *  - `audit-trail-vocabulary.ts` — the shared action/entity-type vocabularies;
 *  - `AuditTrailHeading` — the title row with the filtered-view chip + export pair;
 *  - `useAuditTrailPageState` — the applied-filter/pagination/details state
 *    machine and the trail query;
 *  - `useAuditTrailExports` — the export pair's feedback state machine;
 *  - `AuditTrailFilterBar` / `AuditTrailFilterFields` — the form filter bar
 *    (draft state internal; queries fire ONLY on submit);
 *  - `AuditTrailStates` — `aria-busy` skeleton, honest empty state, settled
 *    failure surfaces;
 *  - `AuditTrailResults` + `AuditTrailRow` — the raw-MUI `Table` trail
 *    with per-row verbatim `details` expansion and the pagination footer.
 *
 * Error seams (branch on `extensions.code` ONLY):
 * `UNAUTHORIZED`/`FORBIDDEN` → `PermissionDeniedFallback` (never bare null);
 * `RATE_LIMITED` (incl. the legacy alias) / `SERVICE_UNAVAILABLE` →
 * `RetryableNotice`; anything else → the localized generic notice with a
 * retry affordance wired to `refetch`.
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` callbacks (no hex/rgb, no string palette access),
 * `*Outlined` icons, RTL-safe logical composition, `React.SubmitEvent` for
 * the form submit, and every user-facing string resolved through the
 * compile-time i18n handle (`useAppTranslation(AdminUsers)` property access
 * — never literal copy). A pure read surface: emits nothing to the logger.
 */

import { Stack } from "@mui/material";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import { AuditTrailFilterBar } from "@/frontend/views/admin/audit/AuditTrailFilterBar";
import { AuditTrailHeading } from "@/frontend/views/admin/audit/AuditTrailHeading";
import { AuditTrailResults } from "@/frontend/views/admin/audit/AuditTrailResults";
import { AuditTrailLoadError, AuditTrailSkeleton } from "@/frontend/views/admin/audit/AuditTrailStates";
import {
  type AuditTrailFiltersSeed,
  actionLabelsOf,
  hasActiveFilters,
} from "@/frontend/views/admin/audit/audit-trail-filters";
import { useAuditTrailExports } from "@/frontend/views/admin/audit/useAuditTrailExports";
import { useAuditTrailPageState } from "@/frontend/views/admin/audit/useAuditTrailPageState";
import { DirectoryFeedbackSnackbar } from "@/frontend/views/admin/directory-shared/DirectoryFeedbackSnackbar";
import { AdminUsers, Common, useAppLocale, useAppTranslation } from "@/shared/locale";

export type { AuditTrailFiltersSeed };

interface AuditTrailViewProps {
  /**
   * Sanitized deep-link filter seed. The server route has already dropped
   * hostile/unparseable query-string values; the view seeds the applied
   * filter record from it, then owns all later edits. Undefined renders
   * the unfiltered first page.
   */
  readonly initialFilters?: AuditTrailFiltersSeed;
}

/**
 * AuditTrailView — see the module docblock for the full composition and
 * state contract.
 */
export function AuditTrailView({ initialFilters }: Readonly<AuditTrailViewProps>): ReactNode {
  const t = useAppTranslation(AdminUsers);
  const commonT = useAppTranslation(Common);
  const locale = useAppLocale();

  const trail = useAuditTrailPageState(initialFilters);
  const {
    feedback: exportFeedback,
    exportAllLoading,
    exportPage: handleExport,
    exportAll: handleExportAll,
    closeFeedback: handleExportFeedbackClose,
  } = useAuditTrailExports({ items: trail.items, appliedFilters: trail.appliedFilters });

  // Denial class replaces the whole view — never bare null.
  if (trail.errorCode !== null && (trail.errorCode === "UNAUTHORIZED" || trail.errorCode === "FORBIDDEN")) {
    return <PermissionDeniedFallback />;
  }

  // Skeleton, failure notice, or trail — statements, not a nested ternary.
  let body: ReactNode;
  if (trail.hasNoDataYet) {
    body = <AuditTrailSkeleton />;
  } else if (trail.errorCode !== null) {
    body = (
      <AuditTrailLoadError
        labels={t.auditTrail}
        commonLabels={commonT}
        retryableKind={trail.retryableKind}
        onRetry={trail.retry}
        retryPending={trail.loading}
      />
    );
  } else {
    body = (
      <AuditTrailResults
        labels={t.auditTrail}
        paginationLabels={t.pagination}
        locale={locale}
        items={trail.items}
        totalCount={trail.totalCount}
        resolvedPage={trail.resolvedPage}
        resolvedPageSize={trail.resolvedPageSize}
        expandedDetailsId={trail.expandedDetailsId}
        actionLabels={actionLabelsOf(t.activity)}
        onToggleDetails={trail.toggleDetails}
        onPageChange={trail.changePage}
        onPageSizeChange={trail.changePageSize}
      />
    );
  }

  return (
    <Stack spacing={3} sx={{ width: "100%", p: { xs: 2, md: 3 } }}>
      <AuditTrailHeading
        labels={t.auditTrail}
        isFiltered={hasActiveFilters(trail.appliedFilters)}
        exportDisabled={trail.items.length === 0}
        exportAllDisabled={trail.totalCount === 0 || exportAllLoading}
        exportAllLoading={exportAllLoading}
        onExport={handleExport}
        onExportAll={handleExportAll}
      />

      <AuditTrailFilterBar
        initialFilters={initialFilters}
        labels={t.auditTrail.filters}
        auditTrailLabels={t.auditTrail}
        allActionsOption={t.auditTrail.table.allActionsOption}
        actionLabels={actionLabelsOf(t.activity)}
        fieldsDisabled={trail.hasNoDataYet}
        applyInFlight={trail.loading}
        locale={locale}
        onApply={trail.applyFilters}
        onClear={trail.clearFilters}
      />

      {body}

      <DirectoryFeedbackSnackbar
        snackbar={exportFeedback === null ? null : { message: exportFeedback.message, severity: exportFeedback.kind }}
        onClose={handleExportFeedbackClose}
      />
    </Stack>
  );
}
