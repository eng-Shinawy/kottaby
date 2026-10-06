"use client";

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { SessionByIdQuery_sessionById } from "@/frontend/graphql/generated/gql/graphql";
import { CaseSection } from "@/frontend/views/shared/disputes/DisputeCasePrimitives";
import { resolutionOutcomeLabel } from "@/frontend/views/shared/disputes/resolution-outcome-label";
import {
  SessionDetailsFeeRow,
  SessionDetailsNoteCallout,
  SessionDetailsNoteText,
} from "@/frontend/views/student/sessions/SessionDetailsDialog.parts";
import { buildSessionDetailsTimeline } from "@/frontend/views/student/sessions/SessionDetailsDialog.timeline.helpers";
import { SessionDetailsTimeline } from "@/frontend/views/student/sessions/SessionDetailsDialog.timeline.parts";
import { SessionRowHeader } from "@/frontend/views/student/sessions/SessionRowHeader";
import {
  resolveCounterpartBand,
  resolveIntentTitle,
  resolveStatusLabel,
  type SessionRowRole,
} from "@/frontend/views/student/sessions/sessionRowPresentation";
import type { SessionDetailsRowPayload } from "@/frontend/views/student/sessions/useSessionDetailsDialogSlot";
import { Sessions, useAppLocale, useAppTranslation } from "@/shared/locale";

/**
 * `SessionDetailsDialog.content.parts` — the details dialog's SETTLED
 * content composition (split from the shell for the per-file caps): the
 * header band (intent title + status chip + counterpart band), the fee row
 * with its hold-state pill, the lifecycle timeline section and the outlined
 * severity callouts for the lifecycle notes.
 *
 * Row-payload seam: the band is the ONLY row-derived datum — the list
 * producers batch-enrich the counterpart names and `sessionById` stays
 * band-free BY DESIGN, so a row that left the list degrades to a band-less
 * header honestly. Every wire-selected field renders from the FRESH
 * single-session read.
 */

/** The dialog content's testid prefix (same anchor family as the shell). */
const CONTENT_TESTID_PREFIX = "session-details";

/** The settled content: header band + fee row + timeline + evidence callouts. */
export function SessionDetailsContent({
  rowRole,
  session,
  wire,
}: Readonly<{
  rowRole: SessionRowRole;
  session: SessionDetailsRowPayload | null;
  wire: SessionByIdQuery_sessionById;
}>): ReactNode {
  const t = useAppTranslation(Sessions);
  const locale = useAppLocale();
  const tid = (suffix: string) => `${CONTENT_TESTID_PREFIX}-${suffix}`;
  const counterpart = session === null ? { name: null, caption: "" } : resolveCounterpartBand(rowRole, session, t);
  return (
    <Stack sx={{ gap: 3 }}>
      <SessionRowHeader
        status={wire.status}
        statusLabel={resolveStatusLabel(wire.status, t)}
        intentText={resolveIntentTitle(wire.intent, t)}
        counterpart={counterpart}
      />
      <SessionDetailsFeeRow fee={wire.fee} feeHeld={wire.feeHeld} status={wire.status} />
      <CaseSection title={t.sessionDetailsTimelineTitle} testId={tid("timeline")}>
        <SessionDetailsTimeline entries={buildSessionDetailsTimeline(wire, t)} locale={locale} />
      </CaseSection>
      {wire.cancelReason !== null ? (
        <SessionDetailsNoteCallout severity="warning" label={t.cancelReasonLine} testId={tid("cancel-note")}>
          <SessionDetailsNoteText text={wire.cancelReason} />
        </SessionDetailsNoteCallout>
      ) : null}
      {wire.disputeReason !== null && wire.disputedAt !== null ? (
        <SessionDetailsNoteCallout severity="error" label={t.disputeReasonLine} testId={tid("dispute-note")}>
          <SessionDetailsNoteText text={wire.disputeReason} />
        </SessionDetailsNoteCallout>
      ) : null}
      {wire.resolvedAt !== null && (wire.resolutionOutcome !== null || wire.resolutionNote !== null) ? (
        <SessionDetailsNoteCallout severity="info" label={t.arbitrationOutcomeLine} testId={tid("resolution-note")}>
          <Stack sx={{ gap: 0.5, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {resolutionOutcomeLabel(wire.resolutionOutcome, t)}
            </Typography>
            {wire.resolutionNote !== null ? <SessionDetailsNoteText text={wire.resolutionNote} /> : null}
          </Stack>
        </SessionDetailsNoteCallout>
      ) : null}
    </Stack>
  );
}
