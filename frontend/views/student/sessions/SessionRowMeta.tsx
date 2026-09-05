"use client";

import { HourglassTopOutlined as PendingConfirmIcon } from "@mui/icons-material";
import { Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { MyStudentSessionsQuery_myStudentSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import {
  CONFIRM_PENDING_STATUSES,
  NO_VALUE_PLACEHOLDER,
} from "@/frontend/views/student/sessions/sessionRowPresentation";
import { SESSION_FEE_CURRENCY } from "@/shared/constants";
import { Sessions, useAppTranslation } from "@/shared/locale";
import type { AppLocale } from "@/shared/locale/AppLocale";

/**
 * The meta band: fee / deadline / created (+ the teacher & student
 * confirmation moments when the lifecycle set them) and the DEV3-012
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
  const deadlineText =
    session.confirmationDeadline === null
      ? NO_VALUE_PLACEHOLDER
      : formatApplicantDate(session.confirmationDeadline, locale);
  const createdText = formatApplicantDate(session.createdAt, locale);
  /** Teacher-confirmation moment — rendered ONLY when the lifecycle set it. */
  const teacherConfirmedText =
    session.confirmedByTeacherAt === null ? null : formatApplicantDate(session.confirmedByTeacherAt, locale);
  /** Student-confirmation moment (DEV3-012) — rendered ONLY when the stamp is set. */
  const studentConfirmedText =
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
      <MetaCell label={t.fee} value={feeText} />
      <MetaCell label={t.deadline} value={deadlineText} />
      <MetaCell label={t.createdAt} value={createdText} />
      {teacherConfirmedText !== null ? <MetaCell label={t.teacherConfirmedAt} value={teacherConfirmedText} /> : null}
      {studentConfirmedText !== null ? <MetaCell label={t.studentConfirmedAt} value={studentConfirmedText} /> : null}
      {isConfirmPending ? (
        <AwaitingConfirmationPill sessionId={session.id} label={t.awaitingStudentConfirmation} />
      ) : null}
    </Stack>
  );
}

interface MetaCellProps {
  readonly label: string;
  readonly value: string;
}

/** One label/value meta pair (overline label + body value), wrap-friendly. */
function MetaCell({ label, value }: Readonly<MetaCellProps>): ReactNode {
  return (
    <Stack sx={{ gap: 0.25, minWidth: 0 }}>
      <Typography variant="overline" sx={theme => ({ color: theme.palette.text.secondary })}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
    </Stack>
  );
}

/**
 * DEV3-012 pending hint — a completed session whose hold is still marked
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
