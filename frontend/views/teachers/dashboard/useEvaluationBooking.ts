/**
 * useEvaluationBooking — the evaluation-session booking write path for
 * `EvaluationBookingDialog`, mirroring the `useVerificationPurchase`
 * precedent (the hook in its own module for Fast Refresh + max-lines).
 *
 * Owns the evaluator picker query, the per-open idempotency-key lifecycle,
 * the picker selection, and the outcome lanes of the booking confirm gate:
 *
 * - The evaluator page comes from `availableEvaluators` (stateful
 *   `useQuery` gated on `open` — the read fires when the dialog opens; no
 *   `useLazyQuery`).
 * - Confirm executes `bookEvaluationSession` carrying the per-OPEN
 *   `x-idempotency-key` context header: the key is minted fresh on every
 *   open (kept until success or close) and stable across in-place retries
 *   so a domain rejection replays the SAME claim server-side.
 * - Outcome lanes (`extensions.code` branch, localized copy only):
 *   success → loop/profile refetch + success notice + close request;
 *   `EVALUATOR_ALREADY_USED` → typed denial notice + evaluator-page
 *   refetch, dialog STAYS OPEN (choose another evaluator);
 *   `DUPLICATE_REQUEST` → idempotent success (the request already landed
 *   server-side) — loop/profile/evaluator refetch + info notice + close;
 *   `EVALUATION_LOOP_COMPLETE` / `NO_EVALUATION_CREDITS_REMAINING` /
 *   `APPLICANT_NOT_IN_EVALUATION` / `VERIFICATION_NOT_ACTIVE` → typed
 *   terminal denial + refetch + close;
 *   everything else → the generic localized failure notice, dialog stays
 *   open, retry replays the SAME kept idempotency key in place.
 *
 * Apollo hooks come from `@apollo/client/react` (stateful `useQuery`,
 * never `useLazyQuery`); every user-facing string resolves through the
 * compile-time `Applicant`/`Errors` namespace handles (property access
 * only).
 */

import { useMutation, useQuery } from "@apollo/client/react";
import { useRef, useState } from "react";
import type {
  AvailableEvaluatorsQuery_availableEvaluators_items,
  AvailableEvaluatorsQueryVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  availableEvaluatorsQueryDocument,
  bookEvaluationSessionMutationDocument,
} from "@/frontend/graphql/sharedDocuments/teachers/evaluation-booking.documents";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { Applicant, Errors, useAppTranslation } from "@/shared/locale";
import type { ApplicantLabels } from "@/shared/locale/types/applicant";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/** The transient booking notice record rendered through the shared notice slot. */
type BookingNotice = { readonly message: string; readonly severity: "success" | "info" | "error" };

/** Everything the module-scope outcome lanes need to settle one booking result. */
interface BookingSettleWiring {
  /** Compile-time localized copy handles (property access only). */
  readonly t: ApplicantLabels;
  readonly te: ErrorsLabels;
  /** Closes the dialog — rotates the claim key and resets the selection. */
  readonly closeDialog: () => void;
  readonly refetchLoopStatus: () => Promise<unknown>;
  readonly refetchProfile: () => Promise<unknown>;
  readonly refetchEvaluators: () => Promise<unknown>;
  readonly setNotice: (notice: BookingNotice) => void;
  readonly clearSelection: () => void;
}

/**
 * Typed terminal denial — the loop state changed server-side; refetch so
 * the status card + zone re-render the truthful state, surface the
 * localized denial, and close the dialog.
 */
async function settleTerminal(message: string, wiring: BookingSettleWiring): Promise<void> {
  await Promise.all([wiring.refetchLoopStatus(), wiring.refetchProfile()]).catch(() => undefined);
  wiring.setNotice({ message, severity: "error" });
  wiring.closeDialog();
}

/**
 * Branches a rejected `bookEvaluationSession` confirmation onto its typed
 * outcome lane (plan §6): the one retryable code stays open with a
 * refetched page, the idempotent replay settles as success, the four
 * terminal codes settle closed, everything else lands on the generic
 * retryable-in-place lane.
 */
async function settleRejection(code: string | null, wiring: BookingSettleWiring): Promise<void> {
  const { t, te } = wiring;
  if (code === "EVALUATOR_ALREADY_USED") {
    // The used evaluator drops off the page on refetch; the dialog STAYS
    // OPEN so the caller picks another.
    wiring.clearSelection();
    await wiring.refetchEvaluators().catch(() => undefined);
    wiring.setNotice({ message: te.evaluatorAlreadyUsed, severity: "error" });
    return;
  }
  if (code === "DUPLICATE_REQUEST") {
    // Same-key replay: the first request already landed server-side —
    // surface it as already-received (calm info lane, the deliberate
    // student-booking posture mirror).
    await Promise.all([wiring.refetchLoopStatus(), wiring.refetchProfile(), wiring.refetchEvaluators()]).catch(
      () => undefined
    );
    wiring.setNotice({ message: t.evaluationBookingSuccess, severity: "info" });
    wiring.closeDialog();
    return;
  }
  if (code === "EVALUATION_LOOP_COMPLETE") {
    await settleTerminal(te.evaluationLoopComplete, wiring);
    return;
  }
  if (code === "NO_EVALUATION_CREDITS_REMAINING") {
    await settleTerminal(te.noEvaluationCreditsRemaining, wiring);
    return;
  }
  if (code === "APPLICANT_NOT_IN_EVALUATION") {
    await settleTerminal(te.applicantNotInEvaluation, wiring);
    return;
  }
  if (code === "VERIFICATION_NOT_ACTIVE") {
    await settleTerminal(te.verificationSubscriptionNotActive, wiring);
    return;
  }
  // Every other code (transport, TEACHER_NOT_CERTIFIED, …) lands on the
  // generic retryable-in-place lane — a retry replays the SAME kept key.
  wiring.setNotice({ message: te.internalServerError, severity: "error" });
}

interface EvaluationBookingWiring {
  /** Whether the booking dialog is open. */
  readonly open: boolean;
  /** Closes the dialog (every settle lane + dismiss affordance routes here). */
  readonly onClose: () => void;
  /** Refetches the caller's evaluation-loop status after outcomes that change it. */
  readonly refetchLoopStatus: () => Promise<unknown>;
  /** Refetches the applicant profile after outcomes that change it. */
  readonly refetchProfile: () => Promise<unknown>;
}

interface EvaluationBooking {
  /** The picker page items (empty until the open-gated read settles). */
  readonly evaluators: readonly AvailableEvaluatorsQuery_availableEvaluators_items[];
  /** `true` while the evaluator-page read is in flight. */
  readonly evaluatorsLoading: boolean;
  /** The selected evaluator's id, or `null` while nothing is chosen. */
  readonly selectedEvaluatorId: string | null;
  /** Marks one evaluator row as the confirm target. */
  readonly selectEvaluator: (id: string) => void;
  /** `true` while the booking mutation is in flight. */
  readonly booking: boolean;
  /**
   * Closes the dialog from ANY dismiss affordance — rotates the claim key
   * and resets the stale selection so a reopen starts from a fresh page.
   */
  readonly closeBooking: () => void;
  /** The transient booking notice (null = idle; survives the dialog close). */
  readonly notice: BookingNotice | null;
  /** Confirms the booking against the selected evaluator. */
  readonly confirmBooking: () => Promise<void>;
  /** Dismisses the transient notice. */
  readonly dismissNotice: () => void;
}

/** The booking write path — see the module docblock. */
export function useEvaluationBooking(wiring: EvaluationBookingWiring): EvaluationBooking {
  const t = useAppTranslation(Applicant);
  const te = useAppTranslation(Errors);
  const { open, onClose, refetchLoopStatus, refetchProfile } = wiring;
  const [notice, setNotice] = useState<BookingNotice | null>(null);
  const [selectedEvaluatorId, setSelectedEvaluatorId] = useState<string | null>(null);
  // Per-open idempotency key — minted on every close/settle (kept until
  // success or close per plan §6), stable across in-place retries so
  // domain rejections replay the same claim server-side.
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());
  // The picker reads the first page with the largest service-legal window
  // (capped at 100 server-side; the loop's exclusion set stays small); the
  // read fires when the dialog opens (the surface is reachable only from
  // the evaluation-zone CTA).
  const evaluatorPageVariables: AvailableEvaluatorsQueryVariables = { page: 1, pageSize: 50 };
  const {
    data: evaluatorsData,
    loading: evaluatorsLoading,
    refetch: refetchEvaluators,
  } = useQuery(availableEvaluatorsQueryDocument, { variables: evaluatorPageVariables, skip: !open });
  const [bookEvaluationSession, { loading: booking }] = useMutation(bookEvaluationSessionMutationDocument);

  const evaluators = evaluatorsData?.availableEvaluators.items ?? [];

  const closeBooking = (): void => {
    idempotencyKeyRef.current = crypto.randomUUID();
    setSelectedEvaluatorId(null);
    onClose();
  };

  const settleWiring: BookingSettleWiring = {
    t,
    te,
    closeDialog: closeBooking,
    refetchLoopStatus,
    refetchProfile,
    refetchEvaluators,
    setNotice,
    clearSelection: () => {
      setSelectedEvaluatorId(null);
    },
  };

  const confirmBooking = async (): Promise<void> => {
    if (selectedEvaluatorId === null || booking) {
      return;
    }
    try {
      const result = await bookEvaluationSession({
        variables: { input: { evaluatorId: selectedEvaluatorId } },
        context: { headers: { "x-idempotency-key": idempotencyKeyRef.current } },
      });
      const payload = result.data?.bookEvaluationSession;
      if (!payload) {
        // Transport-masked settle without data — the same retryable
        // generic lane as the catch arm. The dialog stays open.
        setNotice({ message: te.internalServerError, severity: "error" });
        return;
      }
      // The booking committed server-side; the loop/profile refetches
      // re-render the zone + card into their new state. A refetch failure
      // folds silently — it must not mask the success notice.
      await Promise.all([refetchLoopStatus(), refetchProfile()]).catch(() => undefined);
      setNotice({ message: t.evaluationBookingSuccess, severity: "success" });
      closeBooking();
    } catch (mutationError: unknown) {
      await settleRejection(extractErrorCode(mutationError), settleWiring);
    }
  };

  const selectEvaluator = (id: string): void => setSelectedEvaluatorId(id);

  const dismissNotice = (): void => setNotice(null);

  return {
    evaluators,
    evaluatorsLoading,
    selectedEvaluatorId,
    selectEvaluator,
    booking,
    closeBooking,
    notice,
    confirmBooking,
    dismissNotice,
  };
}
