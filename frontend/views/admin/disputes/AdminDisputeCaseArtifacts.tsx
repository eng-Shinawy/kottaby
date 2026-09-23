"use client";

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type {
  AdminDisputeCaseQuery_adminDisputeCase,
  AdminDisputeCaseQuery_adminDisputeCase_homework,
  AdminDisputeCaseQuery_adminDisputeCase_recitation,
  AdminDisputeCaseQuery_adminDisputeCase_report,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  DisputeCaseHomeworkBlock,
  DisputeCaseRecitationBlock,
  DisputeCaseReportBlock,
} from "@/frontend/views/shared/disputes/DisputeCasePrimitives";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminDisputeCaseArtifacts — the three evidence-artifact sections of the
 * case-review dialog (teacher report, homework, recitation). Absent
 * artifacts arrive as honest `null`s from the case query and render the
 * localized empty-state line — the dialog NEVER fabricates placeholder
 * data. Present artifacts render VERBATIM (notes, numbers, enum refs —
 * server-owned values, never remapped), with the typographic em-dash
 * placeholder (NOT locale copy) for nullable leaf fields.
 *
 * MUI v9 discipline: `sx`-only styling, colors through `theme.palette.*`.
 */

interface AdminDisputeCaseArtifactsProps {
  /** The settled case payload (its three nullable evidence artifacts). */
  readonly disputeCase: AdminDisputeCaseQuery_adminDisputeCase;
  /** Localized sessions-namespace labels (the case-review vocabulary). */
  readonly t: SessionsLabels;
}

/** One evidence section: overline heading + body or honest empty-state line. */
function CaseSection({
  title,
  emptyText,
  isEmpty,
  testId,
  children,
}: Readonly<{
  title: string;
  emptyText: string;
  isEmpty: boolean;
  testId: string;
  children: ReactNode;
}>): ReactNode {
  return (
    <Stack data-testid={testId} sx={{ gap: 1 }}>
      <Typography variant="subtitle1" component="h4" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {isEmpty ? (
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {emptyText}
        </Typography>
      ) : (
        children
      )}
    </Stack>
  );
}

/** The report / homework / recitation sections of the case-review dialog. */
export function AdminDisputeCaseArtifacts({ disputeCase, t }: Readonly<AdminDisputeCaseArtifactsProps>): ReactNode {
  const report: AdminDisputeCaseQuery_adminDisputeCase_report | null = disputeCase.report;
  const homework: AdminDisputeCaseQuery_adminDisputeCase_homework | null = disputeCase.homework;
  const recitation: AdminDisputeCaseQuery_adminDisputeCase_recitation | null = disputeCase.recitation;

  return (
    <Stack sx={{ gap: 3 }}>
      <CaseSection
        title={t.caseReviewReportTitle}
        isEmpty={report === null}
        emptyText={t.caseReviewEmptyReport}
        testId="admin-dispute-case-report"
      >
        {report === null ? null : (
          <DisputeCaseReportBlock
            notes={report.teacherNotes}
            rating={report.studentRatingByTeacher}
            ratingLabel={t.caseReviewRatingLabel}
          />
        )}
      </CaseSection>
      <CaseSection
        title={t.caseReviewHomeworkTitle}
        isEmpty={homework === null}
        emptyText={t.caseReviewEmptyHomework}
        testId="admin-dispute-case-homework"
      >
        {homework === null ? null : (
          <Stack sx={{ gap: 1.5, flexDirection: "row", flexWrap: "wrap" }}>
            <DisputeCaseHomeworkBlock
              label={t.caseReviewHomeworkCurrentLabel}
              homework={homework}
              rangeFromKey="current"
            />
            <DisputeCaseHomeworkBlock
              label={t.caseReviewHomeworkRevisionLabel}
              homework={homework}
              rangeFromKey="revision"
            />
          </Stack>
        )}
      </CaseSection>
      <CaseSection
        title={t.caseReviewRecitationTitle}
        isEmpty={recitation === null}
        emptyText={t.caseReviewEmptyRecitation}
        testId="admin-dispute-case-recitation"
      >
        {recitation === null ? null : <DisputeCaseRecitationBlock recitation={recitation} />}
      </CaseSection>
    </Stack>
  );
}
