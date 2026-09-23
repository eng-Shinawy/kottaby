import { gql, type TypedDocumentNode } from "@apollo/client";
import type { PurchaseVerificationPlanMutation } from "@/frontend/graphql/generated/gql/graphql";

/**
 * `purchaseVerificationPlan` mutation — purchases the teacher verification
 * plan for the authenticated applicant.
 *
 * Zero-argument mutation: identity is derived server-side ONLY from the
 * access token's user, and the purchase target is resolved server-side from
 * the ACTIVE plan catalog by its canonical title, so the operation declares
 * NO variables and carries no client-owned fields at all.
 *
 * Selection is the minimal read-back of the pending purchase pair plus the
 * gateway checkout descriptor, with `id` on every object (Apollo cache
 * normalization):
 * - `subscription { id status planId }` — the freshly created pending
 *   subscription and the plan it grants.
 * - `payment { id amount currency status }` — the pending ledger row (money
 *   as decimal string + ISO currency code + settlement state).
 * - `checkout { provider providerReference checkoutUrl }` — the gateway
 *   session; `checkoutUrl` is null for the mock gateway (no hosted checkout
 *   to redirect to).
 */
export const purchaseVerificationPlanMutationDocument: TypedDocumentNode<PurchaseVerificationPlanMutation> = gql`
  mutation PurchaseVerificationPlan {
    purchaseVerificationPlan {
      subscription {
        id
        status
        planId
      }
      payment {
        id
        amount
        currency
        status
      }
      checkout {
        provider
        providerReference
        checkoutUrl
      }
    }
  }
`;
