import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { type ReactNode, useMemo } from "react";
import { AuthContext, type AuthContextType, type AuthUser } from "@/frontend/context/AuthContext";
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import { DashboardStoryFrame } from "@/frontend/stories/lib/storyHarness";
// Direct file import — the `@/frontend/views/dashboard` barrel drags
// `withPageAuth` (server-only, `pg`-backed) into the Storybook bundle.
import { DashboardView } from "@/frontend/views/dashboard/home/DashboardView";

/**
 * Storybook surface for the parent dashboard page
 * (`app/(dashboard)/parent/dashboard/page.tsx`).
 *
 * The page renders `DashboardView` through
 * `createRoleDashboardPage(UserRole.Parent, "/parent/dashboard")` — parents
 * get no status slot (`resolveStatusSlot` returns `undefined` for Parent), so
 * the surface is the shared welcome header + 1x4 stat grid + getting-started
 * card. Everything the view reads is already context-driven: the welcome line
 * comes from `useAuth()` (`user.fullName`) and all copy from the `Dashboard`
 * locale bundle (provided by the global Storybook decorator), so the harness
 * only fixes the auth session state — no Apollo mocks are needed.
 *
 * Note: the current parent surface renders no linked-children widget; the
 * fixture models a linked parent of two children (Yusuf and Aisha) since the
 * view only consumes the parent's identity.
 */

/** Parent session fixture — a linked parent with two children (Yusuf & Aisha). */
const PARENT_USER: AuthUser = {
  id: 501,
  email: "mariam.hassan\u0040kottaby.academy",
  fullName: "Mariam Hassan",
  phone: "+971501234567",
  country: "AE",
  gender: null,
  locale: null,
  role: UserRole.Parent,
  preferredRecitation: null,
  isDeleted: false,
  suspended: false,
  isBlocked: false,
};

interface ParentDashboardHarnessProps {
  readonly user: AuthUser | null;
  readonly isLoading: boolean;
}

/** Publishes a fixed auth session to `DashboardView` — mirrors `AuthProvider` shape. */
function ParentDashboardHarness({ user, isLoading }: Readonly<ParentDashboardHarnessProps>): ReactNode {
  const authValue = useMemo<AuthContextType>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      error: null,
      login: () => Promise.resolve(false),
      logout: () => undefined,
    }),
    [user, isLoading]
  );
  return (
    <AuthContext.Provider value={authValue}>
      {/* Mirrors the dashboard layout's content frame (Container gutters + py). */}
      <DashboardStoryFrame>
        <DashboardView />
      </DashboardStoryFrame>
    </AuthContext.Provider>
  );
}

const meta = {
  title: "Pages/Parent/Dashboard",
  component: ParentDashboardHarness,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["user", "isLoading"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ParentDashboardHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Signed-in parent — welcome header uses the parent's name, stat grid placeholders. */
export const Default: Story = {
  args: { user: PARENT_USER, isLoading: false },
};

/** Session still resolving (`AuthContext.isLoading`) — falls back to the generic title. */
export const Loading: Story = {
  args: { user: null, isLoading: true },
};
