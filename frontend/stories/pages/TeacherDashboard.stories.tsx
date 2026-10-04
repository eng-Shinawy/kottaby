import type { MockLink } from "@apollo/client/testing";
import { Stack } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { AuthContext, type AuthContextType, type AuthUser } from "@/frontend/context/AuthContext";
import {
  ApplicantStatus,
  type MyApplicantProfileQuery_myApplicantProfile,
  UserRole,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  myApplicantProfileQueryDocument,
  myTeacherAvailabilityQueryDocument,
} from "@/frontend/graphql/sharedDocuments";
import { teacherStatsMocks } from "@/frontend/stories/lib/dashboardStatMocks";
import { DashboardStoryFrame, StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
// Direct file import — the `@/frontend/views/dashboard` barrel drags
// `withPageAuth` (server-only, `pg`-backed) into the Storybook bundle.
import { DashboardView } from "@/frontend/views/dashboard/home/DashboardView";
import { ApplicantStatusCard, TeacherAvailabilityCard } from "@/frontend/views/teachers/dashboard";

/**
 * Storybook surface for the teacher dashboard — `app/(dashboard)/teacher/dashboard/page.tsx`
 * composes `createRoleDashboardPage(UserRole.Teacher)`, which renders
 * `DashboardView` with `<TeacherAvailabilityCard />` + `<ApplicantStatusCard />`
 * as the teacher status slot (the availability card sits FIRST in the
 * production composition — see `RoleDashboardPage.resolveStatusSlot`).
 *
 * The server-side page guard (`withPageAuth`) and the `/teacher/dashboard`
 * route are out of scope for a story; this harness reproduces the client
 * composition exactly: a stubbed `AuthContext` (authenticated teacher) around
 * the same `DashboardView` + the two-card status slot, on a mocked Apollo
 * client (`MockLink` + production cache). The GraphQL operations the page
 * fires are the zero-argument `myTeacherAvailability` + `myApplicantProfile`
 * queries from the two status cards plus the stat-strip queries
 * (`useDashboardStats`: two status-filtered session counts, the teacher
 * wallet, the unread notification count); every mock is
 * `maxUsageCount: Infinity` so re-mounts stay green.
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
  mustChangePassword: false,
};

/** Stub auth context — the page only reads `user`; the actions stay inert. */
const STUB_AUTH: AuthContextType = {
  user: TEACHER_USER,
  isAuthenticated: true,
  isLoading: false,
  error: null,
  login: () => Promise.resolve(true),
  logout: () => {},
  updateSessionUser: () => undefined,
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

/** Availability row fixture — mirrors the `TeacherAvailabilityState` projection. */
type AvailabilityRow = {
  readonly __typename: "TeacherAvailabilityState";
  readonly id: number;
  readonly isOnline: boolean;
  readonly isApproved: boolean;
};

/** Answers `myTeacherAvailability` with the given availability row. */
function availabilityMock(row: AvailabilityRow): MockLink.MockedResponse {
  return {
    request: { query: myTeacherAvailabilityQueryDocument },
    result: { data: { myTeacherAvailability: row } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Certified teacher currently online — the availability card's success-tone branch. */
const CERTIFIED_ONLINE: AvailabilityRow = {
  __typename: "TeacherAvailabilityState",
  id: 77,
  isOnline: true,
  isApproved: true,
};

/** Non-certified teacher — the availability card's disabled-CTA branch. */
const UNCERTIFIED: AvailabilityRow = {
  __typename: "TeacherAvailabilityState",
  id: 77,
  isOnline: false,
  isApproved: false,
};

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
          <DashboardView
            statusSlot={
              <Stack sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <TeacherAvailabilityCard />
                <ApplicantStatusCard />
              </Stack>
            }
          />
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
 * The availability card sits FIRST in the slot (online + certified).
 */
export const CertifiedDefault: Story = {
  args: {
    mocks: [
      availabilityMock(CERTIFIED_ONLINE),
      profileMock(profileFixture({ status: ApplicantStatus.Passed })),
      ...teacherStatsMocks({ completed: 34, upcoming: 3, balance: "1250.50", unread: 2 }),
    ],
  },
};

/** Applicant under review — the `Pending` chip + awaiting-purchase prompt panel. */
export const ApplicantPending: Story = {
  args: {
    mocks: [
      availabilityMock(CERTIFIED_ONLINE),
      profileMock(profileFixture()),
      ...teacherStatsMocks({ completed: 0, upcoming: 0, balance: "0.00", unread: 0 }),
    ],
  },
};

/**
 * Uncertified teacher — the availability card renders the disabled CTA +
 * certification hint (the `Passed` profile is paired here so the applicant
 * card renders its certified summary; the availability card's disabled
 * state is the visual cue the teacher has not completed certification).
 */
export const UncertifiedTeacher: Story = {
  args: {
    mocks: [
      availabilityMock(UNCERTIFIED),
      profileMock(profileFixture({ status: ApplicantStatus.Passed })),
      ...teacherStatsMocks({ completed: 0, upcoming: 0, balance: "0.00", unread: 0 }),
    ],
  },
};

/** Loading — the applicant status card renders its `aria-busy` skeleton indefinitely. */
export const Loading: Story = {
  args: {
    mocks: [
      availabilityMock(CERTIFIED_ONLINE),
      profileLoadingMock(),
      ...teacherStatsMocks({ completed: 34, upcoming: 3, balance: "1250.50", unread: 2 }),
    ],
  },
};
