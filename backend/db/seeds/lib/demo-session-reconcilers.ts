import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { ConflictError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { SessionLifecycleService } from "@/backend/services";
import * as SessionReportService from "@/backend/services/classes/session-report.service";
import type { SessionReturnType } from "@/backend/types/classes/session.types";

/**
 * Shared demo-session reconciliation helpers — the production-path building
 * blocks used by BOTH demo seeders (`seed-demo-session-flow` and
 * `seed-demo-paid-flow`). This is a lib module, not a seeder: it owns no
 * `seedOrGet` and holds no cross-seeder imports, so sibling seeders never
 * reach into each other's internals (seeds/AGENTS.md controller-context
 * rule).
 *
 * Every helper walks the REAL production flows (booking, lifecycle
 * transitions, report submission) so a freshly seeded sandbox exercises
 * exactly the code paths users hit.
 */

/** The demo homework assignment attached to every demo report: a fresh Jadid span plus a revision span. */
const DEMO_HOMEWORK = {
  jadid: { fromAyah: 1, toAyah: 10, surahJuz: SurahJuzRef.SurahAlMaidah },
  madi: { fromAyah: 1, toAyah: 10, surahJuz: SurahJuzRef.Juz30 },
} as const;

const DEMO_TEACHER_NOTES =
  "Demo recitation session — confident memorization of the assigned passage; the revision span needs one more pass with attention to madd rules.";

/**
 * Report variants — submission-indexed so a fresh sandbox's demo reports
 * carry distinct notes, ratings, and homework spans (identical copies
 * read as synthetic data on the trend chart and the two homework
 * surfaces). Variant 0 keeps the original copy; later submissions walk
 * the array (clamped to the last variant).
 */
const DEMO_REPORT_VARIANTS: readonly {
  readonly teacherNotes: string;
  readonly rating: number;
  readonly homework: {
    readonly jadid: { readonly fromAyah: number; readonly toAyah: number; readonly surahJuz: SurahJuzRef };
    readonly madi: { readonly fromAyah: number; readonly toAyah: number; readonly surahJuz: SurahJuzRef };
  };
}[] = [
  {
    teacherNotes: DEMO_TEACHER_NOTES,
    rating: 5,
    homework: DEMO_HOMEWORK,
  },
  {
    teacherNotes:
      "Demo recitation session — the new span settled well after repetition; revision was fluent today, keep the daily review rhythm going.",
    rating: 4,
    homework: {
      jadid: { fromAyah: 11, toAyah: 20, surahJuz: SurahJuzRef.SurahAlMaidah },
      madi: { fromAyah: 1, toAyah: 15, surahJuz: SurahJuzRef.Juz30 },
    },
  },
];

/** Picks the report copy for a submission slot (index-clamped to the last variant). */
function reportVariant(submissionIndex: number): (typeof DEMO_REPORT_VARIANTS)[number] {
  const index = Math.min(submissionIndex, DEMO_REPORT_VARIANTS.length - 1);
  // Length guard instead of a `variant === undefined` check: the static element
  // type is non-optional (noUncheckedIndexedAccess is off), so an undefined
  // comparison reads as always-false to sonarjs/different-types-comparison.
  // The length tripwire preserves the empty-vocabulary defense.
  if (DEMO_REPORT_VARIANTS.length === 0) {
    throw new Error("demo report variants: empty vocabulary");
  }
  return DEMO_REPORT_VARIANTS[index];
}

/**
 * Session statuses as widened strings — the reconcilers compare the drizzle
 * row's status union against these, mirroring the services' guard-constant
 * doctrine (no raw enum-to-union comparison).
 */
const SCHEDULED_STATUS: string = SessionStatus.Scheduled;
const STARTED_STATUS: string = SessionStatus.Started;
const COMPLETED_STATUS: string = SessionStatus.Completed;

/**
 * Sequential walker — the sanctioned no-await-in-loop escape. Demo
 * reconciliation must be strictly ordered (each booking, transition, and
 * report depends on the previous step's committed state), so a
 * recursive walker processes the queue one item at a time instead of a
 * loop body.
 */
export async function walkSequentially<T>(items: readonly T[], visit: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const step = async (): Promise<void> => {
    const item = queue.shift();
    if (item === undefined) {
      return;
    }
    await visit(item);
    await step();
  };
  await step();
}

/** Recursively collects the demo student's sessions across every page (the participant read pages 50 at a time). */
async function collectSessionPages(
  studentUserId: number,
  page: number,
  collected: SessionReturnType[]
): Promise<SessionReturnType[]> {
  const result = await SessionLifecycleService.listMyStudentSessions(studentUserId, { status: null }, page, 50);
  collected.push(...result.items);
  if (collected.length >= result.totalCount || result.items.length === 0) {
    return collected;
  }
  return collectSessionPages(studentUserId, page + 1, collected);
}

/** Lists every session of the demo student (newest first) through the production participant read. */
export function listAllDemoSessions(studentUserId: number): Promise<readonly SessionReturnType[]> {
  return collectSessionPages(studentUserId, 1, []);
}

/** Advances one scheduled session to `completed` (the teacher starts it, then completes it). */
async function drainScheduledSession(teacherUserId: number, sessionId: number, locale: string): Promise<void> {
  await SessionLifecycleService.startSession(teacherUserId, sessionId, locale);
  await SessionLifecycleService.completeSession(teacherUserId, sessionId, locale);
}

/**
 * Advances every in-flight demo session to `completed`. Cancelled and
 * disputed rows are left untouched — those states are owned by their own
 * flows, not by demo reconciliation. Shared by both demo seeders, whose
 * concurrent-replay arms reuse the exact production-path drain.
 */
export async function drainInFlightSessions(
  studentUserId: number,
  teacherUserId: number,
  locale: string
): Promise<number> {
  const sessions = await listAllDemoSessions(studentUserId);
  let drained = 0;
  await walkSequentially(
    sessions.filter(row => row.status === SCHEDULED_STATUS),
    async row => {
      await drainScheduledSession(teacherUserId, row.id, locale);
      drained += 1;
    }
  );
  await walkSequentially(
    sessions.filter(row => row.status === STARTED_STATUS),
    async row => {
      await SessionLifecycleService.completeSession(teacherUserId, row.id, locale);
      drained += 1;
    }
  );
  return drained;
}

/**
 * Submits the demo report for one completed session. `withPreviousGrades`
 * adds the previous-grades block (it grades the student's newest ungraded
 * homework row through the production write-once path); a concurrent or
 * prior grader surfaces as a conflict, which the retry-without-grades arm
 * absorbs — the report itself must still land. Shared by both demo seeders,
 * which reuse the exact production-path report submission (and its
 * conflict-absorbing retry arm).
 */
export async function submitDemoReport(
  teacherUserId: number,
  sessionId: number,
  locale: string,
  withPreviousGrades: boolean,
  submissionIndex = 0
): Promise<void> {
  const variant = reportVariant(submissionIndex);
  try {
    await SessionReportService.submitSessionReport(
      teacherUserId,
      sessionId,
      {
        teacherNotes: variant.teacherNotes,
        studentRatingByTeacher: variant.rating,
        homework: { ...variant.homework },
        previousGrades: withPreviousGrades ? { currentGrade: 92, revisionGrade: 88 } : undefined,
      },
      locale
    );
  } catch (error) {
    if (!(error instanceof ConflictError) || !withPreviousGrades) {
      throw error;
    }
    logger.info("Demo report grades conflicted with an already-graded homework row, retrying without grades");
    await SessionReportService.submitSessionReport(
      teacherUserId,
      sessionId,
      { teacherNotes: variant.teacherNotes, studentRatingByTeacher: variant.rating, homework: { ...variant.homework } },
      locale
    );
  }
}

/**
 * Gives every completed demo session its report, oldest first. A report and
 * its homework assignment settle together, so each submission also attaches
 * the demo homework. The second and later submissions carry previous grades
 * so a freshly seeded sandbox shows both an ungraded and a graded homework
 * row in the parent portal.
 *
 * The ordinal driving the variant/previous-grades ladder counts EVERY
 * reported session — including reports left by an earlier partial run —
 * not just the reports this run creates, so `seedOrGet` reruns produce the
 * same graded sequence as a single fresh pass. The return value stays the
 * count of reports THIS run created.
 */
export async function reportCompletedSessions(
  studentUserId: number,
  teacherUserId: number,
  locale: string
): Promise<number> {
  const sessions = await listAllDemoSessions(studentUserId);
  const oldestFirst = sessions.filter(row => row.status === COMPLETED_STATUS).toReversed();
  let submitted = 0;
  let reportIndex = 0;
  await walkSequentially(oldestFirst, async target => {
    const existing = await SessionReportService.getSessionReport(studentUserId, target.id, locale);
    if (existing !== null) {
      // A report from an earlier partial run still occupies its position in
      // the oldest-first ladder: the next submission must see it, or it
      // would wrongly receive variant 0 with no previous grades.
      reportIndex += 1;
      return;
    }
    await submitDemoReport(teacherUserId, target.id, locale, reportIndex > 0, reportIndex);
    submitted += 1;
    reportIndex += 1;
  });
  return submitted;
}

/** Counts the demo student's completed sessions that already carry a report. */
export async function countReportedSessions(studentUserId: number, locale: string): Promise<number> {
  const sessions = await listAllDemoSessions(studentUserId);
  const completed = sessions.filter(row => row.status === COMPLETED_STATUS);
  let reported = 0;
  await walkSequentially(completed, async target => {
    if ((await SessionReportService.getSessionReport(studentUserId, target.id, locale)) !== null) {
      reported += 1;
    }
  });
  return reported;
}
