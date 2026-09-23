"use client";

import { CalendarMonthOutlined, ViewListOutlined } from "@mui/icons-material";
import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { type ReactNode, useState } from "react";
import { ErrorRetryAlert } from "@/frontend/components/ui/ErrorRetryAlert";
import { IconCircleEmptyState } from "@/frontend/components/ui/IconCircleEmptyState";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode } from "@/frontend/providers/apollo/error-link.map";
import { AttendanceCalendar } from "@/frontend/views/parent/monitoring/AttendanceCalendar";
import { AttendanceSummary } from "@/frontend/views/parent/monitoring/AttendanceSummary";
import { AttendanceRow, AttendanceSkeleton } from "@/frontend/views/parent/monitoring/AttendanceTab.parts";
import { useAllAttendancePages } from "@/frontend/views/parent/monitoring/useAllPortalPages";
import { Common, Errors, ParentMonitoring, useAppLocale, useAppTranslation } from "@/shared/locale";

type ViewMode = "list" | "calendar";

export function AttendanceTab(props: Readonly<AttendanceTabProps>): ReactNode {
  const t = useAppTranslation(ParentMonitoring);
  const te = useAppTranslation(Errors);
  const commonT = useAppTranslation(Common);
  const locale = useAppLocale();
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Fetch-all-pages: the tab renders count + summary + calendar over the
  // child's WHOLE history — page 1 alone would silently truncate >25/50.
  const { data, loading, error, refetch } = useAllAttendancePages(props.studentId);

  const errorCode = error ? extractErrorCode(error) : null;
  const denied =
    errorCode !== null &&
    mapGraphQLErrorByCode(errorCode, { contextKind: "query", hasForm: false })?.kind === "permission-fallback";
  if (denied) {
    return <PermissionDeniedFallback actionLabel={props.deniedAction?.label} onAction={props.deniedAction?.onAction} />;
  }

  const rows = data?.parentChildSessions?.items;
  const showCalendarToggle = rows !== undefined && rows.length > 0;

  let body: ReactNode;
  if (rows === undefined) {
    body =
      error === undefined ? (
        <AttendanceSkeleton />
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
  } else if (rows.length === 0) {
    body = (
      <IconCircleEmptyState
        testId="parent-attendance-empty"
        icon={<CalendarMonthOutlined sx={{ fontSize: 36 }} />}
        title={t.attendanceEmptyTitle}
        body={t.attendanceEmptyBody}
      />
    );
  } else if (viewMode === "calendar") {
    body = <AttendanceCalendar sessions={rows} locale={locale} />;
  } else {
    body = (
      <>
        <AttendanceSummary sessions={rows} labels={t} />
        <Box
          component="output"
          aria-label={t.attendanceSectionTitle}
          data-testid="parent-attendance-list"
          sx={{ display: "grid", gap: 2 }}
        >
          {rows.map(row => (
            <AttendanceRow key={row.id} row={row} labels={t} locale={locale} />
          ))}
        </Box>
      </>
    );
  }

  return (
    <Stack spacing={2} sx={{ width: "100%" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
          {rows === undefined ? t.attendanceSectionTitle : t.attendanceCount(rows.length)}
        </Typography>
        {showCalendarToggle ? (
          <ToggleButtonGroup
            exclusive
            value={viewMode}
            onChange={(_, mode: ViewMode | null) => {
              if (mode !== null) {
                setViewMode(mode);
              }
            }}
            size="small"
          >
            <ToggleButton value="list" aria-label={t.listViewLabel}>
              <ViewListOutlined fontSize="small" />
            </ToggleButton>
            <ToggleButton value="calendar" aria-label={t.calendarViewLabel}>
              <CalendarMonthOutlined fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>
        ) : null}
      </Box>
      {body}
    </Stack>
  );
}

export interface AttendanceTabProps {
  readonly studentId: number;
  /** Page-level recovery affordance rendered inside the tab's FORBIDDEN fallback. */
  readonly deniedAction?: Readonly<{ readonly label: string; readonly onAction: () => void }>;
}
