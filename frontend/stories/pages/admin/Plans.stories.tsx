import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { DashboardStoryFrame, StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { PLAN_ROWS, PLANS_LOADING_MOCK, plansListMock } from "@/frontend/stories/pages/admin/plans.fixtures";
import { PlanCatalogContainer } from "@/frontend/views/admin/plans";

/**
 * Storybook surface for the admin plan catalog page rendered by
 * `app/(dashboard)/admin/plans/page.tsx` at `/admin/plans`.
 *
 * The page's view (`PlanCatalogContainer`) reads the catalog via
 * `adminPlansQueryDocument` (`includeInactive: true`) and its labels via
 * `useAppTranslation(Plans)` — the global decorator supplies theme + locale,
 * so the story only wraps the container in `StoryApolloProvider` with
 * MockLink mocks. Dialogs stay inert: they only fire mutations on submit.
 */

/** Wraps the container in the shared mocked-Apollo harness. */
function PlansHarness({ mocks }: Readonly<{ mocks: readonly MockLink.MockedResponse[] }>): ReactNode {
  return (
    <StoryApolloProvider mocks={mocks}>
      <DashboardStoryFrame>
        <PlanCatalogContainer />
      </DashboardStoryFrame>
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Pages/Admin/Plans",
  component: PlansHarness,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["mocks"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof PlansHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Populated catalog — 4 plans across active/inactive, intervals, currencies. */
export const Default: Story = {
  args: { mocks: [plansListMock(PLAN_ROWS)] },
};

/** Never-resolving list fetch — the skeleton branch of the catalog table. */
export const Loading: Story = {
  args: { mocks: [PLANS_LOADING_MOCK] },
};
