import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { AuthContext, type AuthContextType, type AuthUser } from "@/frontend/context/AuthContext";
import {
  ApplicantStatus,
  type MyApplicantProfileQuery_myApplicantProfile,
  UserRole,
} from "@/frontend/graphql/generated/gql/graphql";
import { myApplicantProfileQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { DashboardStoryFrame, StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
// Direct file import — the `@/frontend/views/dashboard` barrel drags
// `withPageAuth` (server-only, `pg`-backed) into the Storybook bundle.
import { DashboardView } from "@/frontend/views/dashboard/home/DashboardView";
import { ApplicantStatusCard } from "@/frontend/views/teachers/dashboard/ApplicantStatusCard";

/**
 * Storybook surface for the teacher dashboard — `app/(dashboard)/teacher/dashboard/page.tsx`
 * composes `createRoleDashboardPage(UserRole.Teacher)`, which renders
 * `DashboardView` with `<ApplicantStatusCard />` as the teacher status slot.
 *
 * The server-side page guard (`withPageAuth`) and the `/teacher/dashboard`
 * route are out of scope for a story; this harness reproduces the client
 * composition exactly: a stubbed `AuthContext` (authenticated teacher) around
 * the same `DashboardView` + `ApplicantStatusCard` tree, on a mocked Apollo
 * client (`MockLink` + production cache). The only GraphQL operation the page
 * fires is the zero-argument `myApplicantProfile` query from the status card;
 * every mock is `maxUsageCount: Infinity` so re-mounts stay green.
 */

/** Authenticated teacher identity for the welcome header — mirrors `MeQuery`. */
const TEACHER_USER: AuthUser = {
  id: 77,
  email: "amina.khaled+kottabyteacher@example.com",
  fullName: "Amina Khaled",
  phone: null,
  country: null,
  gender: null,
  locale: null,
  role: UserRole.Teacher,
  preferredRecitation: null,
  isDeleted: false,
  suspended: false,
  isBlocked: false,
};

/** Stub auth context — the page only reads `user`; the actions stay inert. */
const STUB_AUTH: AuthContextType = {
  user: TEACHER_USER,
  isAuthenticated: true,
  isLoading: false,
  error: null,
  login: () => Promise.resolve(true),
  logout: () => {},
};

type ApplicantProfileFixture = MyApplicantProfileQuery_myApplicantProfile & {
  readonly __typename: "ApplicantProfile";
};

/** Deterministic seven-field applicant profile fixture (Apollo `__typename` included). */
function profileFixture(overrides?: Partial<ApplicantProfileFixture>): ApplicantProfileFixture {
  return {
    __typename: "ApplicantProfile",
    id: 77,
    status: ApplicantStatus.Pending,
    verificationAttempts: 0,
    lastAttemptAt: null,
    cooldownUntil: null,
    cooldownActive: false,
    canPurchaseVerification: true,
    ...overrides,
  };
}

/** Answers `myApplicantProfile` with the given profile row. */
function profileMock(profile: ApplicantProfileFixture | null): MockLink.MockedResponse {
  return {
    request: { query: myApplicantProfileQueryDocument },
    result: { data: { myApplicantProfile: profile } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Never-resolving profile fetch — the card's `aria-busy` skeleton branch. */
function profileLoadingMock(): MockLink.MockedResponse {
  return {
    request: { query: myApplicantProfileQueryDocument },
    result: { data: { myApplicantProfile: null } },
    delay: Number.POSITIVE_INFINITY,
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Page-level harness: mocked Apollo + stubbed teacher auth around the real view. */
function TeacherDashboardHarness({ mocks }: Readonly<{ mocks: MockLink.MockedResponse[] }>): ReactNode {
  return (
    <StoryApolloProvider mocks={mocks}>
      <AuthContext.Provider value={STUB_AUTH}>
        <DashboardStoryFrame>
          <DashboardView statusSlot={<ApplicantStatusCard />} />
        </DashboardStoryFrame>
      </AuthContext.Provider>
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Pages/Teacher/Dashboard",
  component: TeacherDashboardHarness,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["mocks"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof TeacherDashboardHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Certified teacher — the `Passed` lifecycle row (the certified outcome flow
 * verified end-to-end): passed chip + certified narrative above the stat grid.
 */
export const CertifiedDefault: Story = {
  args: { mocks: [profileMock(profileFixture({ status: ApplicantStatus.Passed }))] },
};

/** Applicant under review — the `Pending` chip + awaiting-purchase prompt panel. */
export const ApplicantPending: Story = {
  args: { mocks: [profileMock(profileFixture())] },
};

/** Loading — the applicant status card renders its `aria-busy` skeleton indefinitely. */
export const Loading: Story = {
  args: { mocks: [profileLoadingMock()] },
};
