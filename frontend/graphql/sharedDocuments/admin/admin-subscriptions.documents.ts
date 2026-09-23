/**
 * Admin subscription-management GraphQL documents — the student drawer's
 * read surface plus the four lifecycle writer mutations.
 *
 * Per `frontend/graphql/sharedDocuments/AGENTS.md`:
 *  - Documents use `gql` + `TypedDocumentNode` (codegen types only).
 *  - `id` is selected FIRST in every object (Apollo cache normalization).
 *  - Hooks consumed from `@apollo/client/react` in views:
 *    `useQuery`/`useMutation` ONLY — NO `useLazyQuery`.
 *  - Variables are typed, never string-interpolated.
 *
 * The row selection is byte-identical across the read query and ALL FOUR
 * mutation payloads so every write converges on the same
 * `StudentSubscription:<id>` cache entries the drawer's list watches: the
 * nested `plan { id title … }` selection normalizes alongside the row
 * (`Plan:<id>`), carrying the balance-lane snapshot the change-plan
 * selector filters on. `ChangeSubscriptionPlanPayload` is an embedded
 * value object with no `id` of its own — the normalizable entities are
 * its nested `subscription` row (which selects `id`) and the scalar
 * proration summary (`direction`, `carrySessions`, `forfeitedSessions`).
 *
 * Operation-name note: the repo's GraphQL naming-convention lint forbids
 * the `Subscription` SUFFIX on operation names (reserved for GraphQL
 * subscription semantics — the same constraint that shaped
 * `PurchaseSubscriptionPlan`), so the mutation documents are named
 * `AdminSubscription<Verb>` (`AdminSessionCancel` precedent: admin scope,
 * entity, verb). The plural query name `AdminStudentSubscriptions` ends
 * in "Subscriptions" and is unaffected.
 */
import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  AdminStudentSubscriptionsQuery,
  AdminStudentSubscriptionsQueryVariables,
  AdminSubscriptionCancelMutation,
  AdminSubscriptionCancelMutationVariables,
  AdminSubscriptionExtendMutation,
  AdminSubscriptionExtendMutationVariables,
  AdminSubscriptionPlanChangeMutation,
  AdminSubscriptionPlanChangeMutationVariables,
  AdminSubscriptionRenewMutation,
  AdminSubscriptionRenewMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/** Shared row fragment for the admin subscription list + mutation payloads. */
const ADMIN_SUBSCRIPTION_ROW_FIELDS = gql`
  fragment AdminSubscriptionRowFields on StudentSubscription {
    id
    planId
    status
    startDate
    endDate
    createdAt
    updatedAt
    auditEntriesCount
    auditTrailPeek {
      actionType
      at
    }
    plan {
      id
      title
      sessionCount
      intervalDays
      price
      currency
      balanceLane
    }
  }
`;

/**
 * Lists one student's subscriptions across every lifecycle status,
 * newest first (server-ordered). The caller addresses the student by user
 * id — the only client-owned argument; the actor identity derives
 * server-side from the authenticated admin.
 */
export const adminStudentSubscriptionsQueryDocument: TypedDocumentNode<
  AdminStudentSubscriptionsQuery,
  AdminStudentSubscriptionsQueryVariables
> = gql`
  ${ADMIN_SUBSCRIPTION_ROW_FIELDS}
  query AdminStudentSubscriptions($userId: ID!) {
    adminStudentSubscriptions(userId: $userId) {
      ...AdminSubscriptionRowFields
    }
  }
`;

/**
 * Extends an ACTIVE subscription's window by a whole number of days.
 * The payload is the extended row itself.
 */
export const adminSubscriptionExtendMutationDocument: TypedDocumentNode<
  AdminSubscriptionExtendMutation,
  AdminSubscriptionExtendMutationVariables
> = gql`
  ${ADMIN_SUBSCRIPTION_ROW_FIELDS}
  mutation AdminSubscriptionExtend($input: ExtendSubscriptionInput!) {
    adminExtendSubscription(input: $input) {
      ...AdminSubscriptionRowFields
    }
  }
`;

/**
 * Renews an EXPIRED subscription into a fresh active period (new row,
 * lane recredited). The payload is the NEW row.
 */
export const adminSubscriptionRenewMutationDocument: TypedDocumentNode<
  AdminSubscriptionRenewMutation,
  AdminSubscriptionRenewMutationVariables
> = gql`
  ${ADMIN_SUBSCRIPTION_ROW_FIELDS}
  mutation AdminSubscriptionRenew($input: RenewSubscriptionInput!) {
    adminRenewSubscription(input: $input) {
      ...AdminSubscriptionRowFields
    }
  }
`;

/**
 * Cancels an ACTIVE subscription balance-preserving (lanes untouched).
 * The payload is the cancelled row.
 */
export const adminSubscriptionCancelMutationDocument: TypedDocumentNode<
  AdminSubscriptionCancelMutation,
  AdminSubscriptionCancelMutationVariables
> = gql`
  ${ADMIN_SUBSCRIPTION_ROW_FIELDS}
  mutation AdminSubscriptionCancel($input: CancelSubscriptionInput!) {
    adminCancelSubscription(input: $input) {
      ...AdminSubscriptionRowFields
    }
  }
`;

/**
 * Moves an ACTIVE subscription onto a different active plan in the SAME
 * balance lane with prorated settlement. The payload reports the new row
 * plus the proration summary (direction + carry/forfeit session counts)
 * the drawer's success copy renders.
 */
export const adminSubscriptionPlanChangeMutationDocument: TypedDocumentNode<
  AdminSubscriptionPlanChangeMutation,
  AdminSubscriptionPlanChangeMutationVariables
> = gql`
  ${ADMIN_SUBSCRIPTION_ROW_FIELDS}
  mutation AdminSubscriptionPlanChange($input: ChangeSubscriptionPlanInput!) {
    adminChangeSubscriptionPlan(input: $input) {
      subscription {
        ...AdminSubscriptionRowFields
      }
      direction
      carrySessions
      forfeitedSessions
    }
  }
`;
