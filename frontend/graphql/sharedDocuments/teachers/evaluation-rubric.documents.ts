import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  MyRubricEvaluationQuery,
  MyRubricEvaluationQueryVariables,
  MyRubricPendingSessionsQuery,
  MyRubricPendingSessionsQueryVariables,
  SubmitRubricEvaluationMutation,
  SubmitRubricEvaluationMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Evaluation-rubric documents — the evaluator-facing three-operation surface
 * of the rubric scoring loop (the submit mutation, the evaluator's
 * pending-session page, and the caller's own submission read).
 *
 * Identity is server-bound on every operation (`ctx.user.id`): no document
 * carries an evaluator or evaluated-identity variable of any kind — the only
 * client-owned inputs are the session locator (`sessionId`) and the sealed
 * rubric payload (`score` + `notes` + `weaknessArea`), so a BOLA probe has
 * no surface to address. `notes` rides ONLY inside the mutation input
 * variable; it is absent from every read selection set.
 *
 * Every object selection includes `id` first so Apollo Client normalizes
 * returned rows into the cache (per `sharedDocuments/AGENTS.md` "id Field
 * Requirement") — submitted `RubricEvaluation` rows normalize on their own
 * identity, and the pending page's `Session` rows normalize against the
 * session family's cache entries (`SessionPage` itself is the canonical
 * id-less pagination wrapper read inline under its root field).
 *
 * All types come from the codegen output
 * (`@/frontend/graphql/generated/gql/graphql`) — never inline literals as
 * TYPES, never mapping layers.
 */

/**
 * `submitRubricEvaluation(sessionId, input)` — files ONE evaluator's rubric
 * verdict for a completed evaluation session (score 0..100, qualitative
 * notes, and a failure area required iff score < 80). The wire rejects with
 * typed `extensions.code` surfaces for every denial (anonymous,
 * non-evaluator, unknown/foreign/untyped session, incomplete session,
 * invalid score, missing/forbidden weakness, replay, already-finalized
 * applicant), and the quorum verdict rides the fifth submission's return.
 */
export const submitRubricEvaluationMutationDocument: TypedDocumentNode<
  SubmitRubricEvaluationMutation,
  SubmitRubricEvaluationMutationVariables
> = gql`
  mutation SubmitRubricEvaluation($sessionId: ID!, $input: RubricEvaluationSubmitInput!) {
    submitRubricEvaluation(sessionId: $sessionId, input: $input) {
      id
      sessionId
      evaluatorId
      evaluatedId
      score
      weaknessArea
      createdAt
      applicantStatus
    }
  }
`;

/**
 * `myRubricPendingSessions(page, pageSize)` — the caller's own pending
 * rubric-evaluation page (`SessionPage!`): the canonical session page shape
 * shared with the participant session lists. Both pagination members are
 * optional (the service normalizes the effective window); a submitted
 * session vanishes from the caller's page on their next read.
 */
export const myRubricPendingSessionsQueryDocument: TypedDocumentNode<
  MyRubricPendingSessionsQuery,
  MyRubricPendingSessionsQueryVariables
> = gql`
  query MyRubricPendingSessions($page: Int, $pageSize: Int) {
    myRubricPendingSessions(page: $page, pageSize: $pageSize) {
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

/**
 * `myRubricEvaluation(sessionId)` — the caller's OWN submission for one
 * session (nullable: an unsubmitted session reads back null, never a
 * foreign row). The payload is the PII-free rubric receipt — `notes` is
 * deliberately unreachable through any read surface.
 *
 * WHY IT EXISTS: it is the loop's read-your-own-verdict arm, pinned
 * alongside the pending page and the submit mutation as the third
 * operation of the rubric wire surface — after scoring (or on a later
 * visit) the evaluator re-reads their OWN receipt for one session. Scope
 * stays the (session, evaluator) pair, so an unknown and a foreign pair
 * share the ONE session-not-found denial and no cross-evaluator probe
 * exists; the document-contract tier locks the selection shape and cache
 * normalization.
 */
export const myRubricEvaluationQueryDocument: TypedDocumentNode<
  MyRubricEvaluationQuery,
  MyRubricEvaluationQueryVariables
> = gql`
  query MyRubricEvaluation($sessionId: ID!) {
    myRubricEvaluation(sessionId: $sessionId) {
      id
      sessionId
      evaluatorId
      evaluatedId
      score
      weaknessArea
      createdAt
      applicantStatus
    }
  }
`;
