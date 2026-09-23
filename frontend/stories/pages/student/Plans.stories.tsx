import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { DashboardStoryFrame, StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import {
  PLAN_CATALOG_ERROR_MOCK,
  PLAN_CATALOG_LOADING_MOCK,
  PLAN_CATALOG_ROWS,
  PURCHASE_COMPLETED_MOCK,
  PURCHASE_FAILED_MOCK,
  planCatalogMock,
  purchaseRedirectMock,
} from "@/frontend/stories/pages/student/plans.fixtures";
import { PlansCatalogContainer } from "@/frontend/views/student/plans/PlansCatalogContainer";

/**
 * Storybook surface for the student plan catalog page rendered by
 * `app/(dashboard)/student/plans/page.tsx` at `/student/plans`.
 *
 * The page's view (`PlansCatalogContainer`) reads the catalog via
 * `planCatalogQueryDocument` and its labels via `useAppTranslation(Checkout)`
 * — the global decorator supplies theme + locale, so the story only wraps
 * the container in `StoryApolloProvider` with MockLink mocks. The
 * confirm dialog fires its purchase mutation only on submit.
 */

/** Wraps the container in the shared mocked-Apollo harness. */
function PlansHarness({ mocks }: Readonly<{ mocks: readonly MockLink.MockedResponse[] }>): ReactNode {
  return (
    <StoryApolloProvider mocks={mocks}>
      <DashboardStoryFrame>
        <PlansCatalogContainer />
      </DashboardStoryFrame>
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Pages/Student/Plans",
  component: PlansHarness,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["mocks"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof PlansHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Populated catalog — 3 plans across the session-count × price matrix. */
export const Default: Story = {
  args: { mocks: [planCatalogMock(PLAN_CATALOG_ROWS)] },
};

/** Never-resolving catalog fetch — the skeleton branch of the card grid. */
export const Loading: Story = {
  args: { mocks: [PLAN_CATALOG_LOADING_MOCK] },
};

/** Zero active plans — the empty-catalog state. */
export const Empty: Story = {
  args: { mocks: [planCatalogMock([])] },
};

/** Transport failure — the translated error alert branch. */
export const LoadError: Story = {
  args: { mocks: [PLAN_CATALOG_ERROR_MOCK] },
};

/** Purchase rejected (SERVICE_UNAVAILABLE) — the dialog stays open with the error. */
export const PurchaseFailed: Story = {
  args: { mocks: [planCatalogMock(PLAN_CATALOG_ROWS), PURCHASE_FAILED_MOCK] },
};

/**
 * Purchase resolving an instant activation (`checkoutUrl: null` — mock
 * provider shape): the success notice snackbar + catalog refetch.
 */
export const PurchaseCompleted: Story = {
  args: { mocks: [planCatalogMock(PLAN_CATALOG_ROWS), PURCHASE_COMPLETED_MOCK] },
};

/**
 * Purchase resolving a hosted checkout — the browser redirects to the
 * gateway URL (the story canvas stays; the navigation is external).
 */
export const PurchaseRedirect: Story = {
  args: {
    mocks: [
      planCatalogMock(PLAN_CATALOG_ROWS),
      purchaseRedirectMock("https://eg.checkout.paymob.com/?publicKey=pk_test&clientSecret=cs_test"),
    ],
  },
};
