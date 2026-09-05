import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import {
  NetworkConnectivityContext,
  type NetworkConnectivityContextValue,
} from "@/frontend/context/NetworkConnectivityContext";
import { AuthProvider } from "@/frontend/providers/apollo/AuthProvider";
import { DashboardStoryFrame, StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { meMock, pendingMeMock, teacherUser } from "@/frontend/stories/pages/Profile.fixtures";
import { ProfileView } from "@/frontend/views/dashboard/profile";

/**
 * Storybook surface for the `/profile` page (`app/(dashboard)/profile/page.tsx`
 * → `ProfileView`).
 *
 * The view reads the session through `useAuth()`, so the story mounts the REAL
 * `AuthProvider`: its session-restore effect consumes the mocked `me` query on
 * `MockLink` (StoryApolloProvider — real client, production cache), the result
 * lands in the normalized cache, and the language-preference card's cache-only
 * `me` read stays in sync. The `NetworkConnectivityContext` stub satisfies the
 * AuthProvider's token-slot dependency; the logout/login flows stay inert.
 *
 * The dashboard shell (AppBar + Sidebar) belongs to the route-group layout —
 * this surface shows the page's main-content slot only.
 */

/** Inert connectivity/token stub — the AuthProvider requires the context. */
const CONNECTIVITY_STUB: NetworkConnectivityContextValue = {
  isConnected: true,
  isChecking: false,
  lastChecked: null,
  checkConnectivity: () => Promise.resolve(true),
  setConnected: () => undefined,
  notifyIfDisconnected: () => undefined,
  authToken: null,
  updateAuthToken: () => undefined,
  clearAuthData: () => undefined,
};

function ProfileHarness({ mocks }: Readonly<{ mocks: readonly MockLink.MockedResponse[] }>): ReactNode {
  return (
    <StoryApolloProvider mocks={mocks}>
      <NetworkConnectivityContext.Provider value={CONNECTIVITY_STUB}>
        <AuthProvider>
          <DashboardStoryFrame>
            <ProfileView />
          </DashboardStoryFrame>
        </AuthProvider>
      </NetworkConnectivityContext.Provider>
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Pages/Profile",
  component: ProfileHarness,
  parameters: {
    layout: "padded",
    controls: { exclude: ["mocks"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ProfileHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Complete teacher account — every `me` field populated (info, recitation, status cards). */
export const Default: Story = {
  args: { mocks: [meMock(teacherUser())] },
};

/** Never-resolving `me` fetch — the session-restore loading branch (spinner). */
export const Loading: Story = {
  args: { mocks: [pendingMeMock()] },
};
