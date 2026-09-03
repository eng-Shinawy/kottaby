import type { ApolloCache } from "@apollo/client";
import { useMutation } from "@apollo/client/react";
import { useCallback } from "react";
import {
  type MyStudentSessionsQuery_myStudentSessions_items,
  SessionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import { confirmSessionCompletionMutationDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import {
  isNotFoundErrorFamily,
  mapGraphQLErrorByCode,
  normalizeGraphQLErrorCode,
} from "@/frontend/providers/apollo/error-link.map";
import {
  evictSessionFromListFields,
  STUDENT_SESSION_LIST_FIELDS,
} from "@/frontend/views/student/sessions/sessionListCacheEviction";
import type { SessionRowAction } from "@/frontend/views/student/sessions/sessionRowAction";
import { type InFlightSlots, isInFlight } from "@/frontend/views/student/sessions/studentSessionInFlightSlots";
import {
  dropRowAlert,
  type StudentSessionNoticeWiring,
} from "@/frontend/views/student/sessions/useStudentSessionNotices";
import type { ErrorsLabels } from "@/shared/locale/types/errors";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/** Unmapped lifecycle-reject code (the mapping table defines NO row for it). */
const SESSION_INVALID_TRANSITION_CODE = "SESSION_INVALID_TRANSITION";

/** Copy handles + slot bookkeeping + shared setters the confirm flow rides on. */
export interface StudentSessionConfirmDeps extends StudentSessionNoticeWiring {
  /** The Apollo cache — the not-found arm evicts the row from the student list. */
  readonly cache: ApolloCache;
  readonly sessionsCopy: SessionsLabels;
  readonly errorsCopy: ErrorsLabels;
  readonly claimConfirmSlot: (sessionId: string) => void;
  readonly clearConfirmSlot: (sessionId: string) => void;
}

/** The confirm-completion affordances the body maps onto its rows. */
export interface StudentSessionConfirmApi {
  /** Confirm-CTA intent — the container owns the mutation launch. */
  readonly handleConfirm: (sessionId: string) => void;
}

/**
 * Confirm error arm — classifies the mutation error and routes
 * the outcome table: not-found family → student-list eviction + error
 * snackbar; `SESSION_INVALID_TRANSITION` → row-scoped inline alert;
 * `FORBIDDEN` → error snackbar; everything else → the generic error
 * snackbar. The caller's `confirm` in-flight slot is cleared FIRST, always.
 */
function handleConfirmMutationError(
  mutationError: unknown,
  wiring: {
    readonly cache: ApolloCache;
    readonly sessionId: string;
    readonly t: SessionsLabels;
    readonly te: ErrorsLabels;
    readonly clearInFlight: () => void;
  } & StudentSessionNoticeWiring
): void {
  wiring.clearInFlight();
  const rawCode = extractErrorCode(mutationError);
  const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
  if (isNotFoundErrorFamily(code)) {
    // The container owns the student-list eviction — the row has already
    // left the list when the snackbar lands.
    evictSessionFromListFields(wiring.cache, wiring.sessionId, STUDENT_SESSION_LIST_FIELDS);
    wiring.setRowAlerts(prev => dropRowAlert(prev, wiring.sessionId));
    wiring.setNotice({ message: wiring.te.sessionNotFound, severity: "error" });
    return;
  }
  const action = mapGraphQLErrorByCode(code, { contextKind: "mutation", hasForm: false });
  if (code === SESSION_INVALID_TRANSITION_CODE) {
    wiring.setRowAlerts(prev => ({ ...prev, [wiring.sessionId]: wiring.te.sessionInvalidTransition }));
    return;
  }
  if (action?.kind === "toast" && action.messageKey === "forbidden") {
    wiring.setNotice({ message: wiring.te.forbidden, severity: "error" });
    return;
  }
  wiring.setNotice({ message: wiring.t.genericError, severity: "error" });
}

/**
 * Confirm-completion wiring (DEV3-012, container-owned, no dialog — the
 * row's Confirm CTA fires directly, its consequence explainer riding the
 * CTA tooltip). Per-call options carry the session id in scope so every
 * outcome arm can address ITS row (row alerts, in-flight clearing)
 * precisely.
 */
export function useStudentSessionConfirm(deps: Readonly<StudentSessionConfirmDeps>): StudentSessionConfirmApi {
  const { cache, sessionsCopy: t, errorsCopy: te, claimConfirmSlot, clearConfirmSlot, setRowAlerts, setNotice } = deps;

  const [confirmSessionCompletion] = useMutation(confirmSessionCompletionMutationDocument);

  const handleConfirm = useCallback(
    (sessionId: string): void => {
      claimConfirmSlot(sessionId);
      void confirmSessionCompletion({
        variables: { id: sessionId },
        // Cache NORMALIZE — rewrite the transitioned fields onto the
        // normalized `Session:<id>` entity (belt-and-braces over the
        // automatic normalized merge of the returned `Session!` payload).
        // NO refetch. The student stamp appearing + the hold releasing is
        // what removes the Confirm CTA and the pending pill in place.
        update(mutationCache, { data: resultData }) {
          const confirmed = resultData?.confirmSessionCompletion;
          if (!confirmed) return;
          mutationCache.modify({
            id: mutationCache.identify({ __typename: "Session", id: confirmed.id }),
            fields: {
              status: () => confirmed.status,
              feeHeld: () => confirmed.feeHeld,
              confirmedByStudentAt: () => confirmed.confirmedByStudentAt,
            },
          });
        },
        onCompleted: result => {
          clearConfirmSlot(sessionId);
          setRowAlerts(prev => dropRowAlert(prev, result.confirmSessionCompletion.id));
          setNotice({ message: t.sessionConfirmedNotice, severity: "success" });
        },
        onError: mutationError =>
          handleConfirmMutationError(mutationError, {
            cache,
            sessionId,
            t,
            te,
            clearInFlight: () => clearConfirmSlot(sessionId),
            setRowAlerts,
            setNotice,
          }),
      });
    },
    [confirmSessionCompletion, cache, t, te, claimConfirmSlot, clearConfirmSlot, setRowAlerts, setNotice]
  );

  return { handleConfirm };
}

/**
 * Confirm affordance matrix: the Confirm descriptor renders ONLY
 * on the exactly-once pending shape (`Completed` ∧ student stamp unset ∧
 * hold still marked) — the SAME predicate the row's pending pill keys off.
 * The descriptor disables while THIS row's `confirm` slot is in flight and
 * carries the consequence-explainer tooltip (the held fee becomes the
 * teacher's earning). Every other shape gets an empty list.
 */
export function studentActionsForSession(
  session: MyStudentSessionsQuery_myStudentSessions_items,
  wiring: {
    readonly t: SessionsLabels;
    readonly inFlightSlots: InFlightSlots;
    readonly onConfirm: (sessionId: string) => void;
  }
): ReadonlyArray<SessionRowAction> {
  const isConfirmPending =
    session.status === SessionStatus.Completed && session.confirmedByStudentAt === null && session.feeHeld;
  if (!isConfirmPending) {
    return [];
  }
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
