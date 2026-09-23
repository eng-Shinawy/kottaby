import type { MockLink } from "@apollo/client/testing";
import { type MySubscriptionsQuery, SubscriptionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { mySubscriptionsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import {
  type SubscriptionRowFixture,
  subscriptionsListMock as sharedSubscriptionsListMock,
  subscriptionRow,
} from "@/frontend/stories/pages/student/subscription-row.fixtures";

/**
 * Fixtures for the `Pages/Student/CheckoutResult` story — the
 * post-checkout funnel-state matrix the result page derives from the
 * authoritative `mySubscriptions` re-query: active (success), pending
 * (still-processing), and no-rows arms. The row builder + the list mock
 * live in the shared `subscription-row.fixtures` module; this file keeps
 * only the result page's per-arm payloads and mocks (the result page's
 * `cache-and-network` refetch semantics need `maxUsageCount: Infinity`).
 */

/** Populated list mock — `maxUsageCount: Infinity` since cache-and-network refetches. */
function resultSubscriptionsListMock(rows: readonly SubscriptionRowFixture[]): MockLink.MockedResponse {
  return { ...sharedSubscriptionsListMock(rows), maxUsageCount: Number.POSITIVE_INFINITY };
}

/** The zero-argument list query's request shape (identity is session-derived). */
const LIST_VARIABLES = {} as const;

/** The success arm's re-query payload: one ACTIVE subscription row. */
export const RESULT_ACTIVE_ROW: readonly SubscriptionRowFixture[] = [
  subscriptionRow({
    id: "sub-result-active",
    status: SubscriptionStatus.Active,
    startDate: "2099-01-10T08:45:00.000Z",
    endDate: "2099-02-10T08:45:00.000Z",
  }),
];

/** The pending arm's re-query payload: one still-PENDING row, no period yet. */
export const RESULT_PENDING_ROW: readonly SubscriptionRowFixture[] = [
  subscriptionRow({
    id: "sub-result-pending",
    status: SubscriptionStatus.Pending,
    startDate: null,
    endDate: null,
  }),
];

/** The zero-rows arm's re-query payload (pending arm — nothing settled yet). */
export const RESULT_EMPTY_ROWS: readonly SubscriptionRowFixture[] = [];

/** Never-resolving list query — drives the checking (loading) arm. */
export const RESULT_CHECKING_MOCK: MockLink.MockedResponse = {
  request: { query: mySubscriptionsQueryDocument, variables: { ...LIST_VARIABLES } },
  result: { data: { mySubscriptions: [] } satisfies MySubscriptionsQuery },
  delay: Number.POSITIVE_INFINITY,
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Transport failure — drives the localized generic-error branch. */
export const RESULT_ERROR_MOCK: MockLink.MockedResponse = {
  request: { query: mySubscriptionsQueryDocument, variables: { ...LIST_VARIABLES } },
  error: new Error("mocked transport failure"),
  maxUsageCount: Number.POSITIVE_INFINITY,
};

export { resultSubscriptionsListMock as subscriptionsListMock };
