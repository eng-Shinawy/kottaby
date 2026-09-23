import type { MockLink } from "@apollo/client/testing";
import { type PlanCatalogQuery_planCatalog, SubscriptionCreditLane } from "@/frontend/graphql/generated/gql/graphql";
import { planCatalogQueryDocument, purchaseSubscriptionMutationDocument } from "@/frontend/graphql/sharedDocuments";

/**
 * Fixtures for the `Pages/Student/Plans` story — the active-catalog rows
 * covering the session-count × validity × lane matrix the student cards
 * render.
 */

type PlanRowFixture = PlanCatalogQuery_planCatalog & { readonly __typename: "Plan" };

/** Deterministic fixture row (all selected fields + `__typename`). */
function planRow(overrides: Partial<PlanRowFixture> & { id: string; title: string }): PlanRowFixture {
  return {
    __typename: "Plan",
    sessionCount: 8,
    price: "300.00",
    currency: "EGP",
    intervalDays: 30,
    balanceLane: null,
    isActive: true,
    deactivatedAt: null,
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  };
}

export const PLAN_CATALOG_ROWS: readonly PlanRowFixture[] = [
  planRow({
    id: "401",
    title: "Hifz Intensive",
    sessionCount: 12,
    price: "450.00",
    intervalDays: 30,
    balanceLane: SubscriptionCreditLane.Hifz,
  }),
  planRow({
    id: "402",
    title: "Tajweed & Tilawa",
    sessionCount: 8,
    price: "300.00",
    intervalDays: 30,
    balanceLane: SubscriptionCreditLane.Tajweed,
  }),
  planRow({
    id: "403",
    title: "Legacy Trial",
    sessionCount: 4,
    price: "100.00",
    intervalDays: 30,
    balanceLane: null,
  }),
];

const CATALOG_VARIABLES = {} as const;

/** Populated catalog mock — `maxUsageCount: Infinity` since cache-and-network refetches. */
export function planCatalogMock(rows: readonly PlanRowFixture[]): MockLink.MockedResponse {
  return {
    request: { query: planCatalogQueryDocument, variables: { ...CATALOG_VARIABLES } },
    result: { data: { planCatalog: [...rows] } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Never-resolving catalog query — drives the loading skeleton branch. */
export const PLAN_CATALOG_LOADING_MOCK: MockLink.MockedResponse = {
  request: { query: planCatalogQueryDocument, variables: { ...CATALOG_VARIABLES } },
  result: { data: { planCatalog: [] } },
  delay: Number.POSITIVE_INFINITY,
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Transport failure — drives the translated error-alert branch. */
export const PLAN_CATALOG_ERROR_MOCK: MockLink.MockedResponse = {
  request: { query: planCatalogQueryDocument, variables: { ...CATALOG_VARIABLES } },
  error: new Error("mocked transport failure"),
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Purchase mutation mock resolving a hosted checkout (the redirect arm). */
export function purchaseRedirectMock(checkoutUrl: string): MockLink.MockedResponse {
  return {
    request: { query: purchaseSubscriptionMutationDocument, variables: { input: { planId: "402" } } },
    result: {
      data: {
        purchaseSubscription: purchasePayload({ checkoutUrl }),
      },
    },
  };
}

/** Purchase mutation mock resolving an instant activation (the null-URL arm). */
export const PURCHASE_COMPLETED_MOCK: MockLink.MockedResponse = {
  request: { query: purchaseSubscriptionMutationDocument, variables: { input: { planId: "402" } } },
  result: {
    data: {
      purchaseSubscription: purchasePayload({ checkoutUrl: null }),
    },
  },
};

/** Purchase mutation mock rejecting with a transport-shaped code. */
export const PURCHASE_FAILED_MOCK: MockLink.MockedResponse = {
  request: { query: purchaseSubscriptionMutationDocument, variables: { input: { planId: "402" } } },
  result: {
    errors: [
      { message: "PAYMENT_UNAVAILABLE (masked transport surface)", extensions: { code: "SERVICE_UNAVAILABLE" } },
    ],
  },
};

/** Builds one mutation payload row (id-first subscription + payment + checkout). */
function purchasePayload(overrides: { checkoutUrl: string | null }): {
  subscription: {
    id: string;
    planId: number;
    status: string;
    startDate: string | null;
    endDate: string | null;
    paymentMethod: string | null;
    paymentReference: string | null;
    paymentVerifiedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  payment: {
    id: string;
    subscriptionId: number | null;
    amount: string;
    currency: string;
    paymentGateway: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  checkout: { provider: string; providerReference: string; checkoutUrl: string | null };
} {
  return {
    subscription: {
      id: "901",
      planId: 402,
      status: "Pending",
      startDate: null,
      endDate: null,
      paymentMethod: null,
      paymentReference: "purchase-claim-901",
      paymentVerifiedAt: null,
      createdAt: "2026-09-12T09:00:00.000Z",
      updatedAt: "2026-09-12T09:00:00.000Z",
    },
    payment: {
      id: "951",
      subscriptionId: 901,
      amount: "300.00",
      currency: "EGP",
      paymentGateway: "Paymob",
      status: "Pending",
      createdAt: "2026-09-12T09:00:00.000Z",
      updatedAt: "2026-09-12T09:00:00.000Z",
    },
    checkout: {
      provider: "Paymob",
      providerReference: "purchase-claim-901",
      checkoutUrl: overrides.checkoutUrl,
    },
  };
}
