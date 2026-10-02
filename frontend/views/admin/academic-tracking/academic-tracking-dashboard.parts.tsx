"use client";

/**
 * Presentational parts of the admin academic-tracking dashboard container
 * — the search/refresh toolbar, the advancement-statistics card, and the
 * paged all-students listing section. Deep imports only (no barrel); the
 * container owns the query/pagination state, these render the settled
 * pieces with caller-resolved labels.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors via
 * callbacks, `*Outlined` icons only, ≥44px touch targets on the refresh
 * and clear affordances.
 */

import { ClearOutlined, InsightsOutlined, RefreshOutlined, SearchOutlined } from "@mui/icons-material";
import { Button, CircularProgress, IconButton, InputAdornment, Stack, TextField, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type {
  AdminAcademicDashboardQuery_adminAcademicDashboard,
  AdminAcademicDashboardQuery_adminAcademicDashboard_stats,
} from "@/frontend/graphql/generated/gql/graphql";
import { AcademicHistoryPager } from "@/frontend/views/admin/academic-tracking/academic-tracking-cells";
import { formatAcademicAverage } from "@/frontend/views/admin/academic-tracking/academic-tracking-display";
import { AcademicStudentsListing } from "@/frontend/views/admin/academic-tracking/academic-tracking-rows";
import { AcademicTrackingEmptyState } from "@/frontend/views/admin/academic-tracking/states/empty-state";
import { MetricCard, MetricRow } from "@/frontend/views/admin/analytics/MetricCard";
import type { AdminAcademicLabels } from "@/shared/locale/types/adminAcademic";

interface DashboardToolbarProps {
  readonly searchInput: string;
  readonly onSearchChange: (value: string) => void;
  readonly onClearSearch: () => void;
  readonly onRefresh: () => void;
  /** Refresh disabled while the initial load is in flight or access is denied. */
  readonly refreshDisabled: boolean;
  readonly refreshing: boolean;
  readonly labels: AdminAcademicLabels;
}

/**
 * The dashboard toolbar — the debounced search field (with its clear
 * affordance) beside the manual refresh CTA, mirroring the admin
 * directories' 300ms posture.
 */
export function DashboardToolbar({
  searchInput,
  onSearchChange,
  onClearSearch,
  onRefresh,
  refreshDisabled,
  refreshing,
  labels,
}: Readonly<DashboardToolbarProps>): ReactNode {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1.5 }}>
      <TextField
        type="search"
        value={searchInput}
        onChange={event => {
          onSearchChange(event.target.value);
        }}
        placeholder={labels.searchPlaceholder}
        aria-label={labels.searchLabel}
        fullWidth
        sx={{ flex: 1, minWidth: 220 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchOutlined fontSize="small" />
              </InputAdornment>
            ),
            endAdornment:
              searchInput !== "" ? (
                <InputAdornment position="end">
                  <IconButton aria-label={labels.searchClearLabel} size="small" onClick={onClearSearch}>
                    <ClearOutlined fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
          },
        }}
      />
      <Button
        variant="outlined"
        onClick={onRefresh}
        disabled={refreshDisabled}
        startIcon={refreshing ? <CircularProgress size={16} color="inherit" /> : <RefreshOutlined />}
        sx={{ minHeight: 44 }}
      >
        {labels.refreshLabel}
      </Button>
    </Stack>
  );
}

interface DashboardStatsCardProps {
  readonly stats: AdminAcademicDashboardQuery_adminAcademicDashboard_stats;
  readonly labels: AdminAcademicLabels;
  readonly locale: string;
}

/**
 * The advancement-statistics card — tracked students, graded-homework
 * coverage, both track averages (honest "not graded yet" when a null
 * average arrives), and the needing-attention count.
 */
export function DashboardStatsCard({ stats, labels, locale }: Readonly<DashboardStatsCardProps>): ReactNode {
  return (
    <MetricCard icon={<InsightsOutlined />} title={labels.statsHeading}>
      <MetricRow label={labels.statTrackedStudents} value={stats.trackedStudentCount} locale={locale} />
      <MetricRow
        label={labels.statStudentsWithGradedHomework}
        value={stats.studentsWithGradedHomeworkCount}
        locale={locale}
      />
      <MetricRow
        label={labels.statAverageJadidGrade}
        value={
          stats.averageJadidGrade === null
            ? labels.gradeNotGraded
            : formatAcademicAverage(stats.averageJadidGrade, locale)
        }
        locale={locale}
      />
      <MetricRow
        label={labels.statAverageMadiGrade}
        value={
          stats.averageMadiGrade === null
            ? labels.gradeNotGraded
            : formatAcademicAverage(stats.averageMadiGrade, locale)
        }
        locale={locale}
      />
      <MetricRow label={labels.statNeedingAttention} value={stats.needingAttentionCount} locale={locale} />
    </MetricCard>
  );
}

interface DashboardListingSectionProps {
  readonly snapshot: AdminAcademicDashboardQuery_adminAcademicDashboard;
  /** The applied search term (`null` = unfiltered) — splits the empty cause. */
  readonly searchApplied: string | null;
  readonly labels: AdminAcademicLabels;
  readonly locale: string;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}

/**
 * The all-students listing section — the honest row count, the
 * cause-split empty state on zero rows, or the desktop/mobile listing
 * with the envelope-echoing pager.
 */
export function DashboardListingSection({
  snapshot,
  searchApplied,
  labels,
  locale,
  onPrevious,
  onNext,
}: Readonly<DashboardListingSectionProps>): ReactNode {
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {labels.rowsCount(snapshot.total)}
      </Typography>
      {snapshot.items.length === 0 ? (
        <AcademicTrackingEmptyState variant={searchApplied === null ? "unfiltered" : "filtered"} labels={labels} />
      ) : (
        <>
          <AcademicStudentsListing rows={snapshot.items} labels={labels} locale={locale} />
          <AcademicHistoryPager
            page={snapshot.page}
            pageCount={snapshot.pageCount}
            previousLabel={labels.paginationPrevious}
            nextLabel={labels.paginationNext}
            pageOfLabel={labels.paginationPageOf}
            onPrevious={onPrevious}
            onNext={onNext}
          />
        </>
      )}
    </Stack>
  );
}
