import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { DashboardStoryFrame, StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { emptyMocks, interactiveMocks, loadingMocks } from "@/frontend/stories/pages/Notifications.fixtures";
import { NotificationsFeedContainer } from "@/frontend/views/notifications";

/**
 * Storybook surface for `NotificationsFeedContainer` — the `/notifications`
 * inbox feed PAGE (the full surface mounted by
 * `app/(dashboard)/notifications/page.tsx`), NOT the app-bar
 * `NotificationDrawer` popover (that one lives under
 * `UI/NotificationDrawer`).
 *
 * The container is self-wiring: labels come from `useAppTranslation` (the
 * global Storybook locale decorator provides the locale), and its queries
 * (`myNotifications` on the page's 20-row window + the 120s-polling unread
 * count) ride the story's `StoryApolloProvider` MockLink client. Fixture rows
 * and mock builders live in the sibling `Notifications.fixtures.ts`.
 */
function NotificationsPageHarness({ mocks }: Readonly<{ mocks: readonly MockLink.MockedResponse[] }>): ReactNode {
  return (
    <StoryApolloProvider mocks={mocks}>
      <DashboardStoryFrame>
        <NotificationsFeedContainer />
      </DashboardStoryFrame>
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Pages/Notifications",
  component: NotificationsPageHarness,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["mocks"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof NotificationsPageHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Mixed read/unread inbox — filter chips, pager-affordance row, interactive mark-one/mark-all. */
export const Default: Story = {
  args: { mocks: interactiveMocks() },
};

/** Empty inbox — translated empty title/body, disabled mark-all affordance. */
export const Empty: Story = {
  args: { mocks: emptyMocks() },
};

/** Never-resolving list fetch — the skeleton branch (count mock still resolves). */
export const Loading: Story = {
  args: { mocks: loadingMocks() },
};
