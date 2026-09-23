import type { MyStudentSessionsQuery_myStudentSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import type { SessionRowAction } from "@/frontend/views/student/sessions/sessionRowAction";
import {
  CONFIRM_PENDING_STATUSES,
  RATE_ELIGIBLE_STATUSES,
} from "@/frontend/views/student/sessions/sessionRowPresentation";
import { type InFlightSlots, isInFlight } from "@/frontend/views/student/sessions/studentSessionInFlightSlots";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * Student affordance matrix: the Confirm descriptor renders ONLY
 * on the exactly-once pending shape (`Completed` ∧ student stamp unset ∧
 * hold still marked) — the SAME predicate the row's pending pill keys off.
 * Once the dual-confirmation handshake settles (BOTH stamps present), the
 * Rate descriptor renders instead — unless the session is already in the
 * student's rated set, whose write-once end-state renders the read-only
 * rated chip. The descriptor disables while THIS row's `confirm` slot is in
 * flight and carries the consequence-explainer tooltip (the held fee becomes
 * the teacher's earning); the rate descriptor carries the one-shot tooltip.
 * Every other shape gets an empty list.
 */
export function studentActionsForSession(
  session: MyStudentSessionsQuery_myStudentSessions_items,
  wiring: {
    readonly t: SessionsLabels;
    readonly inFlightSlots: InFlightSlots;
    readonly onConfirm: (sessionId: string) => void;
    /** Session ids the student has already rated (rated-set read, `sessionId` numbers). */
    readonly ratedSessionIds: ReadonlySet<number>;
    /** Rate-CTA intent — the container owns the dialog slot. */
    readonly onRate: (sessionId: string) => void;
  }
): ReadonlyArray<SessionRowAction> {
  const isConfirmPending =
    session.status in CONFIRM_PENDING_STATUSES && session.confirmedByStudentAt === null && session.feeHeld;
  if (isConfirmPending) {
    return [
      {
        id: "confirm",
        label: wiring.t.confirmCompletion,
        tooltip: wiring.t.confirmCompletionTooltip,
        color: "success",
        disabled: isInFlight(wiring.inFlightSlots, session.id, "confirm"),
        onIntent: wiring.onConfirm,
      },
    ];
  }
  const isRatePending =
    session.status in RATE_ELIGIBLE_STATUSES &&
    session.confirmedByTeacherAt !== null &&
    session.confirmedByStudentAt !== null;
  if (isRatePending) {
    // The rated set carries the read's numeric `sessionId`s; the row id is
    // the same session's GraphQL ID wire form.
    if (wiring.ratedSessionIds.has(Number(session.id))) {
      return [{ id: "rate", label: wiring.t.teacherRatedChip, readOnly: true }];
    }
    return [
      {
        id: "rate",
        label: wiring.t.rateTeacher,
        tooltip: wiring.t.rateTeacherTooltip,
        onIntent: wiring.onRate,
      },
    ];
  }
  return [];
}
