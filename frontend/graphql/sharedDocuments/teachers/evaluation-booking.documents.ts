import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  AvailableEvaluatorsQuery,
  AvailableEvaluatorsQueryVariables,
  BookEvaluationSessionMutation,
  BookEvaluationSessionMutationVariables,
  MyEvaluationLoopStatusQuery,
  MyEvaluationSessionsQuery,
  MyEvaluationSessionsQueryVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Evaluation-booking documents — the applicant-facing four-operation
 * surface of the five-session evaluation loop (the booking mutation, the
 * loop-status read, the evaluator picker page, and the caller's
 * evaluation-session list).
 *
 * Identity is server-bound on every operation (`ctx.user.id`): no document
 * carries a caller-identity variable of any kind, so a BOLA probe has no
 * surface to address. The only client-owned field in the whole family is
 * the booking input's `evaluatorId` (the sealed one-field whitelist); the
 * idempotency key rides the `x-idempotency-key` header, never a variable.
 *
 * Every object selection includes `id` first so Apollo Client normalizes
 * returned rows into the cache (per `sharedDocuments/AGENTS.md` "id Field
 * Requirement") — pages echo their effective window, the loop-status blob
 * is read as a whole, and booked `Session` rows normalize against the
 * session family's cache entries.
 *
 * All types come from the codegen output
 * (`@/frontend/graphql/generated/gql/graphql`) — never inline literals as
 * TYPES, never mapping layers.
 */

/**
 * `bookEvaluationSession(input: BookEvaluationSessionInput!)` — books ONE
 * evaluation session with the chosen evaluator inside the caller's current
 * cycle. The wire rejects with typed `extensions.code` surfaces for every
 * denial (anonymous, non-applicant, wrong applicant state, inactive cycle,
 * capacity, distinctness, certification, replay).
 */
export const bookEvaluationSessionMutationDocument: TypedDocumentNode<
  BookEvaluationSessionMutation,
  BookEvaluationSessionMutationVariables
> = gql`
  mutation BookEvaluationSession($input: BookEvaluationSessionInput!) {
    bookEvaluationSession(input: $input) {
      id
      status
      sessionType
      intent
      teacherId
      studentId
      confirmationDeadline
      createdAt
    }
  }
`;

/**
 * `myEvaluationLoopStatus` — the caller's CURRENT-cycle progress blob
 * (nullable: the loop-closed case is the fixed zero-shape, but `null` is
 * legal on the wire). Zero-argument read: identity is the access token's
 * user, so the operation declares NO variables.
 */
export const myEvaluationLoopStatusQueryDocument: TypedDocumentNode<MyEvaluationLoopStatusQuery> = gql`
  query MyEvaluationLoopStatus {
    myEvaluationLoopStatus {
      bookedCount
      completedCount
      remainingCredits
      cycleStartDate
    }
  }
`;

/**
 * `availableEvaluators(page, pageSize)` — the PII-free evaluator picker
 * page: certified evaluators not yet used in the caller's current cycle.
 * Both pagination members are optional (the service normalizes the
 * effective window and echoes it honestly).
 */
export const availableEvaluatorsQueryDocument: TypedDocumentNode<
  AvailableEvaluatorsQuery,
  AvailableEvaluatorsQueryVariables
> = gql`
  query AvailableEvaluators($page: Int, $pageSize: Int) {
    availableEvaluators(page: $page, pageSize: $pageSize) {
      items {
        id
        fullName
        isOnline
        averageRating
        subjects
      }
      totalCount
      page
      pageSize
    }
  }
`;

/**
 * `myEvaluationSessions(filter, page, pageSize)` — the caller's own
 * teacher-evaluation session list (`SessionPage!`): the same canonical
 * page the participant session lists use. The optional `filter` carries
 * the lifecycle-state member only; a non-applicant's page is empty, never
 * an error.
 */
export const myEvaluationSessionsQueryDocument: TypedDocumentNode<
  MyEvaluationSessionsQuery,
  MyEvaluationSessionsQueryVariables
> = gql`
  query MyEvaluationSessions($filter: SessionListFilterInput, $page: Int, $pageSize: Int) {
    myEvaluationSessions(filter: $filter, page: $page, pageSize: $pageSize) {
      items {
        id
        status
        sessionType
        intent
        teacherId
        studentId
        confirmationDeadline
        createdAt
      }
      totalCount
      page
      pageSize
    }
  }
`;
