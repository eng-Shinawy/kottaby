"use client";

/**
 * The settled body of the per-student academic drill-down — the student
 * header, the soft-delete governance banner, the progress summary, and
 * the two newest-first history sections (homework, session reports).
 * Deep imports only (no barrel); the container owns the query and the
 * shared pagination state.
 *
 * Per-section honesty: a zero TOTAL renders the dedicated empty card
 * (nothing has ever been recorded); a page whose rows are empty while the
 * total is positive (the sibling section's pager moved past this
 * section's ceiling — both histories share one wire page bounds) renders
 * neither rows nor the empty card, so an existing history is never
 * mislabeled as absent. MUI v9 discipline: `sx`-only styling,
 * theme-palette tokens, `*Outlined` icons.
 */

import { AssignmentOutlined, RateReviewOutlined } from "@mui/icons-material";
import { Stack } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminStudentAcademicDetailQuery_adminStudentAcademicDetail } from "@/frontend/graphql/generated/gql/graphql";
import { AcademicHistoryPager } from "@/frontend/views/admin/academic-tracking/academic-tracking-cells";
import {
  AcademicHomeworkHistory,
  HistorySectionHeading,
} from "@/frontend/views/admin/academic-tracking/academic-tracking-histories";
import { AcademicReportHistory } from "@/frontend/views/admin/academic-tracking/academic-tracking-report-history";
import { AcademicTrackingSectionEmptyState } from "@/frontend/views/admin/academic-tracking/states/empty-state";
import {
  DetailGovernanceBanner,
  DetailProgressCard,
  DetailStudentHeader,
} from "@/frontend/views/admin/academic-tracking/student-academic-detail.parts";
import type { AdminAcademicLabels } from "@/shared/locale/types/adminAcademic";

export interface DetailSettledBodyProps {
  readonly snapshot: AdminStudentAcademicDetailQuery_adminStudentAcademicDetail;
  readonly labels: AdminAcademicLabels;
  readonly locale: string;
  /**
   * Shared history page navigation — the wire carries ONE page bounds
   * pair for both sections; each pager bounds the delta by its OWN
   * envelope's ceiling.
   */
  readonly onPage: (delta: -1 | 1, ceiling: number) => void;
}

/**
 * The drill-down settled content — see the module docblock for the
 * per-section honesty rules.
 */
export function DetailSettledBody({ snapshot, labels, locale, onPage }: Readonly<DetailSettledBodyProps>): ReactNode {
  const homework = snapshot.homeworkPage;
  const report = snapshot.reportPage;
  return (
    <Stack spacing={3}>
      <DetailStudentHeader student={snapshot.student} labels={labels} />
      {snapshot.student.isDeleted ? (
        <DetailGovernanceBanner title={labels.accountDeletedBannerTitle} body={labels.accountDeletedBannerBody} />
      ) : null}
      <DetailProgressCard
        progressRowCount={snapshot.progressRowCount}
        attentionFlag={snapshot.needsAttention}
        labels={labels}
      />
      <Stack spacing={1.5}>
        <HistorySectionHeading title={labels.homeworkSectionTitle} count={labels.homeworkCount(homework.total)} />
        {homework.total === 0 ? (
          <AcademicTrackingSectionEmptyState
            testId="academic-tracking-homework-empty"
            icon={<AssignmentOutlined sx={{ fontSize: 32 }} />}
            title={labels.homeworkEmptyTitle}
            body={labels.homeworkEmptyBody}
          />
        ) : (
          <>
            {homework.items.length > 0 ? (
              <AcademicHomeworkHistory history={homework} labels={labels} locale={locale} />
            ) : null}
            {homework.items.length > 0 ? (
              <AcademicHistoryPager
                page={homework.page}
                pageCount={homework.pageCount}
                previousLabel={labels.paginationPrevious}
                nextLabel={labels.paginationNext}
                pageOfLabel={labels.paginationPageOf}
                onPrevious={() => {
                  onPage(-1, homework.pageCount);
                }}
                onNext={() => {
                  onPage(1, homework.pageCount);
                }}
              />
            ) : null}
          </>
        )}
      </Stack>
      <Stack spacing={1.5}>
        <HistorySectionHeading title={labels.reportsSectionTitle} count={labels.reportsCount(report.total)} />
        {report.total === 0 ? (
          <AcademicTrackingSectionEmptyState
            testId="academic-tracking-reports-empty"
            icon={<RateReviewOutlined sx={{ fontSize: 32 }} />}
            title={labels.reportsEmptyTitle}
            body={labels.reportsEmptyBody}
          />
        ) : (
          <>
            {report.items.length > 0 ? (
              <AcademicReportHistory history={report} labels={labels} locale={locale} />
            ) : null}
            {report.items.length > 0 ? (
              <AcademicHistoryPager
                page={report.page}
                pageCount={report.pageCount}
                previousLabel={labels.paginationPrevious}
                nextLabel={labels.paginationNext}
                pageOfLabel={labels.paginationPageOf}
                onPrevious={() => {
                  onPage(-1, report.pageCount);
                }}
                onNext={() => {
                  onPage(1, report.pageCount);
                }}
              />
            ) : null}
          </>
        )}
      </Stack>
    </Stack>
  );
}
