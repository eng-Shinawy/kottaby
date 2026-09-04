import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import {
  activityMock,
  CERTIFIED_TEACHER_USER,
  CERTIFY_SUCCESS_MOCK,
  DETAIL_USER_ID,
  detailMock,
  LOADING_MOCKS,
  PENDING_TEACHER_USER,
} from "@/frontend/stories/admin/AdminUserDetailPage.fixtures";
import { DashboardStoryFrame, StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { AdminUserDetailContainer } from "@/frontend/views/admin/users/detail";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminUsers } from "@/shared/locale/namespaces";

/**
 * Storybook surface for the admin user DETAIL page rendered by
 * `app/(dashboard)/admin/users/[id]` — the full `AdminUserDetailContainer`
 * (hero with inline actions, profile/governance cards, role-child
 * snapshots, recent-activity timeline).
 *
 * Both data queries ride MockLink (`adminUserDetail` +
 * `adminUserActivity`); the PendingTeacher variant additionally wires a
 * successful `adminCertifyTeacherColdStart` mock so clicking the Certify
 * hero button → Confirm runs the real mutation through the story cache —
 * the post-write payload merges into `AdminUserDetail:<id>` and the
 * Certify button disappears without a refetch. The global decorator owns
 * theme / locale / viewport.
 */

/** Wraps the container in the shared mocked-Apollo harness. */
function DetailHarness({ mocks }: Readonly<{ mocks: readonly MockLink.MockedResponse[] }>): ReactNode {
  const labels = useAppTranslation(AdminUsers);
  return (
    <StoryApolloProvider mocks={mocks}>
      <DashboardStoryFrame>
        <AdminUserDetailContainer labels={labels} userId={DETAIL_USER_ID} />
      </DashboardStoryFrame>
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Pages/Admin/User Detail",
  component: DetailHarness,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["mocks"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof DetailHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Uncertified teacher applicant — the Certify hero button is visible and functional. */
export const PendingTeacher: Story = {
  args: { mocks: [detailMock(PENDING_TEACHER_USER), activityMock(), CERTIFY_SUCCESS_MOCK] },
};

/** Certified teacher evaluator — no Certify button (already approved). */
export const CertifiedTeacher: Story = {
  args: { mocks: [detailMock(CERTIFIED_TEACHER_USER), activityMock()] },
};

/** Never-resolving detail query — the `UserDetailLoading` skeleton branch. */
export const Loading: Story = {
  args: { mocks: [...LOADING_MOCKS] },
};
