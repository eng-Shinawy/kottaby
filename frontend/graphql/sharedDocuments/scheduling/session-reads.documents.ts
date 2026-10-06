import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  MyStudentSessionsQuery,
  MyStudentSessionsQueryVariables,
  MyTeacherSessionsQuery,
  MyTeacherSessionsQueryVariables,
  SessionByIdQuery,
  SessionByIdQueryVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Participant session READ documents (the `Session` lifecycle + dispute
 * domain) — the read third of the split out of
 * `session.documents.ts` (which re-exports every sibling, so the
 * deep-import path and the export surface are unchanged).
 *
 * Three reads over the session lifecycle SDL surface: the nullable single-session
 * read (`sessionById`) and the two paginated participant lists
 * (`myStudentSessions`, `myTeacherSessions`). Every `Session` payload
 * selects `id` first so Apollo Client normalizes returned rows into the
 * cache — consumers converge lists via the returned `Session!` payloads
 * WITHOUT refetch storms (per `sharedDocuments/AGENTS.md` "id Field
 * Requirement" and plan §5.4 "no refetch").
 *
 * Every `Session` selection carries the dispute/cancel-audit
 * fields (`cancelReason`, `disputeReason`, `disputedAt`, `resolutionNote`,
 * `resolutionOutcome`, `resolvedAt` — all nullable) so the rows that render them (cancelled
 * rows with a persisted cancel reason; the admin arbitration list) and
 * the cache-normalize `update` arms share ONE field shape across the
 * family.
 *
 * BOTH list selections carry BOTH participant identity bands
 * (`student { id fullName }` AND `teacher { id fullName }`) — the
 * documented structural identity of the two item shapes that lets ONE
 * `SessionRow` component serve both surfaces (a teacher row passes
 * without a mapping layer). The bands are NULLABLE on the wire: each list
 * batch-enriches ONLY the counterpart side (the student lister stamps the
 * teacher, the teacher lister stamps the student), so the own-side band
 * resolves null there; `sessionById` stays band-free — its producers
 * never populate the names and the row's identity consumers read the
 * exposed participant ids.
 *
 * All types come from the codegen output
 * (`@/frontend/graphql/generated/gql/graphql`) — never inline literals
 * as TYPES, never mapping layers. Hooks (`useQuery`, `useMutation`) are
 * consumed from `@apollo/client/react` in views; `useLazyQuery` is banned.
 */

/**
 * `sessionById(id: ID!)` — nullable single-session read for participants.
 * Returns `null` for foreign/nonexistent/never-existed ids (one no-oracle
 * answer — the row is sensitive), so consumers must handle the empty case.
 */
export const sessionByIdQueryDocument: TypedDocumentNode<SessionByIdQuery, SessionByIdQueryVariables> = gql`
  query SessionById($id: ID!) {
    sessionById(id: $id) {
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
    }
  }
`;

/**
 * `myStudentSessions(filter, page, pageSize)` — the authenticated student's
 * paginated session list (`SessionPage!`). Identity is server-bound
 * (`ctx.user.id`); no student identity variable exists (BOPLA hygiene).
 */
export const myStudentSessionsQueryDocument: TypedDocumentNode<
  MyStudentSessionsQuery,
  MyStudentSessionsQueryVariables
> = gql`
  query MyStudentSessions($filter: SessionListFilterInput, $page: Int, $pageSize: Int) {
    myStudentSessions(filter: $filter, page: $page, pageSize: $pageSize) {
      items {
        id
        status
        intent
        sessionType
        fee
        feeHeld
        studentId
        teacherId
        student {
          id
          fullName
        }
        teacher {
          id
          fullName
        }
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
      }
      page
      pageSize
      totalCount
    }
  }
`;

/**
 * `myTeacherSessions(filter, page, pageSize)` — the authenticated teacher's
 * paginated session list (`SessionPage!`). Mirrors `myStudentSessions`;
 * teacher applicants get an empty page, never an error.
 */
export const myTeacherSessionsQueryDocument: TypedDocumentNode<
  MyTeacherSessionsQuery,
  MyTeacherSessionsQueryVariables
> = gql`
  query MyTeacherSessions($filter: SessionListFilterInput, $page: Int, $pageSize: Int) {
    myTeacherSessions(filter: $filter, page: $page, pageSize: $pageSize) {
      items {
        id
        status
        intent
        sessionType
        fee
        feeHeld
        studentId
        teacherId
        student {
          id
          fullName
        }
        teacher {
          id
          fullName
        }
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
      }
      page
      pageSize
      totalCount
    }
  }
`;
