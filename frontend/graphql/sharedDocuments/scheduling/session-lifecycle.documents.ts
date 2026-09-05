import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  CancelSessionMutation,
  CancelSessionMutationVariables,
  CompleteSessionMutation,
  CompleteSessionMutationVariables,
  ConfirmSessionCompletionMutation,
  ConfirmSessionCompletionMutationVariables,
  CreateSessionMutation,
  CreateSessionMutationVariables,
  StartSessionMutation,
  StartSessionMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Session LIFECYCLE mutation documents — the write third of the split out of
 * `session.documents.ts` (which re-exports every sibling, so the
 * deep-import path and the export surface are unchanged).
 *
 * Five mutations over the DEV3-004 SDL surface: the creation/lifecycle
 * quartet (`createSession`, `startSession`, `completeSession`,
 * `cancelSession`) plus the DEV3-012 dual-confirmation mutation
 * (`confirmSessionCompletion`). Every `Session` payload selects `id` first
 * so Apollo Client normalizes returned rows into the cache — consumers
 * converge lists via the returned `Session!` payloads WITHOUT refetch
 * storms (per `sharedDocuments/AGENTS.md` "id Field Requirement" and plan
 * §5.4 "no refetch").
 *
 * Every `Session` selection carries the DEV3-005 dispute/cancel-audit
 * fields (`cancelReason`, `disputeReason`, `disputedAt`, `resolutionNote`,
 * `resolvedAt` — all nullable) so the rows that render them (cancelled
 * rows with a persisted cancel reason; the admin arbitration list) and
 * the cache-normalize `update` arms share ONE field shape across the
 * family.
 *
 * All types come from the codegen output
 * (`@/frontend/graphql/generated/gql/graphql`) — never inline literals
 * as TYPES, never mapping layers. Hooks (`useQuery`, `useMutation`) are
 * consumed from `@apollo/client/react` in views; `useLazyQuery` is banned.
 */

/**
 * `createSession(input: CreateSessionInput!)` — books a session
 * (`intent` + `teacherId`; student identity is server-bound). Returns the
 * created `Session!` for cache normalization. Callers pass a fresh
 * `X-Idempotency-Key` per logical booking attempt (see `docs/IDEMPOTENCY.md`).
 */
export const createSessionMutationDocument: TypedDocumentNode<CreateSessionMutation, CreateSessionMutationVariables> =
  gql`
  mutation CreateSession($input: CreateSessionInput!) {
    createSession(input: $input) {
      id
      status
      intent
      sessionType
      fee
      feeHeld
      studentId
      teacherId
      startedAt
      endedAt
      confirmationDeadline
      confirmedByStudentAt
      confirmedByTeacherAt
      createdAt
      updatedAt
      cancelReason
      disputeReason
      disputedAt
      resolutionNote
      resolvedAt
    }
  }
`;

/**
 * `startSession(id: ID!)` — teacher transitions `Scheduled → Started`.
 * Returns the updated `Session!` payload; the Apollo cache converges by `id`.
 */
export const startSessionMutationDocument: TypedDocumentNode<StartSessionMutation, StartSessionMutationVariables> = gql`
  mutation StartSession($id: ID!) {
    startSession(id: $id) {
      id
      status
      intent
      sessionType
      fee
      feeHeld
      studentId
      teacherId
      startedAt
      endedAt
      confirmationDeadline
      confirmedByStudentAt
      confirmedByTeacherAt
      createdAt
      updatedAt
      cancelReason
      disputeReason
      disputedAt
      resolutionNote
      resolvedAt
    }
  }
`;

/**
 * `completeSession(id: ID!)` — teacher transitions `Started → Completed`
 * (settles the held fee). Returns the updated `Session!` payload.
 */
export const completeSessionMutationDocument: TypedDocumentNode<
  CompleteSessionMutation,
  CompleteSessionMutationVariables
> = gql`
  mutation CompleteSession($id: ID!) {
    completeSession(id: $id) {
      id
      status
      intent
      sessionType
      fee
      feeHeld
      studentId
      teacherId
      startedAt
      endedAt
      confirmationDeadline
      confirmedByStudentAt
      confirmedByTeacherAt
      createdAt
      updatedAt
      cancelReason
      disputeReason
      disputedAt
      resolutionNote
      resolvedAt
    }
  }
`;

/**
 * `cancelSession(id: ID!, reason: String)` — participant cancels a
 * `Scheduled`/`Started` session (optional reason string, ≤ 500 chars
 * enforced at the UI seam). Returns the updated `Session!` payload; the
 * fee hold release surfaces server-side.
 */
export const cancelSessionMutationDocument: TypedDocumentNode<CancelSessionMutation, CancelSessionMutationVariables> =
  gql`
  mutation CancelSession($id: ID!, $reason: String) {
    cancelSession(id: $id, reason: $reason) {
      id
      status
      intent
      sessionType
      fee
      feeHeld
      studentId
      teacherId
      startedAt
      endedAt
      confirmationDeadline
      confirmedByStudentAt
      confirmedByTeacherAt
      createdAt
      updatedAt
      cancelReason
      disputeReason
      disputedAt
      resolutionNote
      resolvedAt
    }
  }
`;

/**
 * `confirmSessionCompletion(id: ID!)` — DEV3-012 (R-201/R-202): the
 * student's completion confirmation, the second dual-confirmation half.
 * IDEMPOTENT — a repeat confirm, the teacher caller, or an already-released
 * hold returns the current `Session!` payload with ZERO financial writes;
 * the FIRST student confirm on a completed hold-marked row writes the
 * student stamp and credits the teacher's wallet server-side (one atomic
 * slice). Non-participants and nonexistent ids are indistinguishable
 * `SESSION_NOT_FOUND` denials (oracle-safe); a non-completed row denies
 * with `SESSION_INVALID_TRANSITION`.
 */
export const confirmSessionCompletionMutationDocument: TypedDocumentNode<
  ConfirmSessionCompletionMutation,
  ConfirmSessionCompletionMutationVariables
> = gql`
  mutation ConfirmSessionCompletion($id: ID!) {
    confirmSessionCompletion(id: $id) {
      id
      status
      intent
      sessionType
      fee
      feeHeld
      studentId
      teacherId
      startedAt
      endedAt
      confirmationDeadline
      confirmedByStudentAt
      confirmedByTeacherAt
      createdAt
      updatedAt
      cancelReason
      disputeReason
      disputedAt
      resolutionNote
      resolvedAt
    }
  }
`;
