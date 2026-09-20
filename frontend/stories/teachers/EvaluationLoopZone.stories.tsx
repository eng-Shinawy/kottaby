import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { ApplicantStatus } from "@/frontend/graphql/generated/gql/graphql";
import { myApplicantProfileQueryDocument } from "@/frontend/graphql/sharedDocuments/teachers/applicant.documents";
import { myEvaluationLoopStatusQueryDocument } from "@/frontend/graphql/sharedDocuments/teachers/evaluation-booking.documents";
import { StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { EvaluationLoopZone } from "@/frontend/views/teachers/dashboard/EvaluationLoopZone";

/**
 * Storybook surface for `EvaluationLoopZone` — the in-evaluation loop
 * progress surface of the applicant status card. Every story wires the
 * zone's two self-contained reads through `StoryApolloProvider` on
 * `MockLink` (the loop-status blob + the profile refetch handle), covering
 * the plan §6.1 visual state matrix: zero-progress (null status → the
 * client zero-shape), mid-loop, loop-complete, and the no-credits
 * capacity ceiling.
 *
 * All row data below is story-fixture data ONLY (prototype-fixture
 * discipline) — the zone itself renders exclusively server-derived counts.
 */

/** In-evaluation applicant profile row — story fixture, never app state. */
const IN_EVALUATION_PROFILE = {
  __typename: "ApplicantProfile",
  id: 42,
  status: ApplicantStatus.InEvaluation,
  verificationAttempts: 1,
  lastAttemptAt: "2026-09-01T10:00:00.000Z",
  cooldownUntil: null,
  cooldownActive: false,
  canPurchaseVerification: false,
};

/** Answers the zone's remounted profile read with the fixture row. */
const PROFILE_MOCK: MockLink.MockedResponse = {
  request: { query: myApplicantProfileQueryDocument },
  result: { data: { myApplicantProfile: IN_EVALUATION_PROFILE } },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Answers the loop-status read with the given blob (or `null` on the wire). */
function loopStatusMock(
  status: {
    bookedCount: number;
    completedCount: number;
    remainingCredits: number;
    cycleStartDate: string | null;
  } | null
): MockLink.MockedResponse {
  return {
    request: { query: myEvaluationLoopStatusQueryDocument },
    result: { data: { myEvaluationLoopStatus: status } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

interface ZoneStoryProps {
  readonly mocks: readonly MockLink.MockedResponse[];
}

function ZoneStory({ mocks }: Readonly<ZoneStoryProps>): ReactNode {
  return (
    <StoryApolloProvider mocks={mocks}>
      <EvaluationLoopZone />
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Teachers/Evaluation Loop Zone",
  component: ZoneStory,
  parameters: {
    layout: "centered",
    controls: { exclude: ["mocks"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ZoneStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Null loop status on the wire — the client renders the zero-shape (0 of 5). */
export const ZeroProgress: Story = {
  args: { mocks: [PROFILE_MOCK, loopStatusMock(null)] },
};

/** Mid-loop — two sessions booked, one completed, three credits left. */
export const MidLoop: Story = {
  args: {
    mocks: [
      PROFILE_MOCK,
      loopStatusMock({
        bookedCount: 2,
        completedCount: 1,
        remainingCredits: 3,
        cycleStartDate: "2026-09-01T00:00:00.000Z",
      }),
    ],
  },
};

/** Loop complete — all five sessions booked AND completed, zero left. */
export const LoopComplete: Story = {
  args: {
    mocks: [
      PROFILE_MOCK,
      loopStatusMock({
        bookedCount: 5,
        completedCount: 5,
        remainingCredits: 0,
        cycleStartDate: "2026-08-01T00:00:00.000Z",
      }),
    ],
  },
};

/** Capacity ceiling — five booked, none completed, zero credits remaining. */
export const NoCredits: Story = {
  args: {
    mocks: [
      PROFILE_MOCK,
      loopStatusMock({
        bookedCount: 5,
        completedCount: 0,
        remainingCredits: 0,
        cycleStartDate: "2026-08-20T00:00:00.000Z",
      }),
    ],
  },
};
