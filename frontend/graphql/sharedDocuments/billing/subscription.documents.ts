import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  MySubscriptionsQuery,
  RequestPlanSubscriptionMutation,
  RequestPlanSubscriptionMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Subscription shared documents (DEV1-006 Phase A).
 *
 * Selection sets take the canonical `Subscription` shape (id, status, plan,
 * lifecycle dates, offline-payment tracking columns, timestamps) with the
 * embedded `plan` riding the FULL ten-field REQ-060 `Plan` selection —
 * `id` is present on EVERY selection set (both `Subscription` and the
 * nested `Plan`) so Apollo normalizes `Subscription:<id>` →
 * `plan: Plan:<id>` and the mutation's RETURNING payload converges with
 * the `mySubscriptions` read on the same cache entries.
 *
 * TypedDocumentNode style with codegen types ONLY — no inline type
 * literals, no mapping layers, no hooks (consumers own `useQuery` /
 * `useMutation` from `@apollo/client/react`).
 */

/**
 * `mySubscriptions` — the owner-scoped read (subscriber roles,
 * server-enforced): every subscription of the current user, newest first,
 * plan embedded. Powers the storefront's pending-request state.
 */
export const mySubscriptionsQueryDocument: TypedDocumentNode<MySubscriptionsQuery> = gql`
  query MySubscriptions {
    mySubscriptions {
      id
      status
      plan {
        id
        title
        sessionCount
        price
        currency
        intervalDays
        isActive
        deactivatedAt
        createdAt
        updatedAt
      }
      startDate
      endDate
      paymentMethod
      paymentReference
      paymentVerifiedAt
      createdAt
      updatedAt
    }
  }
`;

/**
 * `requestPlanSubscription` — the storefront's real subscribe action
 * (subscriber roles, server-enforced D2 purchase-time re-validation).
 * Returns the created PENDING subscription with its plan embedded, so the
 * normalized cache entry is complete the moment the mutation settles.
 */
export const requestPlanSubscriptionMutationDocument: TypedDocumentNode<
  RequestPlanSubscriptionMutation,
  RequestPlanSubscriptionMutationVariables
> = gql`
  mutation RequestPlanSubscription($planId: ID!) {
    requestPlanSubscription(planId: $planId) {
      id
      status
      plan {
        id
        title
        sessionCount
        price
        currency
        intervalDays
        isActive
        deactivatedAt
        createdAt
        updatedAt
      }
      startDate
      endDate
      paymentMethod
      paymentReference
      paymentVerifiedAt
      createdAt
      updatedAt
    }
  }
`;
