/**
 * Teacher certification GraphQL documents — admin cold-start certification.
 *
 * Per `frontend/graphql/sharedDocuments/AGENTS.md`:
 *  - All documents use `gql` + `TypedDocumentNode` (codegen types only).
 *  - `id` is selected FIRST in every object (Apollo cache normalization).
 *  - Hooks consumed from `@apollo/client/react` in views:
 *    `useMutation` ONLY — NO `useLazyQuery`.
 *  - Variables are typed, never string-interpolated.
 *  - The mutation returns the refreshed `AdminUserDetail` (identity type — no
 *    `keyFields` entry is required).
 */
import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  AdminCertifyTeacherColdStartMutation,
  AdminCertifyTeacherColdStartMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

export const adminCertifyTeacherColdStartMutationDocument: TypedDocumentNode<
  AdminCertifyTeacherColdStartMutation,
  AdminCertifyTeacherColdStartMutationVariables
> = gql`
  mutation AdminCertifyTeacherColdStart($userId: Int!, $makeEvaluator: Boolean = true) {
    adminCertifyTeacherColdStart(userId: $userId, makeEvaluator: $makeEvaluator) {
      id
      role
      isDeleted
      suspended
      isBlocked
      applicant {
        id
        status
      }
      teacher {
        isApproved
        isEvaluator
        isOnline
        averageRating
      }
    }
  }
`;
