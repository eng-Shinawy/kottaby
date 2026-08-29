import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  AdminCancelSubscriptionMutation,
  AdminCancelSubscriptionMutationVariables,
  AdminPendingSubscriptionRequestsQuery,
  AdminSubscriptionsQuery,
  AdminSubscriptionsQueryVariables,
  MySubscriptionsQuery,
  RequestPlanSubscriptionMutation,
  RequestPlanSubscriptionMutationVariables,
  VerifySubscriptionPaymentMutation,
  VerifySubscriptionPaymentMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Subscription shared documents (DEV1-006: Phase A storefront + Phase B admin
 * verification; DEV1-009: admin lifecycle management).
 *
 * Selection sets take the canonical `Subscription` shape (id, status, plan,
 * lifecycle dates, offline-payment tracking columns, timestamps) with the
 * embedded `plan` riding the FULL ten-field REQ-060 `Plan` selection —
 * `id` is present on EVERY selection set (both `Subscription` and the
 * nested `Plan`) so Apollo normalizes `Subscription:<id>` →
 * `plan: Plan:<id>` and the mutation's RETURNING payload converges with
 * the `mySubscriptions` read on the same cache entries. The DEV1-009 admin
 * lifecycle documents take the `AdminSubscription` shape instead — same
 * lifecycle/payment/date columns, but the embedded `plan` rides the SHORT
 * catalog slice (no deactivatedAt/createdAt/updatedAt) and the subscriber
 * is the narrow `AdminSubscriptionUser` summary (id / fullName / email) —
 * with `id` present on every nested object (`Subscription`-equivalent root,
 * `Plan`, `AdminSubscriptionUser`) so the cancel mutation's payload
 * normalizes onto the `adminSubscriptions` read's cache entries by id alone.
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

/**
 * `adminPendingSubscriptionRequests` — the ADMIN verification queue
 * (DEV1-006 Phase B, server-enforced admin gate): every PENDING
 * subscription request, oldest first, with its plan and the narrow
 * purchaser summary (id / fullName / email). No payment columns — they are
 * guaranteed NULL pre-verification; the verify dialog COLLECTS them.
 */
export const adminPendingSubscriptionRequestsQueryDocument: TypedDocumentNode<AdminPendingSubscriptionRequestsQuery> = gql`
    query AdminPendingSubscriptionRequests {
      adminPendingSubscriptionRequests {
        id
        status
        plan {
          id
          title
          sessionCount
          price
          currency
          intervalDays
        }
        user {
          id
          fullName
          email
        }
        createdAt
        updatedAt
      }
    }
  `;

/**
 * `verifySubscriptionPayment` — the admin payment-verification transition
 * (DEV1-006 Phase B, server-enforced admin gate). Returns the ACTIVATED
 * subscription in the FULL canonical `Subscription` selection (status
 * active, payment columns stamped, plan embedded) so Apollo overwrites the
 * normalized `Subscription:<id>` entry the moment the mutation settles.
 */
export const verifySubscriptionPaymentMutationDocument: TypedDocumentNode<
  VerifySubscriptionPaymentMutation,
  VerifySubscriptionPaymentMutationVariables
> = gql`
  mutation VerifySubscriptionPayment(
    $subscriptionId: ID!
    $paymentMethod: String!
    $paymentReference: String!
  ) {
    verifySubscriptionPayment(
      subscriptionId: $subscriptionId
      paymentMethod: $paymentMethod
      paymentReference: $paymentReference
    ) {
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
 * `adminSubscriptions` — the ADMIN lifecycle list (DEV1-009,
 * server-enforced admin gate): every subscription across ALL statuses
 * (unless the optional `status` filter narrows the read), newest first,
 * bounded pagination (limit/offset, service-clamped 1..100). The page
 * carries its own `total` + the `limit`/`offset` that shaped it, so the
 * client footer derives pagination from the SERVER state only. Complements
 * (never replaces) `adminPendingSubscriptionRequests` — that read is the
 * FIFO verification queue over pending rows; this one is the filterable
 * lifecycle view over every row.
 *
 * Selection-set contract: the `AdminSubscription` shape — root carries the
 * stamped payment columns + lifecycle dates, the embedded `plan` rides the
 * SHORT catalog slice (`id` … `isActive` — cache-identifying `id` first)
 * and the subscriber is the narrow `AdminSubscriptionUser` summary. `id`
 * on EVERY object keeps Apollo's normalization keys
 * (`AdminSubscription:<id>` → `plan: Plan:<id>`,
 * `user: AdminSubscriptionUser:<id>`) complete the moment the read settles.
 */
export const adminSubscriptionsQueryDocument: TypedDocumentNode<
  AdminSubscriptionsQuery,
  AdminSubscriptionsQueryVariables
> = gql`
  query AdminSubscriptions($status: String, $limit: Int, $offset: Int) {
    adminSubscriptions(status: $status, limit: $limit, offset: $offset) {
      items {
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
        }
        user {
          id
          fullName
          email
        }
        startDate
        endDate
        paymentMethod
        paymentReference
        paymentVerifiedAt
        createdAt
        updatedAt
      }
      total
      limit
      offset
    }
  }
`;

/**
 * `adminCancelSubscription` — the ADMIN cancel transition (DEV1-009,
 * server-enforced admin gate): `active|pending → cancelled`, terminal
 * states fenced server-side (expired/cancelled/suspended reject with the
 * localized already-resolved conflict). Returns the CANCELLED row in the
 * SAME `AdminSubscription` selection as the list read so Apollo overwrites
 * the normalized `AdminSubscription:<id>` entry (status cancelled, payment
 * stamps PRESERVED — no history rewrite) the moment the mutation settles.
 * Cancelling refunds/credits NOTHING (DEV1-007 owns balances).
 */
export const adminCancelSubscriptionMutationDocument: TypedDocumentNode<
  AdminCancelSubscriptionMutation,
  AdminCancelSubscriptionMutationVariables
> = gql`
  mutation AdminCancelSubscription($subscriptionId: ID!) {
    adminCancelSubscription(subscriptionId: $subscriptionId) {
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
      }
      user {
        id
        fullName
        email
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
