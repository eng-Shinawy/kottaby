import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { AuthContext, type AuthContextType, type AuthUser } from "@/frontend/context/AuthContext";
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import { adminStatsMocks } from "@/frontend/stories/lib/dashboardStatMocks";
import { DashboardStoryFrame, StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { DashboardView } from "@/frontend/views/dashboard/home/DashboardView";

/**
 * Storybook surface for the admin dashboard — `app/(dashboard)/admin/dashboard/page.tsx`,
 * which renders the shared `DashboardView` via `createRoleDashboardPage(UserRole.Admin, ...)`.
 *
 * Unlike the teacher/student variants, the ADMIN role has no `statusSlot`
 * content, so the surface is: welcome header, the 1x4 live stat grid (total
 * users / teachers / students / unread notifications from `adminUserStats`
 * + the shared unread count via `useDashboardStats`), and the
 * getting-started card.
 *
 * The only dynamic inputs are `useAuth()` (welcome header) and the stat
 * strip's two queries (`adminUserStats`, `myUnreadNotificationCount`) —
 * both mocked on the shared `MockLink` + production-cache harness
 * (`maxUsageCount: Infinity` so re-mounts stay green). The "Loading"
 * variant models the auth-bootstrapping window (user not yet resolved →
 * falls back to the generic dashboard title; the stat queries stay
 * mounted, so their mocks are provided too).
 *
 * NOTE: `DashboardView` is imported from its file rather than the
 * `@/frontend/views/dashboard` barrel — the barrel also re-exports
 * `RoleDashboardPage`, which transitively imports server auth (`withPageAuth`
 * → pg) and crashes the Storybook browser bundle.
 */

/** Deterministic admin fixture — matches the `me` query selection shape. */
const ADMIN_USER: AuthUser = {
  id: 1,
  email: "admin@kottaby.app",
  fullName: "Sarah Al-Amiri",
  phone: "+971500000001",
  country: "AE",
  gender: null,
  locale: null,
  role: UserRole.Admin,
  preferredRecitation: null,
  isDeleted: false,
  suspended: false,
  isBlocked: false,
};

function authValue(overrides: Partial<AuthContextType>): AuthContextType {
  return {
    user: ADMIN_USER,
    isAuthenticated: true,
    isLoading: false,
    error: null,
    login: () => Promise.resolve(false),
    logout: () => undefined,
    ...overrides,
  };
}

/** Provides the auth context + mocked stat queries the view consumes. */
function AdminDashboardHarness({ auth }: Readonly<{ auth: AuthContextType }>): ReactNode {
  const statMocks = adminStatsMocks({ totalUsers: 128, teachers: 14, students: 97, unread: 5 });
  return (
    <StoryApolloProvider mocks={statMocks}>
      <AuthContext.Provider value={auth}>
        <DashboardStoryFrame>
          <DashboardView />
        </DashboardStoryFrame>
      </AuthContext.Provider>
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Pages/Admin/Dashboard",
  component: AdminDashboardHarness,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["auth"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof AdminDashboardHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Signed-in admin — personalized welcome header above the live platform stats. */
export const Default: Story = {
  args: { auth: authValue({}) },
};

/** Auth still resolving — no user yet, header falls back to the plain title. */
export const Loading: Story = {
  args: { auth: authValue({ user: null, isAuthenticated: false, isLoading: true }) },
};
