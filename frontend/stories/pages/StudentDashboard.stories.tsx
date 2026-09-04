import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { AuthContext, type AuthContextType, type AuthUser } from "@/frontend/context/AuthContext";
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import { myHandshakeCodeQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { DashboardStoryFrame, StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
// Direct file import — the `@/frontend/views/dashboard` barrel drags
// `withPageAuth` (server-only, `pg`-backed) into the Storybook bundle.
import { DashboardView } from "@/frontend/views/dashboard/home/DashboardView";
import { HandshakeCodeCard } from "@/frontend/views/students/dashboard/HandshakeCodeCard";

/**
 * Storybook surface for the student dashboard — `app/(dashboard)/student/dashboard/page.tsx`
 * composes `createRoleDashboardPage(UserRole.Student)`, which renders
 * `DashboardView` with `<HandshakeCodeCard />` as the student status slot.
 *
 * The server-side page guard (`withPageAuth`) and the `/student/dashboard`
 * route are out of scope for a story; this harness reproduces the client
 * composition exactly: a stubbed `AuthContext` (authenticated student) around
 * the same `DashboardView` + `HandshakeCodeCard` tree, on a mocked Apollo
 * client (`MockLink` + production cache). The only GraphQL operation the page
 * fires is the zero-argument `myHandshakeCode` query from the handshake card;
 * every mock is `maxUsageCount: Infinity` so re-mounts stay green.
 */

/** Authenticated student identity for the welcome header — mirrors `MeQuery`. */
const STUDENT_USER: AuthUser = {
  id: 101,
  email: "student@example.com",
  fullName: "Yusuf Ahmed",
  phone: null,
  country: null,
  gender: null,
  locale: null,
  role: UserRole.Student,
  preferredRecitation: null,
  isDeleted: false,
  suspended: false,
  isBlocked: false,
};

/** Stub auth context — the page only reads `user`; the actions stay inert. */
const STUB_AUTH: AuthContextType = {
  user: STUDENT_USER,
  isAuthenticated: true,
  isLoading: false,
  error: null,
  login: () => Promise.resolve(true),
  logout: () => {},
};

/** Resolved handshake code (`KSB-` + 8 uppercase hex, per shared constants). */
function handshakeCodeResolvedMock(): MockLink.MockedResponse {
  return {
    request: { query: myHandshakeCodeQueryDocument },
    result: { data: { myHandshakeCode: "KSB-7F3D9A2E" } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Never-resolving handshake fetch — the card's skeleton branch. */
function handshakeCodeLoadingMock(): MockLink.MockedResponse {
  return {
    request: { query: myHandshakeCodeQueryDocument },
    result: { data: { myHandshakeCode: "KSB-7F3D9A2E" } },
    delay: Number.POSITIVE_INFINITY,
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Page-level harness: mocked Apollo + stubbed student auth around the real view. */
function StudentDashboardHarness({ mocks }: Readonly<{ mocks: MockLink.MockedResponse[] }>): ReactNode {
  return (
    <StoryApolloProvider mocks={mocks}>
      <AuthContext.Provider value={STUB_AUTH}>
        <DashboardStoryFrame>
          <DashboardView statusSlot={<HandshakeCodeCard />} />
        </DashboardStoryFrame>
      </AuthContext.Provider>
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Pages/Student/Dashboard",
  component: StudentDashboardHarness,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["mocks"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof StudentDashboardHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Populated — welcome header, handshake-code card resolved, stat grid, getting-started. */
export const Default: Story = {
  args: { mocks: [handshakeCodeResolvedMock()] },
};

/** Loading — the handshake-code card renders its `aria-busy` skeleton indefinitely. */
export const Loading: Story = {
  args: { mocks: [handshakeCodeLoadingMock()] },
};
