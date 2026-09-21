import {
  countReportedSessions,
  drainInFlightSessions,
  reportCompletedSessions,
  submitDemoReport,
} from "@/backend/db/seeds/lib";
import { resolveDemoUserId } from "@/backend/db/seeds/users";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { ConflictError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { SessionLifecycleService } from "@/backend/services";

/**
 * Result summary for the demo-session-flow seed step.
 *
 * `inFlightDrained` counts scheduled/started demo sessions advanced to
 * `completed` this run (rows stranded by an earlier partial run).
 * `reportsSubmitted` counts completed sessions that gained their report
 * (with the demo homework assignment) this run. `bookedSessionId` is the
 * fresh booking's id when the step had to create one, `null` otherwise.
 * `skippedReason` explains a soft skip of the booking arm — `no-funding`
 * when every balance lane the production debit ladder probes is empty.
 */
export interface DemoSessionFlowState {
  inFlightDrained: number;
  reportsSubmitted: number;
  bookedSessionId: number | null;
  reportedTotal: number;
  skippedReason: "no-funding" | null;
}

/** Deterministic idempotency key for the step's fresh booking — one booking per demo student, ever. */
function demoBookingKey(studentUserId: number): string {
  return `demo-session-flow-${studentUserId}`;
}

/**
 * Books one fresh demo session through the production booking path (the
 * trial lane is always attempted first), then walks the full teacher-side
 * lifecycle: start → complete → report with the demo homework assignment.
 */
async function bookStartCompleteAndReport(
  studentUserId: number,
  teacherUserId: number,
  locale: string
): Promise<number> {
  const booked = await SessionLifecycleService.createSession(
    studentUserId,
    { teacherId: teacherUserId, intent: SessionIntent.Hifz },
    demoBookingKey(studentUserId),
    locale
  );
  await SessionLifecycleService.startSession(teacherUserId, booked.id, locale);
  await SessionLifecycleService.completeSession(teacherUserId, booked.id, locale);
  await submitDemoReport(teacherUserId, booked.id, locale, false);
  return booked.id;
}

/**
 * Demo-session-flow seeder — reconciles ONE completed, reported session for
 * the demo teacher ↔ demo student pair so a freshly seeded sandbox shows the
 * parent portal's report and homework surfaces (and the session-completion
 * notification deep link) populated out of the box.
 *
 * Reconciliation, in order:
 *  1. Drain in-flight sessions (scheduled/started → completed) so a partial
 *     earlier run never strands a booking without its report.
 *  2. Give every completed session without a report its report (the demo
 *     homework assignment settles with it).
 *  3. When the pair still has NO completed+reported session, book one fresh
 *     through the production path with a deterministic idempotency key — a
 *     concurrent run replaying the same key surfaces as `DUPLICATE_REQUEST`
 *     and is absorbed (the other run completes the lifecycle). An empty
 *     balance ladder (trial already consumed, no subscription) is a soft
 *     skip, not a seed failure.
 *
 * Depends on the demo-linkage step: the booking path denies an
 * uncertified demo teacher with `TEACHER_NOT_CERTIFIED`, so this step
 * always runs AFTER it in the master controller. The shared reconciliation
 * helpers (drain, report, count) come from the seeds lib — no sibling
 * seeder internals are imported.
 */
export async function seedOrGet(locale = "en"): Promise<DemoSessionFlowState> {
  const studentUserId = await resolveDemoUserId("student");
  const teacherUserId = await resolveDemoUserId("teacher");

  const inFlightDrained = await drainInFlightSessions(studentUserId, teacherUserId, locale);
  const reportsSubmitted = await reportCompletedSessions(studentUserId, teacherUserId, locale);

  let bookedSessionId: number | null = null;
  let skippedReason: DemoSessionFlowState["skippedReason"] = null;
  let reportedTotal = await countReportedSessions(studentUserId, locale);

  if (reportedTotal === 0) {
    try {
      bookedSessionId = await bookStartCompleteAndReport(studentUserId, teacherUserId, locale);
      reportedTotal = 1;
    } catch (error) {
      if (error instanceof ValidationError && error.code === "INSUFFICIENT_BALANCE") {
        skippedReason = "no-funding";
        logger.info("Demo session booking skipped: the demo student's balance lanes are exhausted");
      } else if (error instanceof ConflictError && error.code === "DUPLICATE_REQUEST") {
        logger.info("Demo session booking replayed concurrently; reconciling the winner's session instead");
        await drainInFlightSessions(studentUserId, teacherUserId, locale);
        await reportCompletedSessions(studentUserId, teacherUserId, locale);
        reportedTotal = await countReportedSessions(studentUserId, locale);
      } else {
        throw error;
      }
    }
  }

  const bookedLabel = bookedSessionId === null ? "none" : String(bookedSessionId);
  const skipLabel = skippedReason === null ? "" : ` skipped=${skippedReason}`;
  logger.info(
    `Demo session flow: drained=${inFlightDrained} reported=${reportsSubmitted} booked=${bookedLabel} reportedTotal=${reportedTotal}${skipLabel}`
  );
  return { inFlightDrained, reportsSubmitted, bookedSessionId, reportedTotal, skippedReason };
}
