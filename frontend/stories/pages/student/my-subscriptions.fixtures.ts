import type { MockLink } from "@apollo/client/testing";
import { SubscriptionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { mySubscriptionsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import {
  type SubscriptionRowFixture,
  subscriptionRow,
} from "@/frontend/stories/pages/student/subscription-row.fixtures";

/**
 * Fixtures for the `Pages/Student/MySubscriptions` story — the prototype's
 * funnel-state matrix: active / pending / failed / empty rows over the
 * normalized `StudentSubscription` wire shape. The row builder + the list
 * mock live in the shared `subscription-row.fixtures` module; this file
 * keeps only the page's four-state row set and its loading mock.
 */

export const SUBSCRIPTION_ROWS: readonly SubscriptionRowFixture[] = [
  subscriptionRow({ id: "sub-active" }),
  subscriptionRow({
    id: "sub-pending",
    status: SubscriptionStatus.Pending,
    startDate: null,
    endDate: null,
    paymentVerifiedAt: "2099-01-10T09:00:00.000Z",
  }),
  subscriptionRow({
    id: "sub-failed",
    status: SubscriptionStatus.Pending,
    startDate: null,
    endDate: null,
  }),
  subscriptionRow({ id: "sub-expired", status: SubscriptionStatus.Expired }),
];

export { subscriptionsListMock } from "@/frontend/stories/pages/student/subscription-row.fixtures";

/** Never-resolving list query — drives the loading skeleton branch. */
export const SUBSCRIPTIONS_LOADING_MOCK: MockLink.MockedResponse = {
  request: { query: mySubscriptionsQueryDocument, variables: {} },
  delay: Number.POSITIVE_INFINITY,
};
