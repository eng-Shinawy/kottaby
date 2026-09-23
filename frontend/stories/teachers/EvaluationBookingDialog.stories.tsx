import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { type ReactNode, useEffect, useState } from "react";
import { SessionIntent, SessionStatus, SessionType } from "@/frontend/graphql/generated/gql/graphql";
import {
  availableEvaluatorsQueryDocument,
  bookEvaluationSessionMutationDocument,
} from "@/frontend/graphql/sharedDocuments/teachers/evaluation-booking.documents";
import { StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { EvaluationBookingDialog } from "@/frontend/views/teachers/dashboard/EvaluationBookingDialog";
import { Applicant, useAppTranslation } from "@/shared/locale";

/**
 * Storybook surface for `EvaluationBookingDialog` — the evaluator picker +
 * confirm gate. The dialog is fully self-contained (its own
 * `availableEvaluators` read fires on open; confirm runs the real
 * `bookEvaluationSession` mutation against `StoryApolloProvider`), so every
 * story just wires MockLink responses. The denial variants auto-select the
 * first radio and click Confirm once after mount so the typed
 * `extensions.code` rejection lands in the shared notice snackbar — the
 * dialog's own outcome lanes decide whether it stays open or closes.
 *
 * All evaluator rows below are story-fixture data ONLY.
 */

/** The first picker row fixture — online, rated, with subjects. */
const FIRST_EVALUATOR = {
  __typename: "EvaluationEvaluatorOption",
  id: "101",
  fullName: "Hajar Al-Siddiq",
  isOnline: true,
  averageRating: "4.6000",
  subjects: "Tajweed · Hafs",
};

/** The second picker row fixture — offline, unrated. */
const SECOND_EVALUATOR = {
  __typename: "EvaluationEvaluatorOption",
  id: "102",
  fullName: "Nadia Al-Fahim",
  isOnline: false,
  averageRating: null,
  subjects: null,
};

/** Answers the picker read with a two-row page (reusable across refetches). */
const EVALUATORS_PAGE_MOCK: MockLink.MockedResponse = {
  request: { query: availableEvaluatorsQueryDocument, variables: { page: 1, pageSize: 50 } },
  result: {
    data: {
      availableEvaluators: {
        __typename: "EvaluationEvaluatorOptionPage",
        items: [FIRST_EVALUATOR, SECOND_EVALUATOR],
        totalCount: 2,
        page: 1,
        pageSize: 50,
      },
    },
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Answers the picker read with an empty page (all evaluators used). */
const EMPTY_PAGE_MOCK: MockLink.MockedResponse = {
  request: { query: availableEvaluatorsQueryDocument, variables: { page: 1, pageSize: 50 } },
  result: {
    data: {
      availableEvaluators: {
        __typename: "EvaluationEvaluatorOptionPage",
        items: [],
        totalCount: 0,
        page: 1,
        pageSize: 50,
      },
    },
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Successful booking — a freshly scheduled teacher-evaluation session. */
const BOOKING_SUCCESS_MOCK: MockLink.MockedResponse = {
  request: {
    query: bookEvaluationSessionMutationDocument,
    variables: { input: { evaluatorId: FIRST_EVALUATOR.id } },
  },
  result: {
    data: {
      bookEvaluationSession: {
        __typename: "Session",
        id: "501",
        status: SessionStatus.Scheduled,
        sessionType: SessionType.TeacherEvaluation,
        intent: SessionIntent.Evaluation,
        teacherId: FIRST_EVALUATOR.id,
        studentId: "42",
        confirmationDeadline: "2026-09-21T18:00:00.000Z",
        createdAt: "2026-09-20T10:00:00.000Z",
      },
    },
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Rejecting confirmation with a typed `extensions.code` denial. */
function bookingErrorMock(code: string): MockLink.MockedResponse {
  return {
    request: {
      query: bookEvaluationSessionMutationDocument,
      variables: { input: { evaluatorId: FIRST_EVALUATOR.id } },
    },
    result: {
      errors: [{ message: `${code} (masked transport surface)`, extensions: { code } }],
    },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

interface DialogStoryProps {
  readonly mocks: readonly MockLink.MockedResponse[];
  /** Click the first evaluator radio once after mount (denial variants). */
  readonly autoSelect?: boolean;
  /** Click Confirm once after mount (denial variants). */
  readonly autoConfirm?: boolean;
}

/**
 * Harness — renders the self-contained dialog open with stub refetch
 * handles, and drives optional one-shot DOM clicks for the variants whose
 * interest IS a post-interaction state (typed denial copy in the notice
 * snackbar). Clicks run against the dialog portal once after mount.
 *
 * Two layers are REQUIRED: the dialog's Apollo hooks must run in a
 * component that is a DESCENDANT of `StoryApolloProvider`.
 */
function DialogStory({ mocks, ...innerProps }: Readonly<DialogStoryProps>): ReactNode {
  return (
    <StoryApolloProvider mocks={mocks}>
      <DialogStoryInner {...innerProps} />
    </StoryApolloProvider>
  );
}

function DialogStoryInner({ autoSelect = false, autoConfirm = false }: Omit<DialogStoryProps, "mocks">): ReactNode {
  const [open, setOpen] = useState(true);
  const labels = useAppTranslation(Applicant);

  useEffect(() => {
    if (!autoSelect && !autoConfirm) return undefined;
    const timer = window.setTimeout(() => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (!dialog) return;
      if (autoSelect) {
        dialog.querySelector<HTMLInputElement>('input[type="radio"]')?.click();
      }
      if (autoConfirm) {
        const confirm = [...dialog.querySelectorAll("button")].find(
          button => button.textContent === labels.evaluationBookingConfirmCta
        );
        confirm?.click();
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [autoSelect, autoConfirm, labels]);

  return (
    <EvaluationBookingDialog
      open={open}
      onClose={() => {
        setOpen(false);
      }}
      refetchLoopStatus={async () => undefined}
      refetchProfile={async () => undefined}
    />
  );
}

const meta = {
  title: "Teachers/Evaluation Booking Dialog",
  component: DialogStory,
  parameters: {
    layout: "centered",
    controls: { exclude: ["mocks", "autoSelect", "autoConfirm"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof DialogStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Armed picker — two evaluator rows, nothing selected, confirm disabled. */
export const Default: Story = {
  args: { mocks: [EVALUATORS_PAGE_MOCK] },
};

/** Empty picker — the localized exhausted-cycle copy, confirm stays disabled. */
export const EmptyEvaluators: Story = {
  args: { mocks: [EMPTY_PAGE_MOCK] },
};

/** Successful booking — success notice snackbar, dialog settles closed. */
export const BookingSuccess: Story = {
  args: { mocks: [EVALUATORS_PAGE_MOCK, BOOKING_SUCCESS_MOCK], autoSelect: true, autoConfirm: true },
};

/** Retryable denial — the used evaluator drops off; the dialog stays open. */
export const EvaluatorAlreadyUsed: Story = {
  args: {
    mocks: [EVALUATORS_PAGE_MOCK, bookingErrorMock("EVALUATOR_ALREADY_USED")],
    autoSelect: true,
    autoConfirm: true,
  },
};

/** Idempotent replay settle — same-key duplicate surfaced as the info lane. */
export const DuplicateRequest: Story = {
  args: { mocks: [EVALUATORS_PAGE_MOCK, bookingErrorMock("DUPLICATE_REQUEST")], autoSelect: true, autoConfirm: true },
};

/** Terminal denial — loop-complete copy, refetch, dialog settles closed. */
export const LoopComplete: Story = {
  args: {
    mocks: [EVALUATORS_PAGE_MOCK, bookingErrorMock("EVALUATION_LOOP_COMPLETE")],
    autoSelect: true,
    autoConfirm: true,
  },
};

/** Terminal denial — no-credits copy, refetch, dialog settles closed. */
export const NoCreditsRemaining: Story = {
  args: {
    mocks: [EVALUATORS_PAGE_MOCK, bookingErrorMock("NO_EVALUATION_CREDITS_REMAINING")],
    autoSelect: true,
    autoConfirm: true,
  },
};
