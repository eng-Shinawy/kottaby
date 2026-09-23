import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  MySubscriptionsQuery,
  PurchaseSubscriptionPlanMutation,
  PurchaseSubscriptionPlanMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Shared GraphQL documents for the student subscription-purchase funnel.
 *
 * Two operations over the billing SDL surface: the purchase write
 * (`purchaseSubscription`) and the caller's own subscription list read
 * (`mySubscriptions`). Both are student-only and self-scoped server-side —
 * the mutation's ONLY client-owned field is the plan selector inside the
 * input whitelist, and the list read takes ZERO arguments (identity always
 * derives from the authenticated caller, never from the wire).
 *
 * The `StudentSubscription` selection is byte-identical across BOTH
 * documents so the cache-normalized shape never forks: the pending pair the
 * mutation returns converges on the same `StudentSubscription:<id>` entries
 * the list query watches (per `sharedDocuments/AGENTS.md` "id Field
 * Requirement" — `id` FIRST on every row object Apollo normalizes). The
 * nested `plan { id title }` selection is part of that shared shape: it
 * selects the human-readable plan title the student surfaces render, and
 * its `Plan:<id>` entry normalizes alongside the row (the plan id is also
 * selected on the row itself so the mutation payload converges on it too).
 *
 * The purchase payload's `PurchaseSubscriptionPayload` and `PaymentCheckout`
 * wrappers are embedded value objects that carry no `id` by design: the
 * normalizable entities are the nested `StudentSubscription` /
 * `StudentPayment` rows, so those two selections correctly select no `id`
 * (they cannot — the types have none).
 *
 * Money stays a decimal string end-to-end (`amount`/`currency` on the
 * payment row) — never a number, never client math. All types come from the
 * codegen output (`@/frontend/graphql/generated/gql/graphql`) — never inline
 * literals as TYPES, never mapping layers. Hooks (`useQuery`, `useMutation`)
 * are consumed from `@apollo/client/react` in views; `useLazyQuery` is
 * banned.
 *
 * Operation-name note: the purchase mutation is named
 * `PurchaseSubscriptionPlan`, NOT `PurchaseSubscription` — the repo's
 * GraphQL naming-convention lint forbids the `Subscription` SUFFIX on
 * operation names (reserved for GraphQL subscription semantics), so the
 * operation names the act on its target instead. The exported constants
 * keep the domain-verb names below.
 */

/**
 * `purchaseSubscription(input: PurchaseSubscriptionInput!)` — opens the
 * gateway checkout session and atomically commits the pending subscription +
 * payment pair. The input whitelist carries exactly one field: the catalog
 * plan id. The idempotency key travels as the `x-idempotency-key` context
 * header (minted client-side, rotated only on success) — never as a document
 * variable. `checkout.checkoutUrl` is null for server-side providers (the
 * built-in mock among them), which is the consumer's refetch-instead-of-
 * redirect branch.
 */
export const purchaseSubscriptionMutationDocument: TypedDocumentNode<
  PurchaseSubscriptionPlanMutation,
  PurchaseSubscriptionPlanMutationVariables
> = gql`
  mutation PurchaseSubscriptionPlan($input: PurchaseSubscriptionInput!) {
    purchaseSubscription(input: $input) {
      subscription {
        id
        planId
        plan {
          id
          title
        }
        status
        startDate
        endDate
        paymentMethod
        paymentReference
        paymentVerifiedAt
        createdAt
        updatedAt
      }
      payment {
        id
        subscriptionId
        amount
        currency
        paymentGateway
        status
        createdAt
        updatedAt
      }
      checkout {
        provider
        providerReference
        checkoutUrl
      }
    }
  }
`;

/**
 * `mySubscriptions` — the caller's own subscriptions across every lifecycle
 * status, newest first (zero arguments; the read scope IS the verified
 * caller identity). The authoritative re-query surface after a checkout
 * redirect: gateway GET-redirect parameters are display hints only, never
 * state truth.
 */
export const mySubscriptionsQueryDocument: TypedDocumentNode<MySubscriptionsQuery> = gql`
  query MySubscriptions {
    mySubscriptions {
      id
      planId
      plan {
        id
        title
      }
      status
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
