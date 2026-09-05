import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { expect, within } from "storybook/test";
import { AuthContext, type AuthContextType } from "@/frontend/context/AuthContext";
import { LoginForm } from "@/frontend/views/auth/login";

/**
 * Storybook surface for the login page — `app/(auth)/login/page.tsx` renders
 * `LoginForm` directly.
 *
 * `useLoginForm` consumes `useAuth()` (login mutation + session state live
 * behind the real `AuthProvider`, which itself needs the network-connectivity
 * context and mount-time `me`/`refreshToken` queries) and reads nothing else
 * from Apollo on mount — so the harness stubs the `AuthContext` seam the form
 * actually consumes, and no Apollo provider/mocks are needed. Labels come from
 * `useAppTranslation` (LocaleProvider is in the global decorator).
 */

/** Baseline anonymous context — every field `LoginForm` touches. */
const ANONYMOUS_CONTEXT: AuthContextType = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  login: async () => true,
  logout: () => {},
};

/** Rejection shaped like the Apollo GraphQL error `extractErrorCode` parses. */
const unauthorizedCredentialsError = Object.assign(new Error("invalid credentials"), {
  extensions: { code: "UNAUTHORIZED" },
});

function LoginHarness({ context }: Readonly<{ context: AuthContextType }>): ReactNode {
  return (
    <AuthContext.Provider value={context}>
      <LoginForm />
    </AuthContext.Provider>
  );
}

const meta = {
  title: "Pages/Auth/Login",
  component: LoginHarness,
  parameters: {
    layout: "centered",
    controls: { exclude: ["context"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LoginHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The form at rest — exactly what an anonymous visitor sees. */
export const Default: Story = {
  args: { context: ANONYMOUS_CONTEXT },
};

/**
 * The `login` mutation answers with a GraphQL `UNAUTHORIZED` error; the play
 * hook submits the (validation-free) form so the sticky `invalidCredentials`
 * alert surfaces and focus returns to the email field.
 */
export const CredentialsRejected: Story = {
  args: {
    context: {
      ...ANONYMOUS_CONTEXT,
      login: async () => {
        throw unauthorizedCredentialsError;
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const submit = canvas.getAllByRole("button").find(button => button.getAttribute("type") === "submit");
    submit?.click();
    await expect(await canvas.findByRole("alert")).toBeVisible();
  },
};
