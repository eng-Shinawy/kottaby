"use client";

import { Stack } from "@mui/material";
import type { ReactNode } from "react";
import { SessionMetaCell } from "@/frontend/components/ui/sessionList";
import type { MyStudentSessionsQuery_myStudentSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";
import {
  AwaitingConfirmationPill,
  AwaitingEvaluationPill,
  ParkedDraftChip,
} from "@/frontend/views/student/sessions/SessionRowMetaPills";
import {
  CONFIRM_PENDING_STATUSES,
  NO_VALUE_PLACEHOLDER,
} from "@/frontend/views/student/sessions/sessionRowPresentation";
import { SESSION_FEE_CURRENCY } from "@/shared/constants";
import { Sessions, useAppTranslation } from "@/shared/locale";
import type { AppLocale } from "@/shared/locale/AppLocale";

/**
 * The meta band: fee / deadline / created (+ the teacher & student
 * confirmation moments when the lifecycle set them) and the confirm-
 * pending pill. The confirm-pending derivation travels WITH the values it
 * decorates: a completed row whose student stamp is still unset AND whose
 * hold is still marked (the exactly-once financial shape). An
 * arbitration-settled hold (`feeHeld = false`) is NOT pending.
 */
export function SessionRowMeta({
  session,
  locale,
  awaitingEvaluationLabel,
  parkedDraftLabel,
}: Readonly<{
  session: MyStudentSessionsQuery_myStudentSessions_items;
  locale: AppLocale;
  /**
   * Localized label for the evaluator's "still owes a rubric" pill, or
   * absent/null on surfaces without the pending-rubric overlay (the
   * student surface omits it entirely; the teacher surface passes the
   * label and lets the pending-id set decide per row).
   */
  readonly awaitingEvaluationLabel?: string | null;
  /**
   * Localized label for the evaluator's "unsubmitted draft parked" chip,
   * or absent/null on surfaces without the parked-draft overlay (the
   * student surface omits it entirely; the teacher surface passes the
   * label and lets the storage membership read decide per row).
   */
  readonly parkedDraftLabel?: string | null;
}>): ReactNode {
  const t = useAppTranslation(Sessions);

  const feeText = session.fee === null ? NO_VALUE_PLACEHOLDER : `${session.fee} ${SESSION_FEE_CURRENCY}`;
  // Timestamps display as the pure-ASCII ledger stamp (byte-stable in both
  // document directions — the ICU `ar` stamp's RLM controls scramble the
  // punctuation inside the isolate box); the locale-aware full stamp rides
  // the native `title` tooltip via `stampTitle`.
  const deadlineText =
    session.confirmationDeadline === null ? NO_VALUE_PLACEHOLDER : formatLedgerStamp(session.confirmationDeadline);
  const deadlineStamp =
    session.confirmationDeadline === null ? undefined : formatApplicantDate(session.confirmationDeadline, locale);
  const createdText = formatLedgerStamp(session.createdAt);
  /** Teacher-confirmation moment — rendered ONLY when the lifecycle set it. */
  const teacherConfirmedText =
    session.confirmedByTeacherAt === null ? null : formatLedgerStamp(session.confirmedByTeacherAt);
  const teacherStampTitle =
    session.confirmedByTeacherAt === null ? null : formatApplicantDate(session.confirmedByTeacherAt, locale);
  /** Student-confirmation moment — rendered ONLY when the stamp is set. */
  const studentConfirmedText =
    session.confirmedByStudentAt === null ? null : formatLedgerStamp(session.confirmedByStudentAt);
  const studentStampTitle =
    session.confirmedByStudentAt === null ? null : formatApplicantDate(session.confirmedByStudentAt, locale);
  const isConfirmPending =
    session.status in CONFIRM_PENDING_STATUSES && session.confirmedByStudentAt === null && session.feeHeld;

  return (
    <Stack
      sx={{
        // Column gap grows past the mobile stack so the confirmation-stamp
        // cells stop crowding each other at tablet width (visual-loop
        // round-1 finding: 5 cells on one 834px line touched labels); the
        // row gap keeps wrapped lines breathable.
        columnGap: { xs: 1.5, sm: 3, lg: 4 },
        rowGap: 1.5,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "baseline",
      }}
    >
      <SessionMetaCell label={t.fee} value={feeText} />
      <SessionMetaCell label={t.deadline} value={deadlineText} stampTitle={deadlineStamp} />
      <SessionMetaCell
        label={t.createdAt}
        value={createdText}
        stampTitle={formatApplicantDate(session.createdAt, locale)}
      />
      {teacherConfirmedText !== null ? (
        <SessionMetaCell
          label={t.teacherConfirmedAt}
          value={teacherConfirmedText}
          stampTitle={teacherStampTitle ?? undefined}
        />
      ) : null}
      {studentConfirmedText !== null ? (
        <SessionMetaCell
          label={t.studentConfirmedAt}
          value={studentConfirmedText}
          stampTitle={studentStampTitle ?? undefined}
        />
      ) : null}
      {isConfirmPending ? (
        <AwaitingConfirmationPill sessionId={session.id} label={t.awaitingStudentConfirmation} />
      ) : null}
      {awaitingEvaluationLabel !== undefined && awaitingEvaluationLabel !== null ? (
        <AwaitingEvaluationPill sessionId={session.id} label={awaitingEvaluationLabel} />
      ) : null}
      {parkedDraftLabel !== undefined && parkedDraftLabel !== null ? (
        <ParkedDraftChip sessionId={session.id} label={parkedDraftLabel} />
      ) : null}
    </Stack>
  );
}
