import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { AuthContext, type AuthContextType, type AuthUser } from "@/frontend/context/AuthContext";
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import { DashboardStoryFrame } from "@/frontend/stories/lib/storyHarness";
import { DashboardView } from "@/frontend/views/dashboard/home/DashboardView";

/**
 * Storybook surface for the admin dashboard — `app/(dashboard)/admin/dashboard/page.tsx`,
 * which renders the shared `DashboardView` via `createRoleDashboardPage(UserRole.Admin, ...)`.
 *
 * Unlike the teacher/student variants, the ADMIN role has no `statusSlot`
 * content, so the surface is: welcome header, the 2x2 placeholder stat grid
 * (Sessions Completed / Balance / Upcoming / Notifications — hardcoded "0"
 * until the Sessions/Wallet/Notifications subsystems land), and the
 * getting-started card.
 *
 * There are NO GraphQL queries on this page to mock — the only dynamic input
 * is `useAuth()` (welcome header), so the harness provides `AuthContext`
 * directly instead of an Apollo MockLink. The "Loading" variant models the
 * auth-bootstrapping window (user not yet resolved → falls back to the
 * generic dashboard title).
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

/** Provides the auth context the view consumes; no Apollo needed (no queries). */
function AdminDashboardHarness({ auth }: Readonly<{ auth: AuthContextType }>): ReactNode {
  return (
    <AuthContext.Provider value={auth}>
      <DashboardStoryFrame>
        <DashboardView />
      </DashboardStoryFrame>
    </AuthContext.Provider>
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

/** Signed-in admin — personalized welcome header above the placeholder stats. */
export const Default: Story = {
  args: { auth: authValue({}) },
};

/** Auth still resolving — no user yet, header falls back to the plain title. */
export const Loading: Story = {
  args: { auth: authValue({ user: null, isAuthenticated: false, isLoading: true }) },
};
