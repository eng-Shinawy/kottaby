import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  AdminDisputedSessionsQuery,
  AdminDisputedSessionsQueryVariables,
  OpenSessionDisputeMutation,
  OpenSessionDisputeMutationVariables,
  ResolveSessionDisputeMutation,
  ResolveSessionDisputeMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Session DISPUTE documents (DEV3-005) — the arbitration third of the split
 * out of `session.documents.ts` (which re-exports every sibling, so the
 * deep-import path and the export surface are unchanged).
 *
 * The DEV3-005 dispute trio: the participant escalation mutation
 * (`openSessionDispute`), the ADMIN arbitration mutation
 * (`resolveSessionDispute`) and the ADMIN read of the arbitration queue
 * (`adminDisputedSessions`). Every `Session` payload selects `id` first so
 * Apollo Client normalizes returned rows into the cache — consumers converge
 * lists via the returned `Session!` payloads WITHOUT refetch storms (per
 * `sharedDocuments/AGENTS.md` "id Field Requirement" and plan §5.4 "no
 * refetch").
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
 * `openSessionDispute(id: ID!, reason: String!)` — a session participant
 * (student OR teacher — the participant predicate is service-side)
 * escalates a `Scheduled`/`Started` session into `Disputed` with a
 * REQUIRED reason (trimmed 1..500 at the UI seam). Returns the updated
 * `Session!` payload for cache normalization — the row flips to its
 * disputed chip WITHOUT a refetch. Non-participants and nonexistent ids
 * are indistinguishable `SESSION_NOT_FOUND` denials (oracle-safe).
 */
export const openSessionDisputeMutationDocument: TypedDocumentNode<
  OpenSessionDisputeMutation,
  OpenSessionDisputeMutationVariables
> = gql`
  mutation OpenSessionDispute($id: ID!, $reason: String!) {
    openSessionDispute(id: $id, reason: $reason) {
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
 * `resolveSessionDispute(id: ID!, resolution: DisputeResolution!, note: String)`
 * — ADMIN arbitration: resolves a `Disputed` session into exactly one
 * terminal state (`Cancel` → cancelled + same-lane refund of any held fee;
 * `Complete` → completed + hold consumed, `startedAt` required). The note
 * is optional (≤ 500 chars at the UI seam). Returns the updated `Session!`
 * payload; arbitration writes (refund/hold consumption) are server-owned.
 */
export const resolveSessionDisputeMutationDocument: TypedDocumentNode<
  ResolveSessionDisputeMutation,
  ResolveSessionDisputeMutationVariables
> = gql`
  mutation ResolveSessionDispute($id: ID!, $resolution: DisputeResolution!, $note: String) {
    resolveSessionDispute(id: $id, resolution: $resolution, note: $note) {
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
 * `adminDisputedSessions(filter, limit, offset)` — the ADMIN read of the
 * arbitration queue (`SessionPage!`): every `Disputed` session, newest
 * first, honest `totalCount` under the same status-first predicate.
 * `limit` clamps 1..50 (default 25) server-side; the page clamps offset ≥ 0.
 * Admin-only scope lives server-side (`$all{authenticated, role:[Admin]}`).
 */
export const adminDisputedSessionsQueryDocument: TypedDocumentNode<
  AdminDisputedSessionsQuery,
  AdminDisputedSessionsQueryVariables
> = gql`
  query AdminDisputedSessions($filter: SessionListFilterInput, $limit: Int, $offset: Int) {
    adminDisputedSessions(filter: $filter, limit: $limit, offset: $offset) {
      items {
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
      page
      pageSize
      totalCount
    }
  }
`;
