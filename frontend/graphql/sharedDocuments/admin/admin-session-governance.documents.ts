import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  AdminSessionCancelMutation,
  AdminSessionCancelMutationVariables,
  AdminSessionJoinMutation,
  AdminSessionJoinMutationVariables,
  AdminSessionQuery,
  AdminSessionQueryVariables,
  AdminSessionReassignMutation,
  AdminSessionReassignMutationVariables,
  AdminSessionRescheduleMutation,
  AdminSessionRescheduleMutationVariables,
  AdminSessionsQuery,
  AdminSessionsQueryVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Admin session-governance documents — the admin surface over the canonical
 * `Session`/`SessionPage` objects: the paginated directory
 * read (`adminSessions`), the nullable browse-detail read (`adminSession`)
 * and the governance mutation quartet (`adminRescheduleSession`,
 * `adminCancelSession`, `adminReassignTeacher`, `adminJoinSession`).
 *
 * Per `frontend/graphql/sharedDocuments/AGENTS.md`:
 *  - All documents use `gql` + `TypedDocumentNode` (codegen types only —
 *    never inline literals as TYPES, never mapping layers).
 *  - `id` is selected FIRST in every object selection (Apollo cache
 *    normalization).
 *  - Every `Session` selection carries the SAME field shape across the
 *    family (the participant lifecycle field set plus the server-derived
 *    `needsAttention` badge) so returned `Session!` mutation payloads
 *    converge the directory rows WITHOUT refetch storms.
 *  - `needsAttention` is selected on BOTH reads: on `adminSessions`
 *    directory rows it carries the server-derived badge (a disputed row,
 *    or a scheduled row whose confirmation deadline has lapsed); the
 *    `adminSession` browse detail and every mutation payload resolve it
 *    to `false` (directory-only producer) but still select it to keep the
 *    `Session` shape uniform.
 *  - Hooks (`useQuery`, `useMutation`) are consumed from
 *    `@apollo/client/react` in views; `useLazyQuery` is banned.
 *  - The directory `filter` is REQUIRED and its participant-id members are
 *    `Int` (send numbers); `page`/`pageSize` are optional variables (the
 *    server defaults the page to 1 and the page size to 25).
 */

/**
 * `adminSessions(filter, page, pageSize)` — the admin governance directory:
 * every session row regardless of state or ownership, newest first, paged
 * with an honest total (`totalCount` computed by the same filtered query).
 * Returns `SessionPage!`; each row carries the server-derived
 * `needsAttention` badge (presentation only, never an authorization
 * signal).
 */
export const adminSessionsQueryDocument: TypedDocumentNode<AdminSessionsQuery, AdminSessionsQueryVariables> = gql`
  query AdminSessions($filter: AdminSessionListFilterInput!, $page: Int, $pageSize: Int) {
    adminSessions(filter: $filter, page: $page, pageSize: $pageSize) {
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
        resolutionOutcome
        resolvedAt
        needsAttention
      }
      page
      pageSize
      totalCount
    }
  }
`;

/**
 * `adminSession(id: ID!)` — the admin browse detail: the row for ANY id
 * regardless of lifecycle state (view is read-only). Nullable payload —
 * unknown and malformed ids resolve to `null` (absence answers with data,
 * not with an error), so consumers must handle the empty case.
 */
export const adminSessionQueryDocument: TypedDocumentNode<AdminSessionQuery, AdminSessionQueryVariables> = gql`
  query AdminSession($id: ID!) {
    adminSession(id: $id) {
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
      resolutionOutcome
      resolvedAt
      needsAttention
    }
  }
`;

/**
 * `adminRescheduleSession(input: AdminSessionRescheduleInput!)` — guarded
 * timing-pair transition (`scheduled`/`started` rows only). Ordering and
 * the past-start grace window are validated server-side before any read;
 * ineligible rows deny with a localized `SESSION_INVALID_TRANSITION`
 * conflict. Returns the updated `Session!` payload; the Apollo cache
 * converges by `id`.
 */
export const adminSessionRescheduleMutationDocument: TypedDocumentNode<
  AdminSessionRescheduleMutation,
  AdminSessionRescheduleMutationVariables
> = gql`
  mutation AdminSessionReschedule($input: AdminSessionRescheduleInput!) {
    adminRescheduleSession(input: $input) {
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
      resolutionOutcome
      resolvedAt
      needsAttention
    }
  }
`;

/**
 * `adminCancelSession(input: AdminSessionCancelInput!)` — pre-terminal
 * cancel (`scheduled`/`started` rows only) that releases the recorded fee
 * hold exactly once. Keyed retries with the same `X-Idempotency-Key`
 * header are no-ops returning the current row — never a duplicate audit
 * row nor a second refund. Returns the updated `Session!` payload.
 */
export const adminSessionCancelMutationDocument: TypedDocumentNode<
  AdminSessionCancelMutation,
  AdminSessionCancelMutationVariables
> = gql`
  mutation AdminSessionCancel($input: AdminSessionCancelInput!) {
    adminCancelSession(input: $input) {
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
      resolutionOutcome
      resolvedAt
      needsAttention
    }
  }
`;

/**
 * `adminReassignTeacher(input: AdminSessionReassignInput!)` — moves a
 * `scheduled` session to a different certified teacher (the candidate's
 * approval is asserted under lock; an unapproved candidate denies with
 * `TEACHER_NOT_CERTIFIED` and leaves the row untouched). Returns the
 * updated `Session!` payload; the cache converges by `id`.
 */
export const adminSessionReassignMutationDocument: TypedDocumentNode<
  AdminSessionReassignMutation,
  AdminSessionReassignMutationVariables
> = gql`
  mutation AdminSessionReassign($input: AdminSessionReassignInput!) {
    adminReassignTeacher(input: $input) {
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
      resolutionOutcome
      resolvedAt
      needsAttention
    }
  }
`;

/**
 * `adminJoinSession(input: AdminSessionJoinInput!)` — joins a `started`
 * session as a read-only observer (audit-only: exactly one audit row, no
 * session column changes). Rows that are not `started` deny with a
 * localized `SESSION_INVALID_TRANSITION` conflict and zero audit rows.
 * Returns the SAME `Session!` shape the participant read path returns.
 */
export const adminSessionJoinMutationDocument: TypedDocumentNode<
  AdminSessionJoinMutation,
  AdminSessionJoinMutationVariables
> = gql`
  mutation AdminSessionJoin($input: AdminSessionJoinInput!) {
    adminJoinSession(input: $input) {
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
      resolutionOutcome
      resolvedAt
      needsAttention
    }
  }
`;
