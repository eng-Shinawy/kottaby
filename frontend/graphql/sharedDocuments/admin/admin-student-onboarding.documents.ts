/**
 * Admin direct student onboarding GraphQL documents — the offline-payment
 * onboarding mutation.
 *
 * Per `frontend/graphql/sharedDocuments/AGENTS.md`:
 *  - `gql` + `TypedDocumentNode` (codegen types only).
 *  - `id` is selected FIRST in every object (Apollo cache normalization).
 *  - Hooks consumed from `@apollo/client/react` in views:
 *    `useQuery`/`useMutation` ONLY — NO `useLazyQuery`.
 *  - Variables are typed, never string-interpolated.
 *  - No credential material is selected — the password travels only inside
 *    the input whitelist and never appears on the result.
 */
import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  AdminOnboardStudentWithOfflinePaymentMutation,
  AdminOnboardStudentWithOfflinePaymentMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Direct student onboarding mutation — provisions the student account,
 * links the optional parent, activates the plan subscription through the
 * offline-payment lane and returns the handshake code for the parent
 * handoff. The actor identity is derived server-side from the
 * authenticated admin caller — the only variable is the closed onboarding
 * input whitelist.
 *
 * Selection shape:
 *  - `student` selects `id` FIRST and carries the EXACT `AdminUserDetail`
 *    detail field set (kept in lockstep with the shared
 *    `AdminUserDetailFields` fragment by the co-located contract test) so
 *    the fresh row normalizes into the SAME `AdminUserDetail:<id>` cache
 *    entry the admin directory/detail consumers read. The fields are
 *    inlined instead of spreading the fragment because a second document
 *    carrying the fragment definition renames the codegen-extracted
 *    fragment sub-types and breaks their existing importers.
 *  - `subscription` carries the offline-payment verification state the
 *    success view surfaces (`paymentMethod`, `paymentReference`,
 *    `paymentVerifiedAt`) plus the lifecycle `status`.
 *  - `creditedLane` / `creditedSessions` / `handshakeCode` are the
 *    credit-lane and parent-handoff scalars.
 */
export const adminOnboardStudentWithOfflinePaymentMutationDocument: TypedDocumentNode<
  AdminOnboardStudentWithOfflinePaymentMutation,
  AdminOnboardStudentWithOfflinePaymentMutationVariables
> = gql`
  mutation AdminOnboardStudentWithOfflinePayment($input: AdminOnboardStudentOfflineInput!) {
    adminOnboardStudentWithOfflinePayment(input: $input) {
      student {
        id
        fullName
        email
        phone
        role
        dateOfBirth
        gender
        country
        isDeleted
        deletedAt
        suspended
        suspendedAt
        suspendedPeriodDays
        isBlocked
        blockedAt
        lastActiveAt
        createdAt
        updatedAt
        applicant {
          id
          status
          verificationAttempts
          lastAttemptAt
          cooldownUntil
          cooldownActive
          canPurchaseVerification
        }
        teacher {
          isApproved
          isEvaluator
          isOnline
          averageRating
        }
        student {
          handshakeCode
          parentId
          primaryLanguage
          anotherLanguage
          hasParentLink
          hasActiveSubscription
          balanceHifz
          balanceTajweed
          balanceReviews
          balanceTrial
          trialGrantedAt
        }
        parent {
          linkedChildrenCount
        }
      }
      subscription {
        id
        status
        paymentMethod
        paymentReference
        paymentVerifiedAt
      }
      creditedLane
      creditedSessions
      handshakeCode
    }
  }
`;
