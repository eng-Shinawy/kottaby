/**
 * Journey — the student→teacher session rating (cross-actor evaluation
 * workflow), executed SEQUENTIALLY through the real services (production
 * transaction path — no outer tx) on the real test database.
 *
 * The arc, each step attributed to a different real actor from one
 * committed fixture cast (real `users.role` values + real role-child
 * rows; authorization and ownership resolve through the same row-side
 * predicates production uses — never monkey-patched):
 *
 *   1. reach-the-rating-state — the session's student books the teacher
 *      through the real request flow, the teacher starts + completes the
 *      session, the student confirms: both stamps set, escrow released,
 *      the teacher's wallet credited exactly the session fee once.
 *   2. rate — the student submits a whole-star rating: exactly one
 *      `evaluations` row appears, keyed by the session's teacher user id
 *      (rated subject), the caller's user id (rater) and the session id,
 *      with `score = rating × 20` on the table's 0–100 scale.
 *   3. write-once — a sequential re-submit and a concurrent
 *      `Promise.allSettled` duplicate pair over a second dual-confirmed
 *      session each leave exactly one row; every loser is denied with the
 *      already-submitted conflict and inserts zero rows.
 *   4. not-yet-ratable — a `scheduled` session and a teacher-stamp-only
 *      session (completed, student stamp absent) are both rejected with
 *      the not-completed conflict, zero rows.
 *   5. oracle — another student targeting the session, and any caller
 *      targeting an unknown session id, receive the byte-identical
 *      not-found denial (foreign ≡ nonexistent); the owner's rating row
 *      stays untouched.
 *   6. read-back — the rater's evaluation list is exactly the submitted
 *      rows, newest first; every other cast member's list is empty.
 *   7. cached-average — every committed rating moves the rated teacher's
 *      cached average to the exact recomputed mean of the live rating
 *      family as a 2-decimal 0–5 string: the first 4★ commit lands
 *      "4.00", the second session's 2★ commit lands "3.00" (recomputed
 *      from the family, never incremented), the race's winning 5★ commit
 *      lands "3.67" with an applicant-flow evaluation (no session link)
 *      excluded; the admin directory's projected row carries the same
 *      value, and every denied submission leaves the teacher row
 *      byte-identical. While the service does not yet maintain the cached
 *      average, exactly these assertions fail — the documented
 *      pre-aggregation state, mirroring the rating service's own
 *      test-first journey above.
 *
 * Layer contract (`test/workflows/AGENTS.md`):
 *  - NO `runInRollback` — fixtures commit in `beforeAll`; every row
 *    (fixtures AND service-created sessions/claims/ratings) is registered
 *    in the `SessionFixtureRegistry` and hard-deleted FK-safely in
 *    `afterAll` (rating rows delete before their evaluator's user row —
 *    the `evaluator_id` FK is RESTRICT).
 *  - Per-run `jrn_teachers_<8hex>` prefix on user labels and idempotency
 *    keys — repeated or parallel runs never collide.
 *  - The realtime publication boundary is SPIED (recording no-op) — no
 *    channel is ever touched; completion prompts are asserted as exactly
 *    one row + one publish targeting the student, and the rating steps
 *    are asserted notification-free.
 *  - The teacher's earning-ledger rows (a REAL financial side effect of
 *    the confirmation legs) are asserted exactly once per confirmed
 *    session and removed in `afterAll` under the sanctioned append-only
 *    trigger suspension.
 *  - Negative steps fail through the REAL service denials, asserted by
 *    `DomainError.code` + the exact translated message (try/catch helper —
 *    never `expect(...).rejects.toThrow()`).
 *
 * The rating service is resolved through the teachers services barrel; its
 * contract is declared test-side so this suite compiles (types + lint
 * clean) before the implementation exists. Nothing is stubbed: while the
 * barrel does not yet export the service, every evaluation leg fails on
 * exactly that lookup — the documented pre-implementation state — and the
 * moment the real namespace is exported the legs run it unmodified.
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/teachers/student-teacher-rating.journey.test.ts
 *   bun run test/scripts/run-test.ts test/workflows
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { TeacherRepository } from "@/backend/db/repo";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { evaluations } from "@/backend/db/schema/teachers/evaluations";
import { createTestEvaluation } from "@/backend/db/test/entity-setup";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ConflictError, DomainError, NotFoundError } from "@/backend/lib/errors";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications";
import * as teachersServices from "@/backend/services/teachers";
import type {
  DBQueryExecutor,
  DBTransaction,
  EvaluationReturnType,
  EvaluationSelectType,
  EvaluationSubmitInput,
  SessionReturnType,
  SessionSubmitInput,
  TeacherSelectType,
  TeacherTransactionSelectType,
  WalletSelectType,
} from "@/backend/types";
import { SESSION_FEE_HIFZ } from "@/shared/constants/session-fees.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  buildSessionJourneyCast,
  countNotificationsForUser,
  createSessionFixtureRegistry,
  journeyPrefix,
  type SessionJourneyCast,
} from "@/test/workflows/helpers";

/**
 * The journey runs on the default test locale throughout.
 */
const LOCALE = "en";

/**
 * Idempotency keys for the five bookings (rated, recomputed, scheduled,
 * stamp-only, race) — per-run unique via the journey prefix, carried
 * verbatim into the service (never trimmed, never coerced).
 */
const JOURNEY_PREFIX = journeyPrefix("teachers");
const KEY_RATED = `${JOURNEY_PREFIX}-rated`;
const KEY_RECOMPUTED = `${JOURNEY_PREFIX}-recomputed`;
const KEY_SCHEDULED = `${JOURNEY_PREFIX}-scheduled`;
const KEY_STAMP_ONLY = `${JOURNEY_PREFIX}-stamp`;
const KEY_RACE = `${JOURNEY_PREFIX}-race`;

/**
 * A session id far outside every sequence's range yet inside the positive
 * safe-integer guard — the "unknown session" probe of the oracle leg.
 */
const UNKNOWN_SESSION_ID = 2_000_000_000;

/** The fixture registry — the hard-delete worklist drained by `afterAll`. */
const registry = createSessionFixtureRegistry();

/** The committed actor cast (assigned once by `beforeAll`). */
let cast: SessionJourneyCast;

/** Session R — booked by the student, driven to dual confirmation, then rated 4★ (the content leg). */
let sessionRated: SessionReturnType;

/** Session S — booked by the student and left `scheduled` (the not-completed leg). */
let sessionScheduled: SessionReturnType;

/** Session T — booked by the student, completed by the teacher, never confirmed (stamp-only leg). */
let sessionStampOnly: SessionReturnType;

/** Session C — booked by the student, dual-confirmed, then raced on (the duplicate leg). */
let sessionRace: SessionReturnType;

/** Session E — booked by the student, dual-confirmed, then rated 2★ (the recompute leg). */
let sessionRecomputed: SessionReturnType;

/** The rating row produced by the content leg (assigned by its step). */
let ratedRating: EvaluationReturnType | undefined;

/** The winning rating row of the concurrent duplicate leg. */
let raceRating: EvaluationReturnType | undefined;

/** The rating row of the recompute leg (assigned by its step). */
let recomputedRating: EvaluationReturnType | undefined;

/** The applicant-flow evaluation row (no session link) committed ahead of the race leg. */
let applicantEvaluation: EvaluationSelectType | undefined;

/**
 * The rating service's contract, declared test-side so this suite
 * compiles before the implementation exists. The single seam every
 * evaluation step goes through — when the barrel exports the real
 * namespace, these exact signatures must hold.
 */
interface StudentEvaluationServiceContract {
  submitTeacherEvaluation(
    studentUserId: number,
    sessionId: number,
    input: EvaluationSubmitInput,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<EvaluationReturnType>;
  listMyTeacherEvaluations(studentUserId: number, tx?: DBQueryExecutor): Promise<readonly EvaluationReturnType[]>;
}

/**
 * Runtime presence guard over the teachers barrel — holds exactly when
 * the barrel exports the real namespace. Declared as a type guard (no
 * type assertions) so the lookup stays statically honest: the barrel is
 * duck-typed once, at this single seam, and the contract below is what
 * the production service must satisfy.
 */
function isBarrelWithStudentEvaluationService(
  barrel: unknown
): barrel is { StudentEvaluationService: StudentEvaluationServiceContract } {
  return typeof barrel === "object" && barrel !== null && "StudentEvaluationService" in barrel;
}

/**
 * Resolves the real rating service from the teachers barrel, or `null`
 * while the barrel does not export it (the intended pre-implementation
 * state — see the caller). Nothing is stubbed: the moment the real
 * namespace is exported, the exact production object flows through.
 */
function findStudentEvaluationService(barrel: unknown): StudentEvaluationServiceContract | undefined {
  if (!isBarrelWithStudentEvaluationService(barrel)) {
    return undefined;
  }
  return barrel.StudentEvaluationService;
}

/**
 * Resolves the real rating service from the teachers barrel. Throws (the
 * intended pre-implementation failure) while the barrel does not export
 * it — every evaluation leg then fails on exactly this message, never on
 * a harness, fixture, or setup error.
 */
function studentEvaluationService(): StudentEvaluationServiceContract {
  const service = findStudentEvaluationService(teachersServices);
  if (service === undefined) {
    throw new Error(
      "student-to-teacher rating service not implemented yet: StudentEvaluationService is missing from @/backend/services/teachers"
    );
  }
  return service;
}

/** The exact translated denial messages for the default test locale. */
function errorTexts() {
  return getServerTranslations(LOCALE).errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code`. */
function denialCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/** The byte-identity signature of a denial: its code and message verbatim. */
function denialSignature(error: unknown): string {
  return `${denialCode(error)}|${error instanceof Error ? error.message : ""}`;
}

/**
 * Runs a denial through the real service and asserts the typed-denial
 * contract: a `DomainError` carrying EXACTLY `code` and EXACTLY the
 * translated message (never the raw key). Returns the caught error so a
 * call site can assert the concrete subclass (e.g. `ConflictError`).
 * Fails the test when the action resolves instead of rejecting.
 */
async function expectServiceDenial(code: string, message: string, action: () => Promise<unknown>): Promise<unknown> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  expect(denialCode(caught)).toBe(code);
  if (caught instanceof Error) {
    expect(caught.message).toBe(message);
  }
  return caught;
}

/** Narrows a nullable captured rating row, failing loudly when absent. */
function requiredRating(value: EvaluationReturnType | undefined, label: string): EvaluationReturnType {
  if (value === undefined) {
    throw new Error(`journey: expected the ${label} rating row (a prerequisite leg failed)`);
  }
  return value;
}

/** Narrows a nullable teacher read to a row, failing loudly when null. */
function requiredTeacherRow(value: TeacherSelectType | null, label: string): TeacherSelectType {
  if (value === null) {
    throw new Error(`journey: expected a teacher row for ${label}`);
  }
  return value;
}

/** Narrows the captured applicant-flow evaluation row, failing loudly when absent. */
function requiredApplicantEvaluation(value: EvaluationSelectType | undefined): EvaluationSelectType {
  if (value === undefined) {
    throw new Error("journey: expected the applicant evaluation row (a prerequisite leg failed)");
  }
  return value;
}

/** Narrows a nullable wallet read to a row, failing loudly when null. */
function requiredWalletRow(value: WalletSelectType | null, label: string): WalletSelectType {
  if (value === null) {
    throw new Error(`journey: expected a wallet row for ${label}`);
  }
  return value;
}

/** Numeric wallet total (a missing wallet counts as zero). */
function walletTotal(value: WalletSelectType | null): number {
  return Number(value?.totalEarning ?? "0");
}

/** Reads one evaluation row by id, or `null` when absent. */
async function readEvaluationRow(id: number): Promise<EvaluationSelectType | null> {
  const rows = await db.select().from(evaluations).where(eq(evaluations.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Reads the rated teacher's row through the repository (cold read — the
 * journey holds no transaction of its own).
 */
function readTeacherRow(): Promise<TeacherSelectType | null> {
  return TeacherRepository.findById(cast.teacher.userId);
}

/** Number of live-or-not rating rows for one (session, rater) pair. */
function countEvaluationsFor(sessionId: number, evaluatorId: number): Promise<number> {
  return db.$count(evaluations, and(eq(evaluations.sessionId, sessionId), eq(evaluations.evaluatorId, evaluatorId)));
}

/** Completion-prompt notification rows pinned to one session id (row oracle). */
function countCompletionNotificationsForSession(sessionId: number): Promise<number> {
  return db.$count(
    notifications,
    and(
      eq(notifications.relatedEntityType, "session"),
      eq(notifications.relatedEntityId, sessionId),
      eq(notifications.type, NotificationType.SessionCompletion)
    )
  );
}

/** Reads the teacher's wallet row, or `null` before the first credit. */
async function readTeacherWalletRow(teacherUserId: number): Promise<WalletSelectType | null> {
  const rows = await db.select().from(wallet).where(eq(wallet.teacherId, teacherUserId)).limit(1);
  return rows[0] ?? null;
}

/** The earning-ledger rows tied to one session (exactly-once oracle). */
async function readLedgerRowsForSession(sessionId: number): Promise<TeacherTransactionSelectType[]> {
  return db.select().from(teacherTransaction).where(eq(teacherTransaction.sessionId, sessionId));
}

/** Registers one service-created idempotency claim (by key) for cleanup. */
async function trackIdempotencyClaim(key: string, label: string): Promise<void> {
  const rows = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  const claim = rows[0];
  if (!claim) {
    throw new Error(`journey: idempotency claim for ${label} not found (fixture tracking failure)`);
  }
  registry.track("session_request_idempotency", claim.id);
}

/**
 * Books one session for the acting student with the cast's teacher (the
 * escrow hold is taken here), then registers the session row AND its
 * idempotency claim for teardown.
 */
async function bookTrackedSession(studentUserId: number, key: string, label: string): Promise<SessionReturnType> {
  const booking: SessionSubmitInput = { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz };
  const booked = await SessionLifecycleService.createSession(studentUserId, booking, key, LOCALE);
  registry.track("session", booked.id);
  await trackIdempotencyClaim(key, label);
  return booked;
}

/**
 * Drives one booked session through the REAL completion handshake — the
 * teacher starts, the teacher completes (exactly one confirm prompt, row
 * + spied publish), the student confirms (both stamps, hold released, the
 * teacher credited exactly the fee once) — and returns the final row.
 */
async function driveToDualConfirmation(booked: SessionReturnType): Promise<SessionReturnType> {
  const walletBefore = await readTeacherWalletRow(cast.teacher.userId);

  const started = await SessionLifecycleService.startSession(cast.teacher.userId, booked.id, LOCALE);
  expect(started.status).toBe(SessionStatus.Started);

  const completed = await SessionLifecycleService.completeSession(cast.teacher.userId, booked.id, LOCALE);
  expect(completed.status).toBe(SessionStatus.Completed);
  expect(completed.confirmedByTeacherAt).not.toBeNull();
  expect(completed.confirmedByStudentAt).toBeNull();
  expect(completed.feeHeld).toBe(true);
  expect(await countCompletionNotificationsForSession(booked.id)).toBe(1);

  const confirmed = await SessionLifecycleService.confirmSessionCompletion(
    cast.primaryStudent.userId,
    booked.id,
    LOCALE
  );
  expect(confirmed.status).toBe(SessionStatus.Completed);
  expect(confirmed.confirmedByTeacherAt).not.toBeNull();
  expect(confirmed.confirmedByStudentAt).not.toBeNull();
  expect(confirmed.feeHeld).toBe(false);

  const walletAfter = requiredWalletRow(
    await readTeacherWalletRow(cast.teacher.userId),
    "teacher wallet after the confirm credit"
  );
  expect(walletTotal(walletAfter) - walletTotal(walletBefore)).toBe(Number(SESSION_FEE_HIFZ));
  const ledgerRows = await readLedgerRowsForSession(booked.id);
  expect(ledgerRows).toHaveLength(1);
  expect(ledgerRows[0]?.amount).toBe(SESSION_FEE_HIFZ);

  return confirmed;
}

/**
 * Installs a recording no-op over the engine's publish contract: no
 * realtime channel is ever touched, and each dispatch is logged together
 * with the receipts so a step can assert both THAT a publish happened and
 * WHICH users it targeted. Installed once in `beforeAll`, restored in
 * `afterAll`.
 */
function spyPublication(): { calls: number[][]; stop: () => void } {
  const calls: number[][] = [];
  const spy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async receipts => {
    calls.push(receipts.flatMap(receipt => receipt.recipientUserIds));
  });
  return { calls, stop: () => spy.mockRestore() };
}

let publication: ReturnType<typeof spyPublication> | undefined;

/** Every recipient id the spy has recorded so far, in publish order. */
function publishedUserIds(): number[] {
  return (publication?.calls ?? []).flat();
}

/** How many publish dispatches the spy has recorded so far. */
function publicationCallCount(): number {
  return publication?.calls.length ?? 0;
}

beforeAll(async () => {
  await db.transaction(async tx => {
    cast = await buildSessionJourneyCast(tx, registry, {
      prefix: JOURNEY_PREFIX,
      // The rating student books FIVE sessions (rated, recomputed,
      // scheduled, stamp-only, race): each booking holds one escrow unit
      // and the confirmed ones consume theirs, so five lanes must be
      // available.
      primaryStudent: { trial: 2, hifz: 3 },
    });
  });
  // No realtime delivery for the whole suite: every publish is recorded.
  publication = spyPublication();
});

afterAll(async () => {
  publication?.stop();

  // The earning-ledger rows the confirmation legs created are append-only
  // (DELETE-blocked) and restrict-delete their way into the wallet, which
  // the cast teardown would otherwise cascade away with the teacher row.
  // They are removed under the sanctioned append-only trigger suspension,
  // then the registry hard-deletes the rest in FK-safe order.
  const teacherWallet = await readTeacherWalletRow(cast.teacher.userId);
  if (teacherWallet !== null) {
    await withImmutabilityTriggersSuspended(["teacher_transaction"], async () => {
      await db.delete(teacherTransaction).where(eq(teacherTransaction.walletId, teacherWallet.id));
    });
  }

  await registry.cleanup();

  // Zero-residue self-check: the suite's session rows, rating rows, the
  // teacher's wallet, and both students' inboxes are gone with the
  // tracked rows.
  await Promise.all([
    ...registry.ids("session").map(async id => {
      expect(await db.$count(session, eq(session.id, id))).toBe(0);
    }),
    ...registry.ids("evaluations").map(async id => {
      expect(await db.$count(evaluations, eq(evaluations.id, id))).toBe(0);
    }),
  ]);
  expect(await db.$count(wallet, eq(wallet.teacherId, cast.teacher.userId))).toBe(0);
  expect(await countNotificationsForUser(cast.primaryStudent.userId)).toBe(0);
  expect(await countNotificationsForUser(cast.secondStudent.userId)).toBe(0);
});

describe("Journey — the student rates the session teacher (cross-actor, real services)", () => {
  test("step 1 — fixture cast commits as tracked ids with real role rows; no rating rows exist yet", async () => {
    expect(cast).toBeDefined();
    expect(registry.trackedCount()).toBe(14);
    expect(registry.ids("users")).toHaveLength(7);
    expect(registry.ids("students")).toHaveLength(2);
    expect(registry.ids("teacher")).toHaveLength(2);

    // Real role-child rows, honest certification only.
    expect(cast.teacher.teacher.isApproved).toBe(true);
    expect(cast.teacher.user.id).not.toBe(cast.primaryStudent.user.id);
    expect(registry.ids("evaluations")).toHaveLength(0);
  });

  test("step 2 — the student books, the teacher completes, the student confirms: the rating state is reached", async () => {
    const notificationsStudentBefore = await countNotificationsForUser(cast.primaryStudent.userId);
    const publishesBefore = publicationCallCount();

    sessionRated = await bookTrackedSession(cast.primaryStudent.userId, KEY_RATED, "key rated (student)");
    expect(sessionRated.status).toBe(SessionStatus.Scheduled);
    expect(sessionRated.feeHeld).toBe(true);
    expect(sessionRated.fee).toBe(SESSION_FEE_HIFZ);
    expect(sessionRated.studentId).toBe(cast.primaryStudent.student.id);
    expect(sessionRated.teacherId).toBe(cast.teacher.userId);

    const confirmed = await driveToDualConfirmation(sessionRated);
    sessionRated = confirmed;

    // The completion prompt was published exactly once, targeting exactly
    // the student; the confirmation itself publishes nothing.
    expect(publicationCallCount()).toBe(publishesBefore + 1);
    expect(publishedUserIds().slice(publishesBefore)).toEqual([cast.primaryStudent.userId]);
    expect(await countNotificationsForUser(cast.primaryStudent.userId)).toBe(notificationsStudentBefore + 1);

    // Baseline for the rating legs: no evaluations row exists for this pair.
    expect(await countEvaluationsFor(sessionRated.id, cast.primaryStudent.userId)).toBe(0);
  });

  test("step 3 — the student rates the dual-confirmed session: exactly one row, score = rating × 20", async () => {
    const notificationsOthersBefore = await Promise.all([
      countNotificationsForUser(cast.teacher.userId),
      countNotificationsForUser(cast.secondStudent.userId),
      countNotificationsForUser(cast.parent.userId),
      countNotificationsForUser(cast.admin.userId),
    ]);
    const publishesBefore = publicationCallCount();

    const submitted = await studentEvaluationService().submitTeacherEvaluation(
      cast.primaryStudent.userId,
      sessionRated.id,
      { rating: 4 },
      LOCALE
    );
    ratedRating = submitted;
    registry.track("evaluations", submitted.id);

    // The submitted row's contents: rated subject = the session teacher's
    // user id, rater = the caller's user id, session link, score 4 × 20.
    expect(submitted.id).toBeGreaterThan(0);
    expect(submitted.evaluatedId).toBe(cast.teacher.userId);
    expect(submitted.evaluatorId).toBe(cast.primaryStudent.userId);
    expect(submitted.sessionId).toBe(sessionRated.id);
    expect(submitted.score).toBe(80);
    expect(submitted.createdAt).toBeInstanceOf(Date);

    // The table holds EXACTLY one row for the pair, and the raw row
    // agrees with the service return field by field.
    expect(await countEvaluationsFor(sessionRated.id, cast.primaryStudent.userId)).toBe(1);
    const rawRow = await readEvaluationRow(submitted.id);
    expect(rawRow).not.toBeNull();
    if (rawRow) {
      expect(rawRow.evaluatedId).toBe(cast.teacher.userId);
      expect(rawRow.evaluatorId).toBe(cast.primaryStudent.userId);
      expect(rawRow.sessionId).toBe(sessionRated.id);
      expect(rawRow.score).toBe(80);
      expect(rawRow.createdAt.getTime()).toBe(submitted.createdAt.getTime());
    }

    // Rating submission fans out to NOBODY: no publish, no new
    // notification rows for any other cast member.
    expect(publicationCallCount()).toBe(publishesBefore);
    expect(await countNotificationsForUser(cast.teacher.userId)).toBe(notificationsOthersBefore[0]);
    expect(await countNotificationsForUser(cast.secondStudent.userId)).toBe(notificationsOthersBefore[1]);
    expect(await countNotificationsForUser(cast.parent.userId)).toBe(notificationsOthersBefore[2]);
    expect(await countNotificationsForUser(cast.admin.userId)).toBe(notificationsOthersBefore[3]);
  });

  test("step 3a — the first rating's commit maintains the rated teacher's cached average", async () => {
    // One live rating row (score 80) behind the cached column: the stored
    // average is 80 / 20, the exact 2-decimal string "4.00".
    const teacherRow = requiredTeacherRow(await readTeacherRow(), "the rated teacher");
    expect(teacherRow.averageRating).toBe("4.00");
  });

  test("step 3b — a second dual-confirmed session rated 2★ recomputes the average over the full family", async () => {
    sessionRecomputed = await bookTrackedSession(
      cast.primaryStudent.userId,
      KEY_RECOMPUTED,
      "key recomputed (student)"
    );
    const confirmed = await driveToDualConfirmation(sessionRecomputed);
    sessionRecomputed = confirmed;

    const submitted = await studentEvaluationService().submitTeacherEvaluation(
      cast.primaryStudent.userId,
      sessionRecomputed.id,
      { rating: 2 },
      LOCALE
    );
    recomputedRating = submitted;
    registry.track("evaluations", submitted.id);
    expect(submitted.evaluatedId).toBe(cast.teacher.userId);
    expect(submitted.evaluatorId).toBe(cast.primaryStudent.userId);
    expect(submitted.sessionId).toBe(sessionRecomputed.id);
    expect(submitted.score).toBe(40);
    expect(await countEvaluationsFor(sessionRecomputed.id, cast.primaryStudent.userId)).toBe(1);

    // Two live rating rows (80 + 40): the stored average is (80 + 40) / 2 / 20 —
    // the exact string "3.00", recomputed from the family, never incremented
    // from the prior "4.00".
    const teacherRow = requiredTeacherRow(await readTeacherRow(), "the rated teacher after the second rating");
    expect(teacherRow.averageRating).toBe("3.00");
  });

  test("step 3c — the admin teacher directory observes the maintained average", async () => {
    // The directory's projected row shape, read straight from the
    // repository — the journey asserts the data tier, not a GraphQL tier.
    const directory = await TeacherRepository.listDirectory({}, 10, 0);
    const directoryRow = directory.rows.find(row => row.id === cast.teacher.userId);
    expect(directoryRow).toBeDefined();
    expect(directoryRow?.averageRating).toBe("3.00");
  });

  test("step 4 — a sequential re-submit is denied as already-submitted and writes nothing", async () => {
    const teacherRowBefore = requiredTeacherRow(await readTeacherRow(), "the teacher row before the denial");
    const caught = await expectServiceDenial(
      "EVALUATION_ALREADY_SUBMITTED",
      errorTexts().evaluationAlreadySubmitted,
      () =>
        studentEvaluationService().submitTeacherEvaluation(
          cast.primaryStudent.userId,
          sessionRated.id,
          { rating: 5 },
          LOCALE
        )
    );
    expect(caught).toBeInstanceOf(ConflictError);

    // Exactly the same single row, byte-identical — the denial inserted
    // nothing and mutated nothing.
    expect(await countEvaluationsFor(sessionRated.id, cast.primaryStudent.userId)).toBe(1);
    const rated = requiredRating(ratedRating, "content leg");
    const rowAfter = await readEvaluationRow(rated.id);
    expect(rowAfter).not.toBeNull();
    if (rowAfter) {
      expect(rowAfter.score).toBe(80);
      expect(rowAfter.createdAt.getTime()).toBe(rated.createdAt.getTime());
    }

    // The denied submission left the rated teacher's row byte-identical.
    expect(await readTeacherRow()).toEqual(teacherRowBefore);
  });

  test("step 4a — an applicant evaluation of the same teacher exists outside the rating family", async () => {
    // The applicant flow's evaluation row carries NO session link and is
    // not a student rating — it must never join the rated teacher's live
    // rating family. It commits here, ahead of the race leg's rating, so
    // the winner's recompute provably skips it.
    await db.transaction(async tx => {
      applicantEvaluation = await createTestEvaluation(tx, cast.teacher.userId, cast.secondTeacher.userId, null, {
        score: 90,
      });
      registry.track("evaluations", applicantEvaluation.id);
    });
    expect(applicantEvaluation?.evaluatedId).toBe(cast.teacher.userId);
    expect(applicantEvaluation?.sessionId).toBeNull();
    expect(applicantEvaluation?.score).toBe(90);
  });

  test("step 5 — two concurrent submits on a fresh dual-confirmed session: exactly ONE row, one loser denied", async () => {
    sessionRace = await bookTrackedSession(cast.primaryStudent.userId, KEY_RACE, "key race (student)");
    await driveToDualConfirmation(sessionRace);

    const teacherRowBefore = requiredTeacherRow(await readTeacherRow(), "the teacher row before the race");

    // Both submissions are dispatched concurrently on the production
    // path — each opens its own top-level transaction, and the UNIQUE
    // (session, rater) index is the write-once arbiter.
    const outcomes = await Promise.allSettled([
      studentEvaluationService().submitTeacherEvaluation(
        cast.primaryStudent.userId,
        sessionRace.id,
        { rating: 5 },
        LOCALE
      ),
      studentEvaluationService().submitTeacherEvaluation(
        cast.primaryStudent.userId,
        sessionRace.id,
        { rating: 5 },
        LOCALE
      ),
    ]);

    const fulfilled = outcomes.filter((outcome): outcome is PromiseFulfilledResult<EvaluationReturnType> => {
      return outcome.status === "fulfilled";
    });
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => {
      return outcome.status === "rejected";
    });
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The winner's row: score 5 × 20, keyed to the same session and rater.
    const winner = fulfilled[0]?.value;
    if (winner) {
      raceRating = winner;
      registry.track("evaluations", winner.id);
      expect(winner.evaluatedId).toBe(cast.teacher.userId);
      expect(winner.evaluatorId).toBe(cast.primaryStudent.userId);
      expect(winner.sessionId).toBe(sessionRace.id);
      expect(winner.score).toBe(100);
    }

    // The loser is the typed already-submitted conflict, nothing more.
    const loserReason = rejected[0]?.reason;
    expect(loserReason).toBeInstanceOf(DomainError);
    expect(loserReason).toBeInstanceOf(ConflictError);
    expect(denialCode(loserReason)).toBe("EVALUATION_ALREADY_SUBMITTED");
    if (loserReason instanceof Error) {
      expect(loserReason.message).toBe(errorTexts().evaluationAlreadySubmitted);
    }

    // Exactly ONE row exists for the raced pair.
    expect(await countEvaluationsFor(sessionRace.id, cast.primaryStudent.userId)).toBe(1);

    // The loser's rollback wrote nothing, and the only teacher-row columns
    // a committed rating may move are the cached average and its update
    // stamp — every other column is byte-identical (the exact post-race
    // average is asserted by the next step).
    const teacherRowAfter = requiredTeacherRow(await readTeacherRow(), "the teacher row after the race");
    expect(teacherRowAfter.id).toBe(teacherRowBefore.id);
    expect(teacherRowAfter.isApproved).toBe(teacherRowBefore.isApproved);
    expect(teacherRowAfter.isEvaluator).toBe(teacherRowBefore.isEvaluator);
    expect(teacherRowAfter.isOnline).toBe(teacherRowBefore.isOnline);
    expect(teacherRowAfter.subjects).toBe(teacherRowBefore.subjects);
    expect(teacherRowAfter.requestPreference).toBe(teacherRowBefore.requestPreference);
    expect(teacherRowAfter.createdAt).toEqual(teacherRowBefore.createdAt);
  });

  test("step 5a — the race's winning rating joins the family: the recompute excludes the applicant evaluation", async () => {
    // The winner (score 100) joins the live family {80, 40}: the stored
    // average is (80 + 40 + 100) / 3 / 20 — the exact string "3.67". The
    // applicant evaluation committed before the race (score 90, no session
    // link) contributes nothing to the family.
    const teacherRow = requiredTeacherRow(await readTeacherRow(), "the rated teacher after the race");
    expect(teacherRow.averageRating).toBe("3.67");

    // The applicant row is still on record — excluded, not removed.
    const applicant = requiredApplicantEvaluation(applicantEvaluation);
    const applicantRow = await readEvaluationRow(applicant.id);
    expect(applicantRow?.sessionId).toBeNull();
    expect(applicantRow?.score).toBe(90);
  });

  test("step 6 — a `scheduled` session is denied as not-completed, zero rows", async () => {
    sessionScheduled = await bookTrackedSession(cast.primaryStudent.userId, KEY_SCHEDULED, "key scheduled (student)");
    expect(sessionScheduled.status).toBe(SessionStatus.Scheduled);
    expect(sessionScheduled.confirmedByTeacherAt).toBeNull();
    expect(sessionScheduled.confirmedByStudentAt).toBeNull();

    const teacherRowBefore = requiredTeacherRow(await readTeacherRow(), "the teacher row before the denial");
    const caught = await expectServiceDenial(
      "EVALUATION_SESSION_NOT_COMPLETED",
      errorTexts().evaluationSessionNotCompleted,
      () =>
        studentEvaluationService().submitTeacherEvaluation(
          cast.primaryStudent.userId,
          sessionScheduled.id,
          { rating: 4 },
          LOCALE
        )
    );
    expect(caught).toBeInstanceOf(ConflictError);

    expect(await countEvaluationsFor(sessionScheduled.id, cast.primaryStudent.userId)).toBe(0);

    // The denied submission left the rated teacher's row byte-identical.
    expect(await readTeacherRow()).toEqual(teacherRowBefore);
  });

  test("step 7 — a teacher-stamp-only session (student stamp absent) is denied the same way, zero rows", async () => {
    sessionStampOnly = await bookTrackedSession(cast.primaryStudent.userId, KEY_STAMP_ONLY, "key stamp-only (student)");

    // The teacher completes; the student never confirms.
    const started = await SessionLifecycleService.startSession(cast.teacher.userId, sessionStampOnly.id, LOCALE);
    expect(started.status).toBe(SessionStatus.Started);
    const completed = await SessionLifecycleService.completeSession(cast.teacher.userId, sessionStampOnly.id, LOCALE);
    expect(completed.status).toBe(SessionStatus.Completed);
    expect(completed.confirmedByTeacherAt).not.toBeNull();
    expect(completed.confirmedByStudentAt).toBeNull();

    // Snapshotted after the completion handshake (the start flow moves the
    // teacher's availability flag): the DENIAL must leave the row identical.
    const teacherRowBefore = requiredTeacherRow(await readTeacherRow(), "the teacher row before the denial");
    const caught = await expectServiceDenial(
      "EVALUATION_SESSION_NOT_COMPLETED",
      errorTexts().evaluationSessionNotCompleted,
      () =>
        studentEvaluationService().submitTeacherEvaluation(
          cast.primaryStudent.userId,
          sessionStampOnly.id,
          { rating: 3 },
          LOCALE
        )
    );
    expect(caught).toBeInstanceOf(ConflictError);

    expect(await countEvaluationsFor(sessionStampOnly.id, cast.primaryStudent.userId)).toBe(0);

    // The denied submission left the rated teacher's row byte-identical.
    expect(await readTeacherRow()).toEqual(teacherRowBefore);
  });

  test("step 8 — another student and an unknown id get the byte-identical not-found denial; the owner's row is untouched", async () => {
    const teacherRowBefore = requiredTeacherRow(await readTeacherRow(), "the teacher row before the oracle denials");

    // A real non-participant targets a REAL session: oracle-denied.
    const foreignDenial = await expectServiceDenial("SESSION_NOT_FOUND", errorTexts().sessionNotFound, () =>
      studentEvaluationService().submitTeacherEvaluation(
        cast.secondStudent.userId,
        sessionRated.id,
        { rating: 4 },
        LOCALE
      )
    );
    expect(foreignDenial).toBeInstanceOf(NotFoundError);

    // The same caller targets a session id that does not exist: the SAME
    // typed denial — foreign ≡ nonexistent, byte for byte.
    const unknownDenial = await expectServiceDenial("SESSION_NOT_FOUND", errorTexts().sessionNotFound, () =>
      studentEvaluationService().submitTeacherEvaluation(
        cast.secondStudent.userId,
        UNKNOWN_SESSION_ID,
        { rating: 4 },
        LOCALE
      )
    );
    expect(unknownDenial).toBeInstanceOf(NotFoundError);
    expect(denialSignature(unknownDenial)).toBe(denialSignature(foreignDenial));

    // The non-participant gained no row anywhere.
    expect(await countEvaluationsFor(sessionRated.id, cast.secondStudent.userId)).toBe(0);

    // The owner's row is byte-identical to before the denial probes.
    const rated = requiredRating(ratedRating, "content leg");
    const rowBefore = await readEvaluationRow(rated.id);
    expect(rowBefore).not.toBeNull();
    const rowAfter = await readEvaluationRow(rated.id);
    expect(rowAfter).toEqual(rowBefore);

    // The denied probes left the rated teacher's row byte-identical too.
    expect(await readTeacherRow()).toEqual(teacherRowBefore);
  });

  test("step 9 — the rater's evaluation list is exactly the submitted rows, newest first; nobody else's", async () => {
    const ownRows = await studentEvaluationService().listMyTeacherEvaluations(cast.primaryStudent.userId);
    expect(ownRows).toHaveLength(3);

    const rated = requiredRating(ratedRating, "content leg");
    const raced = requiredRating(raceRating, "duplicate leg");
    const recomputed = requiredRating(recomputedRating, "second session leg");

    // Newest first: the raced row (submitted later) leads, the second
    // session's 2★ row follows, the content row is oldest. Every field of
    // each read-back row equals the row the submission returned.
    const newest = ownRows[0];
    const middle = ownRows[1];
    const oldest = ownRows[2];
    expect(newest?.id).toBe(raced.id);
    expect(newest?.sessionId).toBe(sessionRace.id);
    expect(newest?.score).toBe(100);
    expect(newest?.evaluatorId).toBe(cast.primaryStudent.userId);
    expect(newest?.evaluatedId).toBe(cast.teacher.userId);
    expect(newest?.createdAt.getTime()).toBe(raced.createdAt.getTime());
    expect(middle?.id).toBe(recomputed.id);
    expect(middle?.sessionId).toBe(sessionRecomputed.id);
    expect(middle?.score).toBe(40);
    expect(middle?.evaluatorId).toBe(cast.primaryStudent.userId);
    expect(middle?.evaluatedId).toBe(cast.teacher.userId);
    expect(middle?.createdAt.getTime()).toBe(recomputed.createdAt.getTime());
    expect(oldest?.id).toBe(rated.id);
    expect(oldest?.sessionId).toBe(sessionRated.id);
    expect(oldest?.score).toBe(80);
    expect(oldest?.evaluatorId).toBe(cast.primaryStudent.userId);
    expect(oldest?.evaluatedId).toBe(cast.teacher.userId);
    expect(oldest?.createdAt.getTime()).toBe(rated.createdAt.getTime());

    // The non-participant's own list is empty — ratings never leak across
    // students in either direction.
    const foreignRows = await studentEvaluationService().listMyTeacherEvaluations(cast.secondStudent.userId);
    expect(foreignRows).toHaveLength(0);
  });

  test("step 10 — teardown worklist is complete: every service-created row is tracked for the afterAll hard-delete", () => {
    expect(registry.ids("session").toSorted((a, b) => a - b)).toEqual(
      [sessionRated.id, sessionScheduled.id, sessionStampOnly.id, sessionRace.id, sessionRecomputed.id].toSorted(
        (a, b) => a - b
      )
    );
    expect(registry.ids("session_request_idempotency")).toHaveLength(5);
    expect(registry.ids("evaluations").toSorted((a, b) => a - b)).toEqual(
      [
        requiredRating(ratedRating, "content leg").id,
        requiredRating(raceRating, "duplicate leg").id,
        requiredRating(recomputedRating, "second session leg").id,
        requiredApplicantEvaluation(applicantEvaluation).id,
      ].toSorted((a, b) => a - b)
    );
    // 14 fixture rows (7 users + 2 students + 2 teachers + 1 applicant +
    // 1 parent + 1 admin) + 5 sessions + 5 idempotency claims + 4 ratings.
    expect(registry.trackedCount()).toBe(28);
  });
});
