import type { MockLink } from "@apollo/client/testing";
import type { AdminPlansQuery_adminPlans } from "@/frontend/graphql/generated/gql/graphql";
import { adminPlansQueryDocument } from "@/frontend/graphql/sharedDocuments";

/**
 * Fixtures for the `Pages/Admin/Plans` story — 4 plans covering the
 * active/inactive × interval × currency matrix the catalog renders.
 */

type PlanRowFixture = AdminPlansQuery_adminPlans & { readonly __typename: "Plan" };

/** Deterministic fixture row (all eight selected fields + `__typename`). */
function planRow(overrides: Partial<PlanRowFixture> & { id: string; title: string }): PlanRowFixture {
  return {
    __typename: "Plan",
    sessionCount: 8,
    price: "120.00",
    currency: "USD",
    intervalDays: 30,
    isActive: true,
    deactivatedAt: null,
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  };
}

export const PLAN_ROWS: readonly PlanRowFixture[] = [
  planRow({
    id: "plan-monthly",
    title: "Tajweed Monthly",
    sessionCount: 12,
  }),
  planRow({
    id: "plan-intensive",
    title: "Hifz Intensive (EGP)",
    sessionCount: 20,
    price: "2500.00",
    currency: "EGP",
    intervalDays: 60,
  }),
  planRow({
    id: "plan-quarterly",
    title: "Qira'ah Quarterly (SAR)",
    sessionCount: 36,
    price: "900.00",
    currency: "SAR",
    intervalDays: 90,
  }),
  planRow({
    id: "plan-legacy",
    title: "Legacy Starter",
    sessionCount: 4,
    price: "40.00",
    intervalDays: 14,
    isActive: false,
    deactivatedAt: "2026-08-01T09:30:00.000Z",
  }),
];

const LIST_VARIABLES = { includeInactive: true } as const;

/** Populated catalog mock — `maxUsageCount: Infinity` since cache-and-network refetches. */
export function plansListMock(rows: readonly PlanRowFixture[]): MockLink.MockedResponse {
  return {
    request: { query: adminPlansQueryDocument, variables: { ...LIST_VARIABLES } },
    result: { data: { adminPlans: [...rows] } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Never-resolving list query — drives the loading skeleton branch. */
export const PLANS_LOADING_MOCK: MockLink.MockedResponse = {
  request: { query: adminPlansQueryDocument, variables: { ...LIST_VARIABLES } },
  result: { data: { adminPlans: [] } },
  delay: Number.POSITIVE_INFINITY,
  maxUsageCount: Number.POSITIVE_INFINITY,
};
