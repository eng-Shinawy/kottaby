import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { RecitationReading } from "@/frontend/graphql/generated/gql/graphql";
import { recitationReadingsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { RegisterForm } from "@/frontend/views/auth/register";

/**
 * Storybook surface for the `/register` page (`app/(auth)/register/page.tsx`
 * → `RegisterForm`). The form's `useRegisterFormState` fetches the public
 * `recitationReadings` catalog on mount, so every story wires the view to a
 * MockLink-backed Apollo client via the shared story harness. The catalog
 * returns a flat `RecitationReading` enum array — no `__typename` in fixtures
 * (no object types in the selection set).
 *
 * The form resolves its labels itself through `useAppTranslation`
 * (LocaleProvider rides the global decorator), so no label props are passed.
 * The `registerUser` mutation is left unmocked: it only fires on a filled,
 * client-valid submit, and the catch branch renders the translated
 * `registrationFailed` banner — a harmless interactive dead-end by design.
 */

/** Curated 5-option recitation catalog fixture (subset of the canonical Qira'ah list). */
const RECITATION_OPTIONS: readonly RecitationReading[] = [
  RecitationReading.HafsAnAsim,
  RecitationReading.WarshAnNafi,
  RecitationReading.QalunAnNafi,
  RecitationReading.AlDuriAnAbiAmr,
  RecitationReading.ShubahAnAsim,
];

/** Resolving catalog mock — returns the 5-option fixture. */
function catalogMock(): MockLink.MockedResponse {
  return {
    request: { query: recitationReadingsQueryDocument },
    result: { data: { recitationReadings: [...RECITATION_OPTIONS] } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Harness: mounts the page view under the shared MockLink Apollo provider. */
function RegisterPageHarness({ mocks }: Readonly<{ mocks: MockLink.MockedResponse[] }>): ReactNode {
  return (
    <StoryApolloProvider mocks={mocks}>
      <RegisterForm />
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Pages/Auth/Register",
  component: RegisterPageHarness,
  parameters: {
    layout: "centered",
    controls: { exclude: ["mocks"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof RegisterPageHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Populated catalog — the recitation selector offers all five options. */
export const Default: Story = {
  args: { mocks: [catalogMock()] },
};

/** Never-resolving catalog fetch — the recitation selector's loading branch. */
export const Loading: Story = {
  args: {
    mocks: [
      {
        request: { query: recitationReadingsQueryDocument },
        result: { data: { recitationReadings: [] } },
        delay: Number.POSITIVE_INFINITY,
        maxUsageCount: Number.POSITIVE_INFINITY,
      },
    ],
  },
};
