/**
 * Entity-setup helpers for DB tests — factories that create isolated test
 * entities inside a transaction.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Always create your own data via these helpers inside `runInRollback`.
 *    NEVER query seed data as test input.
 *  - Generate unique emails / names / handshake codes via `randomUUID()` or
 *    distinct prefixes to avoid unique-constraint violations.
 *  - Each helper takes `tx` as the FIRST argument and passes it to the
 *    underlying repository method.
 *
 * The helpers here are NOT the canonical registration flow — they bypass the
 * service layer to set up test preconditions (e.g. a pre-existing user to
 * test duplicate-email rejection). For registration behavior, call
 * `RegistrationService.registerUser(...)` directly in the test body.
 */
import { randomUUID } from "node:crypto";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { lessons } from "@/backend/db/schema/classes/lessons";
import { reports } from "@/backend/db/schema/classes/reports";
import { session } from "@/backend/db/schema/classes/session";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { evaluations } from "@/backend/db/schema/teachers/evaluations";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import type {
  AdminSelectType,
  ApplicantSelectType,
  DBTransaction,
  EvaluationSelectType,
  HomeWorkSelectType,
  LessonSelectType,
  ParentSelectType,
  PlanSelectType,
  ReportSelectType,
  SessionSelectType,
  StudentPaymentSelectType,
  StudentSelectType,
  SubscriptionSelectType,
  TeacherSelectType,
  TeacherTransactionSelectType,
  UserSelectType,
  WalletSelectType,
} from "@/backend/types";

/** Default test bcrypt hash stub (placeholder — NOT a real hash, never used for verification). */
const TEST_BCRYPT_STUB_HASH = "$2a$12$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUV1234567890ABCDEFGHIJKLMNOPQRSTUV";

/**
 * Creates a unique test user with a random email. Override any field via
 * `overrides` — useful for setting `role` to a specific value or pre-seeding
 * `isDeleted` to test governance-state rejection paths.
 *
 * @example
 * const user = await createTestUser(tx);
 * const admin = await createTestUser(tx, { role: "admin" });
 */
export async function createTestUser(
  tx: DBTransaction,
  overrides: Partial<UserSelectType> = {}
): Promise<UserSelectType> {
  const [row] = await tx
    .insert(users)
    .values({
      fullName: `Test User ${randomUUID().slice(0, 8)}`,
      email: `test-${randomUUID()}@test.local`,
      phone: "+10000000000",
      passwordHash: TEST_BCRYPT_STUB_HASH,
      role: "student",
      // Governance defaults
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      lastActiveAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("createTestUser: insert returned no rows");
  }
  return row;
}

/**
 * Creates a `students` row for a previously-created user. Generates a unique
 * `handshakeCode` so multiple test students don't collide.
 */
export async function createTestStudent(
  tx: DBTransaction,
  userId: number,
  overrides: Partial<StudentSelectType> = {}
): Promise<StudentSelectType> {
  const [row] = await tx
    .insert(students)
    .values({
      id: userId,
      handshakeCode: `KSB-${randomUUID().slice(0, 8).toUpperCase()}`,
      balanceHifz: 0,
      balanceTajweed: 0,
      balanceReviews: 0,
      parentId: null,
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("createTestStudent: insert returned no rows");
  }
  return row;
}

/**
 * Creates a `parents` row for a previously-created user (PK only — the
 * `parents` table has no extra columns beyond shared PK + timestamps).
 */
export async function createTestParent(tx: DBTransaction, userId: number): Promise<ParentSelectType> {
  const [row] = await tx.insert(parents).values({ id: userId }).returning();
  if (!row) {
    throw new Error("createTestParent: insert returned no rows");
  }
  return row;
}

/**
 * Creates an `applicants` row for a previously-created user. Defaults
 * `status='pending'`, `verification_attempts=0`.
 */
export async function createTestApplicant(
  tx: DBTransaction,
  userId: number,
  overrides: Partial<ApplicantSelectType> = {}
): Promise<ApplicantSelectType> {
  const [row] = await tx
    .insert(applicants)
    .values({
      id: userId,
      status: "pending",
      verificationAttempts: 0,
      lastAttemptAt: null,
      cooldownUntil: null,
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("createTestApplicant: insert returned no rows");
  }
  return row;
}

/**
 * Creates an `admin` row for a previously-created user (PK only — the `admin`
 * table has no extra columns beyond shared PK + timestamps).
 */
export async function createTestAdmin(tx: DBTransaction, userId: number): Promise<AdminSelectType> {
  const [row] = await tx.insert(admin).values({ id: userId }).returning();
  if (!row) {
    throw new Error("createTestAdmin: insert returned no rows");
  }
  return row;
}

/**
 * Creates a unique test subscription plan row with randomized unique title.
 */
export async function createTestPlan(
  tx: DBTransaction,
  overrides: Partial<PlanSelectType> = {}
): Promise<PlanSelectType> {
  const [row] = await tx
    .insert(plans)
    .values({
      title: `Test Plan ${randomUUID().slice(0, 8)}`,
      sessionCount: 8,
      price: "200.00",
      currency: "EGP",
      intervalDays: 30,
      isActive: true,
      deactivatedAt: null,
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("createTestPlan: insert returned no rows");
  }
  return row;
}

/**
 * Creates a `subscriptions` row for an existing user + plan pair (both FKs
 * use restrict delete — resolve both parents first).
 *
 * Defaults model a LIVE subscription: `status='active'`, `startDate` captured
 * at call time, open-ended `endDate` — the shape an active-window read
 * counts (start already due, end not yet due). All timestamps are plain
 * `Date`s: override `startDate` / `endDate` relative to the test's captured
 * `now` for expired, cancelled, suspended, or future-dated fixtures (an
 * expired subscription needs an `endDate` in the past, not just a status).
 *
 * @example
 * const live = await createTestSubscription(tx, user.id, plan.id);
 * const expired = await createTestSubscription(tx, user.id, plan.id, {
 *   status: SubscriptionStatus.Expired,
 *   startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
 *   endDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
 * });
 */
export async function createTestSubscription(
  tx: DBTransaction,
  userId: number,
  planId: number,
  overrides: Partial<SubscriptionSelectType> = {}
): Promise<SubscriptionSelectType> {
  const [row] = await tx
    .insert(subscriptions)
    .values({
      userId,
      planId,
      status: SubscriptionStatus.Active,
      startDate: new Date(),
      endDate: null,
      paymentMethod: null,
      paymentReference: null,
      paymentVerifiedAt: null,
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("createTestSubscription: insert returned no rows");
  }
  return row;
}

/**
 * Creates a `student_payments` row for an existing student (restrict FK —
 * create the student first) and, optionally, the subscription it pays for.
 *
 * The payments ledger is append-only: a wrong entry is corrected by a NEW
 * compensating row, never by editing — this factory therefore only ever
 * inserts.
 *
 * Defaults record a settled gateway payment captured now
 * (`status='paid'`, `createdAt` at call time) so trailing-30-day and
 * same-day revenue windows include the row out of the box. `amount` is an
 * exact decimal STRING and must stay non-negative
 * (`student_payments_amount_check`); `currency` is a 3-character ISO code
 * string and keys per-currency revenue grouping verbatim. Offline-payment
 * channels are set via `paymentGateway` overrides.
 */
export async function createTestStudentPayment(
  tx: DBTransaction,
  studentId: number,
  subscriptionId: number | null,
  overrides: Partial<StudentPaymentSelectType> = {}
): Promise<StudentPaymentSelectType> {
  const [row] = await tx
    .insert(studentPayments)
    .values({
      studentId,
      subscriptionId,
      amount: "100.00",
      currency: "EGP",
      paymentGateway: PaymentGateway.Stripe,
      status: PaymentStatus.Paid,
      createdAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("createTestStudentPayment: insert returned no rows");
  }
  return row;
}

/**
 * Creates a `session` row between an existing teacher and student (both FKs
 * use restrict delete — resolve both parents first).
 *
 * Defaults to a freshly requested `scheduled` student session created at
 * call time. Every lifecycle instant (`startedAt`, `endedAt`,
 * `confirmedByStudentAt`, `confirmedByTeacherAt`, `confirmationDeadline`)
 * and every dispute/cancel column is override-driven — a completed session
 * still awaiting student confirmation passes
 * `{ status: SessionStatus.Completed, startedAt, endedAt,
 * confirmedByTeacherAt }`, a dispute adds
 * `{ status: SessionStatus.Disputed, disputeReason, disputedAt }`. `fee`
 * is a decimal STRING when provided.
 */
export async function createTestSession(
  tx: DBTransaction,
  teacherId: number,
  studentId: number,
  overrides: Partial<SessionSelectType> = {}
): Promise<SessionSelectType> {
  const [row] = await tx
    .insert(session)
    .values({
      teacherId,
      studentId,
      status: SessionStatus.Scheduled,
      sessionType: SessionType.StudentSession,
      intent: null,
      fee: null,
      feeHeld: false,
      heldBalanceLane: null,
      startedAt: null,
      endedAt: null,
      confirmedByStudentAt: null,
      confirmedByTeacherAt: null,
      confirmationDeadline: null,
      createdAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("createTestSession: insert returned no rows");
  }
  return row;
}

/**
 * Creates a `reports` row for an existing session (cascade FK — the report
 * disappears with its session). The teacher is reached through the session;
 * there is no teacher column on reports.
 *
 * `studentRatingByTeacher` defaults to 5 and must stay within [0, 5]
 * (`reports_student_rating_by_teacher_check`) when provided; pass `null`
 * explicitly for an unrated report.
 */
export async function createTestSessionReport(
  tx: DBTransaction,
  sessionId: number,
  overrides: Partial<ReportSelectType> = {}
): Promise<ReportSelectType> {
  const [row] = await tx
    .insert(reports)
    .values({
      sessionId,
      teacherNotes: null,
      studentRatingByTeacher: 5,
      createdAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("createTestSessionReport: insert returned no rows");
  }
  return row;
}

/**
 * Creates a `home_work` row for an existing session (cascade FK — the row
 * disappears with its session). One row per session (`session_id` UNIQUE).
 *
 * Defaults model the assigned-but-ungraded state: BOTH grade columns NULL
 * and both assignment tracks empty — override the `current_*` (Jadid) and
 * `revision_*` (Madi) columns to model authored blocks. Grades must stay
 * within [0, 100] (`home_work_current_grade_check` /
 * `home_work_revision_grade_check`) when provided; the surah/juz columns
 * take `SurahJuzRef` members only.
 */
export async function createTestHomeWork(
  tx: DBTransaction,
  sessionId: number,
  overrides: Partial<HomeWorkSelectType> = {}
): Promise<HomeWorkSelectType> {
  const [row] = await tx
    .insert(homeWork)
    .values({
      sessionId,
      currentFromAyah: null,
      currentToAyah: null,
      currentGrade: null,
      currentSurahJuz: null,
      revisionFromAyah: null,
      revisionToAyah: null,
      revisionGrade: null,
      revisionSurahJuz: null,
      createdAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("createTestHomeWork: insert returned no rows");
  }
  return row;
}

/**
 * Creates a unique test lesson row on a given plan. `planId` is positional
 * and REQUIRED — a lesson fixture always names its plan explicitly (the
 * service tier routes plan-not-found rejections through validation, not
 * through a null-plan write). Generates a randomized unique title; override
 * any field via `overrides`.
 */
export async function createTestLesson(
  tx: DBTransaction,
  planId: number,
  overrides: Partial<LessonSelectType> = {}
): Promise<LessonSelectType> {
  const [row] = await tx
    .insert(lessons)
    .values({
      planId,
      title: `Test Lesson ${randomUUID().slice(0, 8)}`,
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("createTestLesson: insert returned no rows");
  }
  return row;
}

/**
 * Creates an `evaluations` row. `evaluatedId` (cascade delete) and
 * `evaluatorId` (restrict delete) reference users rows; `sessionId` is the
 * nullable evaluation-session link — pass `null` for a standalone
 * evaluation.
 *
 * `score` defaults to 85 and must stay within [0, 100]
 * (`evaluations_score_check`) when provided. Soft delete is override-driven
 * (`{ isDeleted: true, deletedAt: ... }`) — rating aggregates exclude
 * soft-deleted rows, so flip it to model an excluded evaluation.
 */
export async function createTestEvaluation(
  tx: DBTransaction,
  evaluatedId: number,
  evaluatorId: number,
  sessionId: number | null,
  overrides: Partial<EvaluationSelectType> = {}
): Promise<EvaluationSelectType> {
  const [row] = await tx
    .insert(evaluations)
    .values({
      evaluatedId,
      evaluatorId,
      sessionId,
      score: 85,
      notes: null,
      isDeleted: false,
      deletedAt: null,
      createdAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("createTestEvaluation: insert returned no rows");
  }
  return row;
}

/**
 * Creates the `wallet` row for an existing teacher (unique per teacher —
 * one wallet each).
 *
 * `balance` / `totalEarning` are exact decimal STRINGS and must stay
 * non-negative (`wallet_balance_check` / `wallet_total_earning_check`). The
 * ledger does NOT move these cached columns by itself — fund a fixture
 * wallet explicitly via overrides (e.g.
 * `{ balance: "500.00", totalEarning: "500.00" }`) when a payout needs
 * headroom.
 */
export async function createTestWallet(
  tx: DBTransaction,
  teacherId: number,
  overrides: Partial<WalletSelectType> = {}
): Promise<WalletSelectType> {
  const [row] = await tx
    .insert(wallet)
    .values({
      teacherId,
      balance: "0.00",
      totalEarning: "0.00",
      createdAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("createTestWallet: insert returned no rows");
  }
  return row;
}

/**
 * Creates a `teacher_transaction` ledger row against an existing wallet
 * (restrict FK) and, optionally, the session that earned it.
 *
 * The ledger is append-only: a payout settles via a NEW compensating row,
 * never an in-place flip — this factory therefore only ever inserts, and it
 * does NOT touch the wallet's cached `balance` / `totalEarning` columns
 * (fund them via the wallet factory's overrides).
 *
 * Defaults to a settled earning (`type='earning'`, `status='completed'`);
 * an in-flight payout passes
 * `{ type: TransactionType.Withdrawal, status: TransactionStatus.Pending }`.
 * `amount` is an exact decimal STRING and must stay non-negative
 * (`teacher_transaction_amount_check`).
 */
export async function createTestTeacherTransaction(
  tx: DBTransaction,
  walletId: number,
  sessionId: number | null,
  overrides: Partial<TeacherTransactionSelectType> = {}
): Promise<TeacherTransactionSelectType> {
  const [row] = await tx
    .insert(teacherTransaction)
    .values({
      walletId,
      sessionId,
      description: null,
      amount: "50.00",
      type: TransactionType.Earning,
      status: TransactionStatus.Completed,
      createdAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("createTestTeacherTransaction: insert returned no rows");
  }
  return row;
}

/**
 * Creates the `teacher` role-child row for an ALREADY-created users row
 * (shared PK — the caller owns user creation and role selection; nothing
 * here synthesizes a role or its user).
 *
 * Defaults model a certified, offline teacher (`isApproved=true` — a
 * teacher row exists only after upstream certification; `isOnline=false`);
 * presence fixtures override `isEvaluator` / `isOnline`. `averageRating`
 * is a decimal STRING within [0, 5] (`teacher_average_rating_check`) when
 * provided.
 */
export async function createTestTeacherRow(
  tx: DBTransaction,
  userId: number,
  overrides: Partial<TeacherSelectType> = {}
): Promise<TeacherSelectType> {
  const [row] = await tx
    .insert(teacher)
    .values({
      id: userId,
      isApproved: true,
      isEvaluator: false,
      isOnline: false,
      averageRating: null,
      createdAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("createTestTeacherRow: insert returned no rows");
  }
  return row;
}
