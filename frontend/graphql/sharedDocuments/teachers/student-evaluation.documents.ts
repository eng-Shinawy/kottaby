import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  MyTeacherEvaluationsQuery,
  SubmitTeacherEvaluationMutation,
  SubmitTeacherEvaluationMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Student teacher-evaluation shared GraphQL documents — the write-once
 * per-session teacher rating surfaced to the rating student.
 *
 * Two operations over the evaluation SDL surface: the write-once mutation
 * (`submitTeacherEvaluation`) and the caller's own rating-history read
 * (`myTeacherEvaluations`). Both payloads select `id` first so Apollo
 * Client normalizes the returned `Evaluation` rows into the cache —
 * `Evaluation` is an id-bearing entity, so default normalization applies
 * and the frozen `apolloCache.ts` type-policy inventory stays untouched.
 *
 * Caller identity is NEVER wire-visible: the query declares no variables
 * at all (identity is derived server-side from the authenticated caller)
 * and the mutation's surface is `input` + `sessionId` — the closed
 * `SubmitTeacherEvaluationInput` whitelist carries only `rating`; the
 * rater, the rated teacher, and the session are all resolved server-side.
 *
 * Selections are exactly the six public `Evaluation` fields of the SDL —
 * `sessionId` and `score` are the only nullable leaves.
 *
 * All types come from the codegen output
 * (`@/frontend/graphql/generated/gql/graphql`) — never inline literals
 * as TYPES, never mapping layers. Hooks (`useQuery`, `useMutation`) are
 * consumed from `@apollo/client/react` in views; `useLazyQuery` is banned.
 */

/**
 * `submitTeacherEvaluation(input: SubmitTeacherEvaluationInput!, sessionId: ID!)` —
 * the calling student's write-once rating of one completed session's
 * teacher. Returns the created `Evaluation!` (score = rating × 20) for
 * cache normalization. A client retry of a completed write surfaces
 * `EVALUATION_ALREADY_SUBMITTED`, an unfinished handshake surfaces
 * `EVALUATION_SESSION_NOT_COMPLETED`, and an unknown session is
 * indistinguishable from a foreign one (`SESSION_NOT_FOUND` — one
 * no-oracle answer for both).
 */
export const submitTeacherEvaluationMutationDocument: TypedDocumentNode<
  SubmitTeacherEvaluationMutation,
  SubmitTeacherEvaluationMutationVariables
> = gql`
  mutation SubmitTeacherEvaluation($input: SubmitTeacherEvaluationInput!, $sessionId: ID!) {
    submitTeacherEvaluation(input: $input, sessionId: $sessionId) {
      id
      evaluatedId
      evaluatorId
      sessionId
      score
      createdAt
    }
  }
`;

/**
 * `myTeacherEvaluations` — the calling student's own rating rows, newest
 * first. Non-paginated by design: per-student rating volume is
 * self-limiting, so there are no page variables — an empty history is
 * `[]`, never an error. Consumers derive the rated-session set (a
 * `Set<number>` of `sessionId`s) from this read; the sessions-list
 * payload is never widened for it.
 */
export const myTeacherEvaluationsQueryDocument: TypedDocumentNode<MyTeacherEvaluationsQuery> = gql`
  query MyTeacherEvaluations {
    myTeacherEvaluations {
      id
      evaluatedId
      evaluatorId
      sessionId
      score
      createdAt
    }
  }
`;
