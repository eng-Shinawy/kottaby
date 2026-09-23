"use client";

import { Alert, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { SessionMetaCell } from "@/frontend/components/ui/sessionList";
import { formatApplicantDate, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";
import {
  CaseSection,
  DisputeCaseHomeworkBlock,
  DisputeCaseRecitationBlock,
  DisputeCaseReportBlock,
  NO_VALUE_PLACEHOLDER,
} from "@/frontend/views/shared/disputes/DisputeCasePrimitives";
import type { ParticipantCaseView } from "@/frontend/views/shared/disputes/ParticipantCaseBundleView";
import { resolutionOutcomeLabel } from "@/frontend/views/shared/disputes/resolution-outcome-label";
import type { AppLocale } from "@/shared/locale/AppLocale";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * ParticipantCaseDecision — the arbitration-decision half of the settled
 * case bundle both participant mirrors render: the outcome (the FULL note
 * + the decided-on moment) or the honest pending line while the case
 * awaits arbitration, plus the participant-owned artifacts (the authored
 * report, the homework row, the recitation record) with honest `null`s —
 * the view NEVER fabricates placeholder data. The student and teacher
 * dialogs are the SAME surface modulo the perspective attribution labels
 * passed in.
 */

interface ParticipantCaseDecisionSectionsProps {
  /** The surface identity — the testid prefix (`<surface>-dispute-case-*`). */
  readonly surface: "student" | "teacher";
  readonly caseView: ParticipantCaseView;
  /** Localized sessions-namespace labels (the arbitration vocabulary). */
  readonly t: SessionsLabels;
  readonly locale: AppLocale;
  /** Perspective attribution: the report/rating keys. */
  readonly reportTitleText: string;
  readonly ratingLabelText: string;
}

/** The decision + the participant-owned artifacts (the bundle's closing half). */
export function ParticipantCaseDecisionSections({
  surface,
  caseView,
  t,
  locale,
  reportTitleText,
  ratingLabelText,
}: Readonly<ParticipantCaseDecisionSectionsProps>): ReactNode {
  const tid = (suffix: string) => `${surface}-dispute-case-${suffix}`;
  const session = caseView.session;
  const isResolved = session.resolvedAt !== null;
  const report = caseView.report;
  const homework = caseView.homework;
  const recitation = caseView.recitation;

  return (
    <>
      {/* The arbitration decision: the FULL outcome + note once resolved,
          the honest pending line while the case awaits arbitration. */}
      <CaseSection title={t.teacherCaseResolutionTitle} testId={tid("resolution")}>
        {isResolved ? (
          <Stack sx={{ gap: 1.5 }}>
            <SessionMetaCell
              label={t.arbitrationOutcomeLine}
              value={resolutionOutcomeLabel(session.resolutionOutcome, t)}
            />
            {session.resolutionNote !== null ? (
              <Typography variant="body2" sx={{ fontWeight: 600, unicodeBidi: "isolate" }} dir="auto">
                {session.resolutionNote}
              </Typography>
            ) : null}
            <SessionMetaCell
              label={t.teacherCaseResolvedAtLabel}
              value={session.resolvedAt === null ? NO_VALUE_PLACEHOLDER : formatLedgerStamp(session.resolvedAt)}
              stampTitle={session.resolvedAt === null ? undefined : formatApplicantDate(session.resolvedAt, locale)}
            />
          </Stack>
        ) : (
          <Alert severity="info" variant="outlined" data-testid={tid("pending")}>
            {t.teacherCasePendingLine}
          </Alert>
        )}
      </CaseSection>

      {/* The participant-owned artifacts (honest nulls — never fabricated). */}
      <CaseSection title={reportTitleText} testId={tid("report")}>
        {report === null ? (
          <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.caseReviewEmptyReport}
          </Typography>
        ) : (
          <DisputeCaseReportBlock
            notes={report.teacherNotes}
            rating={report.studentRatingByTeacher}
            ratingLabel={ratingLabelText}
          />
        )}
      </CaseSection>

      <CaseSection title={t.caseReviewHomeworkTitle} testId={tid("homework")}>
        {homework === null ? (
          <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.caseReviewEmptyHomework}
          </Typography>
        ) : (
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

      <CaseSection title={t.caseReviewRecitationTitle} testId={tid("recitation")}>
        {recitation === null ? (
          <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.caseReviewEmptyRecitation}
          </Typography>
        ) : (
          <DisputeCaseRecitationBlock recitation={recitation} />
        )}
      </CaseSection>
    </>
  );
}
