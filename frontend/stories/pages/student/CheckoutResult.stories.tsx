import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { DashboardStoryFrame, StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import {
  RESULT_ACTIVE_ROW,
  RESULT_CHECKING_MOCK,
  RESULT_EMPTY_ROWS,
  RESULT_ERROR_MOCK,
  RESULT_PENDING_ROW,
  subscriptionsListMock,
} from "@/frontend/stories/pages/student/checkout-result.fixtures";
import { PaymentResultContainer } from "@/frontend/views/student/checkout/result/PaymentResultContainer";

/**
 * Storybook surface for the payment-result page rendered by
 * `app/(dashboard)/student/checkout/result/page.tsx` at
 * `/student/checkout/result`.
 *
 * The page's view (`PaymentResultContainer`) derives EVERY arm from the
 * authoritative `mySubscriptions` re-query (student-scoped server-side;
 * zero arguments) — the gateway's GET-redirect hints are display context
 * only and can never produce the success arm. Labels resolve through
 * `useAppTranslation(Checkout)`; the global decorator supplies theme +
 * locale, so the story only wraps the container in `StoryApolloProvider`
 * with MockLink mocks.
 */

/** Wraps the container in the shared mocked-Apollo harness. */
function CheckoutResultHarness({
  mocks,
  hintParams,
}: Readonly<{
  mocks: readonly MockLink.MockedResponse[];
  hintParams?: Readonly<Record<string, string | string[] | undefined>>;
}>): ReactNode {
  return (
    <StoryApolloProvider mocks={mocks}>
      <DashboardStoryFrame>
        <PaymentResultContainer hintParams={hintParams ?? {}} />
      </DashboardStoryFrame>
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Pages/Student/CheckoutResult",
  component: CheckoutResultHarness,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["mocks"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof CheckoutResultHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Server truth = ACTIVE subscription — the success arm. */
export const Default: Story = {
  args: { mocks: [subscriptionsListMock(RESULT_ACTIVE_ROW)] },
};

/** Never-resolving re-query — the checking (loading) arm. */
export const Loading: Story = {
  args: { mocks: [RESULT_CHECKING_MOCK] },
};

/** Zero settled rows — the pending arm (nothing has confirmed yet). */
export const Pending: Story = {
  args: { mocks: [subscriptionsListMock(RESULT_EMPTY_ROWS)] },
};

/** Pending row + the decline redirect hint — the failed arm's guidance copy. */
export const PaymentFailed: Story = {
  args: {
    mocks: [subscriptionsListMock(RESULT_PENDING_ROW)],
    hintParams: { success: "false" },
  },
};

/** Re-query transport failure — the localized generic error alert. */
export const LoadError: Story = {
  args: { mocks: [RESULT_ERROR_MOCK] },
};
