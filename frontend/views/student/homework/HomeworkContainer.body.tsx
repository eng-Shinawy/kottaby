"use client";

import { Skeleton, Stack, Typography } from "@mui/material";
import { type ReactNode, useMemo } from "react";
import { ErrorRetryAlert } from "@/frontend/components/ui/ErrorRetryAlert";
import type { MyHomeworkQuery_myHomework_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { type PrintableRow, PrintExportDialog } from "@/frontend/views/shared/print-export/PrintExportDialog";
import { HomeworkListSection } from "@/frontend/views/student/homework/HomeworkContainer.chrome";
import { SummaryStrip } from "@/frontend/views/student/homework/HomeworkContainer.summary";
import {
  computeHomeworkSummary,
  filterHomeworkByQuery,
  filterHomeworkByStatus,
  type HomeworkStatusFilter,
} from "@/frontend/views/student/homework/homework.helpers";
import type { HomeworkLabels } from "@/shared/locale/types/homework";

/** Linear skeleton (summary strip + three list rows) — `aria-busy` + label. */
function HomeworkSkeleton({ loadingLabel }: Readonly<{ loadingLabel: string }>): ReactNode {
  const SKELETON_ROW_KEYS = ["homework-row-skeleton-1", "homework-row-skeleton-2", "homework-row-skeleton-3"] as const;
  return (
    <Stack
      spacing={2}
      aria-busy="true"
      aria-label={loadingLabel}
      data-testid="student-homework-loading"
      sx={{ minWidth: 0 }}
    >
      <Stack direction="row" spacing={1.5}>
        {[1, 2, 3].map(n => (
          <Skeleton key={n} variant="rounded" sx={{ height: 56, borderRadius: 2, flex: 1 }} />
        ))}
      </Stack>
      {SKELETON_ROW_KEYS.map(key => (
        <Stack key={key} spacing={1}>
          <Skeleton variant="text" sx={{ fontSize: "0.9rem", maxWidth: 220 }} />
          <Skeleton variant="rounded" sx={{ height: 44, borderRadius: 1.5 }} />
          <Skeleton variant="rounded" sx={{ height: 44, borderRadius: 1.5 }} />
        </Stack>
      ))}
    </Stack>
  );
}

/**
 * The branch-matrix body — the chrome stays mounted above it. Hooks may
 * not sit behind conditional returns, so the two composable lenses are
 * computed before the matrix and every branch renders exactly one arm.
 */
export function HomeworkBody(
  props: Readonly<{
    loading: boolean;
    isError: boolean;
    refetch: () => Promise<unknown>;
    errorTitle: string;
    errorBody: string;
    retryLabel: string;
    loadingLabel: string;
    emptyTitle: string;
    emptyBody: string;
    rows: readonly MyHomeworkQuery_myHomework_items[] | undefined;
    labels: HomeworkLabels;
    locale: string;
    printOpen: boolean;
    onPrintOpenChange: (open: boolean) => void;
    printableRows: readonly PrintableRow[];
    statusFilter: HomeworkStatusFilter;
    onStatusFilter: (filter: HomeworkStatusFilter) => void;
    searchQuery: string;
    onSearchChange: (next: { query: string }) => void;
  }>
): ReactNode {
  const { rows, labels: t, locale, searchQuery } = props;
  // The composed view: status bucket FIRST (the summary strip's own
  // predicate), then the free-text lens. Computed before the branch
  // matrix — hooks may not sit behind conditional returns.
  const visibleRows = useMemo(() => {
    if (rows === undefined) {
      return undefined;
    }
    const statusFiltered = filterHomeworkByStatus(rows, props.statusFilter);
    return filterHomeworkByQuery(statusFiltered, searchQuery, (row, q) =>
      formatApplicantDate(row.createdAt, locale).toLowerCase().includes(q)
    );
  }, [rows, props.statusFilter, searchQuery, locale]);
  if (rows === undefined) {
    if (props.isError) {
      return (
        <ErrorRetryAlert
          title={props.errorTitle}
          retryLabel={props.retryLabel}
          retryPending={props.loading}
          onRetry={() => {
            // A rejected retry keeps the Apollo error set, so the alert
            // stays up for another attempt; the rejection is swallowed
            // deliberately (the visible error surface already announces
            // the failure — an ignored promise must not become an
            // unhandled rejection).
            void props.refetch().catch(() => undefined);
          }}
        >
          <Typography variant="body2">{props.errorBody}</Typography>
        </ErrorRetryAlert>
      );
    }
    return <HomeworkSkeleton loadingLabel={props.loadingLabel} />;
  }
  const summary = computeHomeworkSummary(rows);
  const settledVisibleRows = visibleRows ?? rows;
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <SummaryStrip summary={summary} labels={t} active={props.statusFilter} onToggle={props.onStatusFilter} />
      <HomeworkListSection
        labels={t}
        locale={locale}
        rows={rows}
        settledVisibleRows={settledVisibleRows}
        searchQuery={searchQuery}
        onSearchChange={props.onSearchChange}
        onPrintOpenChange={props.onPrintOpenChange}
        emptyTitle={props.emptyTitle}
        emptyBody={props.emptyBody}
      />
      {props.printOpen ? (
        <PrintExportDialog
          open={props.printOpen}
          onClose={() => {
            props.onPrintOpenChange(false);
          }}
          rows={props.printableRows}
          metaSubject={t.pageTitle}
          title={t.printDialogTitle}
          colHeaders={[t.csvColumnDate, t.csvColumnJadid, t.csvColumnMadi, t.csvColumnGrade]}
          countLabel={t.countLine}
          filePrefix="student-homework"
          labels={{ printOption: t.printOption, exportCsvOption: t.exportCsvOption }}
        />
      ) : null}
    </Stack>
  );
}
