"use client";

import { PrintOutlined } from "@mui/icons-material";
import { Box, IconButton, Stack, Typography } from "@mui/material";
import { type ReactNode, useMemo, useState } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { mapGraphQLErrorByCode } from "@/frontend/providers/apollo/error-link.map";
import { renderReportsBody } from "@/frontend/views/parent/monitoring/ReportsTab.body";
import {
  DEFAULT_SORT,
  filterReportRows,
  type SearchFilterState,
} from "@/frontend/views/parent/monitoring/SearchFilterBar.helpers";
import { useAllReportPages } from "@/frontend/views/parent/monitoring/useAllPortalPages";
import { type PrintableRow, PrintExportDialog } from "@/frontend/views/shared/print-export/PrintExportDialog";
import { Common, Errors, ParentMonitoring, useAppLocale, useAppTranslation } from "@/shared/locale";

export function ReportsTab(props: Readonly<ReportsTabProps>): ReactNode {
  const t = useAppTranslation(ParentMonitoring);
  const te = useAppTranslation(Errors);
  const commonT = useAppTranslation(Common);
  const locale = useAppLocale();
  const [printOpen, setPrintOpen] = useState(false);
  const [searchState, setSearchState] = useState<SearchFilterState>({
    query: "",
    ratingFilter: null,
    sort: DEFAULT_SORT,
  });
  // Fetch-all-pages: summaries + trend chart + print/export bundle cover the
  // child's WHOLE report history — page 1 alone would silently truncate >25/50.
  const { data, loading, error, refetch } = useAllReportPages(props.studentId);
  const errorCode = error ? extractErrorCode(error) : null;
  const denied =
    errorCode !== null &&
    mapGraphQLErrorByCode(errorCode, { contextKind: "query", hasForm: false })?.kind === "permission-fallback";
  const rows = data?.parentChildReports?.items;
  const filteredRows = useMemo(
    () =>
      rows !== undefined
        ? filterReportRows(rows, searchState, (row, q) =>
            formatApplicantDate(row.sessionStartedAt ?? row.createdAt, locale)
              .toLowerCase()
              .includes(q)
          )
        : undefined,
    [rows, searchState, locale]
  );
  if (denied) {
    return <PermissionDeniedFallback actionLabel={props.deniedAction?.label} onAction={props.deniedAction?.onAction} />;
  }
  const showPrintButton = rows !== undefined && rows.length > 0;
  const body = renderReportsBody(
    rows,
    filteredRows,
    error,
    loading,
    te,
    commonT,
    t,
    locale,
    props.session,
    searchState,
    setSearchState,
    refetch
  );
  const printableRows: readonly PrintableRow[] =
    filteredRows?.map(row => ({
      date: formatApplicantDate(row.sessionStartedAt ?? row.createdAt, locale),
      col2: row.sessionStatus,
      col3: row.studentRatingByTeacher === null ? t.ratingNotRated : String(row.studentRatingByTeacher),
      col4: row.teacherNotes ?? "",
    })) ?? [];
  return (
    <Stack spacing={2.5} sx={{ width: "100%" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
          {rows === undefined ? t.reportsSectionTitle : t.reportsCount(rows.length)}
        </Typography>
        {showPrintButton ? (
          <IconButton
            className="portal-print-button"
            aria-label={t.printLabel}
            onClick={() => {
              setPrintOpen(true);
            }}
            size="small"
            sx={theme => ({ color: theme.palette.primary.main })}
          >
            <PrintOutlined />
          </IconButton>
        ) : null}
      </Box>
      {body}
      {printOpen ? (
        <PrintExportDialog
          open={printOpen}
          onClose={() => {
            setPrintOpen(false);
          }}
          rows={printableRows}
          metaSubject={props.childName}
          title={t.printDialogTitle}
          colHeaders={[t.attendanceColumnDate, t.csvStatusColumn, t.reportsColumnRating, t.reportsColumnNotes]}
          countLabel={t.reportsCount}
          filePrefix="parent-portal-reports"
          labels={{ printOption: t.printOption, exportCsvOption: t.exportCsvOption }}
        />
      ) : null}
    </Stack>
  );
}

export interface ReportsTabProps {
  readonly studentId: number;
  /** Page-level recovery affordance rendered inside the tab's FORBIDDEN fallback. */
  readonly deniedAction?: Readonly<{ readonly label: string; readonly onAction: () => void }>;
  readonly session: number | null;
  readonly childName: string;
}
