"use client";

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { SessionMetaCell } from "@/frontend/components/ui/sessionList";
import type { AdminDisputeCaseQuery_adminDisputeCase_session } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";
import { AdminDisputeEscrowChip } from "@/frontend/views/admin/disputes/AdminDisputeEscrowChip";
import { SESSION_FEE_CURRENCY } from "@/shared/constants";
import type { AppLocale } from "@/shared/locale";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminDisputeCaseSessionFacts — the disputed session's own detail block at
 * the top of the case-review dialog: the booking intent verbatim next to
 * the escrow-class chip, then the classification-relevant facts (verbatim
 * fee + currency, the dispute moment through the shared locale-aware date
 * formatter, the filed reason). The presentation mirrors
 * {@link AdminDisputeRow} so the queue card and the case dialog speak the
 * SAME arbitration vocabulary.
 *
 * Typographic em-dash placeholder for nullable payload values (NOT locale
 * copy — the shipped row convention). MUI v9 discipline: `sx`-only styling.
 */

/** Typographic placeholder for nullable payload values (NOT locale copy). */
const NO_VALUE_PLACEHOLDER = "—";

interface AdminDisputeCaseSessionFactsProps {
  /** The case query's session detail (the shared dispute-family row). */
  readonly session: AdminDisputeCaseQuery_adminDisputeCase_session;
  /** Server-resolved student display name; `null` falls back to the numeric identity. */
  readonly studentName: string | null;
  /** Server-resolved teacher display name; `null` falls back to the numeric identity. */
  readonly teacherName: string | null;
  /** Localized sessions-namespace labels (the arbitration vocabulary). */
  readonly t: SessionsLabels;
  /** Active app locale — drives the dispute-moment formatter. */
  readonly locale: AppLocale;
}

/** The session detail block of the case-review dialog. */
export function AdminDisputeCaseSessionFacts({
  session,
  studentName,
  teacherName,
  t,
  locale,
}: Readonly<AdminDisputeCaseSessionFactsProps>): ReactNode {
  const feeText = session.fee === null ? NO_VALUE_PLACEHOLDER : `${session.fee} ${SESSION_FEE_CURRENCY}`;
  const disputedText = session.disputedAt === null ? NO_VALUE_PLACEHOLDER : formatLedgerStamp(session.disputedAt);
  const disputeReason = session.disputeReason ?? NO_VALUE_PLACEHOLDER;
  const studentLabel = studentName ?? `#${session.studentId}`;
  const teacherLabel = teacherName ?? `#${session.teacherId}`;
  const participantsText = `${studentLabel} · ${teacherLabel}`;

  return (
    <Stack data-testid="admin-dispute-case-session" sx={{ gap: 1.5 }}>
      <Stack
        sx={{
          gap: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <Typography variant="h6" component="h3" sx={{ fontWeight: 700 }}>
          {session.intent ?? NO_VALUE_PLACEHOLDER}
        </Typography>
        <AdminDisputeEscrowChip feeHeld={session.feeHeld} t={t} />
      </Stack>
      <Stack sx={{ gap: 1.5, flexDirection: "row", flexWrap: "wrap", alignItems: "baseline" }}>
        <SessionMetaCell label={t.fee} value={feeText} />
        <SessionMetaCell
          label={t.disputedAtLabel}
          value={disputedText}
          stampTitle={session.disputedAt === null ? undefined : formatApplicantDate(session.disputedAt, locale)}
        />
        <SessionMetaCell label={t.participantsLabel} value={participantsText} />
      </Stack>
      <Stack sx={{ gap: 0.5 }}>
        <Typography variant="overline" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.disputeReasonMeta}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {disputeReason}
        </Typography>
      </Stack>
    </Stack>
  );
}
