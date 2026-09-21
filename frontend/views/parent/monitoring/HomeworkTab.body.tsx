"use client";

import { MenuBookOutlined, SearchOutlined } from "@mui/icons-material";
import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { ErrorRetryAlert } from "@/frontend/components/ui/ErrorRetryAlert";
import { IconCircleEmptyState } from "@/frontend/components/ui/IconCircleEmptyState";
import type { ParentChildHomeworkQuery_parentChildHomework_items } from "@/frontend/graphql/generated/gql/graphql";
import { HomeworkSummary } from "@/frontend/views/parent/monitoring/HomeworkSummary";
import { HomeworkRow, HomeworkSkeleton } from "@/frontend/views/parent/monitoring/HomeworkTab.parts";
import { SearchFilterBar } from "@/frontend/views/parent/monitoring/SearchFilterBar";
import type { SearchFilterState } from "@/frontend/views/parent/monitoring/SearchFilterBar.helpers";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

export function renderHomeworkBody(
  rows: readonly ParentChildHomeworkQuery_parentChildHomework_items[] | undefined,
  filteredRows: readonly ParentChildHomeworkQuery_parentChildHomework_items[] | undefined,
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
      <HomeworkSkeleton />
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
        testId="parent-homework-empty"
        icon={<MenuBookOutlined sx={{ fontSize: 36 }} />}
        title={t.homeworkEmptyTitle}
        body={t.homeworkEmptyBody}
      />
    );
  }
  if (filteredRows?.length === 0 && searchState.query !== "") {
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
          showRatingFilter={false}
        />
        <IconCircleEmptyState
          testId="parent-homework-search-empty"
          icon={<SearchOutlined sx={{ fontSize: 36 }} />}
          title={t.searchNoResults}
          body={""}
        />
      </>
    );
  }
  return (
    <>
      <HomeworkSummary items={rows} labels={t} />
      <SearchFilterBar
        state={searchState}
        labels={t}
        onChange={onSearchChange}
        resultCount={filteredRows?.length ?? 0}
        totalCount={rows.length}
        showRatingFilter={false}
      />
      <Box
        component="output"
        aria-label={t.homeworkSectionTitle}
        data-testid="parent-homework-list"
        sx={{ display: "grid", gap: 2 }}
      >
        {filteredRows !== undefined
          ? filteredRows.map(row => (
              <HomeworkRow key={row.id} row={row} labels={t} locale={locale} deepLinkSessionId={session} />
            ))
          : null}
      </Box>
    </>
  );
}
