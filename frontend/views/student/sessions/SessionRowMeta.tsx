"use client";

import { HourglassTopOutlined as PendingConfirmIcon } from "@mui/icons-material";
import { Chip, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { SessionMetaCell } from "@/frontend/components/ui/sessionList";
import type { MyStudentSessionsQuery_myStudentSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";
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
}: Readonly<{ session: MyStudentSessionsQuery_myStudentSessions_items; locale: AppLocale }>): ReactNode {
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
        gap: 1.5,
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
    </Stack>
  );
}

/**
 * Confirm-pending hint — a completed session whose hold is still marked
 * and whose student stamp is unset. On the teacher surface it explains WHY
 * the wallet credit has not fired; on the student surface it names what the
 * Confirm CTA settles. Info-toned pill through theme tokens (no raw hex).
 */
function AwaitingConfirmationPill({ sessionId, label }: Readonly<{ sessionId: string; label: string }>): ReactNode {
  return (
    <Chip
      icon={<PendingConfirmIcon fontSize="small" />}
      label={label}
      size="small"
      variant="outlined"
      data-testid={`session-awaiting-confirmation-${sessionId}`}
      sx={theme => ({
        alignSelf: "center",
        borderColor: theme.palette.infoContainer,
        bgcolor: theme.palette.surfaceContainerLowest,
        color: theme.palette.onInfoContainer,
        "& .MuiChip-icon": {
          color: theme.palette.onInfoContainer,
        },
      })}
    />
  );
}
