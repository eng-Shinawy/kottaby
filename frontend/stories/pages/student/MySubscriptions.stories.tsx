import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { DashboardStoryFrame, StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import {
  SUBSCRIPTION_ROWS,
  SUBSCRIPTIONS_LOADING_MOCK,
  subscriptionsListMock,
} from "@/frontend/stories/pages/student/my-subscriptions.fixtures";
import { MySubscriptionsContainer } from "@/frontend/views/student/subscriptions/MySubscriptionsContainer";

/**
 * Storybook surface for the my-subscriptions page rendered by
 * `app/(dashboard)/subscriptions/page.tsx` at `/subscriptions`.
 *
 * The page's view (`MySubscriptionsContainer`) reads the caller's own
 * subscriptions via `mySubscriptionsQueryDocument` (student-scoped
 * server-side; zero arguments) and its labels via `useAppTranslation(Checkout)`
 * — the global decorator supplies theme + locale, so the story only wraps
 * the container in `StoryApolloProvider` with MockLink mocks.
 */

/** Wraps the container in the shared mocked-Apollo harness. */
function MySubscriptionsHarness({ mocks }: Readonly<{ mocks: readonly MockLink.MockedResponse[] }>): ReactNode {
  return (
    <StoryApolloProvider mocks={mocks}>
      <DashboardStoryFrame>
        <MySubscriptionsContainer />
      </DashboardStoryFrame>
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Pages/Student/MySubscriptions",
  component: MySubscriptionsHarness,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["mocks"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof MySubscriptionsHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Populated list — active / pending / failed / expired rows (the four-state matrix). */
export const Default: Story = {
  args: { mocks: [subscriptionsListMock(SUBSCRIPTION_ROWS)] },
};

/** Never-resolving list fetch — the skeleton branch of the list. */
export const Loading: Story = {
  args: { mocks: [SUBSCRIPTIONS_LOADING_MOCK] },
};

/** Zero rows — the localized empty state + the browse-plans CTA. */
export const Empty: Story = {
  args: { mocks: [subscriptionsListMock([])] },
};

/** Payment-failed rows only — the derived `Payment failed` chip + guidance copy. */
export const PaymentFailed: Story = {
  args: {
    mocks: [
      subscriptionsListMock(SUBSCRIPTION_ROWS.filter(row => row.id !== "sub-active" && row.id !== "sub-expired")),
    ],
  },
};

/** Pending rows only — the amber in-flight chips + blank validity placeholders. */
export const Pending: Story = {
  args: {
    mocks: [subscriptionsListMock(SUBSCRIPTION_ROWS.filter(row => row.id === "sub-pending"))],
  },
};
