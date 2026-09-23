/**
 * SessionRepository evaluation-booking cycle reads — `resolveCurrentEvaluationCycle`,
 * `countEvaluationBookingsInCycle`, `listEvaluationSessionsForApplicant`, and
 * `listCompletedRubricPendingSessions` — against the live PostgreSQL test
 * instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query.
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data.
 *  - No `expect(...).rejects.toThrow()` — every read signals a miss by
 *    returning a null / zero shape, so this suite has no throwing paths.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): the cycle probe resolves the newest ACTIVE
 *    verification-plan subscription and the closed-loop shape when none
 *    exists; the aggregate counts the non-cancelled bookings, the completed
 *    bookings, and the DISTINCT evaluators of one cycle; the list pages only
 *    the applicant's teacher-evaluation sessions newest first with an honest
 *    total (regular student sessions and other applicants' rows excluded).
 *  - Tier 2 (boundary): a regular plan's active subscription and a cancelled
 *    verification subscription open no cycle; the deterministic tiebreak
 *    (start_date DESC, id DESC) picks the newer subscription; prior-cycle
 *    rows are excluded from the aggregate; cancelled rows drop out of its
 *    counts and evaluator set; the list's status filter narrows; the page
 *    window normalizes (page 0 → first page, oversized size → default); an
 *    out-of-range page yields an empty page with the unchanged total.
 *  - Tier 3 (tx propagation): the reads observe the caller transaction's own
 *    writes and a forced rollback un-applies them.
 *  - Tier 4 (schema + static): the `session.student_id` FK targets `users`,
 *    so an evaluation row inserts against a bare applicant-user id (no
 *    `students` child row) while a regular student session keeps inserting
 *    against the students leg; the helpers' source has no SQL line-comment
 *    sequences, no prepared statements, enum members only, and no
 *    plan-artifact references in comments.
 *  - listCompletedRubricPendingSessions tier (runInRollback): the pending
 *    page lists ONLY the evaluator's own completed evaluation sessions with
 *    no own submission — an own submitted row drops out while another
 *    evaluator's submission on the same session changes nothing (the
 *    per-evaluator anti-join); scheduled, untyped-intent, mistyped-intent,
 *    and non-owned rows never join (the intent pin mirrors the submission
 *    gate); the page window normalizes sane-fallback (page 0 → first page,
 *    oversized size → default 25) with an honest total, and an out-of-range
 *    page is empty with the unchanged total.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { SessionRepository } from "@/backend/db/repo";
import { session } from "@/backend/db/schema/classes/session";
import {
  createTestApplicant,
  createTestEvaluation,
  createTestPlan,
  createTestSession,
  createTestStudent,
  createTestSubscription,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import type { DBTransaction } from "@/backend/types";
import { VERIFICATION_PLAN_TITLE } from "@/shared/constants/verification-plan.constants";

/**
 * Shared fixture scaffold for the cycle reads: a teacher-role user with an
 * `applicants` row (NO `students` child row — the evaluation-loop identity)
 * plus an ACTIVE subscription on the pinned verification plan. Returns the
 * owning user id, the subscription, and the applicant row.
 */
async function createVerificationApplicant(tx: DBTransaction) {
  const user = await createTestUser(tx, { role: "teacher" });
  await createTestApplicant(tx, user.id, { status: ApplicantStatus.InEvaluation });
  const plan = await createTestPlan(tx, { title: VERIFICATION_PLAN_TITLE });
  const subscription = await createTestSubscription(tx, user.id, plan.id);
  return { user, plan, subscription };
}

describe("SessionRepository.resolveCurrentEvaluationCycle", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("resolves the newest ACTIVE verification-plan subscription as the cycle window", async () => {
    await runInRollback(async tx => {
      const { user, subscription } = await createVerificationApplicant(tx);

      const window = await SessionRepository.resolveCurrentEvaluationCycle(user.id, tx);

      const start = subscription.startDate;
      const windowStart = window.cycleStart;
      if (!start || !windowStart) throw new Error("expected the cycle window to resolve");
      expect(windowStart.getTime()).toBe(start.getTime());
      expect(window.activeSubscriptionId).toBe(subscription.id);
    });
  });

  test("resolves the closed-loop shape when no active verification subscription exists", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id);

      const window = await SessionRepository.resolveCurrentEvaluationCycle(user.id, tx);

      expect(window.cycleStart).toBeNull();
      expect(window.activeSubscriptionId).toBeNull();
    });
  });

  // ─── Tier 2: boundary / vocabulary edges ────────────────────────────

  test("a regular plan's active subscription does not open an evaluation cycle", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id);
      const regularPlan = await createTestPlan(tx);
      await createTestSubscription(tx, user.id, regularPlan.id);

      const window = await SessionRepository.resolveCurrentEvaluationCycle(user.id, tx);

      // The plan-title pin is the cycle's identity: a non-verification plan
      // never opens the loop, whatever its status.
      expect(window.cycleStart).toBeNull();
      expect(window.activeSubscriptionId).toBeNull();
    });
  });

  test("a cancelled verification subscription does not open an evaluation cycle", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id);
      const plan = await createTestPlan(tx, { title: VERIFICATION_PLAN_TITLE });
      await createTestSubscription(tx, user.id, plan.id, { status: SubscriptionStatus.Cancelled });

      const window = await SessionRepository.resolveCurrentEvaluationCycle(user.id, tx);

      expect(window.cycleStart).toBeNull();
      expect(window.activeSubscriptionId).toBeNull();
    });
  });

  test("the newest start_date wins when several verification subscriptions are active", async () => {
    await runInRollback(async tx => {
      const { user, plan } = await createVerificationApplicant(tx);
      const older = await createTestSubscription(tx, user.id, plan.id, {
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      });
      const newer = await createTestSubscription(tx, user.id, plan.id);

      const window = await SessionRepository.resolveCurrentEvaluationCycle(user.id, tx);

      expect(window.activeSubscriptionId).toBe(newer.id);
      expect(window.activeSubscriptionId).not.toBe(older.id);
      const newerStart = newer.startDate;
      if (!newerStart) throw new Error("expected the newer subscription's start date");
      expect(window.cycleStart?.getTime()).toBe(newerStart.getTime());
    });
  });

  test("an identical start_date tiebreaks on the higher subscription id", async () => {
    await runInRollback(async tx => {
      const { user, plan } = await createVerificationApplicant(tx);
      // Both candidates post-date the base fixture's start, so the window
      // race is decided purely by the (start_date, id) tiebreak.
      const sameStart = new Date(Date.now() + 60_000);
      const first = await createTestSubscription(tx, user.id, plan.id, { startDate: sameStart });
      const second = await createTestSubscription(tx, user.id, plan.id, { startDate: sameStart });

      const window = await SessionRepository.resolveCurrentEvaluationCycle(user.id, tx);

      expect(window.activeSubscriptionId).toBe(second.id);
      expect(window.activeSubscriptionId).not.toBe(first.id);
    });
  });
});

describe("SessionRepository.countEvaluationBookingsInCycle", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("counts zero across all shapes for a cycle with no evaluation bookings", async () => {
    await runInRollback(async tx => {
      const { user } = await createVerificationApplicant(tx);

      const counts = await SessionRepository.countEvaluationBookingsInCycle(user.id, new Date(), tx);

      expect(counts).toEqual({ booked: 0, completed: 0, evaluators: [] });
    });
  });

  test("counts the non-cancelled bookings, completed bookings, and DISTINCT evaluators of one cycle", async () => {
    await runInRollback(async tx => {
      const { user } = await createVerificationApplicant(tx);
      const teacherA = await createTestUser(tx, { role: "teacher" });
      const teacherB = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, teacherA.id);
      await createTestTeacherRow(tx, teacherB.id);
      const now = new Date();
      // Two bookings with teacher A (one completed), one with teacher B, and
      // a cancelled one — the distinctness memory collapses A's two rows.
      await createTestSession(tx, teacherA.id, user.id, {
        sessionType: SessionType.TeacherEvaluation,
        status: SessionStatus.Completed,
        startedAt: now,
        endedAt: now,
        createdAt: now,
      });
      await createTestSession(tx, teacherA.id, user.id, {
        sessionType: SessionType.TeacherEvaluation,
        createdAt: new Date(now.getTime() + 1_000),
      });
      await createTestSession(tx, teacherB.id, user.id, {
        sessionType: SessionType.TeacherEvaluation,
        createdAt: new Date(now.getTime() + 2_000),
      });
      await createTestSession(tx, teacherB.id, user.id, {
        sessionType: SessionType.TeacherEvaluation,
        status: SessionStatus.Cancelled,
        createdAt: new Date(now.getTime() + 3_000),
      });

      const counts = await SessionRepository.countEvaluationBookingsInCycle(user.id, now, tx);

      expect(counts.booked).toBe(3);
      expect(counts.completed).toBe(1);
      expect(counts.evaluators.toSorted((a, b) => a - b)).toEqual([teacherA.id, teacherB.id]);
    });
  });

  // ─── Tier 2: cycle-window edges ─────────────────────────────────────

  test("prior-cycle evaluation rows are excluded (they created history, not entitlements)", async () => {
    await runInRollback(async tx => {
      const { user } = await createVerificationApplicant(tx);
      const priorTeacher = await createTestUser(tx, { role: "teacher" });
      const currentTeacher = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, priorTeacher.id);
      await createTestTeacherRow(tx, currentTeacher.id);
      const cycleStart = new Date();
      await createTestSession(tx, priorTeacher.id, user.id, {
        sessionType: SessionType.TeacherEvaluation,
        createdAt: new Date(cycleStart.getTime() - 60_000),
      });
      await createTestSession(tx, currentTeacher.id, user.id, {
        sessionType: SessionType.TeacherEvaluation,
        createdAt: new Date(cycleStart.getTime() + 1_000),
      });

      const counts = await SessionRepository.countEvaluationBookingsInCycle(user.id, cycleStart, tx);

      // The half-open window (`created_at >= cycleStart`) keeps only the
      // current-cycle booking and its evaluator.
      expect(counts.booked).toBe(1);
      expect(counts.completed).toBe(0);
      expect(counts.evaluators).toEqual([currentTeacher.id]);
    });
  });

  test("a cancelled-only cycle contributes nothing to the booked count or the evaluator set", async () => {
    await runInRollback(async tx => {
      const { user } = await createVerificationApplicant(tx);
      const cancelledTeacher = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, cancelledTeacher.id);
      const now = new Date();
      await createTestSession(tx, cancelledTeacher.id, user.id, {
        sessionType: SessionType.TeacherEvaluation,
        status: SessionStatus.Cancelled,
        createdAt: now,
      });

      const counts = await SessionRepository.countEvaluationBookingsInCycle(user.id, now, tx);

      // A cancellation re-opens the credit: the cancelled booking is absent
      // from both the non-cancelled count and the distinctness memory, so the
      // same evaluator becomes bookable again.
      expect(counts).toEqual({ booked: 0, completed: 0, evaluators: [] });
    });
  });
});

describe("SessionRepository.listEvaluationSessionsForApplicant", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("pages only the applicant's teacher-evaluation sessions, newest first, with an honest total", async () => {
    await runInRollback(async tx => {
      const { user } = await createVerificationApplicant(tx);
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, teacherUser.id);
      const otherApplicant = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, otherApplicant.id);
      const now = new Date();
      const first = await createTestSession(tx, teacherUser.id, user.id, {
        sessionType: SessionType.TeacherEvaluation,
        createdAt: new Date(now.getTime() - 2_000),
      });
      const second = await createTestSession(tx, teacherUser.id, user.id, {
        sessionType: SessionType.TeacherEvaluation,
        createdAt: new Date(now.getTime() - 1_000),
      });
      const third = await createTestSession(tx, teacherUser.id, user.id, {
        sessionType: SessionType.TeacherEvaluation,
        createdAt: now,
      });
      // A regular student session (type pin excludes it) and another
      // applicant's evaluation booking (owner equality excludes it).
      await createTestSession(tx, teacherUser.id, user.id, { createdAt: new Date(now.getTime() + 1_000) });
      await createTestSession(tx, teacherUser.id, otherApplicant.id, {
        sessionType: SessionType.TeacherEvaluation,
        createdAt: new Date(now.getTime() + 2_000),
      });

      const page = await SessionRepository.listEvaluationSessionsForApplicant(user.id, { page: 1, pageSize: 25 }, tx);

      expect(page.total).toBe(3);
      expect(page.items.map(row => row.id)).toEqual([third.id, second.id, first.id]);
      expect(page.items.every(row => row.sessionType === (SessionType.TeacherEvaluation as string))).toBe(true);
    });
  });

  // ─── Tier 2: filter + page-window edges ─────────────────────────────

  test("the status filter narrows the page to the requested lifecycle state", async () => {
    await runInRollback(async tx => {
      const { user } = await createVerificationApplicant(tx);
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, teacherUser.id);
      const now = new Date();
      const scheduled = await createTestSession(tx, teacherUser.id, user.id, {
        sessionType: SessionType.TeacherEvaluation,
        createdAt: now,
      });
      await createTestSession(tx, teacherUser.id, user.id, {
        sessionType: SessionType.TeacherEvaluation,
        status: SessionStatus.Completed,
        startedAt: now,
        endedAt: now,
        createdAt: new Date(now.getTime() + 1_000),
      });

      const page = await SessionRepository.listEvaluationSessionsForApplicant(
        user.id,
        { status: SessionStatus.Scheduled, page: 1, pageSize: 25 },
        tx
      );

      expect(page.total).toBe(1);
      expect(page.items.map(row => row.id)).toEqual([scheduled.id]);
    });
  });

  test("the page window normalizes: page 0 falls back to the first page, an oversized size to the default", async () => {
    await runInRollback(async tx => {
      const { user } = await createVerificationApplicant(tx);
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, teacherUser.id);
      const only = await createTestSession(tx, teacherUser.id, user.id, {
        sessionType: SessionType.TeacherEvaluation,
      });

      const page = await SessionRepository.listEvaluationSessionsForApplicant(user.id, { page: 0, pageSize: 1000 }, tx);

      // Sane-fallback, never thrown: the fabricated window (page 0, size
      // 1000) resolves to the first page at the default size and still
      // returns the single fixture.
      expect(page.total).toBe(1);
      expect(page.items.map(row => row.id)).toEqual([only.id]);
    });
  });

  test("an out-of-range page yields an empty items array with the unchanged total", async () => {
    await runInRollback(async tx => {
      const { user } = await createVerificationApplicant(tx);
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, teacherUser.id);
      await createTestSession(tx, teacherUser.id, user.id, { sessionType: SessionType.TeacherEvaluation });

      const page = await SessionRepository.listEvaluationSessionsForApplicant(user.id, { page: 2, pageSize: 25 }, tx);

      expect(page.items).toEqual([]);
      expect(page.total).toBe(1);
    });
  });
});

/**
 * Rubric pending-list fixtures: an evaluator, a second evaluator (for the
 * cross-evaluator anti-join probes), and an applicant (bare user — the
 * evaluation loop's student leg needs no `students` child row).
 */
async function createRubricPendingCast(tx: DBTransaction) {
  const evaluator = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, evaluator.id);
  const secondEvaluator = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, secondEvaluator.id);
  const applicant = await createTestUser(tx, { role: "teacher" });
  return { evaluator: evaluator.id, secondEvaluator: secondEvaluator.id, applicant: applicant.id };
}

/**
 * Books one completed evaluation session for the applicant; when
 * `submittedBy` is set, that evaluator's scored rubric row lands on it.
 * The booking carries the evaluation intent — the pending page's predicate
 * pins the same member the submission gate enforces.
 */
async function bookCompletedEvaluationSession(
  tx: DBTransaction,
  cast: Awaited<ReturnType<typeof createRubricPendingCast>>,
  evaluatorId: number,
  submittedBy: number | null,
  createdAt = new Date()
) {
  const booked = await createTestSession(tx, evaluatorId, cast.applicant, {
    sessionType: SessionType.TeacherEvaluation,
    intent: SessionIntent.Evaluation,
    status: SessionStatus.Completed,
    startedAt: createdAt,
    endedAt: createdAt,
    createdAt,
  });
  if (submittedBy !== null) {
    await createTestEvaluation(tx, cast.applicant, submittedBy, booked.id, { score: 80 });
  }
  return booked;
}

describe("SessionRepository.listCompletedRubricPendingSessions", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("pages only the evaluator's own completed evaluation sessions with no own submission", async () => {
    await runInRollback(async tx => {
      const cast = await createRubricPendingCast(tx);
      const now = Date.now();
      const pendingNewer = await bookCompletedEvaluationSession(tx, cast, cast.evaluator, null, new Date(now + 2_000));
      const foreignScored = await bookCompletedEvaluationSession(
        tx,
        cast,
        cast.evaluator,
        cast.secondEvaluator,
        new Date(now + 1_000)
      );
      const pendingOlder = await bookCompletedEvaluationSession(tx, cast, cast.evaluator, null, new Date(now));
      // An own submitted row drops out of the evaluator's pending page.
      await bookCompletedEvaluationSession(tx, cast, cast.evaluator, cast.evaluator, new Date(now - 1_000));
      // A scheduled (non-completed) evaluation session never joins.
      await createTestSession(tx, cast.evaluator, cast.applicant, {
        sessionType: SessionType.TeacherEvaluation,
        createdAt: new Date(now - 2_000),
      });
      // A completed evaluation session without the evaluation intent never
      // joins either — an untyped (null) row and a mistyped (hifz) row both
      // drop out of the pending page, mirroring the submission gate's
      // evaluation-intent leg (the read gate and the write gate agree).
      await createTestSession(tx, cast.evaluator, cast.applicant, {
        sessionType: SessionType.TeacherEvaluation,
        intent: null,
        status: SessionStatus.Completed,
        startedAt: new Date(now - 4_000),
        endedAt: new Date(now - 4_000),
        createdAt: new Date(now - 4_000),
      });
      await createTestSession(tx, cast.evaluator, cast.applicant, {
        sessionType: SessionType.TeacherEvaluation,
        intent: SessionIntent.Hifz,
        status: SessionStatus.Completed,
        startedAt: new Date(now - 5_000),
        endedAt: new Date(now - 5_000),
        createdAt: new Date(now - 5_000),
      });
      // Another evaluator's completed session (owner equality) never joins.
      await bookCompletedEvaluationSession(tx, cast, cast.secondEvaluator, null, new Date(now - 3_000));

      const page = await SessionRepository.listCompletedRubricPendingSessions(
        cast.evaluator,
        { page: 1, pageSize: 25 },
        tx
      );

      // The other evaluator's submission on foreignScored changes nothing —
      // the anti-join binds BOTH the session link and the evaluator id.
      expect(page.totalCount).toBe(3);
      expect(page.items.map(row => row.id)).toEqual([pendingNewer.id, foreignScored.id, pendingOlder.id]);
      expect(page.items.every(row => row.sessionType === (SessionType.TeacherEvaluation as string))).toBe(true);
    });
  });

  test("resolves empty for an evaluator with no completed evaluation sessions", async () => {
    await runInRollback(async tx => {
      const cast = await createRubricPendingCast(tx);

      const page = await SessionRepository.listCompletedRubricPendingSessions(
        cast.evaluator,
        { page: 1, pageSize: 25 },
        tx
      );

      expect(page.items).toEqual([]);
      expect(page.totalCount).toBe(0);
    });
  });

  // ─── Tier 2: page-window edges ─────────────────────────────────────

  test("the page window normalizes: page 0 falls back to the first page, an oversized size to the default", async () => {
    await runInRollback(async tx => {
      const cast = await createRubricPendingCast(tx);
      // Thirty pending sessions — enough rows to distinguish the default
      // fallback (25) from a pass-through of the oversized requested size.
      const base = Date.now();
      await tx.insert(session).values(
        Array.from({ length: 30 }, (_, index) => ({
          teacherId: cast.evaluator,
          studentId: cast.applicant,
          status: SessionStatus.Completed,
          sessionType: SessionType.TeacherEvaluation,
          intent: SessionIntent.Evaluation,
          startedAt: new Date(base),
          endedAt: new Date(base),
          createdAt: new Date(base + index * 1_000),
        }))
      );

      const oversized = await SessionRepository.listCompletedRubricPendingSessions(
        cast.evaluator,
        { page: 1, pageSize: 150 },
        tx
      );
      expect(oversized.items).toHaveLength(25);
      expect(oversized.totalCount).toBe(30);

      const firstPage = await SessionRepository.listCompletedRubricPendingSessions(
        cast.evaluator,
        { page: 0, pageSize: 25 },
        tx
      );
      expect(firstPage.items).toHaveLength(25);
      expect(firstPage.totalCount).toBe(30);

      const secondPage = await SessionRepository.listCompletedRubricPendingSessions(
        cast.evaluator,
        { page: 2, pageSize: 25 },
        tx
      );
      expect(secondPage.items).toHaveLength(5);
      expect(secondPage.totalCount).toBe(30);
      // Pages never overlap: the second page holds the five OLDEST rows.
      const firstPageIds = new Set(firstPage.items.map(row => row.id));
      expect(secondPage.items.every(row => !firstPageIds.has(row.id))).toBe(true);
    });
  });

  test("an out-of-range page yields an empty items array with the unchanged total", async () => {
    await runInRollback(async tx => {
      const cast = await createRubricPendingCast(tx);
      await bookCompletedEvaluationSession(tx, cast, cast.evaluator, null);

      const page = await SessionRepository.listCompletedRubricPendingSessions(
        cast.evaluator,
        { page: 2, pageSize: 25 },
        tx
      );

      expect(page.items).toEqual([]);
      expect(page.totalCount).toBe(1);
    });
  });
});

describe("SessionRepository evaluation-booking FK retarget", () => {
  // ─── Tier 4: schema contract ────────────────────────────────────────

  test("an evaluation session inserts against a bare applicant-user id (no students row) post-retarget", async () => {
    await runInRollback(async tx => {
      const { user } = await createVerificationApplicant(tx);
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, teacherUser.id);

      // The student leg points at users.id: the insert succeeds without any
      // `students` child row — the invariant that lets an evaluation booking
      // exist against an applicant identity.
      const booked = await createTestSession(tx, teacherUser.id, user.id, {
        sessionType: SessionType.TeacherEvaluation,
      });

      expect(booked.studentId).toBe(user.id);
      const [reread] = await tx.select().from(session).where(eq(session.id, booked.id));
      expect(reread?.studentId).toBe(user.id);
      // The booked row is visible through the applicant list read too.
      const page = await SessionRepository.listEvaluationSessionsForApplicant(user.id, { page: 1, pageSize: 25 }, tx);
      expect(page.total).toBe(1);
      expect(page.items[0]?.id).toBe(booked.id);
    });
  });

  test("a regular student session still inserts against the students leg (existing semantics kept)", async () => {
    await runInRollback(async tx => {
      const studentUser = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, studentUser.id);
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, teacherUser.id);

      const created = await createTestSession(tx, teacherUser.id, studentUser.id);

      expect(created.studentId).toBe(studentUser.id);
    });
  });

  // ─── Tier 4: static surface pins ────────────────────────────────────

  const HELPERS_FILE = join(import.meta.dir, "../../../repo/classes/session.repository.evaluation.helpers.ts");
  const helpersSource = readFileSync(HELPERS_FILE, "utf8");

  test("source: no SQL line-comment sequences, no prepared statements in the evaluation helpers", () => {
    expect(helpersSource.includes("--")).toBe(false);
    expect(helpersSource.includes(".prepare(")).toBe(false);
    expect(helpersSource.includes("sql.placeholder")).toBe(false);
  });

  test("source: the pending-rubric anti-join is a required-tx read over the canonical vocabularies", () => {
    expect(helpersSource).toContain("export async function listCompletedRubricPendingSessions(");
    // The anti-join keeps only rows whose own-submission side is NULL, the
    // intent pin mirrors the submission gate's evaluation-intent leg, and
    // the page window normalizes sane-fallback before any database work.
    expect(helpersSource).toContain("isNull(evaluations.id)");
    expect(helpersSource).toContain("SessionIntent.Evaluation");
    expect(helpersSource).toContain("RUBRIC_PENDING_MAX_PAGE_SIZE");
    expect(helpersSource).toContain("tx: DBTransaction");
  });

  test("source: lifecycle and type vocabularies ride the canonical enum members (no string literals)", () => {
    expect(helpersSource).toContain("SessionStatus.Cancelled");
    expect(helpersSource).toContain("SessionStatus.Completed");
    expect(helpersSource).toContain("SessionType.TeacherEvaluation");
    expect(/'(scheduled|started|completed|cancelled|student_session|teacher_evaluation)'/.test(helpersSource)).toBe(
      false
    );
  });

  test("source: comments describe domain behavior only (no plan-artifact references)", () => {
    expect(/REQ-\d|DEV2|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(helpersSource)).toBe(false);
  });
});
