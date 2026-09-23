"use client";

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { SessionMetaCell } from "@/frontend/components/ui/sessionList";
import type { StudentDisputeCaseQuery } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";
import { AdminDisputeEscrowChip } from "@/frontend/views/admin/disputes/AdminDisputeEscrowChip";
import { NO_VALUE_PLACEHOLDER } from "@/frontend/views/shared/disputes/DisputeCasePrimitives";
import { SESSION_FEE_CURRENCY } from "@/shared/constants";
import type { AppLocale } from "@/shared/locale/AppLocale";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * ParticipantCaseBundleView — the session-facts half of the settled case
 * bundle both participant mirrors render (the escrow chip, the verbatim
 * fee, the dispute moment, the counterparty identity and the FULL filed
 * reason). The student and teacher dialogs are the SAME surface modulo
 * WHICH counterparty they address, so the facts render from the
 * surface-agnostic `ParticipantCaseView` with the perspective attribution
 * label passed in — the family's arbitration vocabulary never forks.
 */

/** The surface-agnostic case view projected from either participant envelope. */
export interface ParticipantCaseView {
  readonly session: StudentDisputeCaseQuery["studentDisputeCase"]["session"];
  readonly counterpartyName: string | null;
  readonly counterpartyId: string;
  readonly report: StudentDisputeCaseQuery["studentDisputeCase"]["report"];
  readonly homework: StudentDisputeCaseQuery["studentDisputeCase"]["homework"];
  readonly recitation: StudentDisputeCaseQuery["studentDisputeCase"]["recitation"];
}

interface ParticipantCaseSessionFactsProps {
  /** The surface identity — the testid prefix (`<surface>-dispute-case-*`). */
  readonly surface: "student" | "teacher";
  readonly caseView: ParticipantCaseView;
  /** Localized sessions-namespace labels (the arbitration vocabulary). */
  readonly t: SessionsLabels;
  readonly locale: AppLocale;
  /** Perspective attribution: the counterparty meta label. */
  readonly counterpartyLabelText: string;
}

/** The session facts + the FULL filed reason (the bundle's opening half). */
export function ParticipantCaseSessionFacts({
  surface,
  caseView,
  t,
  locale,
  counterpartyLabelText,
}: Readonly<ParticipantCaseSessionFactsProps>): ReactNode {
  const tid = (suffix: string) => `${surface}-dispute-case-${suffix}`;
  const session = caseView.session;
  const feeText = session.fee === null ? NO_VALUE_PLACEHOLDER : `${session.fee} ${SESSION_FEE_CURRENCY}`;
  const disputedText = session.disputedAt === null ? NO_VALUE_PLACEHOLDER : formatLedgerStamp(session.disputedAt);
  const counterpartyLabel = caseView.counterpartyName ?? `#${caseView.counterpartyId}`;

  return (
    <>
      {/* Session facts — the same arbitration vocabulary the queue row speaks. */}
      <Stack data-testid={tid("session")} sx={{ gap: 1.5 }}>
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
          <SessionMetaCell label={counterpartyLabelText} value={counterpartyLabel} />
        </Stack>
      </Stack>

      {/* The FULL filed reason — never truncated inside the case dialog. */}
      {session.disputeReason !== null ? (
        <Stack data-testid={tid("reason")} sx={{ gap: 0.5 }}>
          <Typography variant="overline" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.disputeReasonMeta}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, unicodeBidi: "isolate" }} dir="auto">
            {session.disputeReason}
          </Typography>
        </Stack>
      ) : null}
    </>
  );
}
