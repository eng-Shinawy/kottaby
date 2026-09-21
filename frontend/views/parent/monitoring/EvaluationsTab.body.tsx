"use client";

/**
 * Presentational body of the EvaluationsTab — the four render branches
 * (loading/error, genuinely-empty, filtered-empty, list). Extracted from
 * the stateful tab so the hook-bearing component stays inside the
 * per-function line budget (`oxlint.config.mts` frontend/views cap) and
 * so the branch chain mirrors the ReportsTab.body / HomeworkTab.body
 * composition pattern.
 */
import { GradingOutlined, SearchOutlined } from "@mui/icons-material";
import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { ErrorRetryAlert } from "@/frontend/components/ui/ErrorRetryAlert";
import { IconCircleEmptyState } from "@/frontend/components/ui/IconCircleEmptyState";
import type { ParentChildReportsQuery_parentChildReports_items } from "@/frontend/graphql/generated/gql/graphql";
import { EvaluationsSummary } from "@/frontend/views/parent/monitoring/EvaluationsSummary";
import { EvaluationRow, EvaluationsSkeleton } from "@/frontend/views/parent/monitoring/EvaluationsTab.parts";
import { SearchFilterBar } from "@/frontend/views/parent/monitoring/SearchFilterBar";
import type { SearchFilterState } from "@/frontend/views/parent/monitoring/SearchFilterBar.helpers";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

export function renderEvaluationsBody(
  rows: readonly ParentChildReportsQuery_parentChildReports_items[] | undefined,
  filteredRows: readonly ParentChildReportsQuery_parentChildReports_items[] | undefined,
  error: unknown,
  loading: boolean,
  te: { readonly internalServerError: string },
  commonT: { readonly retry: string },
  t: ParentMonitoringLabels,
  locale: string,
  session: number | null,
  searchState: SearchFilterState,
  onSearchChange: (next: SearchFilterState) => void,
  refetch: () => Promise<unknown>
): ReactNode {
  if (rows === undefined) {
    return error === undefined ? (
      <EvaluationsSkeleton />
    ) : (
      <ErrorRetryAlert
        title={te.internalServerError}
        retryLabel={commonT.retry}
        retryPending={loading}
        onRetry={() => {
          void refetch();
        }}
      >
        <Typography variant="body2">{t.loadErrorBody}</Typography>
      </ErrorRetryAlert>
    );
  }
  if (rows.length === 0) {
    return (
      <IconCircleEmptyState
        testId="parent-evaluations-empty"
        icon={<GradingOutlined sx={{ fontSize: 36 }} />}
        title={t.evaluationsEmptyTitle}
        body={t.evaluationsEmptyBody}
      />
    );
  }
  if (filteredRows?.length === 0 && (searchState.query !== "" || searchState.ratingFilter !== null)) {
    // Zero matches under an ACTIVE filter must keep the filter bar reachable
    // — the empty state alone would strand the user on a filter he cannot
    // change or clear without a page reload.
    return (
      <>
        <SearchFilterBar
          state={searchState}
          labels={t}
          onChange={onSearchChange}
          resultCount={0}
          totalCount={rows.length}
        />
        <IconCircleEmptyState
          testId="parent-evaluations-search-empty"
          icon={<SearchOutlined sx={{ fontSize: 36 }} />}
          title={t.searchNoResults}
          body={""}
        />
      </>
    );
  }
  return (
    <>
      <EvaluationsSummary items={rows} labels={t} />
      <SearchFilterBar
        state={searchState}
        labels={t}
        onChange={onSearchChange}
        resultCount={filteredRows?.length ?? 0}
        totalCount={rows.length}
      />
      <Box
        component="output"
        aria-label={t.evaluationsSectionTitle}
        data-testid="parent-evaluations-list"
        sx={{ display: "grid", gap: 2 }}
      >
        {filteredRows !== undefined
          ? filteredRows.map(row => (
              <EvaluationRow key={row.id} row={row} labels={t} locale={locale} deepLinkSessionId={session} />
            ))
          : null}
      </Box>
    </>
  );
}
