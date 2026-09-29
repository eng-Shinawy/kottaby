import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import {
  type StudentHomeworkHistoryQuery_studentHomeworkHistory_items,
  SurahJuzRef,
} from "@/frontend/graphql/generated/gql/graphql";
import { studentHomeworkHistoryQueryDocument } from "@/frontend/graphql/sharedDocuments/scheduling/session-report.documents";
import { studentProgressQueryDocument } from "@/frontend/graphql/sharedDocuments/scheduling/student-progress.documents";
import { StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { TeacherPrepDialog } from "@/frontend/views/teacher/sessions/TeacherPrepDialog";

/**
 * Storybook surface for `TeacherPrepDialog` — the read-only pre-session
 * preparation glance a teacher opens from a scheduled session row. The REAL
 * dialog runs under `StoryApolloProvider`: its query bundle issues the two
 * production reads (the curriculum-position read and the cross-teacher
 * homework-history page, always requested as the explicit page-1 window of
 * five rows) and every section folds its own state, so one section's
 * failure never blanks the other.
 *
 * One story per visual branch: the positioned mid-plan card with graded
 * history rows, the honest first-session banner (empty homework and — the
 * divergent case — a first-session student who still carries one prior
 * homework row because a previous session completed without a confirmed
 * completion), ungraded tracks and the no-assignment row, the "+N more"
 * overflow line, the per-section permission-denied fallback, the retryable
 * uncoded failure, the loading skeleton, and the final-lesson end-state
 * where the position line becomes a completion chip. The dialog is purely
 * observational — the mock set carries only the two reads, and the copy
 * resolves through the locale system.
 *
 * The denial stories inject the FORBIDDEN code on ONE read while the other
 * succeeds to exercise each section's local fallback fold; in production
 * the shared relationship gate denies both reads together, so treat them as
 * section-contract exhibits, not reachable server states. All payloads
 * below are story-fixture data ONLY (synthetic ids, titles, and ranges).
 */

/** The owning session row's id — dialog identity; the reads are student-keyed. */
const SESSION_ID = "601";

/** The continuing-student fixture — active plan, mid-curriculum. */
const CONTINUING_STUDENT_ID = 401;

/** The first-session fixture student — no settled progress yet. */
const FIRST_SESSION_STUDENT_ID = 402;

/** One history-row fixture — the codegen homework item (the shipped
 *  twelve-column shape) pinned to its concrete `SessionHomeWork` leaf. */
type HomeworkItemFixture = StudentHomeworkHistoryQuery_studentHomeworkHistory_items & {
  readonly __typename: "SessionHomeWork";
};

/**
 * Builds the homework-history page mock the hook's explicit window
 * requests (`page: 1`, `pageSize: 5`) — items newest-first per the server.
 */
function homeworkHistoryMock(
  studentId: number,
  items: readonly HomeworkItemFixture[],
  totalCount: number
): MockLink.MockedResponse {
  return {
    request: {
      query: studentHomeworkHistoryQueryDocument,
      variables: { studentId, page: 1, pageSize: 5 },
    },
    result: {
      data: {
        studentHomeworkHistory: {
          __typename: "StudentHomeworkPage",
          items: [...items],
          totalCount,
          page: 1,
          pageSize: 5,
        },
      },
    },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Mid-plan progress — lesson 2 of 3, one completed lesson, 33%. */
const CONTINUING_PROGRESS_MOCK: MockLink.MockedResponse = {
  request: { query: studentProgressQueryDocument, variables: { studentId: CONTINUING_STUDENT_ID } },
  result: {
    data: {
      studentProgress: {
        __typename: "StudentProgress",
        hasProgress: true,
        studentId: CONTINUING_STUDENT_ID,
        planId: 11,
        planTitle: "Beginner tajweed plan",
        totalLessons: 3,
        currentLessonId: 12,
        currentLessonTitle: "Lesson 2 — tajweed basics",
        currentLessonPosition: 2,
        lessonsCompleted: 1,
        completionPercent: 33,
        isOnFinalLesson: false,
      },
    },
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Final-lesson end-state — position at the plan's end over the completed prefix. */
const FINAL_LESSON_PROGRESS_MOCK: MockLink.MockedResponse = {
  request: { query: studentProgressQueryDocument, variables: { studentId: CONTINUING_STUDENT_ID } },
  result: {
    data: {
      studentProgress: {
        __typename: "StudentProgress",
        hasProgress: true,
        studentId: CONTINUING_STUDENT_ID,
        planId: 11,
        planTitle: "Beginner tajweed plan",
        totalLessons: 3,
        currentLessonId: 13,
        currentLessonTitle: "Lesson 3 — review and recitation polish",
        currentLessonPosition: 3,
        lessonsCompleted: 2,
        completionPercent: 67,
        isOnFinalLesson: true,
      },
    },
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** No settled progress — the honesty flag is the only first-session signal. */
const FIRST_SESSION_PROGRESS_MOCK: MockLink.MockedResponse = {
  request: { query: studentProgressQueryDocument, variables: { studentId: FIRST_SESSION_STUDENT_ID } },
  result: {
    data: {
      studentProgress: {
        __typename: "StudentProgress",
        hasProgress: false,
        studentId: FIRST_SESSION_STUDENT_ID,
        planId: null,
        planTitle: null,
        totalLessons: 0,
        currentLessonId: null,
        currentLessonTitle: null,
        currentLessonPosition: null,
        lessonsCompleted: 0,
        completionPercent: 0,
        isOnFinalLesson: false,
      },
    },
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Progress read denied — the tenancy family's FORBIDDEN code. */
const PROGRESS_DENIED_MOCK: MockLink.MockedResponse = {
  request: { query: studentProgressQueryDocument, variables: { studentId: CONTINUING_STUDENT_ID } },
  result: {
    errors: [{ message: "Forbidden (masked transport surface)", extensions: { code: "FORBIDDEN" } }],
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Homework read denied — same code family, different section. */
const HOMEWORK_DENIED_MOCK: MockLink.MockedResponse = {
  request: {
    query: studentHomeworkHistoryQueryDocument,
    variables: { studentId: CONTINUING_STUDENT_ID, page: 1, pageSize: 5 },
  },
  result: {
    errors: [{ message: "History read denied (masked transport surface)", extensions: { code: "FORBIDDEN" } }],
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Progress read failed with NO code — the section's retry branch. */
const PROGRESS_UNCODED_ERROR_MOCK: MockLink.MockedResponse = {
  request: { query: studentProgressQueryDocument, variables: { studentId: CONTINUING_STUDENT_ID } },
  result: { errors: [{ message: "Curriculum read failed" }] },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Two fully graded rows — the positioned card's resting homework look. */
const GRADED_HISTORY_ITEMS: readonly HomeworkItemFixture[] = [
  {
    __typename: "SessionHomeWork",
    id: "8101",
    sessionId: 701,
    currentFromAyah: 1,
    currentToAyah: 10,
    currentGrade: 92,
    currentSurahJuz: SurahJuzRef.Juz6,
    revisionFromAyah: 1,
    revisionToAyah: 5,
    revisionGrade: 88,
    revisionSurahJuz: SurahJuzRef.Juz30,
    createdAt: "2026-09-18T09:00:00.000Z",
    updatedAt: "2026-09-18T12:00:00.000Z",
  },
  {
    __typename: "SessionHomeWork",
    id: "8102",
    sessionId: 702,
    currentFromAyah: 11,
    currentToAyah: 20,
    currentGrade: 90,
    currentSurahJuz: SurahJuzRef.Juz6,
    revisionFromAyah: 6,
    revisionToAyah: 10,
    revisionGrade: 84,
    revisionSurahJuz: SurahJuzRef.Juz30,
    createdAt: "2026-09-17T09:00:00.000Z",
    updatedAt: "2026-09-17T12:00:00.000Z",
  },
];

/** One graded jadid assignment with no madi track — the single-track row. */
const FIRST_SESSION_HISTORY_ITEMS: readonly HomeworkItemFixture[] = [
  {
    __typename: "SessionHomeWork",
    id: "8103",
    sessionId: 703,
    currentFromAyah: 1,
    currentToAyah: 8,
    currentGrade: 78,
    currentSurahJuz: SurahJuzRef.Juz7,
    revisionFromAyah: null,
    revisionToAyah: null,
    revisionGrade: null,
    revisionSurahJuz: null,
    createdAt: "2026-09-20T09:00:00.000Z",
    updatedAt: "2026-09-20T11:00:00.000Z",
  },
];

/** An assigned-but-ungraded jadid beside a graded madi, plus one row with
 *  no assignment at all — the honest absence states. */
const UNGRADED_HISTORY_ITEMS: readonly HomeworkItemFixture[] = [
  {
    __typename: "SessionHomeWork",
    id: "8104",
    sessionId: 704,
    currentFromAyah: 1,
    currentToAyah: 12,
    currentGrade: null,
    currentSurahJuz: SurahJuzRef.Juz7,
    revisionFromAyah: 1,
    revisionToAyah: 8,
    revisionGrade: 95,
    revisionSurahJuz: SurahJuzRef.Juz29,
    createdAt: "2026-09-19T09:00:00.000Z",
    updatedAt: "2026-09-19T10:00:00.000Z",
  },
  {
    __typename: "SessionHomeWork",
    id: "8105",
    sessionId: 705,
    currentFromAyah: null,
    currentToAyah: null,
    currentGrade: null,
    currentSurahJuz: null,
    revisionFromAyah: null,
    revisionToAyah: null,
    revisionGrade: null,
    revisionSurahJuz: null,
    createdAt: "2026-09-16T09:00:00.000Z",
    updatedAt: "2026-09-16T09:00:00.000Z",
  },
];

/** Five shown rows of a twelve-row history — the page-1 window right before
 *  the overflow line (fixture-only id/session sequences). */
const DEEP_HISTORY_ITEMS: readonly HomeworkItemFixture[] = [
  {
    __typename: "SessionHomeWork",
    id: "8111",
    sessionId: 711,
    currentFromAyah: 1,
    currentToAyah: 10,
    currentGrade: 91,
    currentSurahJuz: SurahJuzRef.Juz9,
    revisionFromAyah: 1,
    revisionToAyah: 5,
    revisionGrade: 87,
    revisionSurahJuz: SurahJuzRef.Juz30,
    createdAt: "2026-09-15T09:00:00.000Z",
    updatedAt: "2026-09-15T12:00:00.000Z",
  },
  {
    __typename: "SessionHomeWork",
    id: "8112",
    sessionId: 712,
    currentFromAyah: 11,
    currentToAyah: 20,
    currentGrade: 89,
    currentSurahJuz: SurahJuzRef.Juz10,
    revisionFromAyah: 6,
    revisionToAyah: 10,
    revisionGrade: 85,
    revisionSurahJuz: SurahJuzRef.Juz30,
    createdAt: "2026-09-14T09:00:00.000Z",
    updatedAt: "2026-09-14T12:00:00.000Z",
  },
  {
    __typename: "SessionHomeWork",
    id: "8113",
    sessionId: 713,
    currentFromAyah: 1,
    currentToAyah: 12,
    currentGrade: 94,
    currentSurahJuz: SurahJuzRef.Juz11,
    revisionFromAyah: 1,
    revisionToAyah: 6,
    revisionGrade: 90,
    revisionSurahJuz: SurahJuzRef.Juz29,
    createdAt: "2026-09-13T09:00:00.000Z",
    updatedAt: "2026-09-13T12:00:00.000Z",
  },
  {
    __typename: "SessionHomeWork",
    id: "8114",
    sessionId: 714,
    currentFromAyah: 1,
    currentToAyah: 10,
    currentGrade: 88,
    currentSurahJuz: SurahJuzRef.Juz12,
    revisionFromAyah: 7,
    revisionToAyah: 12,
    revisionGrade: 82,
    revisionSurahJuz: SurahJuzRef.Juz29,
    createdAt: "2026-09-12T09:00:00.000Z",
    updatedAt: "2026-09-12T12:00:00.000Z",
  },
  {
    __typename: "SessionHomeWork",
    id: "8115",
    sessionId: 715,
    currentFromAyah: 1,
    currentToAyah: 15,
    currentGrade: 96,
    currentSurahJuz: SurahJuzRef.Juz13,
    revisionFromAyah: 1,
    revisionToAyah: 7,
    revisionGrade: 91,
    revisionSurahJuz: SurahJuzRef.Juz28,
    createdAt: "2026-09-11T09:00:00.000Z",
    updatedAt: "2026-09-11T12:00:00.000Z",
  },
];

const GRADED_HISTORY_MOCK = homeworkHistoryMock(CONTINUING_STUDENT_ID, GRADED_HISTORY_ITEMS, 2);
const FIRST_SESSION_HISTORY_MOCK = homeworkHistoryMock(FIRST_SESSION_STUDENT_ID, FIRST_SESSION_HISTORY_ITEMS, 1);
const EMPTY_HISTORY_MOCK = homeworkHistoryMock(FIRST_SESSION_STUDENT_ID, [], 0);
const UNGRADED_HISTORY_MOCK = homeworkHistoryMock(CONTINUING_STUDENT_ID, UNGRADED_HISTORY_ITEMS, 2);
const DEEP_HISTORY_MOCK = homeworkHistoryMock(CONTINUING_STUDENT_ID, DEEP_HISTORY_ITEMS, 12);

/** The settled payloads held in flight — the sections' skeleton window. */
const LOADING_PROGRESS_MOCK: MockLink.MockedResponse = { ...CONTINUING_PROGRESS_MOCK, delay: 30_000 };
const LOADING_HISTORY_MOCK: MockLink.MockedResponse = { ...GRADED_HISTORY_MOCK, delay: 30_000 };

interface PrepStoryProps {
  readonly mocks: readonly MockLink.MockedResponse[];
  /** The student the fixture session was booked with (server-derived in the app). */
  readonly studentId: number;
}

/**
 * Harness — mounts the REAL dialog open under `StoryApolloProvider`; the
 * dialog's own query bundle drives both reads against the story's mocks.
 */
function PrepStory({ mocks, studentId }: Readonly<PrepStoryProps>): ReactNode {
  return (
    <StoryApolloProvider mocks={mocks}>
      <TeacherPrepDialog open studentId={studentId} sessionId={SESSION_ID} onClose={() => {}} />
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Teachers/Preparation Dialog",
  component: PrepStory,
  parameters: {
    layout: "centered",
    controls: { exclude: ["mocks", "studentId"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof PrepStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Mid-plan card — lesson 2 of 3 at 33%, plan line, two graded rows. */
export const PositionedMidPlanCard: Story = {
  args: { mocks: [CONTINUING_PROGRESS_MOCK, GRADED_HISTORY_MOCK], studentId: CONTINUING_STUDENT_ID },
};

/** Final lesson — the position line becomes the completion chip (3 of 3). */
export const FinalLessonCard: Story = {
  args: { mocks: [FINAL_LESSON_PROGRESS_MOCK, GRADED_HISTORY_MOCK], studentId: CONTINUING_STUDENT_ID },
};

/** First session with an empty history — the banner beside the no-assignments state. */
export const FirstSessionEmptyHomework: Story = {
  args: { mocks: [FIRST_SESSION_PROGRESS_MOCK, EMPTY_HISTORY_MOCK], studentId: FIRST_SESSION_STUDENT_ID },
};

/** First session that still carries one prior homework row — the banner
 *  NEVER suppresses the homework section. */
export const FirstSessionWithHomework: Story = {
  args: { mocks: [FIRST_SESSION_PROGRESS_MOCK, FIRST_SESSION_HISTORY_MOCK], studentId: FIRST_SESSION_STUDENT_ID },
};

/** Ungraded tracks — the muted not-yet-graded chip (never a zero) and the
 *  no-assignment row line. */
export const NullGradeTracks: Story = {
  args: { mocks: [CONTINUING_PROGRESS_MOCK, UNGRADED_HISTORY_MOCK], studentId: CONTINUING_STUDENT_ID },
};

/** Deep history — five shown rows plus the "+7 more" overflow line. */
export const MoreHomeworkLine: Story = {
  args: { mocks: [CONTINUING_PROGRESS_MOCK, DEEP_HISTORY_MOCK], studentId: CONTINUING_STUDENT_ID },
};

/** Progress read denied — the permission fallback replaces the card while
 *  the homework rows still render. */
export const ProgressDenied: Story = {
  args: { mocks: [PROGRESS_DENIED_MOCK, GRADED_HISTORY_MOCK], studentId: CONTINUING_STUDENT_ID },
};

/** Homework read denied — the heading keeps its section-local fallback
 *  while the progress card still renders. */
export const HomeworkDenied: Story = {
  args: { mocks: [CONTINUING_PROGRESS_MOCK, HOMEWORK_DENIED_MOCK], studentId: CONTINUING_STUDENT_ID },
};

/** Uncoded progress failure — the retryable alert, never a fabricated card. */
export const ProgressRetryableFailure: Story = {
  args: { mocks: [PROGRESS_UNCODED_ERROR_MOCK, GRADED_HISTORY_MOCK], studentId: CONTINUING_STUDENT_ID },
};

/** Both reads in flight — the sections' skeletons with busy content. */
export const LoadingSkeleton: Story = {
  args: { mocks: [LOADING_PROGRESS_MOCK, LOADING_HISTORY_MOCK], studentId: CONTINUING_STUDENT_ID },
};
