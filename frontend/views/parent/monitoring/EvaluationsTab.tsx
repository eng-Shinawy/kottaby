"use client";

import { Stack, Typography } from "@mui/material";
import { type ReactNode, useMemo, useState } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { mapGraphQLErrorByCode } from "@/frontend/providers/apollo/error-link.map";
import { renderEvaluationsBody } from "@/frontend/views/parent/monitoring/EvaluationsTab.body";
import {
  DEFAULT_SORT,
  filterReportRows,
  type SearchFilterState,
} from "@/frontend/views/parent/monitoring/SearchFilterBar.helpers";
import { useAllReportPages } from "@/frontend/views/parent/monitoring/useAllPortalPages";
import { Common, Errors, ParentMonitoring, useAppLocale, useAppTranslation } from "@/shared/locale";

type DeniedAction = Readonly<{ readonly label: string; readonly onAction: () => void }>;

/**
 * TabDeniedFallback — thin wrapper keeping the EvaluationsTab function body
 * under the per-function line budget while forwarding the page-level
 * recovery action into the shared FORBIDDEN surface.
 */
function TabDeniedFallback({ action }: Readonly<{ readonly action?: DeniedAction }>): ReactNode {
  return <PermissionDeniedFallback actionLabel={action?.label} onAction={action?.onAction} />;
}

export function EvaluationsTab(props: Readonly<EvaluationsTabProps>): ReactNode {
  const t = useAppTranslation(ParentMonitoring);
  const te = useAppTranslation(Errors);
  const commonT = useAppTranslation(Common);
  const locale = useAppLocale();
  const [searchState, setSearchState] = useState<SearchFilterState>({
    query: "",
    ratingFilter: null,
    sort: DEFAULT_SORT,
  });
  // Fetch-all-pages: summaries + filters + the row list cover the child's
  // WHOLE report history — page 1 alone would silently truncate >25/50.
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
    return <TabDeniedFallback action={props.deniedAction} />;
  }
  const body = renderEvaluationsBody(
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
  return (
    <Stack spacing={2.5} sx={{ width: "100%" }}>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
        {rows === undefined ? t.evaluationsSectionTitle : t.evaluationsCount(rows.length)}
      </Typography>
      {body}
    </Stack>
  );
}

export interface EvaluationsTabProps {
  readonly studentId: number;
  /** The `?session=` deep-link pointer — the evaluation row of this session highlights. */
  readonly session: number | null;
  /** Page-level recovery affordance rendered inside the tab's FORBIDDEN fallback. */
  readonly deniedAction?: Readonly<{ readonly label: string; readonly onAction: () => void }>;
}
