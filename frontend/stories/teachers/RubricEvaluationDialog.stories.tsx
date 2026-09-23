import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { type ReactNode, useEffect, useState } from "react";
import { GraphQLErrorSurfaceHost } from "@/frontend/components/ui/GraphQLErrorSurfaceHost";
import { NoticeSnackbar } from "@/frontend/components/ui/NoticeSnackbar";
import {
  RubricWeaknessArea,
  SessionIntent,
  SessionStatus,
  SessionType,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  myRubricPendingSessionsQueryDocument,
  submitRubricEvaluationMutationDocument,
} from "@/frontend/graphql/sharedDocuments/teachers/evaluation-rubric.documents";
import { StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { RubricEvaluationDialog } from "@/frontend/views/teacher/sessions/RubricEvaluationDialog";
import type { ContainerNotice } from "@/frontend/views/teacher/sessions/teacherSessionSlots";
import { useRubricEvaluation } from "@/frontend/views/teacher/sessions/useRubricEvaluation";
import { Sessions, useAppTranslation } from "@/shared/locale";

/**
 * Storybook surface for `RubricEvaluationDialog` — the evaluator's rubric
 * form. The dialog is draft-local (its score/notes/weakness state resets on
 * the keyed mount) while the WRITE PATH runs through the real
 * {@link useRubricEvaluation} arms inside `StoryApolloProvider`, so every
 * story exercises the production wiring: the pending read, the submit
 * mutation, the post-success refetch, and the success notice lane. The
 * typed-denial story also mounts the app-scope `GraphQLErrorSurfaceHost` —
 * the same single error surface the app shell mounts — so the mapped
 * denial notice renders exactly as it does in production; the dialog stays
 * open with the draft intact for an in-place retry.
 *
 * The draft variants type their score once after mount (the weakness
 * `Select` renders only while the entered score is below the pass
 * threshold); the settled variants additionally fill notes, pick Tajweed,
 * and click Submit. All payloads below are story-fixture data ONLY.
 */

/** The scored session fixture — a completed evaluation row still pending. */
const SESSION_ID = "501";

/** The notes draft fixture shared by the settled variants. */
const NOTES_DRAFT = "Recitation steady; two tajweed slips in Surah Yusuf.";

/**
 * The denial code the typed-denial story replays — the rubric session's
 * state-conflict gate. Draft-INDEPENDENT, so the settled draft fixture
 * (which must carry the weakness pick to clear the dialog's client-side
 * validation) stays semantically coherent against the server denial.
 */
const DENIAL_CODE = "RUBRIC_SESSION_NOT_COMPLETED";

/** Answers the pending read with one owed rubric session (reused across refetches). */
const PENDING_PAGE_MOCK: MockLink.MockedResponse = {
  request: { query: myRubricPendingSessionsQueryDocument, variables: { page: null, pageSize: null } },
  result: {
    data: {
      myRubricPendingSessions: {
        __typename: "SessionPage",
        items: [
          {
            __typename: "Session",
            id: SESSION_ID,
            status: SessionStatus.Completed,
            sessionType: SessionType.TeacherEvaluation,
            intent: SessionIntent.Evaluation,
            teacherId: "77",
            studentId: "42",
            confirmationDeadline: null,
            createdAt: "2026-09-18T09:00:00.000Z",
          },
        ],
        totalCount: 1,
        page: 1,
        pageSize: 25,
      },
    },
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** The exact sealed submit payload the settled variants drive. */
const SUBMIT_VARIABLES = {
  sessionId: SESSION_ID,
  input: { score: 79, notes: NOTES_DRAFT, weaknessArea: RubricWeaknessArea.Tajweed },
};

/** Successful verdict — the write-once rubric receipt (no notes on reads). */
const SUBMIT_SUCCESS_MOCK: MockLink.MockedResponse = {
  request: { query: submitRubricEvaluationMutationDocument, variables: SUBMIT_VARIABLES },
  result: {
    data: {
      submitRubricEvaluation: {
        __typename: "RubricEvaluation",
        id: "901",
        sessionId: SESSION_ID,
        evaluatorId: "77",
        evaluatedId: "42",
        score: 79,
        weaknessArea: RubricWeaknessArea.Tajweed,
        createdAt: "2026-09-21T12:00:00.000Z",
        applicantStatus: "InEvaluation",
      },
    },
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Rejecting confirmation with a typed `extensions.code` denial. */
const SUBMIT_DENIAL_MOCK: MockLink.MockedResponse = {
  request: { query: submitRubricEvaluationMutationDocument, variables: SUBMIT_VARIABLES },
  result: {
    errors: [{ message: `${DENIAL_CODE} (masked transport surface)`, extensions: { code: DENIAL_CODE } }],
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Types into a React-controlled field through the prototype's value setter. */
function typeIntoField(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    field instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  // The prototype-level Reflect.set bypasses React's instance value-tracker
  // (the direct element assignment is deduped away) so the dispatched input
  // event really lands as a controlled change.
  Reflect.set(prototype, "value", value, field);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** One timed interaction step of the auto-fill driver. */
interface DriverStep {
  readonly delayMs: number;
  readonly run: () => void;
}

/**
 * Runs the draft/submit steps against the mounted dialog portal — the
 * story analogue of the booking stories' one-shot auto-click driver,
 * extended for controlled text fields and the select's portal menu.
 */
function scheduleDriver(steps: readonly DriverStep[]): () => void {
  const timerIds = steps.map(step => window.setTimeout(step.run, step.delayMs));
  return () => {
    timerIds.forEach(timerId => {
      window.clearTimeout(timerId);
    });
  };
}

interface DialogStoryProps {
  readonly mocks: readonly MockLink.MockedResponse[];
  /** Type a score into the score field once after mount (draft variants). */
  readonly autoScore?: string;
  /** Fill the notes field once after mount (settled variants). */
  readonly autoNotes?: boolean;
  /** Open the weakness select and pick Tajweed once after mount (settled variants). */
  readonly autoWeakness?: boolean;
  /** Click the submit CTA once after mount (settled variants). */
  readonly autoSubmit?: boolean;
}

/**
 * Harness — mounts the app-scope error surface host plus the REAL rubric
 * arms under `StoryApolloProvider`, then renders the dialog open. Two
 * layers are REQUIRED: the hook's Apollo hooks must run in a component
 * that is a DESCENDANT of the provider, and the host must sit beside (not
 * inside) the dialog so denial toasts survive any dialog state.
 */
function DialogStory({ mocks, ...autoSteps }: Readonly<DialogStoryProps>): ReactNode {
  return (
    <StoryApolloProvider mocks={mocks}>
      <GraphQLErrorSurfaceHost />
      <DialogStoryInner {...autoSteps} />
    </StoryApolloProvider>
  );
}

function DialogStoryInner({
  autoScore,
  autoNotes = false,
  autoWeakness = false,
  autoSubmit = false,
}: Omit<DialogStoryProps, "mocks">): ReactNode {
  const [open, setOpen] = useState(true);
  const [notice, setNotice] = useState<ContainerNotice | null>(null);
  const labels = useAppTranslation(Sessions);
  const rubric = useRubricEvaluation({ setNotice });

  useEffect(() => {
    if (autoScore === undefined && !autoNotes && !autoWeakness && !autoSubmit) return undefined;
    const steps: DriverStep[] = [];
    if (autoScore !== undefined) {
      steps.push({
        delayMs: 300,
        run: () => {
          const dialog = document.querySelector<HTMLElement>('[data-testid="rubric-evaluation-dialog"]');
          const scoreField = dialog?.querySelector<HTMLInputElement>('input[type="number"]');
          if (scoreField) typeIntoField(scoreField, autoScore);
        },
      });
    }
    if (autoNotes) {
      steps.push({
        delayMs: 450,
        run: () => {
          const dialog = document.querySelector<HTMLElement>('[data-testid="rubric-evaluation-dialog"]');
          const notesField = dialog?.querySelector<HTMLTextAreaElement>("textarea");
          if (notesField) typeIntoField(notesField, NOTES_DRAFT);
        },
      });
    }
    if (autoWeakness) {
      steps.push({
        delayMs: 600,
        run: () => {
          document.querySelector<HTMLElement>('[aria-haspopup="listbox"]')?.click();
        },
      });
      steps.push({
        delayMs: 800,
        run: () => {
          document.querySelector<HTMLElement>('li[role="option"][data-value="Tajweed"]')?.click();
        },
      });
    }
    if (autoSubmit) {
      steps.push({
        delayMs: 1000,
        run: () => {
          const dialog = document.querySelector<HTMLElement>('[data-testid="rubric-evaluation-dialog"]');
          const submit = [...(dialog?.querySelectorAll("button") ?? [])].find(
            button => button.textContent === labels.rubricSubmitCta
          );
          submit?.click();
        },
      });
    }
    return scheduleDriver(steps);
  }, [autoScore, autoNotes, autoWeakness, autoSubmit, labels]);

  return (
    <>
      {open ? (
        <RubricEvaluationDialog
          sessionId={SESSION_ID}
          onClose={() => {
            setOpen(false);
          }}
          onSubmit={rubric.submitEvaluation}
          submitting={rubric.submitting}
        />
      ) : null}
      <NoticeSnackbar notice={notice} autoHideDuration={6000} onClose={() => setNotice(null)} />
    </>
  );
}

const meta = {
  title: "Teachers/Rubric Evaluation Dialog",
  component: DialogStory,
  parameters: {
    layout: "centered",
    controls: { exclude: ["mocks", "autoScore", "autoNotes", "autoWeakness", "autoSubmit"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof DialogStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Pristine draft — empty score, the weakness select stays hidden. */
export const Pristine: Story = {
  args: { mocks: [PENDING_PAGE_MOCK] },
};

/** Passing draft — a score at/above the threshold keeps the select hidden. */
export const PassingDraft: Story = {
  args: { mocks: [PENDING_PAGE_MOCK], autoScore: "85" },
};

/** Failing draft — a score below the threshold reveals the required select. */
export const FailingDraft: Story = {
  args: { mocks: [PENDING_PAGE_MOCK], autoScore: "79" },
};

/** Typed denial — mapped conflict notice renders app-scope; the dialog stays open for retry. */
export const TypedDenial: Story = {
  args: {
    mocks: [PENDING_PAGE_MOCK, SUBMIT_DENIAL_MOCK],
    autoScore: "79",
    autoNotes: true,
    autoWeakness: true,
    autoSubmit: true,
  },
};

/** Settled success — pending read refetched, success snackbar, dialog closes. */
export const SubmissionSuccess: Story = {
  args: {
    mocks: [PENDING_PAGE_MOCK, SUBMIT_SUCCESS_MOCK],
    autoScore: "79",
    autoNotes: true,
    autoWeakness: true,
    autoSubmit: true,
  },
};
