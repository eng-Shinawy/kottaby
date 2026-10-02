/**
 * Admin-ordered paid re-evaluation GraphQL documents — the write surface
 * behind the admin user-detail "Order re-evaluation" governance action
 * (`adminOrderTeacherReEvaluation`).
 *
 * Per `frontend/graphql/sharedDocuments/AGENTS.md`:
 *  - Documents use `gql` + `TypedDocumentNode` (codegen types only).
 *  - Variables are typed, never string-interpolated.
 *  - Documents are re-exported through the admin sub-directory barrel.
 *
 * Contract notes:
 *  - The wire carries EXACTLY two variables — `teacherId` and `reason`.
 *    There is NO caller-identity variable (the actor is always derived
 *    server-side from the authenticated admin) and NO fee/amount variable
 *    (pricing is server-owned; mass-assignment of price is structurally
 *    impossible).
 *  - The `TeacherReEvaluationOrder` payload is the sanctioned IDE-less
 *    receipt object (`teacherId` is the subject anchor): it exposes
 *    `teacherId: ID!` instead of an `id`, so NO `id` is selected anywhere
 *    and the type registers `keyFields: false` in
 *    `frontend/providers/apollo/apolloCache.ts` (embedded-type
 *    normalization policy — the receipt is read back inline under the
 *    mutation field).
 */
import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  AdminOrderTeacherReEvaluationMutation,
  AdminOrderTeacherReEvaluationMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Admin-ordered teacher re-evaluation mutation — debits the re-evaluation
 * fee from the subject teacher's wallet, de-certifies them, and re-opens
 * their applicant row into a fresh evaluation cycle. The five-field
 * receipt (fee string, currency, post-debit balance, ISO anchor) is
 * display-ready; the affected caches are refetched by the consuming hook.
 */
export const adminOrderTeacherReEvaluationMutationDocument: TypedDocumentNode<
  AdminOrderTeacherReEvaluationMutation,
  AdminOrderTeacherReEvaluationMutationVariables
> = gql`
  mutation AdminOrderTeacherReEvaluation($teacherId: ID!, $reason: String!) {
    adminOrderTeacherReEvaluation(teacherId: $teacherId, reason: $reason) {
      teacherId
      amountCharged
      currency
      walletBalance
      reEvaluationStartedAt
    }
  }
`;
