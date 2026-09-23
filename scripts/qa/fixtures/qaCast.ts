/**
 * Shared QA cast fixtures — the deterministic database provisioner the
 * browser-QA scripts build on. Extracted from the rubric seed so future QA
 * entry points (verification-cycle fixtures, conflict flows, …) reuse the
 * SAME upsert contract instead of minting private copies:
 *
 *  - `upsertQaUser` — idempotent user row keyed by the unique `qa_` email
 *    (teacher role, known bcrypt password), returning the row id;
 *  - `ensureEvaluatorCast` — the certified-evaluator teacher child row;
 *  - `ensureApplicantCast` — the applicant teacher child row + the
 *    `in_evaluation` applicant status;
 *  - `ensureCompletedEvaluationSessions` — tops the teacher's completed
 *    `teacher_evaluation` sessions for the applicant up to a minimum count
 *    (the pending-rubric feed reads from exactly these).
 *
 * Every helper is idempotent (re-running refreshes the same rows, never
 * duplicates) and speaks to the DEV postgres database through the shared
 * `db` client — a QA script runs with `bun --env-file=.env`.
 */
import { hash } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { session } from "@/backend/db/schema/classes/session";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { evaluations } from "@/backend/db/schema/teachers/evaluations";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  VERIFICATION_PLAN_CURRENCY,
  VERIFICATION_PLAN_INTERVAL_DAYS,
  VERIFICATION_PLAN_PRICE,
  VERIFICATION_PLAN_SESSION_COUNT,
  VERIFICATION_PLAN_TITLE,
} from "@/shared/constants/verification-plan.constants";

/** The shared plaintext password of the QA cast (demo-cast only). */
export const QA_CAST_PASSWORD = "Password123!";

/** The certified evaluator's known login. */
export const QA_EVALUATOR_EMAIL = "qa-evaluator@demo.local";

/** The applicant's known login. */
export const QA_APPLICANT_EMAIL = "qa-applicant@demo.local";

/** The applicant status the rubric flow expects (`in_evaluation`). */
export const QA_APPLICANT_STATUS = "in_evaluation";

/** The minimum count of completed `teacher_evaluation` sessions the feed reads. */
export const QA_PENDING_SESSION_COUNT = 5;

/** The two cast handles every QA flow navigates between. */
export interface QaCastHandles {
  readonly evaluatorId: number;
  readonly applicantId: number;
}

/**
 * Idempotently provisions (or refreshes) one QA user row keyed by the
 * unique email, returning the row id. Teacher role, not deleted/suspended,
 * English locale — the simplest login the flows can drive.
 */
export async function upsertQaUser(email: string, fullName: string): Promise<number> {
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) return existing[0].id;
  const [row] = await db
    .insert(users)
    .values({
      email,
      fullName,
      phone: "+201000000001",
      passwordHash: await hash(QA_CAST_PASSWORD, 10),
      role: "teacher",
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      locale: "en",
      lastActiveAt: new Date(),
    })
    .returning();
  if (!row) throw new Error("user insert failed");
  return row.id;
}

/** The certified-evaluator teacher child row (`isApproved` + `isEvaluator`). */
export async function ensureEvaluatorCast(userId: number): Promise<void> {
  const existing = await db.select().from(teacher).where(eq(teacher.id, userId)).limit(1);
  if (!existing[0]) {
    await db.insert(teacher).values({ id: userId, isApproved: true, isEvaluator: true });
    return;
  }
  await db.update(teacher).set({ isApproved: true, isEvaluator: true }).where(eq(teacher.id, userId));
}

/** The applicant teacher child row (uncertified, non-evaluator) + the full pre-verification state. */
export async function ensureApplicantCast(userId: number): Promise<void> {
  const existingTeacherRow = await db.select().from(teacher).where(eq(teacher.id, userId)).limit(1);
  if (!existingTeacherRow[0]) {
    await db.insert(teacher).values({ id: userId, isApproved: false, isEvaluator: false });
  }
  const existingApplicantRow = await db.select().from(applicants).where(eq(applicants.id, userId)).limit(1);
  if (!existingApplicantRow[0]) {
    await db.insert(applicants).values({ id: userId, status: QA_APPLICANT_STATUS, verificationAttempts: 0 });
    return;
  }
  // The refresh restores the WHOLE pre-verification state, not just the
  // status: a finalized cycle leaves cooldownUntil/lastAttemptAt/verificationAttempts
  // behind (the r11 finalization drive proved the path), and a cast left
  // `in_evaluation` but still carrying a cooldown stamp is an incoherent
  // fixture the booking gate could trip over.
  await db
    .update(applicants)
    .set({ status: QA_APPLICANT_STATUS, verificationAttempts: 0, lastAttemptAt: null, cooldownUntil: null })
    .where(eq(applicants.id, userId));
}

/**
 * Tops the teacher's completed `teacher_evaluation` sessions for the
 * applicant up to `minCount` (total, created + pre-existing), returning the
 * resulting total — the number of pending-rubric rows the feed renders.
 *
 * The count mirrors the pending read's PENDING predicate (completed
 * evaluation-intent sessions with no evaluation row by THIS evaluator —
 * the repo's anti-join), not the raw session count: after an in-browser
 * happy-path submit scores one cast session, re-running a seed that
 * counted raw sessions would restore nothing (five sessions exist, four
 * pending); counting pending sessions keeps the cast self-healing to
 * exactly `minCount` restorable rows.
 */
export async function ensureCompletedEvaluationSessions(
  teacherId: number,
  studentId: number,
  minCount: number = QA_PENDING_SESSION_COUNT
): Promise<number> {
  const [castSessions, submittedRows] = await Promise.all([
    db
      .select({ id: session.id })
      .from(session)
      .where(
        and(
          eq(session.teacherId, teacherId),
          eq(session.studentId, studentId),
          eq(session.sessionType, "teacher_evaluation"),
          eq(session.intent, "evaluation"),
          eq(session.status, "completed")
        )
      ),
    db.select({ sessionId: evaluations.sessionId }).from(evaluations).where(eq(evaluations.evaluatorId, teacherId)),
  ]);
  const submittedSessionIds = new Set(
    submittedRows.map(row => row.sessionId).filter((id): id is number => id !== null)
  );
  const pendingCount = castSessions.filter(row => !submittedSessionIds.has(row.id)).length;
  const toCreate = Math.max(0, minCount - pendingCount);
  if (toCreate > 0) {
    // One batched insert — the sessions are interchangeable completed
    // evaluation slots (distinct auto-generated ids).
    await db.insert(session).values(
      Array.from({ length: toCreate }, () => ({
        teacherId,
        studentId,
        status: "completed" as const,
        sessionType: "teacher_evaluation" as const,
        intent: "evaluation" as const,
        fee: "0",
        feeHeld: false,
        startedAt: new Date(Date.now() - 3600_000),
        endedAt: new Date(Date.now() - 1800_000),
        confirmedByStudentAt: new Date(),
        confirmedByTeacherAt: new Date(),
      }))
    );
  }
  return pendingCount + toCreate;
}

/**
 * Provisions the applicant's ACTIVE verification cycle — the subscription
 * window the submission gate resolves through `resolveCurrentEvaluationCycle`:
 * a rubric verdict is only scorable while the evaluated session falls inside
 * the applicant's newest ACTIVE verification-plan subscription, and a cast
 * without one folds every submit attempt into the oracle-free SESSION_NOT_FOUND
 * denial (history is not scorable). The plan row resolves by its canonical
 * catalog title (the server-side resolution key) — the seeder owns it, and a
 * missing row is provisioned here from the SHARED product constants so the
 * fixture can never drift from the contract. Idempotent: an existing active
 * subscription for the user is reused untouched.
 */
export async function ensureVerificationCycle(applicantUserId: number): Promise<void> {
  const existingPlan = await db.select().from(plans).where(eq(plans.title, VERIFICATION_PLAN_TITLE)).limit(1);
  let planId: number;
  if (!existingPlan[0]) {
    const [row] = await db
      .insert(plans)
      .values({
        title: VERIFICATION_PLAN_TITLE,
        sessionCount: VERIFICATION_PLAN_SESSION_COUNT,
        price: VERIFICATION_PLAN_PRICE,
        currency: VERIFICATION_PLAN_CURRENCY,
        intervalDays: VERIFICATION_PLAN_INTERVAL_DAYS,
      })
      .returning();
    if (!row) throw new Error("plan insert failed");
    planId = row.id;
  } else {
    planId = existingPlan[0].id;
  }
  const existingSubscription = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, applicantUserId), eq(subscriptions.status, "active")))
    .limit(1);
  if (!existingSubscription[0]) {
    // The window starts a day back so the cast sessions' creation instants
    // (seed time) always fall inside the scorable cycle.
    await db.insert(subscriptions).values({
      userId: applicantUserId,
      planId,
      status: "active",
      startDate: new Date(Date.now() - 86_400_000),
      endDate: new Date(Date.now() + VERIFICATION_PLAN_INTERVAL_DAYS * 86_400_000),
    });
  }
}

/**
 * The full rubric-flow cast in one call — evaluator + applicant + the
 * verification cycle + the pending-session feed — returning the handles
 * and the session count.
 */
export async function ensureRubricQaCast(): Promise<QaCastHandles & { readonly sessionCount: number }> {
  const evaluatorId = await upsertQaUser(QA_EVALUATOR_EMAIL, "QA Evaluator");
  const applicantId = await upsertQaUser(QA_APPLICANT_EMAIL, "QA Applicant");
  await ensureEvaluatorCast(evaluatorId);
  await ensureApplicantCast(applicantId);
  await ensureVerificationCycle(applicantId);
  const sessionCount = await ensureCompletedEvaluationSessions(evaluatorId, applicantId);
  return { evaluatorId, applicantId, sessionCount };
}
