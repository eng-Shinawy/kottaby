import type { TypedDocumentNode } from "@apollo/client";
import type {
  MyStudentSessionsQuery_myStudentSessions_items,
  OpenPostConfirmationDisputeMutation,
  OpenSessionDisputeMutation,
  OpenSessionDisputeMutation_openSessionDispute,
  OpenSessionDisputeMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  openPostConfirmationDisputeMutationDocument,
  openSessionDisputeMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { isPostConfirmationDisputable } from "@/frontend/views/student/sessions/sessionRowPresentation";

/**
 * The dispute mutations' binding vocabulary — the MUTATION-GENERATION
 * NEUTRAL seam the dispute dialog rides on: the mutation document + the
 * result accessor projecting the operation's payload onto the shared
 * dispute-family `Session` row. The two dispute generations share ONE
 * variables shape (`id` + REQUIRED `reason`) and ONE payload row, so the
 * layout, cache arm and error arms stay shared:
 *
 *  - the pre-completion (held-escrow) arm binds
 *    `openSessionDisputeMutationDocument` — the shipped participant
 *    escalation, byte-stable for student AND teacher surfaces;
 *  - the student post-confirmation arm binds
 *    `openPostConfirmationDisputeMutationDocument` — the student
 *    escalation for a dual-confirmed (hold consumed) row.
 */

/** The shared dispute-family mutation payload row (the dispute `Session` selection). */
type SessionDisputePayloadRow = OpenSessionDisputeMutation_openSessionDispute;

/**
 * The dispute mutations' ONE wire variables shape — `id` plus the REQUIRED
 * `reason`. Both dispute generations declare the identical variables set,
 * so the dialog's submit path is generation-neutral.
 */
type SessionDisputeMutationVariables = OpenSessionDisputeMutationVariables;

/**
 * The two dispute-generation mutation results the dialog parameterizes
 * over — the held-escrow escalation and the post-confirmation escalation.
 */
type SessionDisputeMutationData = OpenSessionDisputeMutation | OpenPostConfirmationDisputeMutation;

/**
 * The mutation binding the dispute dialog rides on: the dispute-generation
 * mutation document + the result accessor projecting the operation result
 * onto the shared dispute-family payload row. Callers pick the binding per
 * disputed row's generation (see {@link resolveStudentDisputeMutation}).
 */
export interface SessionDisputeMutationProps {
  /** The dispute-generation mutation document. */
  readonly mutationDocument: TypedDocumentNode<SessionDisputeMutationData, SessionDisputeMutationVariables>;
  /** Projects the mutation result onto the shared dispute-family row. */
  readonly resultAccessor: (
    data: SessionDisputeMutationData | null | undefined
  ) => SessionDisputePayloadRow | null | undefined;
}

/**
 * The dispute-family payload projection — the ONE result accessor BOTH
 * bindings share, accepting EITHER generation's payload key.
 *
 * WHY the projection must be generation-agnostic (live-found defect,
 * CR-10 cross-user QA): the container derives the dialog's binding from
 * the LIVE row on every render (`resolveStudentDisputeMutation` below).
 * The dispute mutation's own `update` flips the row to `Disputed`
 * mid-flight, so the container re-renders and RE-BINDS the dialog to the
 * other generation BEFORE the in-flight mutation's completion callbacks
 * fire (`useMutation` reads the latest options at completion time; the
 * document and `update` of the running operation stay call-time-captured,
 * which is why the row flip and the DB write were always correct). A
 * generation-narrow accessor then read the other generation's envelope,
 * projected `undefined`, and `onCompleted` skipped `onDisputed` — the
 * dialog stayed open with NO success snackbar while the dispute HAD filed.
 * Projecting whichever dispute-family key is present makes the completion
 * path drift-proof: both operations return the same shared dispute-family
 * `Session` row, so the projection is contract-identical for either
 * generation no matter which binding reads it.
 */
function projectDisputeFamilyPayload(
  data: SessionDisputeMutationData | null | undefined
): SessionDisputePayloadRow | null | undefined {
  if (data === null || data === undefined) return null;
  if ("openSessionDispute" in data) return data.openSessionDispute;
  return "openPostConfirmationDispute" in data ? data.openPostConfirmationDispute : undefined;
}

/**
 * The pre-completion (held-escrow) dispute arm — the SHIPPED participant
 * escalation, byte-stable on every surface that keeps it bound.
 */
export const OPEN_SESSION_DISPUTE_MUTATION: SessionDisputeMutationProps = {
  mutationDocument: openSessionDisputeMutationDocument,
  resultAccessor: projectDisputeFamilyPayload,
};

const OPEN_POST_CONFIRMATION_DISPUTE_MUTATION: SessionDisputeMutationProps = {
  mutationDocument: openPostConfirmationDisputeMutationDocument,
  resultAccessor: projectDisputeFamilyPayload,
};

/**
 * The student surface's dispute-mutation arm for ONE disputed row: a
 * post-confirmation row (completed + student-confirmed + hold consumed)
 * escalates through the post-confirmation document; every other shape —
 * pre-completion rows, or an unresolved row id while the dialog slot
 * mounts (e.g. the list changed under an open dialog) — keeps the SHIPPED
 * held-escrow document. The wire operations authorize server-side (the
 * post-confirmation service predicate re-validates student ownership), so
 * a degraded binding can only surface a localized denial, never an
 * unauthorized write.
 */
export function resolveStudentDisputeMutation(
  disputedSession:
    | Pick<MyStudentSessionsQuery_myStudentSessions_items, "status" | "confirmedByStudentAt" | "feeHeld" | "resolvedAt">
    | null
    | undefined
): SessionDisputeMutationProps {
  if (disputedSession !== null && disputedSession !== undefined && isPostConfirmationDisputable(disputedSession)) {
    return OPEN_POST_CONFIRMATION_DISPUTE_MUTATION;
  }
  return OPEN_SESSION_DISPUTE_MUTATION;
}
