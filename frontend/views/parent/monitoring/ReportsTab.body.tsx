"use client";

import { DescriptionOutlined, SearchOutlined } from "@mui/icons-material";
import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { ErrorRetryAlert } from "@/frontend/components/ui/ErrorRetryAlert";
import { IconCircleEmptyState } from "@/frontend/components/ui/IconCircleEmptyState";
import type { ParentChildReportsQuery_parentChildReports_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { RatingTrendChart } from "@/frontend/views/parent/monitoring/RatingTrendChart";
import { ReportRow, ReportsSkeleton } from "@/frontend/views/parent/monitoring/ReportsTab.parts";
import { SearchFilterBar } from "@/frontend/views/parent/monitoring/SearchFilterBar";
import type { SearchFilterState } from "@/frontend/views/parent/monitoring/SearchFilterBar.helpers";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

export function renderReportsBody(
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
      <ReportsSkeleton />
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
        testId="parent-reports-empty"
        icon={<DescriptionOutlined sx={{ fontSize: 36 }} />}
        title={t.reportsEmptyTitle}
        body={t.reportsEmptyBody}
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
          testId="parent-reports-search-empty"
          icon={<SearchOutlined sx={{ fontSize: 36 }} />}
          title={t.searchNoResults}
          body={""}
        />
      </>
    );
  }
  return (
    <>
      <RatingTrendChart items={rows} labels={t} locale={locale} />
      <SearchFilterBar
        state={searchState}
        labels={t}
        onChange={onSearchChange}
        resultCount={filteredRows?.length ?? 0}
        totalCount={rows.length}
      />
      <Box
        className="printable-section"
        component="output"
        aria-label={t.reportsSectionTitle}
        data-testid="parent-reports-list"
        sx={{ display: "grid", gap: 2 }}
      >
        {filteredRows !== undefined
          ? filteredRows.map(row => (
              <ReportRow key={row.id} row={row} labels={t} locale={locale} deepLinkSessionId={session} />
            ))
          : null}
        <Typography
          className="print-timestamp"
          variant="caption"
          sx={theme => ({ color: theme.palette.text.secondary })}
        >
          {t.printTimestampLabel(formatApplicantDate(new Date().toISOString(), locale))}
        </Typography>
      </Box>
    </>
  );
}
