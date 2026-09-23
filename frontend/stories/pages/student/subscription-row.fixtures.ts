import type { MockLink } from "@apollo/client/testing";
import {
  type MySubscriptionsQuery,
  type MySubscriptionsQuery_mySubscriptions,
  SubscriptionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import { mySubscriptionsQueryDocument } from "@/frontend/graphql/sharedDocuments";

/**
 * Shared subscription wire-row fixtures — the deterministic
 * `StudentSubscription` row builder + the `mySubscriptions` list mock,
 * consumed by every story/suite that renders a subscription-shaped page
 * over the normalized wire row (id-first, ten fields + the nested plan).
 */

export type SubscriptionRowFixture = MySubscriptionsQuery_mySubscriptions & {
  readonly __typename: "StudentSubscription";
};

/** Deterministic fixture row (all ten selected fields + the nested plan + `__typename`). */
export function subscriptionRow(overrides: Partial<SubscriptionRowFixture> & { id: string }): SubscriptionRowFixture {
  return {
    __typename: "StudentSubscription",
    planId: 3,
    plan: { id: "3", title: "Hifz Intensive" },
    status: SubscriptionStatus.Active,
    startDate: "2099-01-10T08:45:00.000Z",
    endDate: "2099-02-10T08:45:00.000Z",
    paymentMethod: null,
    paymentReference: null,
    paymentVerifiedAt: null,
    createdAt: "2099-01-10T08:45:00.000Z",
    updatedAt: "2099-01-10T08:45:00.000Z",
    ...overrides,
  };
}

/** Populated list mock over the zero-argument list query. */
export function subscriptionsListMock(rows: readonly SubscriptionRowFixture[]): MockLink.MockedResponse {
  return {
    request: { query: mySubscriptionsQueryDocument, variables: {} },
    result: { data: { mySubscriptions: [...rows] } satisfies MySubscriptionsQuery },
  };
}
