"use client";

import { PrintOutlined } from "@mui/icons-material";
import { Box, IconButton, Stack, Typography } from "@mui/material";
import { type ReactNode, useMemo, useState } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { mapGraphQLErrorByCode } from "@/frontend/providers/apollo/error-link.map";
import { renderHomeworkBody } from "@/frontend/views/parent/monitoring/HomeworkTab.body";
import {
  DEFAULT_SORT,
  filterHomeworkRows,
  type SearchFilterState,
} from "@/frontend/views/parent/monitoring/SearchFilterBar.helpers";
import { useAllHomeworkPages } from "@/frontend/views/parent/monitoring/useAllPortalPages";
import { PrintExportDialog } from "@/frontend/views/shared/print-export/PrintExportDialog";
import { Common, Errors, ParentMonitoring, useAppLocale, useAppTranslation } from "@/shared/locale";

export function HomeworkTab(props: Readonly<HomeworkTabProps>): ReactNode {
  const t = useAppTranslation(ParentMonitoring);
  const te = useAppTranslation(Errors);
  const commonT = useAppTranslation(Common);
  const locale = useAppLocale();
  const [searchState, setSearchState] = useState<SearchFilterState>({
    query: "",
    ratingFilter: null,
    sort: DEFAULT_SORT,
  });
  const [printOpen, setPrintOpen] = useState(false);
  // Fetch-all-pages: summaries + the graded-row list cover the child's WHOLE
  // homework history — page 1 alone would silently truncate >25/50.
  const { data, loading, error, refetch } = useAllHomeworkPages(props.studentId);
  const errorCode = error ? extractErrorCode(error) : null;
  const denied =
    errorCode !== null &&
    mapGraphQLErrorByCode(errorCode, { contextKind: "query", hasForm: false })?.kind === "permission-fallback";
  const rows = data?.parentChildHomework?.items;
  const filteredRows = useMemo(
    () =>
      rows !== undefined
        ? filterHomeworkRows(rows, searchState, (row, q) =>
            formatApplicantDate(row.createdAt, locale).toLowerCase().includes(q)
          )
        : undefined,
    [rows, searchState, locale]
  );
  if (denied) {
    return <PermissionDeniedFallback actionLabel={props.deniedAction?.label} onAction={props.deniedAction?.onAction} />;
  }
  const body = renderHomeworkBody(
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
  const showPrintButton = rows !== undefined && rows.length > 0;
  const printableRows =
    filteredRows !== undefined
      ? filteredRows.map(item => ({
          date: formatApplicantDate(item.createdAt, locale),
          col2: item.jadid?.surahJuz ?? "",
          col3: item.madi?.surahJuz ?? "",
          col4: [item.jadid?.grade, item.madi?.grade]
            .filter(g => g !== null && g !== undefined)
            .map(g => String(g))
            .join("/"),
        }))
      : [];
  return (
    <Stack spacing={2.5} sx={{ width: "100%" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
          {rows === undefined ? t.homeworkSectionTitle : t.homeworkCount(rows.length)}
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
          metaSubject={String(props.studentId)}
          title={t.homeworkPrintDialogTitle}
          colHeaders={[t.attendanceColumnDate, t.csvJadidColumn, t.csvMadiColumn, t.csvGradeColumn]}
          countLabel={t.homeworkCount}
          filePrefix="parent-portal-homework"
          labels={{ printOption: t.printOption, exportCsvOption: t.exportCsvOption }}
        />
      ) : null}
    </Stack>
  );
}

export interface HomeworkTabProps {
  readonly studentId: number;
  /** The `?session=` deep-link pointer — the homework row of this session highlights. */
  readonly session: number | null;
  /** Page-level recovery affordance rendered inside the tab's FORBIDDEN fallback. */
  readonly deniedAction?: Readonly<{ readonly label: string; readonly onAction: () => void }>;
}
