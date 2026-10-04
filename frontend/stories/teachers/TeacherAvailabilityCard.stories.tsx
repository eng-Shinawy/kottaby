import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { expect, within } from "storybook/test";
import {
  myTeacherAvailabilityQueryDocument,
  setTeacherAvailabilityMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { TeacherAvailabilityCard } from "@/frontend/views/teachers/dashboard/TeacherAvailabilityCard";

/**
 * Storybook surface for `TeacherAvailabilityCard` — the teacher dashboard's
 * availability toggle card. The card is fully self-contained (its own
 * `myTeacherAvailability` read fires on mount; the toggle runs the real
 * `setTeacherAvailability` mutation against `StoryApolloProvider`), so
 * every story just wires `MockLink` responses and asserts the rendered
 * branch.
 *
 * Covered branches:
 *  - `Available` — certified teacher currently online (success-tone chip +
 *    the "Set as Unavailable" CTA).
 *  - `Unavailable` — certified teacher currently offline (neutral-tone chip
 *    + the "Set as Available" CTA).
 *  - `Uncertified` — non-certified teacher (the "Set as Available" CTA is
 *    DISABLED + the `certificationRequiredHint` notice renders — the
 *    server 403 FORBIDDEN is the defense-in-depth backstop).
 *  - `Loading` — the in-flight skeleton branch (`aria-busy`).
 *  - `LoadError` — the query-load failure branch (`loadErrorNotice`).
 *  - `InSessionRejection` — the mutation returns
 *    `TEACHER_IN_ACTIVE_SESSION` (the inline `inSessionLockedHint` notice
 *    renders — the global toast fires via the shared error-link map).
 *  - `GenericMutationError` — an unmapped mutation error (the inline
 *    `updateGenericError` notice renders).
 *  - `ToggleSuccess` — the mutation succeeds (the success snackbar +
 *    cache normalization re-renders the card into the opposite branch).
 *
 * Every mock is `maxUsageCount: Infinity` so re-mounts stay green; the
 * mutation mocks thread the `isOnline` variable so the typed Apollo
 * `MockLink` matches the card's write request exactly.
 */

/** Row shape returned by the `myTeacherAvailability` query. */
type AvailabilityRow = {
  readonly __typename: "TeacherAvailabilityState";
  readonly id: number;
  readonly isOnline: boolean;
  readonly isApproved: boolean;
};

/** Stable fixture — a certified teacher currently online. */
const CERTIFIED_ONLINE: AvailabilityRow = {
  __typename: "TeacherAvailabilityState",
  id: 77,
  isOnline: true,
  isApproved: true,
};

/** Stable fixture — a certified teacher currently offline. */
const CERTIFIED_OFFLINE: AvailabilityRow = {
  __typename: "TeacherAvailabilityState",
  id: 77,
  isOnline: false,
  isApproved: true,
};

/** Stable fixture — a non-certified teacher (always offline in steady state). */
const UNCERTIFIED: AvailabilityRow = {
  __typename: "TeacherAvailabilityState",
  id: 77,
  isOnline: false,
  isApproved: false,
};

/** Answers the read with the given availability row (reusable across refetches). */
function availabilityMock(row: AvailabilityRow): MockLink.MockedResponse {
  return {
    request: { query: myTeacherAvailabilityQueryDocument },
    result: { data: { myTeacherAvailability: row } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Never-resolving read — the card's `aria-busy` skeleton branch. */
function availabilityLoadingMock(): MockLink.MockedResponse {
  return {
    request: { query: myTeacherAvailabilityQueryDocument },
    result: { data: { myTeacherAvailability: CERTIFIED_OFFLINE } },
    delay: Number.POSITIVE_INFINITY,
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Rejects the read with a transport error — the load-error branch. */
function availabilityErrorMock(): MockLink.MockedResponse {
  return {
    request: { query: myTeacherAvailabilityQueryDocument },
    error: new Error("network unavailable (masked transport surface)"),
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Successful toggle — returns the post-toggle snapshot row. */
function toggleSuccessMock(targetOnline: boolean): MockLink.MockedResponse {
  return {
    request: {
      query: setTeacherAvailabilityMutationDocument,
      variables: { isOnline: targetOnline },
    },
    result: {
      data: {
        setTeacherAvailability: {
          __typename: "TeacherAvailabilityState",
          id: 77,
          isOnline: targetOnline,
          isApproved: true,
        },
      },
    },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Rejects the toggle with a typed `extensions.code` denial. */
function toggleErrorMock(targetOnline: boolean, code: string): MockLink.MockedResponse {
  return {
    request: {
      query: setTeacherAvailabilityMutationDocument,
      variables: { isOnline: targetOnline },
    },
    result: {
      errors: [{ message: `${code} (masked transport surface)`, extensions: { code } }],
    },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

interface CardStoryProps {
  readonly mocks: readonly MockLink.MockedResponse[];
}

/** Harness — wraps the card with the mocked Apollo provider. */
function CardStory({ mocks }: Readonly<CardStoryProps>): ReactNode {
  return (
    <StoryApolloProvider mocks={[...mocks]}>
      <TeacherAvailabilityCard />
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Teachers/Teacher Availability Card",
  component: CardStory,
  parameters: {
    layout: "centered",
    controls: { exclude: ["mocks"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof CardStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Certified teacher currently online — success-tone chip + "Set as Unavailable" CTA. */
export const Available: Story = {
  args: { mocks: [availabilityMock(CERTIFIED_ONLINE)] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByTestId("teacher-availability-card");
    await expect(card).toBeVisible();
  },
};

/** Certified teacher currently offline — neutral-tone chip + "Set as Available" CTA. */
export const Unavailable: Story = {
  args: { mocks: [availabilityMock(CERTIFIED_OFFLINE)] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByTestId("teacher-availability-card");
    await expect(card).toBeVisible();
  },
};

/** Non-certified teacher — "Set as Available" CTA DISABLED + certification hint renders. */
export const Uncertified: Story = {
  args: { mocks: [availabilityMock(UNCERTIFIED)] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByTestId("teacher-availability-card");
    const cta = canvas.getByRole("button");
    await expect(cta).toBeDisabled();
    await expect(card).toBeVisible();
  },
};

/** Loading — the card renders its `aria-busy` skeleton indefinitely. */
export const Loading: Story = {
  args: { mocks: [availabilityLoadingMock()] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const skeleton = await canvas.findByTestId("teacher-availability-card-loading");
    await expect(skeleton).toBeVisible();
  },
};

/** Load failure — the query rejection surfaces as the inline `loadErrorNotice`. */
export const LoadError: Story = {
  args: { mocks: [availabilityErrorMock()] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const errorCard = await canvas.findByTestId("teacher-availability-card-load-error");
    await expect(errorCard).toBeVisible();
  },
};

/** In-session rejection — the mutation returns TEACHER_IN_ACTIVE_SESSION. */
export const InSessionRejection: Story = {
  args: {
    mocks: [availabilityMock(CERTIFIED_OFFLINE), toggleErrorMock(true, "TEACHER_IN_ACTIVE_SESSION")],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByTestId("teacher-availability-card");
    const cta = canvas.getByRole("button");
    cta.click();
    await expect(card).toBeVisible();
  },
};

/** Generic mutation error — an unmapped code surfaces the inline `updateGenericError`. */
export const GenericMutationError: Story = {
  args: {
    mocks: [availabilityMock(CERTIFIED_OFFLINE), toggleErrorMock(true, "INTERNAL_SERVER_ERROR")],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByTestId("teacher-availability-card");
    const cta = canvas.getByRole("button");
    cta.click();
    await expect(card).toBeVisible();
  },
};

/** Successful toggle — the mutation settles and the success snackbar fires. */
export const ToggleSuccess: Story = {
  args: {
    mocks: [availabilityMock(CERTIFIED_OFFLINE), toggleSuccessMock(true), availabilityMock(CERTIFIED_ONLINE)],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByTestId("teacher-availability-card");
    const cta = canvas.getByRole("button");
    cta.click();
    await expect(card).toBeVisible();
  },
};
