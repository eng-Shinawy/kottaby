import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { adminUsersQueryDocument } from "@/frontend/graphql/sharedDocuments/admin";
import {
  directoryMock,
  POPULATED_ROWS,
  POPULATED_TOTAL_COUNT,
} from "@/frontend/stories/admin/AdminUsersDirectory.fixtures";
import { DashboardStoryFrame, StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { AdminUsersDirectoryContainer } from "@/frontend/views/admin/users/directory";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminUsers } from "@/shared/locale/namespaces";

/**
 * Storybook surface for the `/admin/users` directory page
 * (`AdminUsersDirectoryContainer` + `useAdminUsersDirectory`).
 *
 * The real page (`app/(dashboard)/admin/users/page.tsx`) passes the
 * `AdminUsers` locale leaf from the server; the story resolves the same
 * bundle through `useAppTranslation` so the toolbar locale toggle switches
 * labels live. Data rides a real `ApolloClient` over
 * `MockLink` (production cache) via `StoryApolloProvider`; mocks match any
 * `adminUsers` variables (`VariableMatcher` — the exact first-render
 * variables are pinned in `DIRECTORY_VARIABLES` for reference) and are
 * `maxUsageCount: Infinity` so filter/pagination refetches never fall off
 * the mock queue.
 */

function DirectoryHarness({ mocks }: Readonly<{ mocks: readonly MockLink.MockedResponse[] }>): ReactNode {
  const labels = useAppTranslation(AdminUsers);
  return (
    <StoryApolloProvider mocks={mocks}>
      <DashboardStoryFrame>
        <AdminUsersDirectoryContainer labels={labels} />
      </DashboardStoryFrame>
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Pages/Admin/Users Directory",
  component: DirectoryHarness,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["mocks"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof DirectoryHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Populated page 1 of N — mixed roles, governance states, and sparse fields. */
export const Default: Story = {
  args: { mocks: [directoryMock(POPULATED_ROWS, POPULATED_TOTAL_COUNT)] },
};

/** Never-resolving list fetch — the skeleton branch (desktop + mobile). */
export const Loading: Story = {
  args: {
    mocks: [
      {
        request: { query: adminUsersQueryDocument, variables: () => true },
        result: {
          data: { adminUsers: { __typename: "AdminUserPage", items: [], totalCount: 0, page: 1, pageSize: 10 } },
        },
        delay: Number.POSITIVE_INFINITY,
        maxUsageCount: Number.POSITIVE_INFINITY,
      },
    ],
  },
};

/** Transport failure — the translated error alert above the results. */
export const LoadError: Story = {
  args: {
    mocks: [
      {
        request: { query: adminUsersQueryDocument, variables: () => true },
        error: new Error("mocked transport failure"),
        maxUsageCount: Number.POSITIVE_INFINITY,
      },
    ],
  },
};

/** Zero rows with no filters — the translated empty state + create CTA. */
export const Empty: Story = {
  args: { mocks: [directoryMock([], 0)] },
};
