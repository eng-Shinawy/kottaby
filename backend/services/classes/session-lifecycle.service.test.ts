/**
 * SessionLifecycleService tests — the booking + lifecycle state machine
 * (`createSession`, `startSession`, `completeSession`, `cancelSession`,
 * `openSessionDispute`, `resolveSessionDispute`, `getSessionById`, the
 * participant list pair, and the admin disputed listing) against the live
 * `kottaby_test_db` PostgreSQL instance, on REAL repositories.
 *
 * Per `backend/db/test/AGENTS.md` (the DB-backed service-test rules the
 * sibling suites apply):
 *  - Every transactional case runs inside `runInRollback`; `tx` (or
 *    `outerTx`) is propagated to EVERY service call so the flow executes on
 *    the caller's transaction (the service's documented test path — a
 *    SAVEPOINT on it, released or rolled back per outcome).
 *  - Entities are created ONLY via `entity-setup.ts` helpers plus the
 *    file-local shared-PK helpers — never seed data. The journey-cast
 *    builders under `test/workflows/helpers/` are committed-journey
 *    infrastructure (registry + hard-delete cleanup) and do not fit the
 *    rollback model; the chaos block mirrors the repo-suite committed-
 *    fixture pattern instead (beforeAll commit, afterAll hard delete).
 *  - NO `expect(...).rejects.toThrow()` — every denial goes through
 *    `expectRepoError` (try/catch); typed denials are asserted through the
 *    `DomainError.code` contract plus the exact translated message.
 *
 * Coverage map:
 *  - Tier 1 (branch/statement): every debit-ladder branch (trial hit, hifz
 *    hit, tajweed hit, total miss → `INSUFFICIENT_BALANCE` with zero rows
 *    and a still-reusable key); every probe-classification branch on
 *    start/complete/cancel/dispute (unknown id and foreign actor →
 *    `SESSION_NOT_FOUND`, wrong state → `SESSION_INVALID_TRANSITION`,
 *    owned+started completion with a decertified teacher →
 *    `TEACHER_NOT_CERTIFIED`); the participant list enrichment (the page
 *    rows batch-stamp the counterpart display name through ONE
 *    `listNamesByIds` membership read; the empty page answers without the
 *    names read at all); the replay branch (same key →
 *    `DUPLICATE_REQUEST` conflict whose rollback leaves zero new rows and
 *    zero second debit; foreign-key owner → oracle-safe
 *    `SESSION_NOT_FOUND`); every pre-DB validation guard (empty/129-char
 *    key, non-safe-integer ids, `intent=evaluation` with a zero-writes
 *    proof); governance re-check denials (`FORBIDDEN`) on create/start/
 *    complete with cancel deliberately EXEMPT (a governed student can
 *    still release an in-flight hold); teacher-lock branches (missing
 *    teacher → `TEACHER_NOT_FOUND`, unapproved/null-certification →
 *    `TEACHER_NOT_CERTIFIED`); oracle-safe read branches; the dispute
 *    pair (participant open from both live states with the hold frozen;
 *    admin arbitration over both outcomes with the role re-check).
 *  - Tier 2 (boundary): confirmation deadline = captured now +
 *    86_400_000 ms EXACTLY (bracketed); fee "25.00" decimal STRING per
 *    intent; cancel reason 500 chars accepted-and-persisted (trim-
 *    normalized), 501 rejected; dispute reason empty/whitespace/501
 *    rejected pre-DB; arbitration note trims to NULL when whitespace-only;
 *    idempotency key EXACTLY 128 chars accepted verbatim; pagination
 *    boundaries (page 1, pageSize 1 and 50, out-of-range page/size
 *    normalized to 1/25 per the implemented contract, out-of-vocabulary
 *    filter drops out); held-balance provenance (Trial when the trial lane
 *    won, paid lane when the trial lane was empty); the admin listing's
 *    limit clamp (1..50 default 25) with the honest page echo.
 *  - Tier 3 (rollback-path chaos): REQ-040 forced session-insert failure
 *    (a file-local trigger raises mid-flow) → ZERO rows in `session`,
 *    the claim table, and the students lane delta, and the key is
 *    REUSABLE; REQ-042 double-cancel refunds EXACTLY once (second cancel
 *    → `SESSION_INVALID_TRANSITION`, balance unchanged). The concurrency
 *    chaos lives in the committed-fixture block below.
 *  - Tier 4 (typed denials + source pins): every denial carries the exact
 *    `DomainError.code` and the localized message; `intent=evaluation`
 *    never reaches the DB (zero writes proof); grep-level pins — the
 *    service unit's imports are a pinned allowlist whose ONLY cross-surface
 *    channels are the wallet-credit slice (repository barrel), the
 *    engine-mediated waves (the wave-emitter sibling plus the notification
 *    engine's publish contract; the unit never imports a notification
 *    repository and every notification row is written BY THE ENGINE inside
 *    the owning transaction — the booking's teacher intake wave, the
 *    completion prompt, and the sweeper's auto-cancel notice),
 *    and the arbitration's audit trail row (the shared append-only audit
 *    writer plus the enum that names the Override verb), plus the settled
 *    arm's curriculum-progress advance (the progress service composed
 *    inside the confirmation transaction, after the credit) — and the unit
 *    holds zero `console.*` calls.
 *
 * Completion-handshake composition (the confirm prompt + the two-leg
 * sweeper's auto-cancel notices):
 *  - the confirm prompt fires EXACTLY ONCE per completion, on the
 *    completion's own transaction, only after the guarded UPDATE matches —
 *    a denied completion and a replayed (conflicting) completion write zero
 *    new notification rows;
 *  - the caller-tx path returns the prompt's delivery receipt UNPUBLISHED
 *    (the receipt-bearing completion variant) while the plain completion
 *    surface stays row-shaped; the production (no-tx) path hands the
 *    receipt to the engine strictly after its own commit — a rolled-back
 *    flow publishes nothing;
 *  - the deadline sweeper composes BOTH legs in one transaction and
 *    refunds the UNION of their rows; every swept completed-leg row's
 *    student gets exactly one auto-cancel notice, the scheduled-expiry leg
 *    gains nothing beyond its own booking intake wave, and an emitter
 *    failure fails closed (the whole sweep rolls back, zero receipts
 *    published);
 *  - the sweep's counts stay honest across both legs and idempotent on
 *    re-run.
 *
 * Booking intake wave (the teacher's session-request notice):
 *  - a FIRST booking emits exactly one `SessionRequest` row addressed to
 *    the booked teacher, composed in the teacher's persisted locale, on
 *    the booking's own transaction (nested savepoint) — a replayed booking
 *    (duplicate claim key) never reaches the wave;
 *  - the caller-tx path publishes nothing (the caller owns the commit
 *    boundary); the production path hands the receipt to the engine
 *    strictly after its own commit;
 *  - an intake emitter failure degrades: only the wave's savepoint rolls
 *    back — the booking stays durable (row + debit + claim all commit).
 *
 * Chaos block (REQ-043, `Promise.allSettled` on the PRODUCTION tx path):
 *  committed fixtures (hard-deleted in `afterAll`) let each concurrent
 *  service call open its own real transaction on its own connection —
 *  genuine row-lock serialization, a genuine 23505 claim race, and the
 *  production savepoint/rollback behavior end to end.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { SessionRepository, TeacherRepository, WalletRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { progress } from "@/backend/db/schema/classes/progress";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestLesson,
  createTestPlan,
  createTestStudent,
  createTestSubscription,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { hasPostgresErrorCode } from "@/backend/db/test/pg-error";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { SessionRequestNotificationService } from "@/backend/services/classes/session-request-notification.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  DBTransaction,
  NotificationDeliveryReceipt,
  SessionInsertType,
  SessionListFilterInput,
  SessionReturnType,
  SessionSelectType,
  SessionStudentIntentType,
  SessionSubmitInput,
} from "@/backend/types";
import {
  SESSION_CONFIRMATION_WINDOW_MS,
  SESSION_FEE_HIFZ,
  SESSION_FEE_TAJWEED,
} from "@/shared/constants/session-fees.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

/** PostgreSQL error code for `raise_exception` (the REQ-040 trigger probe). */
const PG_RAISE_EXCEPTION = "P0001";

/**
 * The chaos-assertion statuses, widened to plain strings at module scope:
 * the fulfilled rows' `status` is the raw pg-enum string union, so the
 * predicate comparison needs the enum member's string identity without a
 * runtime conversion — the vocabulary still flows from the enum, never from
 * a bare literal (mirrors the service's own `SESSION_STARTED_STATUS`).
 */
const SESSION_CANCELLED_STATUS: string = SessionStatus.Cancelled;
const SESSION_STARTED_STATUS: string = SessionStatus.Started;

/** The errors-namespace translations for the default test locale. */
function t() {
  return getServerTranslations("en").errorsTranslations;
}

/** The notifications-namespace copy in the default (student fixture) locale. */
const NOTIFS_EN = getServerTranslations("en").notificationsTranslations;

/**
 * Type-guard read of a caught rejection's `extensions.code` — the
 * assertion-free form of the REQ-050 DomainError contract check (an
 * `instanceof` guard, never a narrowing cast).
 */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Asserts a caught error is a `DomainError` carrying EXACTLY the expected
 * `extensions.code` (the REQ-050 typed-denial contract) and the exact
 * translated message (never the raw translation key).
 */
function expectDomainDenial(error: Error, code: string, message: string): void {
  expect(error).toBeInstanceOf(DomainError);
  expect(rejectionCode(error)).toBe(code);
  expect(error.message).toBe(message);
  expect(error.message).not.toContain(code);
}

// ─── File-local fixtures (mirror the repo-suite helpers) ────────────────

/** Shared-PK ids for one booking pair (session.teacher_id / session.student_id). */
interface SessionActors {
  teacherUserId: number;
  studentUserId: number;
}

/**
 * Shared-PK `teacher` row insert for a previously-created user — mirrors
 * the entity-setup role-child factory pattern (PK = users.id, FK cascade).
 * `isApproved` accepts `null` to pin the strict-true certification boundary.
 */
async function createTestTeacherRow(tx: DBTransaction, userId: number, isApproved: boolean | null): Promise<void> {
  await tx.insert(teacher).values({ id: userId, isApproved });
}

/** Creates one certified teacher + one student pair with shared-PK rows. */
async function createSessionActors(tx: DBTransaction): Promise<SessionActors> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id, true);
  const studentUser = await createTestUser(tx, { role: "student" });
  await createTestStudent(tx, studentUser.id);
  return { teacherUserId: teacherUser.id, studentUserId: studentUser.id };
}

/** Sets the students row's escrow lane balances (test-local oracle setup). */
async function setLaneBalances(
  tx: DBTransaction,
  studentId: number,
  balances: { trial?: number; hifz?: number; tajweed?: number }
): Promise<void> {
  await tx
    .update(students)
    .set({
      balanceTrial: balances.trial ?? 0,
      balanceHifz: balances.hifz ?? 0,
      balanceTajweed: balances.tajweed ?? 0,
    })
    .where(eq(students.id, studentId));
}

/** Independent read-back oracle: the student row's lane balances. */
async function readLaneBalances(tx: DBTransaction, studentId: number) {
  const [row] = await tx
    .select({ trial: students.balanceTrial, hifz: students.balanceHifz, tajweed: students.balanceTajweed })
    .from(students)
    .where(eq(students.id, studentId));
  if (!row) {
    throw new Error("readLaneBalances: student row vanished");
  }
  return row;
}

/** Independent read-back oracle: the full session row (NOT via the service). */
async function readSessionRow(tx: DBTransaction, sessionId: number): Promise<SessionSelectType | null> {
  const [row] = await tx.select().from(session).where(eq(session.id, sessionId));
  return row ?? null;
}

/**
 * One student's governing curriculum: a tajweed-lane plan with three
 * lessons (creation order IS the `id ASC` sequence) plus the student's
 * active subscription on it — the full context the settled arm's pointer
 * advance needs.
 */
async function createCurriculum(tx: DBTransaction, studentId: number) {
  const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });
  const firstLesson = await createTestLesson(tx, plan.id);
  const secondLesson = await createTestLesson(tx, plan.id);
  const thirdLesson = await createTestLesson(tx, plan.id);
  await createTestSubscription(tx, studentId, plan.id);
  return { plan, lessons: [firstLesson, secondLesson, thirdLesson] };
}

/** Independent read-back oracle: the student's progress pointer rows. */
async function readProgressRows(tx: DBTransaction, studentId: number) {
  return tx.select().from(progress).where(eq(progress.studentId, studentId));
}

/** Every session row booked by the student (count oracle, tx-scoped). */
async function countSessionsForStudent(tx: DBTransaction, studentId: number): Promise<number> {
  const rows = await tx.select({ id: session.id }).from(session).where(eq(session.studentId, studentId));
  return rows.length;
}

/** Every claim row spent by the user (count oracle, tx-scoped). */
async function countClaimsForUser(tx: DBTransaction, userId: number): Promise<number> {
  const rows = await tx
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.userId, userId));
  return rows.length;
}

/** The claim row for a key, read directly (replay backfill oracle). */
async function readClaimByKey(tx: DBTransaction, key: string) {
  const [row] = await tx
    .select()
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  return row ?? null;
}

/** Independent read-back oracle for the committed chaos block (db-scoped). */
async function readChaosSessionRow(sessionId: number): Promise<SessionSelectType | null> {
  const [row] = await db.select().from(session).where(eq(session.id, sessionId));
  return row ?? null;
}

/**
 * Direct session-row insert for test preconditions (full column control —
 * e.g. a non-scheduled lifecycle state for probe-classification tests).
 */
async function insertSessionRow(
  tx: DBTransaction,
  actors: SessionActors,
  overrides: Partial<SessionInsertType> = {}
): Promise<SessionSelectType> {
  const [row] = await tx
    .insert(session)
    .values({
      teacherId: actors.teacherUserId,
      studentId: actors.studentUserId,
      status: SessionStatus.Scheduled,
      // Non-null intent: the completion flow's confirm-prompt wave reads
      // the session's intent — a null one is a corruption denial, and this
      // fixture models a legitimately booked (hence intent-carrying) row.
      intent: SessionIntent.Hifz,
      fee: "10.00",
      feeHeld: true,
      heldBalanceLane: HeldBalanceLane.Hifz,
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("insertSessionRow: insert returned no rows");
  }
  return row;
}

/** An integer id that cannot exist as a `session` row during this transaction. */
async function absentSessionId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${session.id}), 0)::int` }).from(session);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** An integer id that cannot exist as a `users` row during this transaction. */
async function absentUserId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** The service's booking call, pinned to the test transaction + locale. */
function bookSession(
  tx: DBTransaction,
  studentId: number,
  teacherId: number,
  intent: SessionStudentIntentType,
  key: string
): Promise<SessionReturnType> {
  return SessionLifecycleService.createSession(studentId, { teacherId, intent }, key, "en", tx);
}

/** Walks the Drizzle cause chain for a PostgreSQL SQLSTATE code. */

/**
 * Widens an action-type enum member to its raw stored string. Select rows
 * carry the raw `action_type` value (coercion to the enum is the read
 * service's job), so audit-row lookups compare primitive-to-primitive.
 */
function rawActionType(actionType: AuditActionType): string {
  return actionType;
}

/**
 * Fetches every session-entity audit row the supplied actor minted for one
 * entity id. Entity+actor scoping keeps counts immune to concurrent test
 * files committing their own rows against the shared database.
 */
async function fetchSessionAuditRows(tx: DBTransaction, actorId: number, entityId: number) {
  const rows = await tx
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.actorId, actorId), eq(auditLogs.entityType, "session"), eq(auditLogs.entityId, entityId)));
  // Widen the pg-enum column to its raw stored string so lookups compare
  // primitive-to-primitive (see rawActionType).
  return rows.map(
    (row): { id: number; actionType: string; entityType: string; entityId: number | null; details: string | null } => ({
      id: row.id,
      actionType: row.actionType,
      entityType: row.entityType,
      entityId: row.entityId,
      details: row.details,
    })
  );
}

/**
 * Counts `audit_logs` rows attributable to a single actor id — the zero-write
 * oracle for denial probes. Global table totals are NOT stable mid-test under
 * parallel bun test file execution, so write-freedom is asserted per-actor:
 * an id this test owns (minted inside the rollback tx) cannot be perturbed by
 * concurrent external churn.
 */
async function countAuditRowsForActor(tx: DBTransaction, actorId: number): Promise<number> {
  const rows = await tx.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.actorId, actorId));
  return rows.length;
}

// ─── Transactional service flows (runInRollback) ────────────────────────

describe("SessionLifecycleService — transactional flows (runInRollback)", () => {
  // ── Tier 1: booking + the debit ladder ──────────────────────────────

  test("trial-hit branch: books on the trial lane, holds the fee, records Trial provenance, debits exactly one trial unit", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });

      const created = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-trial-hit"
      );

      expect(created.status).toBe(SessionStatus.Scheduled);
      expect(created.sessionType).toBe(SessionType.StudentSession);
      expect(created.intent).toBe(SessionIntent.Hifz);
      expect(created.feeHeld).toBe(true);
      expect(created.heldBalanceLane).toBe(HeldBalanceLane.Trial);
      expect(created.startedAt).toBeNull();
      expect(created.endedAt).toBeNull();

      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(0);
      expect(balances.hifz).toBe(0);
      expect(balances.tajweed).toBe(0);

      const claim = await readClaimByKey(tx, "key-trial-hit");
      expect(claim).not.toBeNull();
      expect(claim?.sessionId).toBe(created.id);
      expect(await countSessionsForStudent(tx, actors.studentUserId)).toBe(1);
      expect(await countClaimsForUser(tx, actors.studentUserId)).toBe(1);
    });
  });

  test("hifz-hit branch: empty trial lane falls through to the intent's own lane", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { hifz: 1 });

      const created = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-hifz-hit"
      );

      expect(created.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(0);
      expect(balances.hifz).toBe(0);
      expect(balances.tajweed).toBe(0);
    });
  });

  test("tajweed-hit branch: the Tajweed intent binds its own lane and its own fee", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { tajweed: 1 });

      const created = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Tajweed,
        "key-tajweed-hit"
      );

      expect(created.intent).toBe(SessionIntent.Tajweed);
      expect(created.heldBalanceLane).toBe(HeldBalanceLane.Tajweed);
      expect(created.fee).toBe(SESSION_FEE_TAJWEED);
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.tajweed).toBe(0);
    });
  });

  test("total-miss branch: an empty student is denied INSUFFICIENT_BALANCE with zero rows and the key stays reusable", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);

      const error = await expectRepoError(() =>
        bookSession(tx, actors.studentUserId, actors.teacherUserId, SessionIntent.Hifz, "key-total-miss")
      );
      expectDomainDenial(error, "INSUFFICIENT_BALANCE", t().insufficientBalance);

      // Zero rows anywhere: no session, no claim, no lane delta.
      expect(await countSessionsForStudent(tx, actors.studentUserId)).toBe(0);
      expect(await countClaimsForUser(tx, actors.studentUserId)).toBe(0);
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(0);
      expect(balances.hifz).toBe(0);
      expect(balances.tajweed).toBe(0);

      // The failed booking never burned its key: funding the student and
      // retrying the SAME key succeeds.
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const retry = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-total-miss"
      );
      expect(retry.heldBalanceLane).toBe(HeldBalanceLane.Trial);
      expect(await countSessionsForStudent(tx, actors.studentUserId)).toBe(1);
    });
  });

  test("trial-first ordering proof: a student holding BOTH lanes books twice — trial first, paid lane second", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1, hifz: 1 });

      const first = await bookSession(tx, actors.studentUserId, actors.teacherUserId, SessionIntent.Hifz, "key-both-1");
      const second = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-both-2"
      );

      expect(first.heldBalanceLane).toBe(HeldBalanceLane.Trial);
      expect(second.heldBalanceLane).toBe(HeldBalanceLane.Hifz);

      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(0);
      expect(balances.hifz).toBe(0);
      expect(await countSessionsForStudent(tx, actors.studentUserId)).toBe(2);
      expect(await countClaimsForUser(tx, actors.studentUserId)).toBe(2);
    });
  });

  // ── Tier 1: pre-DB validation guards ────────────────────────────────

  test("idempotency key guards: an empty key and a 129-char key are rejected pre-DB with VALIDATION", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });

      const emptyError = await expectRepoError(() =>
        bookSession(tx, actors.studentUserId, actors.teacherUserId, SessionIntent.Hifz, "")
      );
      expectDomainDenial(emptyError, "VALIDATION", t().idempotencyKeyRequired);

      const longError = await expectRepoError(() =>
        bookSession(tx, actors.studentUserId, actors.teacherUserId, SessionIntent.Hifz, "k".repeat(129))
      );
      expectDomainDenial(longError, "VALIDATION", t().idempotencyKeyRequired);

      // Zero writes: no session, no claim, balances untouched.
      expect(await countSessionsForStudent(tx, actors.studentUserId)).toBe(0);
      expect(await countClaimsForUser(tx, actors.studentUserId)).toBe(0);
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(1);
    });
  });

  test("identifier guards: non-positive / non-safe-integer student and teacher ids are rejected pre-DB", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);

      // Every id fails the PRE-DB boundary guards — no query is ever issued
      // for any attempt, so the guard matrix runs as one parallel batch
      // (each denial is asserted inside its own promise chain).
      await Promise.all(
        [0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1].map(badStudentId =>
          expectRepoError(() =>
            bookSession(
              tx,
              badStudentId,
              actors.teacherUserId,
              SessionIntent.Hifz,
              `key-bad-student-${String(badStudentId)}`
            )
          ).then(error => expectDomainDenial(error, "VALIDATION", t().validation))
        )
      );
      await Promise.all(
        [0, -1, 2.25, Number.NaN].map(badTeacherId =>
          expectRepoError(() =>
            bookSession(
              tx,
              actors.studentUserId,
              badTeacherId,
              SessionIntent.Hifz,
              `key-bad-teacher-${String(badTeacherId)}`
            )
          ).then(error => expectDomainDenial(error, "VALIDATION", t().validation))
        )
      );

      // Zero rows reached the database through the whole guard matrix
      // (covers the per-attempt zero-writes proof — no attempt touched any
      // table, so the post-batch counts are the same zero).
      expect(await countSessionsForStudent(tx, actors.studentUserId)).toBe(0);
      expect(await countClaimsForUser(tx, actors.studentUserId)).toBe(0);
    });
  });

  test("session-id shape guards: malformed TARGET session ids are denied VALIDATION pre-DB on start/complete/cancel/dispute and null on the read (REQ-054)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const admin = await createTestUser(tx, { role: "admin" });

      // The malformed-id matrix — each member is the runtime shape the
      // boundary's shape-only `Number()` parse yields for a malformed `ID`
      // string ("abc"/"12abc" → NaN, "1.5" → 1.5, "1e20" → 1e20 — outside
      // the safe-integer range — plus "-1"/"0"): NONE is a positive safe
      // integer, so every attempt must fail the pre-DB guard with the
      // canonical VALIDATION denial, never a SQL round-trip (pg 22P02 →
      // masked 500).
      const malformedIds: number[] = [Number.NaN, 1.5, 1e20, -1, 0];

      // The boundary-skipped raw-string leg: a raw "abc" id delivered by a
      // caller that skipped the boundary's `Number()` parse entirely. The
      // hostile runtime value is laundered through the codebase's lint-clean
      // Object.assign overlay mechanism (no unsafe assertion) — the runtime
      // value is NOT a primitive number, so the guard's typeof leg fails
      // closed exactly as it would for the string itself.
      const skippedParseId: number = Object.assign(0, { hostileRawId: "abc" });

      // Every guard fires before ANY query is issued, so the whole matrix
      // runs as one parallel batch (the suite's pre-DB-guard idiom), each
      // denial asserted inside its own promise chain.
      await Promise.all([
        ...malformedIds.flatMap(badId => [
          expectRepoError(() => SessionLifecycleService.startSession(actors.teacherUserId, badId, "en", tx)).then(
            error => expectDomainDenial(error, "VALIDATION", t().validation)
          ),
          expectRepoError(() => SessionLifecycleService.completeSession(actors.teacherUserId, badId, "en", tx)).then(
            error => expectDomainDenial(error, "VALIDATION", t().validation)
          ),
          expectRepoError(() =>
            SessionLifecycleService.cancelSession(actors.studentUserId, badId, null, "en", tx)
          ).then(error => expectDomainDenial(error, "VALIDATION", t().validation)),
          expectRepoError(() =>
            SessionLifecycleService.openSessionDispute(actors.studentUserId, badId, "reason", "en", tx)
          ).then(error => expectDomainDenial(error, "VALIDATION", t().validation)),
          expectRepoError(() =>
            SessionLifecycleService.resolveSessionDispute(admin.id, badId, DisputeResolution.Cancel, null, "en", tx)
          ).then(error => expectDomainDenial(error, "VALIDATION", t().validation)),
        ]),
        expectRepoError(() =>
          SessionLifecycleService.startSession(actors.teacherUserId, skippedParseId, "en", tx)
        ).then(error => expectDomainDenial(error, "VALIDATION", t().validation)),
        expectRepoError(() =>
          SessionLifecycleService.completeSession(actors.teacherUserId, skippedParseId, "en", tx)
        ).then(error => expectDomainDenial(error, "VALIDATION", t().validation)),
        expectRepoError(() =>
          SessionLifecycleService.cancelSession(actors.studentUserId, skippedParseId, null, "en", tx)
        ).then(error => expectDomainDenial(error, "VALIDATION", t().validation)),
        expectRepoError(() =>
          SessionLifecycleService.openSessionDispute(actors.studentUserId, skippedParseId, "reason", "en", tx)
        ).then(error => expectDomainDenial(error, "VALIDATION", t().validation)),
        expectRepoError(() =>
          SessionLifecycleService.resolveSessionDispute(
            admin.id,
            skippedParseId,
            DisputeResolution.Cancel,
            null,
            "en",
            tx
          )
        ).then(error => expectDomainDenial(error, "VALIDATION", t().validation)),
      ]);

      // The read's oracle-safe null channel: a malformed id resolves to the
      // SAME null as a nonexistent id — before any database read, never an
      // error (the read surface has no locale). The guard short-circuits
      // pre-DB (no query is issued), so the matrix runs as one parallel
      // batch like the denial legs above.
      await Promise.all(
        [...malformedIds, skippedParseId].map(badId =>
          SessionLifecycleService.getSessionById(actors.studentUserId, badId, tx).then(nullChannel =>
            expect(nullChannel).toBeNull()
          )
        )
      );

      // Zero writes through the whole matrix: no session row, no claim, no
      // lane delta — the guards fired before any database work.
      expect(await countSessionsForStudent(tx, actors.studentUserId)).toBe(0);
      expect(await countClaimsForUser(tx, actors.studentUserId)).toBe(0);
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(1);
    });
  });

  test("intent guard: intent=evaluation is rejected PRE-DB — VALIDATION, zero writes (no session, no claim, no debit)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1, hifz: 1 });

      // The out-of-vocabulary intent must reach the SERVICE's runtime guard
      // (the compiler cannot see it): the hostile value is overlaid onto a
      // correctly-typed base input via Object.assign — the lint-clean
      // mechanism (no unsafe assertion), mirroring the registration suite's
      // hostile-extras pattern. At runtime the value IS the
      // SessionIntent.Evaluation member; the guard must still reject it.
      const baseInput: SessionSubmitInput = { teacherId: actors.teacherUserId, intent: SessionIntent.Hifz };
      const evaluationInput: SessionSubmitInput = Object.assign({}, baseInput, { intent: SessionIntent.Evaluation });

      const error = await expectRepoError(() =>
        SessionLifecycleService.createSession(actors.studentUserId, evaluationInput, "key-evaluation", "en", tx)
      );
      expectDomainDenial(error, "VALIDATION", t().invalidSessionIntent);

      // The zero-writes proof: the rejection happened before any DB work.
      expect(await countSessionsForStudent(tx, actors.studentUserId)).toBe(0);
      expect(await countClaimsForUser(tx, actors.studentUserId)).toBe(0);
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(1);
      expect(balances.hifz).toBe(1);
      expect(await readClaimByKey(tx, "key-evaluation")).toBeNull();
    });
  });

  // ── Tier 1: governance re-check (create/start/complete; cancel exempt) ──

  test("governed students are denied FORBIDDEN on create — isDeleted, isBlocked, and suspended each fail closed with zero writes", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const deletedUser = await createTestUser(tx, { role: "student", isDeleted: true });
      await createTestStudent(tx, deletedUser.id);
      const blockedUser = await createTestUser(tx, { role: "student", isBlocked: true });
      await createTestStudent(tx, blockedUser.id);
      const suspendedUser = await createTestUser(tx, { role: "student", suspended: true });
      await createTestStudent(tx, suspendedUser.id);

      // The governance denial is read-only (one probe SELECT, then the typed
      // FORBIDDEN — it throws before the booking transaction opens), so the
      // three cases run as one parallel batch with their zero-writes oracles
      // folded into each case's own promise chain.
      await Promise.all(
        [deletedUser.id, blockedUser.id, suspendedUser.id].map((governedId, index) =>
          expectRepoError(() =>
            bookSession(tx, governedId, actors.teacherUserId, SessionIntent.Hifz, `key-governed-${index}`)
          ).then(async error => {
            expectDomainDenial(error, "FORBIDDEN", t().forbidden);
            expect(await countClaimsForUser(tx, governedId)).toBe(0);
            expect(await countSessionsForStudent(tx, governedId)).toBe(0);
            return undefined;
          })
        )
      );

      // The clean actors are untouched by the denials.
      expect(await countSessionsForStudent(tx, actors.studentUserId)).toBe(0);
      expect(await countClaimsForUser(tx, actors.studentUserId)).toBe(0);
    });
  });

  test("governed teachers are denied FORBIDDEN on start AND on complete", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors, { status: SessionStatus.Started });

      await tx.update(users).set({ isBlocked: true }).where(eq(users.id, actors.teacherUserId));

      const startError = await expectRepoError(() =>
        SessionLifecycleService.startSession(actors.teacherUserId, row.id, "en", tx)
      );
      expectDomainDenial(startError, "FORBIDDEN", t().forbidden);

      const completeError = await expectRepoError(() =>
        SessionLifecycleService.completeSession(actors.teacherUserId, row.id, "en", tx)
      );
      expectDomainDenial(completeError, "FORBIDDEN", t().forbidden);

      // Zero mutation: the session is still exactly where it was.
      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow?.status).toBe(SessionStatus.Started);
      expect(finalRow?.endedAt).toBeNull();
      expect(finalRow?.confirmedByTeacherAt).toBeNull();
    });
  });

  test("cancel is governance-EXEMPT: a blocked student can still release an in-flight hold and get the refund", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const created = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-gov-cancel"
      );
      expect(created.heldBalanceLane).toBe(HeldBalanceLane.Trial);

      await tx.update(users).set({ isBlocked: true }).where(eq(users.id, actors.studentUserId));

      const cancelled = await SessionLifecycleService.cancelSession(actors.studentUserId, created.id, null, "en", tx);
      expect(cancelled.status).toBe(SessionStatus.Cancelled);
      expect(cancelled.feeHeld).toBe(false);

      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(1);
    });
  });

  // ── Tier 1: teacher-lock branches ───────────────────────────────────

  test("teacher-lock null branch: booking a nonexistent teacher is denied TEACHER_NOT_FOUND with zero writes", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const absentId = await absentUserId(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });

      const error = await expectRepoError(() =>
        bookSession(tx, actors.studentUserId, absentId, SessionIntent.Hifz, "key-no-teacher")
      );
      expectDomainDenial(error, "TEACHER_NOT_FOUND", t().teacherNotFound);

      expect(await countSessionsForStudent(tx, actors.studentUserId)).toBe(0);
      expect(await countClaimsForUser(tx, actors.studentUserId)).toBe(0);
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(1);
    });
  });

  test("teacher-lock certification branches: an unapproved teacher AND a null-flag teacher are both TEACHER_NOT_CERTIFIED", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const unapprovedUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, unapprovedUser.id, false);
      const nullFlagUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, nullFlagUser.id, null);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });

      const unapprovedError = await expectRepoError(() =>
        bookSession(tx, actors.studentUserId, unapprovedUser.id, SessionIntent.Hifz, "key-unapproved")
      );
      expectDomainDenial(unapprovedError, "TEACHER_NOT_CERTIFIED", t().teacherNotCertified);

      const nullFlagError = await expectRepoError(() =>
        bookSession(tx, actors.studentUserId, nullFlagUser.id, SessionIntent.Hifz, "key-null-flag")
      );
      expectDomainDenial(nullFlagError, "TEACHER_NOT_CERTIFIED", t().teacherNotCertified);

      // Strict-true semantics: neither booking wrote anything.
      expect(await countSessionsForStudent(tx, actors.studentUserId)).toBe(0);
      expect(await countClaimsForUser(tx, actors.studentUserId)).toBe(0);
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(1);
    });
  });

  // ── Tier 1: transition probe classification (start / complete / cancel) ──

  test("start probe: an unknown session id is classified SESSION_NOT_FOUND", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const absentId = await absentSessionId(tx);

      const error = await expectRepoError(() =>
        SessionLifecycleService.startSession(actors.teacherUserId, absentId, "en", tx)
      );
      expectDomainDenial(error, "SESSION_NOT_FOUND", t().sessionNotFound);
      expect(error).toBeInstanceOf(NotFoundError);
    });
  });

  test("start probe: a foreign (non-owning) teacher is oracle-collapsed onto SESSION_NOT_FOUND", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const foreignTeacher = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, foreignTeacher.id, true);
      const row = await insertSessionRow(tx, actors);

      const error = await expectRepoError(() =>
        SessionLifecycleService.startSession(foreignTeacher.id, row.id, "en", tx)
      );
      expectDomainDenial(error, "SESSION_NOT_FOUND", t().sessionNotFound);

      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow?.status).toBe(SessionStatus.Scheduled);
      expect(finalRow?.startedAt).toBeNull();
    });
  });

  test("start probe: an already-started session is a SESSION_INVALID_TRANSITION conflict", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors, { status: SessionStatus.Started });

      const error = await expectRepoError(() =>
        SessionLifecycleService.startSession(actors.teacherUserId, row.id, "en", tx)
      );
      expectDomainDenial(error, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);
      expect(error).toBeInstanceOf(ConflictError);
    });
  });

  test("complete probe: a scheduled (never-started) session is a SESSION_INVALID_TRANSITION conflict", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);

      const error = await expectRepoError(() =>
        SessionLifecycleService.completeSession(actors.teacherUserId, row.id, "en", tx)
      );
      expectDomainDenial(error, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);

      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow?.status).toBe(SessionStatus.Scheduled);
      expect(finalRow?.endedAt).toBeNull();
      expect(finalRow?.confirmedByTeacherAt).toBeNull();
    });
  });

  test("complete probe: an owned in-progress session that fails the fused certification predicate is TEACHER_NOT_CERTIFIED", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const created = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-decert"
      );

      // Decertify AFTER booking, then start (start carries no certification
      // predicate — only completion re-asserts it, fused into its UPDATE).
      await tx.update(teacher).set({ isApproved: false }).where(eq(teacher.id, actors.teacherUserId));
      const started = await SessionLifecycleService.startSession(actors.teacherUserId, created.id, "en", tx);
      expect(started.status).toBe(SessionStatus.Started);

      const error = await expectRepoError(() =>
        SessionLifecycleService.completeSession(actors.teacherUserId, created.id, "en", tx)
      );
      expectDomainDenial(error, "TEACHER_NOT_CERTIFIED", t().teacherNotCertified);

      const finalRow = await readSessionRow(tx, created.id);
      expect(finalRow?.status).toBe(SessionStatus.Started);
      expect(finalRow?.endedAt).toBeNull();
      expect(finalRow?.confirmedByTeacherAt).toBeNull();
    });
  });

  test("cancel probe: a completed session and a foreign caller are both denied (terminal + oracle-safety)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const foreignStudent = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, foreignStudent.id);

      const completed = await insertSessionRow(tx, actors, { status: SessionStatus.Completed, feeHeld: false });
      const terminalError = await expectRepoError(() =>
        SessionLifecycleService.cancelSession(actors.studentUserId, completed.id, null, "en", tx)
      );
      expectDomainDenial(terminalError, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);

      const scheduled = await insertSessionRow(tx, actors);
      const foreignError = await expectRepoError(() =>
        SessionLifecycleService.cancelSession(foreignStudent.id, scheduled.id, null, "en", tx)
      );
      expectDomainDenial(foreignError, "SESSION_NOT_FOUND", t().sessionNotFound);

      // Both denials left the rows untouched.
      const untouched = await readSessionRow(tx, scheduled.id);
      expect(untouched?.status).toBe(SessionStatus.Scheduled);
      expect(untouched?.feeHeld).toBe(true);
    });
  });

  test("cancel happy path: keeps the start stamp, never writes an end stamp, refunds the SAME lane exactly once", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { hifz: 1 });
      const created = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-cancel"
      );
      await SessionLifecycleService.startSession(actors.teacherUserId, created.id, "en", tx);

      const cancelled = await SessionLifecycleService.cancelSession(actors.studentUserId, created.id, null, "en", tx);

      expect(cancelled.status).toBe(SessionStatus.Cancelled);
      expect(cancelled.feeHeld).toBe(false);
      expect(cancelled.startedAt).not.toBeNull();
      expect(cancelled.endedAt).toBeNull();
      expect(cancelled.heldBalanceLane).toBe(HeldBalanceLane.Hifz);

      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.hifz).toBe(1);
      expect(balances.trial).toBe(0);
    });
  });

  // ── Tier 1: the idempotent replay branch ────────────────────────────

  test("replay branch: a same-caller retry of a spent key surfaces DUPLICATE_REQUEST, leaves zero new rows and zero second debit", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const original = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-replay"
      );

      // Fund a paid lane so the retry passes the ladder and REACHES the
      // claim insert (the exact conflict-under-duplication scenario).
      await setLaneBalances(tx, actors.studentUserId, { hifz: 1 });

      const error = await expectRepoError(() =>
        bookSession(tx, actors.studentUserId, actors.teacherUserId, SessionIntent.Hifz, "key-replay")
      );
      expectDomainDenial(error, "DUPLICATE_REQUEST", t().duplicateRequest);
      expect(error).toBeInstanceOf(ConflictError);

      // Exactly one session and one claim — the original's. The replay's
      // own partial writes (its ladder debit) rolled back with its tx, so
      // the balances are static (REQ-073: no second debit).
      expect(await countSessionsForStudent(tx, actors.studentUserId)).toBe(1);
      expect(await countClaimsForUser(tx, actors.studentUserId)).toBe(1);
      const claim = await readClaimByKey(tx, "key-replay");
      expect(claim?.sessionId).toBe(original.id);
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(0);
      expect(balances.hifz).toBe(1);
      expect(balances.tajweed).toBe(0);
    });
  });

  test("replay branch: a key spent by a DIFFERENT caller is oracle-denied SESSION_NOT_FOUND and the foreign attempt writes nothing", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const second = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, second.id);

      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const original = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-owner-a"
      );

      await setLaneBalances(tx, second.id, { trial: 1 });
      const error = await expectRepoError(() =>
        bookSession(tx, second.id, actors.teacherUserId, SessionIntent.Hifz, "key-owner-a")
      );
      expectDomainDenial(error, "SESSION_NOT_FOUND", t().sessionNotFound);

      // Another user's claim is never surfaced, and the foreign attempt's
      // debit rolled back with its transaction.
      const balances = await readLaneBalances(tx, second.id);
      expect(balances.trial).toBe(1);
      expect(await countSessionsForStudent(tx, second.id)).toBe(0);
      const originalClaim = await readClaimByKey(tx, "key-owner-a");
      expect(originalClaim?.sessionId).toBe(original.id);
      expect(await countClaimsForUser(tx, second.id)).toBe(0);
    });
  });

  // ── Tier 1: oracle-safe reads ───────────────────────────────────────

  test("getSessionById: the owner sees the row; a non-participant and a nonexistent id resolve to the identical null", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const foreignStudent = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, foreignStudent.id);
      const row = await insertSessionRow(tx, actors);
      const absentId = await absentSessionId(tx);

      const ownerView = await SessionLifecycleService.getSessionById(actors.studentUserId, row.id, tx);
      expect(ownerView).not.toBeNull();
      expect(ownerView?.id).toBe(row.id);

      expect(await SessionLifecycleService.getSessionById(foreignStudent.id, row.id, tx)).toBeNull();
      expect(await SessionLifecycleService.getSessionById(actors.studentUserId, absentId, tx)).toBeNull();
    });
  });

  // ── Tier 2: boundary contracts ──────────────────────────────────────

  testOnRealPostgres(
    "deadline boundary: confirmationDeadline = captured now + 86_400_000 ms EXACTLY (bracketed)",
    async () => {
      await runInRollback(async tx => {
        const actors = await createSessionActors(tx);
        await setLaneBalances(tx, actors.studentUserId, { trial: 1 });

        const before = Date.now();
        const created = await bookSession(
          tx,
          actors.studentUserId,
          actors.teacherUserId,
          SessionIntent.Hifz,
          "key-deadline"
        );
        const after = Date.now();

        expect(created.confirmationDeadline).toBeInstanceOf(Date);
        if (!(created.confirmationDeadline instanceof Date)) {
          throw new Error("deadline boundary: confirmationDeadline is not a Date");
        }
        const deadline = created.confirmationDeadline.getTime();
        expect(deadline).toBeGreaterThanOrEqual(before + SESSION_CONFIRMATION_WINDOW_MS);
        expect(deadline).toBeLessThanOrEqual(after + SESSION_CONFIRMATION_WINDOW_MS);
        expect(SESSION_CONFIRMATION_WINDOW_MS).toBe(86_400_000);
      });
    }
  );

  test("fee boundary: both intents carry the platform fee as a decimal STRING verbatim (never a number)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      // The hifz booking consumes the trial lane; the tajweed booking then
      // falls through to (and debits) the tajweed lane — both must be funded.
      await setLaneBalances(tx, actors.studentUserId, { trial: 1, tajweed: 1 });

      const hifzSession = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-fee-hifz"
      );
      const tajweedSession = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Tajweed,
        "key-fee-tajweed"
      );

      expect(hifzSession.fee).toBe(SESSION_FEE_HIFZ);
      expect(tajweedSession.fee).toBe(SESSION_FEE_TAJWEED);
      expect(hifzSession.fee).toBe("25.00");
      expect(tajweedSession.fee).toBe("25.00");
      expect(typeof hifzSession.fee).toBe("string");
      expect(typeof tajweedSession.fee).toBe("string");
    });
  });

  test("key boundary: an EXACTLY-128-char key is accepted and stored verbatim", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const key = "k".repeat(128);

      const created = await bookSession(tx, actors.studentUserId, actors.teacherUserId, SessionIntent.Hifz, key);
      const claim = await readClaimByKey(tx, key);
      expect(claim).not.toBeNull();
      expect(claim?.idempotencyKey).toBe(key);
      expect(claim?.sessionId).toBe(created.id);
    });
  });

  test("cancel reason boundary: 500 chars (trim-normalized) accepted and PERSISTED; 501 rejected pre-DB", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 2 });

      const rejectedSession = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-reason-long"
      );
      const tooLongError = await expectRepoError(() =>
        SessionLifecycleService.cancelSession(actors.studentUserId, rejectedSession.id, "x".repeat(501), "en", tx)
      );
      expectDomainDenial(tooLongError, "VALIDATION", t().validation);
      // The rejection mutated nothing: the session is still held.
      const stillHeld = await readSessionRow(tx, rejectedSession.id);
      expect(stillHeld?.status).toBe(SessionStatus.Scheduled);
      expect(stillHeld?.feeHeld).toBe(true);
      expect(stillHeld?.cancelReason).toBeNull();

      // Whitespace beyond 500 content chars trims away — accepted.
      const acceptedSession = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-reason-ok"
      );
      const cancelled = await SessionLifecycleService.cancelSession(
        actors.studentUserId,
        acceptedSession.id,
        `${"y".repeat(500)}  `,
        "en",
        tx
      );
      expect(cancelled.status).toBe(SessionStatus.Cancelled);
      // The reason is persisted TRIMMED inside the guarded UPDATE
      // (`cancel_reason` — R-107; a whitespace-only reason persists NULL).
      expect(cancelled.cancelReason).toBe("y".repeat(500));
      const cancelledRow = await readSessionRow(tx, acceptedSession.id);
      expect(cancelledRow?.cancelReason).toBe("y".repeat(500));

      // A whitespace-only reason maps to NULL — nothing is persisted.
      const bareSession = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-reason-blank"
      );
      const bareCancelled = await SessionLifecycleService.cancelSession(
        actors.studentUserId,
        bareSession.id,
        "   ",
        "en",
        tx
      );
      expect(bareCancelled.status).toBe(SessionStatus.Cancelled);
      expect(bareCancelled.cancelReason).toBeNull();

      // Zero behavior change otherwise: the refund primitive still ran.
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(1);
    });
  });

  test("pagination boundaries: page 1 / pageSize 1 and 50 windows; out-of-range page and size normalize (1 / default 25); bogus filter drops out", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await insertSessionRow(tx, actors);
      await insertSessionRow(tx, actors);
      await insertSessionRow(tx, actors, { status: SessionStatus.Started });

      const firstPage = await SessionLifecycleService.listMyStudentSessions(
        actors.studentUserId,
        {} satisfies SessionListFilterInput,
        1,
        1,
        tx
      );
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.totalCount).toBe(3);
      expect(firstPage.page).toBe(1);
      expect(firstPage.pageSize).toBe(1);

      const fifty = await SessionLifecycleService.listMyStudentSessions(
        actors.studentUserId,
        { status: null },
        1,
        50,
        tx
      );
      expect(fifty.items).toHaveLength(3);
      expect(fifty.totalCount).toBe(3);
      expect(fifty.pageSize).toBe(50);

      // Out-of-range inputs normalize honestly — they never error.
      const oversized = await SessionLifecycleService.listMyStudentSessions(actors.studentUserId, {}, 1, 51, tx);
      expect(oversized.items).toHaveLength(3);
      expect(oversized.pageSize).toBe(25);

      const zeroPage = await SessionLifecycleService.listMyStudentSessions(actors.studentUserId, {}, 0, 25, tx);
      expect(zeroPage.page).toBe(1);
      const negativeInputs = await SessionLifecycleService.listMyStudentSessions(actors.studentUserId, {}, -3, 0, tx);
      expect(negativeInputs.page).toBe(1);
      expect(negativeInputs.pageSize).toBe(25);
      expect(negativeInputs.totalCount).toBe(3);

      // The lifecycle filter narrows list AND count coherently; a bogus
      // status drops out of the predicate (filters never error).
      const scheduled = await SessionLifecycleService.listMyStudentSessions(
        actors.studentUserId,
        { status: SessionStatus.Scheduled },
        1,
        50,
        tx
      );
      expect(scheduled.items).toHaveLength(2);
      expect(scheduled.totalCount).toBe(2);
      // Genuinely out-of-vocabulary (NOT a SessionStatus member — e.g.
      // `disputed` IS one) — the guard drops it and the read is unfiltered.
      // Object.assign overlays the hostile value onto a correctly-typed base
      // filter (no unsafe assertion); at runtime the value is a plausible-
      // but-unknown string the guard must drop out.
      const bogusFilter: SessionListFilterInput = Object.assign(
        { status: SessionStatus.Scheduled },
        { status: "expired" }
      );
      const bogus = await SessionLifecycleService.listMyStudentSessions(actors.studentUserId, bogusFilter, 1, 50, tx);
      expect(bogus.items).toHaveLength(3);
      expect(bogus.totalCount).toBe(3);

      // Owner-side scoping: another student and the teacher-side twin.
      const foreignStudent = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, foreignStudent.id);
      const foreignView = await SessionLifecycleService.listMyStudentSessions(foreignStudent.id, {}, 1, 50, tx);
      expect(foreignView.items).toHaveLength(0);
      expect(foreignView.totalCount).toBe(0);

      const teacherView = await SessionLifecycleService.listMyTeacherSessions(actors.teacherUserId, {}, 1, 50, tx);
      expect(teacherView.items).toHaveLength(3);
      expect(teacherView.totalCount).toBe(3);
    });
  });

  test("participant lists batch-enrich each row with the counterpart display name; the empty page skips the names read", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await insertSessionRow(tx, actors);
      await insertSessionRow(tx, actors);

      // Independent read-back oracle: both actors' persisted display names
      // (never taken from the fixture builder's return value).
      const [teacherNameRow] = await tx
        .select({ fullName: users.fullName })
        .from(users)
        .where(eq(users.id, actors.teacherUserId));
      const [studentNameRow] = await tx
        .select({ fullName: users.fullName })
        .from(users)
        .where(eq(users.id, actors.studentUserId));
      if (!teacherNameRow || !studentNameRow) {
        throw new Error("counterpart-name oracle: actor user row vanished");
      }

      // Passthrough spy on the repository seam — the original names read
      // still runs; only the call record is observed.
      const namesSpy = spyOn(SessionRepository, "listNamesByIds");

      const studentPage = await SessionLifecycleService.listMyStudentSessions(
        actors.studentUserId,
        {} satisfies SessionListFilterInput,
        1,
        50,
        tx
      );
      expect(studentPage.items).toHaveLength(2);
      for (const item of studentPage.items) {
        expect(item.teacherName).toBe(teacherNameRow.fullName);
      }
      // ONE batched names read for the whole page — the DISTINCT
      // counterpart ids collapse into a single membership call.
      expect(namesSpy.mock.calls).toHaveLength(1);
      expect(namesSpy.mock.calls[0]?.[0]).toEqual([actors.teacherUserId]);
      namesSpy.mockRestore();

      const teacherPage = await SessionLifecycleService.listMyTeacherSessions(actors.teacherUserId, {}, 1, 50, tx);
      expect(teacherPage.items).toHaveLength(2);
      for (const item of teacherPage.items) {
        expect(item.studentName).toBe(studentNameRow.fullName);
      }
    });
  });

  test("an empty participant page answers the honest empty window WITHOUT the counterpart-names read", async () => {
    await runInRollback(async tx => {
      // A student who owns no sessions: the page read answers empty and the
      // enrichment must not even form a membership query.
      const loneStudent = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, loneStudent.id);

      const namesSpy = spyOn(SessionRepository, "listNamesByIds");
      const emptyPage = await SessionLifecycleService.listMyStudentSessions(loneStudent.id, {}, 1, 50, tx);
      expect(emptyPage.items).toHaveLength(0);
      expect(emptyPage.totalCount).toBe(0);
      expect(namesSpy.mock.calls).toHaveLength(0);
      namesSpy.mockRestore();
    });
  });

  // ── Tier 3 (rollback path): REQ-040 + REQ-042 ───────────────────────

  test("REQ-040 rollback proof: a forced session-insert failure leaves ZERO rows in session/claim/lane delta and the key is REUSABLE", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1, hifz: 1 });
      const key = "key-req040";

      // Chaos injection: a transactional trigger raises on THIS student's
      // session inserts only. The DDL lives inside the rolled-back test
      // transaction — nothing leaks into the shared database.
      const failFn = `raise_session_insert_fail_${randomUUID().slice(0, 8).replaceAll("-", "_")}`;
      const failTrigger = `fail_session_insert_${randomUUID().slice(0, 8).replaceAll("-", "_")}`;
      await tx.execute(
        sql.raw(
          `CREATE FUNCTION ${failFn}() RETURNS trigger LANGUAGE plpgsql AS $fn$ ` +
            `BEGIN RAISE EXCEPTION 'forced session-insert failure (REQ-040 probe)'; END; $fn$;`
        )
      );
      await tx.execute(
        sql.raw(
          `CREATE TRIGGER ${failTrigger} ` +
            `BEFORE INSERT ON session FOR EACH ROW WHEN (NEW.student_id = ${actors.studentUserId}) ` +
            `EXECUTE FUNCTION ${failFn}()`
        )
      );

      const error = await expectRepoError(() =>
        bookSession(tx, actors.studentUserId, actors.teacherUserId, SessionIntent.Hifz, key)
      );

      // The raw database failure surfaced untouched (no DomainError masking,
      // no swallowed catch) as a raise_exception from the trigger.
      expect(error).not.toBeInstanceOf(DomainError);
      expect(hasPostgresErrorCode(error, PG_RAISE_EXCEPTION)).toBe(true);

      // REQ-040's atomicity proof: zero rows in ALL THREE surfaces and the
      // lane delta rolled back with them.
      expect(await countSessionsForStudent(tx, actors.studentUserId)).toBe(0);
      expect(await countClaimsForUser(tx, actors.studentUserId)).toBe(0);
      expect(await readClaimByKey(tx, key)).toBeNull();
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(1);
      expect(balances.hifz).toBe(1);
      expect(balances.tajweed).toBe(0);

      // Drop the trigger (same transaction), then prove the key is
      // REUSABLE: the failed booking never burned it.
      await tx.execute(sql.raw(`DROP TRIGGER ${failTrigger} ON session`));
      const retry = await bookSession(tx, actors.studentUserId, actors.teacherUserId, SessionIntent.Hifz, key);
      expect(retry.status).toBe(SessionStatus.Scheduled);
      expect(await countSessionsForStudent(tx, actors.studentUserId)).toBe(1);
      const claim = await readClaimByKey(tx, key);
      expect(claim?.sessionId).toBe(retry.id);
      const retryBalances = await readLaneBalances(tx, actors.studentUserId);
      // The retry is funded on BOTH lanes, so the documented trial-first
      // ladder debits the TRIAL unit — the hifz unit is untouched.
      expect(retryBalances.trial).toBe(0);
      expect(retryBalances.hifz).toBe(1);
    });
  });

  test("REQ-042: double-cancel refunds EXACTLY once — the second cancel is a SESSION_INVALID_TRANSITION with the balance unchanged", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const created = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-req042"
      );

      const first = await SessionLifecycleService.cancelSession(actors.studentUserId, created.id, null, "en", tx);
      expect(first.status).toBe(SessionStatus.Cancelled);
      expect(first.feeHeld).toBe(false);
      const afterFirst = await readLaneBalances(tx, actors.studentUserId);
      expect(afterFirst.trial).toBe(1);

      const second = await expectRepoError(() =>
        SessionLifecycleService.cancelSession(actors.studentUserId, created.id, null, "en", tx)
      );
      expectDomainDenial(second, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);

      // EXACTLY ONE unit refunded — the second denial refunded nothing.
      const afterSecond = await readLaneBalances(tx, actors.studentUserId);
      expect(afterSecond.trial).toBe(1);
      expect(afterSecond.hifz).toBe(0);
      expect(afterSecond.tajweed).toBe(0);
    });
  });

  // ── Tier 4: grep-level source pins (financial side-effect isolation) ──

  // The service is split (max-lines refactor) into sibling implementation
  // modules; the financial-isolation pin therefore scans the service AND
  // its pinned siblings as ONE implementation unit — the same pattern
  // `session.repository.test.ts` applies to the split repository. The file
  // list below is exhaustive: any sibling the unit gains must be
  // consciously admitted here alongside the import allowlist.
  const SERVICE_UNIT_FILES = [
    join(import.meta.dir, "session-lifecycle.service.ts"),
    join(import.meta.dir, "session-lifecycle.guards.ts"),
    join(import.meta.dir, "session-lifecycle.governance.ts"),
    join(import.meta.dir, "session-lifecycle.transitions.ts"),
    join(import.meta.dir, "session-lifecycle.booking.ts"),
    join(import.meta.dir, "session-lifecycle.confirmation.ts"),
    join(import.meta.dir, "session-lifecycle.queries.ts"),
  ];
  const unitSources = SERVICE_UNIT_FILES.map(file => readFileSync(file, "utf8"));
  const serviceSource = unitSources.join("\n");
  const serviceFromClauses = serviceSource.match(/from "[^"]+"/g) ?? [];

  test("source: the unit's cross-surface channels are the wallet-credit slice, the settlement's curriculum-progress advance, the engine-mediated completion waves, and the arbitration's audit trail row — imports are a pinned allowlist (no report import, no notification-repository import)", () => {
    // HONEST PIN (adapted to the sibling-module split — the same three
    // locks, with the notification and audit channels consciously admitted):
    //  1. every `from "…"` specifier in the unit must be on the explicit
    //     allowlist (the `@/backend/services/classes/` entries ARE the pinned
    //     siblings, aliased per the repo-wide eslint alias rule) — any
    //     NEW import (a report/billing service import, a notification
    //     REPOSITORY import, or any other unaccounted module) fails until
    //     the allowlist consciously admits it. The wave-emitter sibling and
    //     the notification ENGINE are the sanctioned notification channel:
    //     rows are written exclusively by the engine inside the owning
    //     transaction, and the unit only ever hands receipts to the engine's
    //     publish contract after that transaction commits. The audit writer
    //     and the audit-verb enum are the sanctioned audit channel: the
    //     admin arbitration appends its single Override row through the
    //     append-only writer INSIDE the arbitration's own transaction
    //     (denials classify before the emission and mint zero rows);
    //  - the curriculum-progress advance is the sanctioned progress
    //    channel: the settled arm composes the progress service INSIDE
    //    the confirmation transaction after the credit, and the unit
    //    never touches the progress repository itself;
    //  2. the ONLY `@/backend/db/` specifier is the repository barrel itself
    //     (no deep repository bypass), and the UNION of the barrel's named
    //     import lists across the unit is pinned — WalletRepository rides it
    //     BY NAME and no other repository surface is reachable;
    //  3. the ONLY `@/backend/lib/db/` specifier is the shared transaction
    //     helper (the arbitration's audit writer is pinned separately on
    //     the allowlist — no other cross-surface service import exists).
    const specifiers = serviceFromClauses.map(clause => clause.replace(/^from "/, "").replace(/"$/, ""));
    const allowedSpecifiers: ReadonlySet<string> = new Set([
      "@/backend/db/repo",
      "@/backend/enum/audit/audit-action-type.enum",
      "@/backend/enum/billing/subscription-credit-lane.enum",
      "@/backend/enum/scheduling/dispute-resolution.enum",
      "@/backend/enum/scheduling/held-balance-lane.enum",
      "@/backend/enum/scheduling/session-intent.enum",
      "@/backend/enum/scheduling/session-status.enum",
      "@/backend/enum/scheduling/session-type.enum",
      "@/backend/enum/users/user-role.enum",
      "@/backend/lib/errors",
      "@/backend/lib/logger",
      "@/backend/lib/db/with-transaction",
      "@/backend/types",
      "@/shared/constants/session-fees.constants",
      "@/shared/locale/server-graphql",
      "@/backend/services/classes/session-lifecycle.booking",
      "@/backend/services/classes/session-lifecycle.confirmation",
      "@/backend/services/classes/session-lifecycle.governance",
      "@/backend/services/classes/session-lifecycle.guards",
      "@/backend/services/classes/session-lifecycle.queries",
      "@/backend/services/classes/session-lifecycle.transitions",
      "@/backend/services/classes/session-request-notification.service",
      "@/backend/services/classes/student-progress.service",
      "@/backend/services/notifications",
      "@/backend/services/admin/audit.service",
      "@/shared/locale/AppLocale",
    ]);
    for (const specifier of specifiers) {
      expect(allowedSpecifiers.has(specifier)).toBe(true);
    }
    // No duplicate import statements of the same module WITHIN any one file
    // of the unit (siblings legitimately share specifiers).
    for (const source of unitSources) {
      const fileSpecifiers = (source.match(/from "[^"]+"/g) ?? []).map(clause =>
        clause.replace(/^from "/, "").replace(/"$/, "")
      );
      expect(new Set(fileSpecifiers).size).toBe(fileSpecifiers.length);
    }

    // (2) The repository surface is exactly the shared barrel: no deep
    // repository import exists anywhere in the unit, and the UNION of the
    // barrel's named members across the unit is pinned (WalletRepository is
    // the sanctioned wallet channel; no other repository surface is
    // reachable).
    const repoSpecifiers = specifiers.filter(specifier => specifier.includes("@/backend/db/"));
    expect(repoSpecifiers.length).toBeGreaterThan(0);
    for (const specifier of repoSpecifiers) {
      expect(specifier).toBe("@/backend/db/repo");
    }
    const barrelMemberLists = [...serviceSource.matchAll(/import \{([^}]+)\} from "@\/backend\/db\/repo";/g)].map(
      match => match[1] ?? ""
    );
    const barrelMembers = new Set(
      barrelMemberLists
        .flatMap(list => list.split(","))
        .map(member => member.trim())
        .filter(member => member.length > 0)
    );
    expect(barrelMembers).toEqual(
      new Set([
        "SessionRepository",
        "SessionRequestIdempotencyRepository",
        "StudentRepository",
        "SubscriptionRepository",
        "TeacherRepository",
        "UserRepository",
        "WalletRepository",
      ])
    );

    // (3) The only cross-surface-shaped import is the shared tx helper
    // (canonical substrate at `@/backend/lib/db/with-transaction` — the
    // merged repository-wide single truth for SAVEPOINT-vs-top-level tx).
    const serviceImports = specifiers.filter(specifier => specifier.includes("@/backend/lib/db/"));
    expect(new Set(serviceImports)).toEqual(new Set(["@/backend/lib/db/with-transaction"]));
  });

  test("source: the specifier allowlist has no dynamic-import escape hatch — zero import( / require( call sites in the service", () => {
    // HONEST PIN: the allowlist above reads ONLY static `from "…"` clauses,
    // so a dynamic `import("…")` or `require(…)` would load a module without
    // ever entering that scan and silently bypass the financial-isolation
    // allowlist. The service must therefore contain ZERO dynamic import call
    // sites. If this fails, the newly loaded module is unaccounted for:
    // replace the dynamic load with a statically pinned import (admitting its
    // specifier on the allowlist above) or consciously extend BOTH pins in
    // the same change.
    const dynamicImportSites = serviceSource.match(/\bimport\s*\(/g) ?? [];
    const requireCallSites = serviceSource.match(/\brequire\s*\(/g) ?? [];
    expect(dynamicImportSites).toEqual([]);
    expect(requireCallSites).toEqual([]);
  });

  test("source: zero console.* calls and zero raw process.env reads in the service", () => {
    expect(/console\./.test(serviceSource)).toBe(false);
    expect(/process\.env/.test(serviceSource)).toBe(false);
  });
});

// ─── Dispute pair (openSessionDispute / resolveSessionDispute) ──

describe("SessionLifecycleService — dispute pair (runInRollback)", () => {
  test("openSessionDispute happy path: BOTH live states move to disputed with the trimmed reason, the hold frozen, zero balance delta", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { hifz: 2 });

      // From scheduled — the student opens with a reason that needs trimming.
      const scheduled = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-dispute-happy-1"
      );
      const fromScheduled = await SessionLifecycleService.openSessionDispute(
        actors.studentUserId,
        scheduled.id,
        "  schedule conflict  ",
        "en",
        tx
      );
      expect(fromScheduled.status).toBe(SessionStatus.Disputed);
      expect(fromScheduled.disputeReason).toBe("schedule conflict");
      expect(fromScheduled.disputedAt).not.toBeNull();
      // The escrow hold is deliberately FROZEN by the dispute itself —
      // the money stays held until the admin resolution.
      expect(fromScheduled.feeHeld).toBe(true);
      expect(fromScheduled.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      // Zero balance delta: the dispute itself moves NO money — the unit
      // debited at booking time stays in escrow (2 funded, 1 booked).
      const balancesAfterOpen = await readLaneBalances(tx, actors.studentUserId);
      expect(balancesAfterOpen.hifz).toBe(1);
      expect(balancesAfterOpen.trial).toBe(0);

      // From started — the teacher opens on an in-progress row.
      const started = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-dispute-happy-2"
      );
      await SessionLifecycleService.startSession(actors.teacherUserId, started.id, "en", tx);
      const fromStarted = await SessionLifecycleService.openSessionDispute(
        actors.teacherUserId,
        started.id,
        "teacher dispute",
        "en",
        tx
      );
      expect(fromStarted.status).toBe(SessionStatus.Disputed);
      expect(fromStarted.disputeReason).toBe("teacher dispute");
      expect(fromStarted.disputedAt).not.toBeNull();
      // The start stamp survives the dispute transition.
      expect(fromStarted.startedAt).not.toBeNull();
      expect(fromStarted.endedAt).toBeNull();
    });
  });

  test("openSessionDispute reason guard: empty, whitespace-only, and 501-char reasons are VALIDATION denials pre-DB with zero writes", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const row = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-dispute-reason"
      );

      // The three denial shapes are asserted sequentially — each denial is
      // independent, and the zero-write oracle is checked after ALL of them.
      const emptyError = await expectRepoError(() =>
        SessionLifecycleService.openSessionDispute(actors.studentUserId, row.id, "", "en", tx)
      );
      expectDomainDenial(emptyError, "VALIDATION", t().validation);
      const whitespaceError = await expectRepoError(() =>
        SessionLifecycleService.openSessionDispute(actors.studentUserId, row.id, "   \t\n  ", "en", tx)
      );
      expectDomainDenial(whitespaceError, "VALIDATION", t().validation);
      const oversizedError = await expectRepoError(() =>
        SessionLifecycleService.openSessionDispute(actors.studentUserId, row.id, "x".repeat(501), "en", tx)
      );
      expectDomainDenial(oversizedError, "VALIDATION", t().validation);

      // Zero writes: the row and the hold are untouched after every denial
      // (the booking's own debit is the ONLY balance movement — no denial
      // path refunds or debits).
      const untouched = await readSessionRow(tx, row.id);
      expect(untouched?.status).toBe(SessionStatus.Scheduled);
      expect(untouched?.disputeReason).toBeNull();
      expect(untouched?.disputedAt).toBeNull();
      expect(untouched?.feeHeld).toBe(true);
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(0);
    });
  });

  test("openSessionDispute probe chain: unknown id and non-participants are oracle-safe SESSION_NOT_FOUND; terminal and already-disputed rows are SESSION_INVALID_TRANSITION", async () => {
    await runInRollback(async tx => {
      const actorsA = await createSessionActors(tx);
      const actorsB = await createSessionActors(tx);
      const outsider = await createTestUser(tx, { role: "parent" });
      const missingSessionId = await absentSessionId(tx);
      await setLaneBalances(tx, actorsA.studentUserId, { hifz: 4 });

      // Unknown id.
      const unknownError = await expectRepoError(() =>
        SessionLifecycleService.openSessionDispute(actorsA.studentUserId, missingSessionId, "r", "en", tx)
      );
      expectDomainDenial(unknownError, "SESSION_NOT_FOUND", t().sessionNotFound);

      // Non-participants (another student, another teacher, a parent
      // account) are all collapsed onto the SAME oracle-safe denial — a
      // foreign target is indistinguishable from a nonexistent one.
      const row = await bookSession(
        tx,
        actorsA.studentUserId,
        actorsA.teacherUserId,
        SessionIntent.Hifz,
        "key-dispute-oracle"
      );
      const foreignStudentError = await expectRepoError(() =>
        SessionLifecycleService.openSessionDispute(actorsB.studentUserId, row.id, "r", "en", tx)
      );
      expectDomainDenial(foreignStudentError, "SESSION_NOT_FOUND", t().sessionNotFound);
      const foreignTeacherError = await expectRepoError(() =>
        SessionLifecycleService.openSessionDispute(actorsB.teacherUserId, row.id, "r", "en", tx)
      );
      expectDomainDenial(foreignTeacherError, "SESSION_NOT_FOUND", t().sessionNotFound);
      const parentError = await expectRepoError(() =>
        SessionLifecycleService.openSessionDispute(outsider.id, row.id, "r", "en", tx)
      );
      expectDomainDenial(parentError, "SESSION_NOT_FOUND", t().sessionNotFound);
      const stillScheduled = await readSessionRow(tx, row.id);
      expect(stillScheduled?.status).toBe(SessionStatus.Scheduled);

      // Terminal rows are structurally unreachable (INV-S1/S2 intact).
      const completed = await bookSession(
        tx,
        actorsA.studentUserId,
        actorsA.teacherUserId,
        SessionIntent.Hifz,
        "key-dispute-completed"
      );
      await SessionLifecycleService.startSession(actorsA.teacherUserId, completed.id, "en", tx);
      await SessionLifecycleService.completeSession(actorsA.teacherUserId, completed.id, "en", tx);
      const completedError = await expectRepoError(() =>
        SessionLifecycleService.openSessionDispute(actorsA.studentUserId, completed.id, "r", "en", tx)
      );
      expectDomainDenial(completedError, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);

      const cancelled = await bookSession(
        tx,
        actorsA.studentUserId,
        actorsA.teacherUserId,
        SessionIntent.Hifz,
        "key-dispute-cancelled"
      );
      await SessionLifecycleService.cancelSession(actorsA.studentUserId, cancelled.id, null, "en", tx);
      const cancelledError = await expectRepoError(() =>
        SessionLifecycleService.openSessionDispute(actorsA.teacherUserId, cancelled.id, "r", "en", tx)
      );
      expectDomainDenial(cancelledError, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);

      // Double-dispute: the second attempt is a transition conflict and
      // never rewrites the recorded reason.
      const disputed = await bookSession(
        tx,
        actorsA.studentUserId,
        actorsA.teacherUserId,
        SessionIntent.Hifz,
        "key-dispute-double"
      );
      await SessionLifecycleService.openSessionDispute(actorsA.studentUserId, disputed.id, "first reason", "en", tx);
      const doubleError = await expectRepoError(() =>
        SessionLifecycleService.openSessionDispute(actorsA.teacherUserId, disputed.id, "second reason", "en", tx)
      );
      expectDomainDenial(doubleError, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);
      const recorded = await readSessionRow(tx, disputed.id);
      expect(recorded?.status).toBe(SessionStatus.Disputed);
      expect(recorded?.disputeReason).toBe("first reason");
    });
  });

  test("resolveSessionDispute CANCEL outcome: the SAME same-lane refund primitive fires inside the arbitration transaction — refund and status flip commit atomically", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { hifz: 1 });
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-resolve-cancel"
      );
      await SessionLifecycleService.openSessionDispute(actors.studentUserId, row.id, "teacher no-show", "en", tx);

      const resolved = await SessionLifecycleService.resolveSessionDispute(
        admin.id,
        row.id,
        DisputeResolution.Cancel,
        "  refunded in full  ",
        "en",
        tx
      );

      expect(resolved.status).toBe(SessionStatus.Cancelled);
      expect(resolved.feeHeld).toBe(false);
      expect(resolved.resolutionNote).toBe("refunded in full");
      expect(resolved.resolvedAt).not.toBeNull();
      // A cancellation never writes an end stamp; the dispute reason stays.
      expect(resolved.endedAt).toBeNull();
      expect(resolved.disputeReason).toBe("teacher no-show");

      // The refund landed on the recorded provenance lane — EXACTLY one
      // unit (the lane that funded the hold; the hold marker is cleared).
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.hifz).toBe(1);
      expect(balances.trial).toBe(0);
      expect(balances.tajweed).toBe(0);
    });
  });

  test("resolveSessionDispute CANCEL on an unheld disputed row refunds nothing; a whitespace-only note persists NULL", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 2 });
      const admin = await createTestUser(tx, { role: "admin" });

      // An unheld row (feeHeld false, no provenance lane) disputed from
      // scheduled: the CANCEL outcome has no money to move.
      const unheld = await insertSessionRow(tx, actors, { feeHeld: false, heldBalanceLane: null });
      await SessionLifecycleService.openSessionDispute(actors.studentUserId, unheld.id, "r", "en", tx);
      const resolved = await SessionLifecycleService.resolveSessionDispute(
        admin.id,
        unheld.id,
        DisputeResolution.Cancel,
        "   ",
        "en",
        tx
      );
      expect(resolved.status).toBe(SessionStatus.Cancelled);
      expect(resolved.feeHeld).toBe(false);
      expect(resolved.resolutionNote).toBeNull();
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(2);
      expect(balances.hifz).toBe(0);
    });
  });

  test("resolveSessionDispute COMPLETE outcome: consumes the hold with NO wallet credit, writes the end stamp, preserves the start stamp", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-resolve-complete"
      );
      const startedAt = await SessionLifecycleService.startSession(actors.teacherUserId, row.id, "en", tx);
      await SessionLifecycleService.openSessionDispute(actors.teacherUserId, row.id, "disputed mid-session", "en", tx);

      const resolved = await SessionLifecycleService.resolveSessionDispute(
        admin.id,
        row.id,
        DisputeResolution.Complete,
        "held per policy",
        "en",
        tx
      );

      expect(resolved.status).toBe(SessionStatus.Completed);
      // The hold is consumed — and NO wallet credit is part of this outcome
      // (D2/the confirmation pair owns credit): the student's lanes stay exactly as they
      // were after the original debit.
      expect(resolved.feeHeld).toBe(false);
      expect(resolved.resolutionNote).toBe("held per policy");
      expect(resolved.resolvedAt).not.toBeNull();
      expect(resolved.endedAt).not.toBeNull();
      expect(resolved.startedAt?.getTime()).toBe(startedAt.startedAt?.getTime());

      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(0);
      expect(balances.hifz).toBe(0);
      expect(balances.tajweed).toBe(0);
    });
  });

  test("resolveSessionDispute COMPLETE on a never-started dispute is a pre-DB VALIDATION denial — the row stays disputed with its hold intact", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { hifz: 1 });
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-resolve-never-started"
      );
      await SessionLifecycleService.openSessionDispute(actors.studentUserId, row.id, "never happened", "en", tx);

      const error = await expectRepoError(() =>
        SessionLifecycleService.resolveSessionDispute(admin.id, row.id, DisputeResolution.Complete, null, "en", tx)
      );
      expectDomainDenial(error, "VALIDATION", t().validation);

      // The denial mutated nothing: still disputed, hold still frozen.
      const untouched = await readSessionRow(tx, row.id);
      expect(untouched?.status).toBe(SessionStatus.Disputed);
      expect(untouched?.feeHeld).toBe(true);
      expect(untouched?.endedAt).toBeNull();
      expect(untouched?.resolutionNote).toBeNull();
      expect(untouched?.resolvedAt).toBeNull();
    });
  });

  test("resolveSessionDispute probe chain: unknown id → SESSION_NOT_FOUND; non-disputed rows → SESSION_INVALID_TRANSITION; double-resolve → SESSION_INVALID_TRANSITION", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const missingSessionId = await absentSessionId(tx);

      // Unknown id.
      const unknownError = await expectRepoError(() =>
        SessionLifecycleService.resolveSessionDispute(
          admin.id,
          missingSessionId,
          DisputeResolution.Cancel,
          null,
          "en",
          tx
        )
      );
      expectDomainDenial(unknownError, "SESSION_NOT_FOUND", t().sessionNotFound);

      // A scheduled row is not resolvable — the guarded predicate misses.
      const scheduled = await insertSessionRow(tx, actors);
      const scheduledError = await expectRepoError(() =>
        SessionLifecycleService.resolveSessionDispute(admin.id, scheduled.id, DisputeResolution.Cancel, null, "en", tx)
      );
      expectDomainDenial(scheduledError, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);
      const stillScheduled = await readSessionRow(tx, scheduled.id);
      expect(stillScheduled?.status).toBe(SessionStatus.Scheduled);

      // Double-resolve: the second attempt matches zero rows.
      const row = await insertSessionRow(tx, actors);
      await SessionLifecycleService.openSessionDispute(actors.studentUserId, row.id, "r", "en", tx);
      await SessionLifecycleService.resolveSessionDispute(admin.id, row.id, DisputeResolution.Cancel, "n", "en", tx);
      const doubleError = await expectRepoError(() =>
        SessionLifecycleService.resolveSessionDispute(admin.id, row.id, DisputeResolution.Complete, "n2", "en", tx)
      );
      expectDomainDenial(doubleError, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);
      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow?.status).toBe(SessionStatus.Cancelled);
      expect(finalRow?.resolutionNote).toBe("n");
      expect(finalRow?.startedAt).toBeNull();
    });
  });

  test("resolveSessionDispute admin governance re-check: non-admin callers and governed admins fail closed FORBIDDEN before any state change", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);
      await SessionLifecycleService.openSessionDispute(actors.studentUserId, row.id, "r", "en", tx);

      // A still-authenticated non-admin (student) fails the role leg.
      const studentError = await expectRepoError(() =>
        SessionLifecycleService.resolveSessionDispute(
          actors.studentUserId,
          row.id,
          DisputeResolution.Cancel,
          null,
          "en",
          tx
        )
      );
      expectDomainDenial(studentError, "FORBIDDEN", t().forbidden);

      // Governance-flipped admins fail closed too (isDeleted / isBlocked /
      // suspended) — the user row is the authority, never the token. The
      // three variants are asserted sequentially (each denial is
      // independent and leaves the row untouched for the next).
      const deletedAdmin = await createTestUser(tx, { role: "admin", isDeleted: true });
      const deletedError = await expectRepoError(() =>
        SessionLifecycleService.resolveSessionDispute(deletedAdmin.id, row.id, DisputeResolution.Cancel, null, "en", tx)
      );
      expectDomainDenial(deletedError, "FORBIDDEN", t().forbidden);
      const blockedAdmin = await createTestUser(tx, { role: "admin", isBlocked: true });
      const blockedError = await expectRepoError(() =>
        SessionLifecycleService.resolveSessionDispute(blockedAdmin.id, row.id, DisputeResolution.Cancel, null, "en", tx)
      );
      expectDomainDenial(blockedError, "FORBIDDEN", t().forbidden);
      const suspendedAdmin = await createTestUser(tx, { role: "admin", suspended: true });
      const suspendedError = await expectRepoError(() =>
        SessionLifecycleService.resolveSessionDispute(
          suspendedAdmin.id,
          row.id,
          DisputeResolution.Cancel,
          null,
          "en",
          tx
        )
      );
      expectDomainDenial(suspendedError, "FORBIDDEN", t().forbidden);

      // Unknown admin id → same fail-closed FORBIDDEN.
      const absentAdminId = await absentUserId(tx);
      const absentError = await expectRepoError(() =>
        SessionLifecycleService.resolveSessionDispute(absentAdminId, row.id, DisputeResolution.Cancel, null, "en", tx)
      );
      expectDomainDenial(absentError, "FORBIDDEN", t().forbidden);

      // Every denial left the row untouched: still disputed, hold intact.
      const untouched = await readSessionRow(tx, row.id);
      expect(untouched?.status).toBe(SessionStatus.Disputed);
      expect(untouched?.feeHeld).toBe(true);
      expect(untouched?.resolutionNote).toBeNull();
    });
  });

  test("listAdminDisputedSessions: honest totals, newest first, limit clamp 1..50 default 25, offset floor, pinned disputed scope", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      // Future-stamped createdAt overrides keep the window assertions
      // deterministic against any other committed disputed rows.
      const now = Date.now();
      const dispute1 = await insertSessionRow(tx, actors, { createdAt: new Date(now + 3_600_000) });
      const dispute2 = await insertSessionRow(tx, actors, { createdAt: new Date(now + 2 * 3_600_000) });
      const dispute3 = await insertSessionRow(tx, actors, { createdAt: new Date(now + 3 * 3_600_000) });
      const liveRow = await insertSessionRow(tx, actors, { createdAt: new Date(now + 4 * 3_600_000) });

      // The three disputes open sequentially (each is an independent row,
      // but the shared oracle reads below require all three to have landed).
      const opened1 = await SessionLifecycleService.openSessionDispute(
        actors.studentUserId,
        dispute1.id,
        `reason-${dispute1.id}`,
        "en",
        tx
      );
      expect(opened1.status).toBe(SessionStatus.Disputed);
      const opened2 = await SessionLifecycleService.openSessionDispute(
        actors.studentUserId,
        dispute2.id,
        `reason-${dispute2.id}`,
        "en",
        tx
      );
      expect(opened2.status).toBe(SessionStatus.Disputed);
      const opened3 = await SessionLifecycleService.openSessionDispute(
        actors.studentUserId,
        dispute3.id,
        `reason-${dispute3.id}`,
        "en",
        tx
      );
      expect(opened3.status).toBe(SessionStatus.Disputed);

      // The full queue: newest first, honest count — the never-disputed
      // liveRow (newest row overall) never appears.
      const queue = await SessionLifecycleService.listAdminDisputedSessions({}, 50, 0, tx);
      expect(queue.totalCount).toBeGreaterThanOrEqual(3);
      const myIds = [dispute3.id, dispute2.id, dispute1.id];
      expect(queue.items.slice(0, 3).map(row => row.id)).toEqual(myIds);
      expect(queue.items.map(row => row.id)).not.toContain(liveRow.id);
      expect(queue.page).toBe(1);
      expect(queue.pageSize).toBe(50);

      // The limit clamp mirrors the participant lists exactly (1..50,
      // default 25) and the offset floors at zero — both normalize
      // honestly, never error. The page echo is the honest window index.
      const oversized = await SessionLifecycleService.listAdminDisputedSessions({}, 51, 0, tx);
      expect(oversized.pageSize).toBe(25);
      const nonPositive = await SessionLifecycleService.listAdminDisputedSessions({}, 0, 25, tx);
      expect(nonPositive.pageSize).toBe(25);
      expect(nonPositive.page).toBe(2);
      const negativeOffset = await SessionLifecycleService.listAdminDisputedSessions({}, 25, -4, tx);
      expect(negativeOffset.page).toBe(1);

      // A short window truncates the page; the offset skips forward without
      // shrinking the honest total.
      const clamped = await SessionLifecycleService.listAdminDisputedSessions({}, 2, 0, tx);
      expect(clamped.items.map(row => row.id)).toEqual([dispute3.id, dispute2.id]);
      expect(clamped.totalCount).toBe(queue.totalCount);
      const skipped = await SessionLifecycleService.listAdminDisputedSessions({}, 2, 1, tx);
      expect(skipped.items.map(row => row.id)).toEqual([dispute2.id, dispute1.id]);

      // A filter explicitly contradicting the pinned disputed scope (any
      // in-vocabulary status other than disputed) is the honest EMPTY page
      // — zero items AND zero count, coherently.
      const contradictory = await SessionLifecycleService.listAdminDisputedSessions(
        { status: SessionStatus.Scheduled },
        25,
        0,
        tx
      );
      expect(contradictory.items).toHaveLength(0);
      expect(contradictory.totalCount).toBe(0);

      // The pinned scope itself: an explicit disputed filter behaves like
      // the unfiltered queue (one identical set).
      const pinned = await SessionLifecycleService.listAdminDisputedSessions(
        { status: SessionStatus.Disputed },
        25,
        0,
        tx
      );
      expect(pinned.totalCount).toBe(queue.totalCount);
      expect(pinned.items.slice(0, 3).map(row => row.id)).toEqual(myIds);
    });
  });
});

// ─── Arbitration audit trail (Override rows on the dispute's own tx) ────

describe("SessionLifecycleService — arbitration audit trail (runInRollback)", () => {
  test("CANCEL arbitration mints exactly one Override/session row recording the resolution and the note's presence — never its content", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { hifz: 1 });
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-arbitrate-cancel-row"
      );
      await SessionLifecycleService.openSessionDispute(actors.studentUserId, row.id, "teacher no-show", "en", tx);

      await SessionLifecycleService.resolveSessionDispute(
        admin.id,
        row.id,
        DisputeResolution.Cancel,
        "  refunded in full  ",
        "en",
        tx
      );

      const rows = await fetchSessionAuditRows(tx, admin.id, row.id);
      expect(rows).toHaveLength(1);
      const trailRow = rows[0];
      if (!trailRow) throw new Error("expected one audit(Override) row for the cancelled arbitration");
      expect(trailRow.actionType).toBe(rawActionType(AuditActionType.Override));
      expect(trailRow.entityType).toBe("session");
      expect(trailRow.entityId).toBe(row.id);
      expect(JSON.parse(trailRow.details ?? "null")).toEqual({
        resolution: DisputeResolution.Cancel,
        notePresent: true,
      });
      // The note's free-text content must never reach the trail.
      expect(trailRow.details).not.toContain("refunded");
    });
  });

  test("COMPLETE arbitration (started row) mints one Override row with notePresent false when no note is supplied", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-arbitrate-complete-row"
      );
      await SessionLifecycleService.startSession(actors.teacherUserId, row.id, "en", tx);
      await SessionLifecycleService.openSessionDispute(actors.teacherUserId, row.id, "disputed mid-session", "en", tx);

      await SessionLifecycleService.resolveSessionDispute(admin.id, row.id, DisputeResolution.Complete, null, "en", tx);

      const rows = await fetchSessionAuditRows(tx, admin.id, row.id);
      expect(rows).toHaveLength(1);
      const trailRow = rows[0];
      if (!trailRow) throw new Error("expected one audit(Override) row for the completed arbitration");
      expect(trailRow.actionType).toBe(rawActionType(AuditActionType.Override));
      expect(JSON.parse(trailRow.details ?? "null")).toEqual({
        resolution: DisputeResolution.Complete,
        notePresent: false,
      });
    });
  });

  test("a bad-state arbitration denial mints ZERO audit rows", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { hifz: 1 });
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-arbitrate-denied-row"
      );
      // Never disputed: arbitration is a VALIDATION denial before any write.
      const error = await expectRepoError(() =>
        SessionLifecycleService.resolveSessionDispute(admin.id, row.id, DisputeResolution.Cancel, null, "en", tx)
      );
      expectDomainDenial(error, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);

      expect(await countAuditRowsForActor(tx, admin.id)).toBe(0);
    });
  });
});

// ─── REQ-043 chaos (production tx path, committed fixtures) ─────────────

describe("SessionLifecycleService — REQ-043 chaos (production tx path, committed fixtures)", () => {
  let chaosTeacherId = 0;
  let chaosStudentId = 0;

  beforeAll(async () => {
    await db.transaction(async tx => {
      const actors = await createSessionActors(tx);
      chaosTeacherId = actors.teacherUserId;
      chaosStudentId = actors.studentUserId;
    });
  });

  afterAll(async () => {
    // FK-safe hard delete: claims → sessions → users (the users delete
    // cascades the students/teacher role-child rows).
    await db.delete(sessionRequestIdempotency).where(eq(sessionRequestIdempotency.userId, chaosStudentId));
    await db.delete(session).where(eq(session.studentId, chaosStudentId));
    await db.delete(users).where(eq(users.id, chaosStudentId));
    await db.delete(users).where(eq(users.id, chaosTeacherId));
  });

  /** Committed lane setup for the chaos fixtures (production-path bookings). */
  async function setChaosBalances(balances: { trial?: number; hifz?: number; tajweed?: number }): Promise<void> {
    await db
      .update(students)
      .set({
        balanceTrial: balances.trial ?? 0,
        balanceHifz: balances.hifz ?? 0,
        balanceTajweed: balances.tajweed ?? 0,
      })
      .where(eq(students.id, chaosStudentId));
  }

  async function readChaosBalances() {
    const [row] = await db
      .select({ trial: students.balanceTrial, hifz: students.balanceHifz, tajweed: students.balanceTajweed })
      .from(students)
      .where(eq(students.id, chaosStudentId));
    if (!row) {
      throw new Error("readChaosBalances: chaos student row vanished");
    }
    return row;
  }

  async function countChaosSessions(): Promise<number> {
    const rows = await db.select({ id: session.id }).from(session).where(eq(session.studentId, chaosStudentId));
    return rows.length;
  }

  async function countChaosClaims(): Promise<number> {
    const rows = await db
      .select({ id: sessionRequestIdempotency.id })
      .from(sessionRequestIdempotency)
      .where(eq(sessionRequestIdempotency.userId, chaosStudentId));
    return rows.length;
  }

  function chaosBook(intent: SessionStudentIntentType, key: string): Promise<SessionReturnType> {
    // NO outerTx — the production path: the service opens its own
    // transaction, giving every concurrent call a real connection.
    return SessionLifecycleService.createSession(chaosStudentId, { teacherId: chaosTeacherId, intent }, key, "en");
  }

  testOnRealPostgres(
    "REQ-043(a): concurrent double-start → one success + one SESSION_INVALID_TRANSITION, final started",
    async () => {
      await setChaosBalances({ trial: 1 });
      const created = await chaosBook(SessionIntent.Hifz, `chaos-a-${randomUUID()}`);

      const outcomes = await Promise.allSettled([
        SessionLifecycleService.startSession(chaosTeacherId, created.id, "en"),
        SessionLifecycleService.startSession(chaosTeacherId, created.id, "en"),
      ]);

      const fulfillments = outcomes.flatMap(outcome => (outcome.status === "fulfilled" ? [outcome.value] : []));
      const rejections = outcomes.flatMap(outcome => (outcome.status === "rejected" ? [outcome.reason] : []));
      expect(fulfillments).toHaveLength(1);
      expect(rejections).toHaveLength(1);
      expect(fulfillments[0]?.status).toBe(SessionStatus.Started);
      expect(rejections[0]).toBeInstanceOf(DomainError);
      expect(rejectionCode(rejections[0])).toBe("SESSION_INVALID_TRANSITION");

      const finalRow = await readChaosSessionRow(created.id);
      expect(finalRow?.status).toBe(SessionStatus.Started);
      expect(finalRow?.startedAt).not.toBeNull();
      expect(finalRow?.endedAt).toBeNull();
    }
  );

  testOnRealPostgres(
    "REQ-043(b): start⚡cancel race serializes to one consistent state — refund iff cancel wins (it always does)",
    async () => {
      await setChaosBalances({ trial: 1 });
      const created = await chaosBook(SessionIntent.Hifz, `chaos-b-${randomUUID()}`);

      const outcomes = await Promise.allSettled([
        SessionLifecycleService.startSession(chaosTeacherId, created.id, "en"),
        SessionLifecycleService.cancelSession(chaosStudentId, created.id, null, "en"),
      ]);

      const fulfillments = outcomes.flatMap(outcome => (outcome.status === "fulfilled" ? [outcome.value] : []));
      const rejections = outcomes.flatMap(outcome => (outcome.status === "rejected" ? [outcome.reason] : []));

      // Cancel is legal from BOTH pre-start states, so it never loses; the
      // start wins only if its guarded UPDATE acquired the row lock first.
      const cancelledOutcome = fulfillments.find(value => value.status === SESSION_CANCELLED_STATUS);
      expect(cancelledOutcome).toBeDefined();
      for (const rejection of rejections) {
        expect(rejection).toBeInstanceOf(DomainError);
        expect(rejectionCode(rejection)).toBe("SESSION_INVALID_TRANSITION");
      }

      const finalRow = await readChaosSessionRow(created.id);
      expect(finalRow?.status).toBe(SessionStatus.Cancelled);
      expect(finalRow?.feeHeld).toBe(false);
      expect(finalRow?.endedAt).toBeNull();
      // The start stamp survives iff the start landed before the cancel.
      if (fulfillments.some(value => value.status === SESSION_STARTED_STATUS)) {
        expect(finalRow?.startedAt).not.toBeNull();
      } else {
        expect(finalRow?.startedAt).toBeNull();
      }

      // Refund iff cancel won — and EXACTLY once (one unit back on trial).
      const balances = await readChaosBalances();
      expect(balances.trial).toBe(1);
      expect(balances.hifz).toBe(0);
      expect(balances.tajweed).toBe(0);
    }
  );

  testOnRealPostgres(
    "REQ-043(c): concurrent double-complete → one success, confirmedByTeacherAt written once, loser is a transition conflict",
    async () => {
      await setChaosBalances({ trial: 1 });
      const created = await chaosBook(SessionIntent.Hifz, `chaos-c-${randomUUID()}`);
      await SessionLifecycleService.startSession(chaosTeacherId, created.id, "en");

      const outcomes = await Promise.allSettled([
        SessionLifecycleService.completeSession(chaosTeacherId, created.id, "en"),
        SessionLifecycleService.completeSession(chaosTeacherId, created.id, "en"),
      ]);

      const fulfillments = outcomes.flatMap(outcome => (outcome.status === "fulfilled" ? [outcome.value] : []));
      const rejections = outcomes.flatMap(outcome => (outcome.status === "rejected" ? [outcome.reason] : []));
      expect(fulfillments).toHaveLength(1);
      expect(rejections).toHaveLength(1);
      expect(fulfillments[0]?.status).toBe(SessionStatus.Completed);
      expect(fulfillments[0]?.confirmedByTeacherAt).not.toBeNull();
      expect(rejectionCode(rejections[0])).toBe("SESSION_INVALID_TRANSITION");

      const finalRow = await readChaosSessionRow(created.id);
      expect(finalRow?.status).toBe(SessionStatus.Completed);
      expect(finalRow?.endedAt).not.toBeNull();
      // The confirmation stamp is the ONE write the winner made.
      expect(finalRow?.confirmedByTeacherAt?.getTime()).toBe(fulfillments[0]?.confirmedByTeacherAt?.getTime());
    }
  );

  testOnRealPostgres(
    "REQ-043(d): two concurrent creations with ONE unit → exactly one session + one INSUFFICIENT_BALANCE, lanes never negative",
    async () => {
      await setChaosBalances({ trial: 1 });

      // The chaos block shares one committed student, so the count oracles are
      // scoped per test: the race must add EXACTLY one session and one claim
      // on top of the earlier tests' committed rows.
      const baselineSessions = await countChaosSessions();
      const baselineClaims = await countChaosClaims();

      const outcomes = await Promise.allSettled([
        chaosBook(SessionIntent.Hifz, `chaos-d-${randomUUID()}`),
        chaosBook(SessionIntent.Hifz, `chaos-d-${randomUUID()}`),
      ]);

      const fulfillments = outcomes.flatMap(outcome => (outcome.status === "fulfilled" ? [outcome.value] : []));
      const rejections = outcomes.flatMap(outcome => (outcome.status === "rejected" ? [outcome.reason] : []));
      expect(fulfillments).toHaveLength(1);
      expect(rejections).toHaveLength(1);
      expect(rejections[0]).toBeInstanceOf(ValidationError);
      expect(rejectionCode(rejections[0])).toBe("INSUFFICIENT_BALANCE");

      expect(await countChaosSessions()).toBe(baselineSessions + 1);
      expect(await countChaosClaims()).toBe(baselineClaims + 1);
      const balances = await readChaosBalances();
      expect(balances.trial).toBe(0);
      expect(balances.hifz).toBe(0);
      expect(balances.tajweed).toBe(0);
    }
  );

  testOnRealPostgres(
    "REQ-043(e): the same key replayed concurrently N=4 times → exactly one session, one net debit, three DUPLICATE_REQUEST denials",
    async () => {
      // Fund the paid lane with N units so every concurrent flow passes the
      // ladder and reaches the claim insert — the genuine 23505 race. The
      // losers' flows throw DUPLICATE_REQUEST, so their own ladder debits
      // roll back: exactly ONE net debit survives (REQ-073).
      await setChaosBalances({ hifz: 4 });
      const sharedKey = `chaos-e-${randomUUID()}`;

      // Per-test scoping (shared committed chaos student — see REQ-043(d)).
      const baselineSessions = await countChaosSessions();
      const baselineClaims = await countChaosClaims();

      const outcomes = await Promise.allSettled([
        chaosBook(SessionIntent.Hifz, sharedKey),
        chaosBook(SessionIntent.Hifz, sharedKey),
        chaosBook(SessionIntent.Hifz, sharedKey),
        chaosBook(SessionIntent.Hifz, sharedKey),
      ]);

      const fulfillments = outcomes.flatMap(outcome => (outcome.status === "fulfilled" ? [outcome.value] : []));
      const rejections = outcomes.flatMap(outcome => (outcome.status === "rejected" ? [outcome.reason] : []));
      expect(fulfillments).toHaveLength(1);
      expect(rejections).toHaveLength(3);
      for (const rejection of rejections) {
        expect(rejection).toBeInstanceOf(DomainError);
        expect(rejectionCode(rejection)).toBe("DUPLICATE_REQUEST");
      }

      // One session, one claim, one net debit — every other flow rolled back.
      expect(await countChaosSessions()).toBe(baselineSessions + 1);
      expect(await countChaosClaims()).toBe(baselineClaims + 1);
      const balances = await readChaosBalances();
      expect(balances.hifz).toBe(3);
      expect(balances.trial).toBe(0);
      expect(balances.tajweed).toBe(0);

      const claimRows = await db
        .select()
        .from(sessionRequestIdempotency)
        .where(eq(sessionRequestIdempotency.idempotencyKey, sharedKey));
      expect(claimRows).toHaveLength(1);
      expect(claimRows[0]?.sessionId).toBe(fulfillments[0]?.id);
    }
  );
});

// ─── Dual confirmation + deadline sweeper ──────────────────────────

describe("SessionLifecycleService — dual confirmation (runInRollback)", () => {
  test("confirmSessionCompletion happy path: student stamp + hold release + EXACTLY ONE earning credit (ledger row + wallet increment) in one flow", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const row = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-d12-confirm-happy"
      );
      await SessionLifecycleService.startSession(actors.teacherUserId, row.id, "en", tx);
      await SessionLifecycleService.completeSession(actors.teacherUserId, row.id, "en", tx);

      const confirmed = await SessionLifecycleService.confirmSessionCompletion(actors.studentUserId, row.id, "en", tx);

      // The row: student stamp written, hold consumed by earning.
      expect(confirmed.status).toBe(SessionStatus.Completed);
      expect(confirmed.confirmedByStudentAt).not.toBeNull();
      expect(confirmed.confirmedByTeacherAt).not.toBeNull();
      expect(confirmed.feeHeld).toBe(false);

      // The credit slice: EXACTLY ONE earning ledger row with the fee
      // verbatim, and the wallet incremented by exactly that fee.
      const walletRow = await WalletRepository.findByTeacherId(actors.teacherUserId, tx);
      expect(walletRow).not.toBeNull();
      const expectedFee = SESSION_FEE_HIFZ;
      expect(walletRow?.balance).toBe(expectedFee);
      expect(walletRow?.totalEarning).toBe(expectedFee);
      const ledger = await WalletRepository.listTransactionsByWalletId(walletRow?.id ?? -1, tx);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.type).toBe("earning");
      expect(ledger[0]?.amount).toBe(expectedFee);
      expect(ledger[0]?.sessionId).toBe(row.id);
      expect(ledger[0]?.status).toBe("completed");

      // The student's lanes: debited at booking, NEVER refunded by the
      // confirm (the hold is consumed by earning, not released).
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(0);
    });
  });

  test("confirmSessionCompletion is IDEMPOTENT: a replayed confirm returns the current row with ZERO new financial writes", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const row = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-d12-confirm-replay"
      );
      await SessionLifecycleService.startSession(actors.teacherUserId, row.id, "en", tx);
      await SessionLifecycleService.completeSession(actors.teacherUserId, row.id, "en", tx);
      await SessionLifecycleService.confirmSessionCompletion(actors.studentUserId, row.id, "en", tx);

      const walletBefore = await WalletRepository.findByTeacherId(actors.teacherUserId, tx);
      const ledgerBefore = await WalletRepository.listTransactionsByWalletId(walletBefore?.id ?? -1, tx);

      const replayed = await SessionLifecycleService.confirmSessionCompletion(actors.studentUserId, row.id, "en", tx);

      expect(replayed.id).toBe(row.id);
      expect(replayed.feeHeld).toBe(false);
      expect(replayed.confirmedByStudentAt).not.toBeNull();
      const walletAfter = await WalletRepository.findByTeacherId(actors.teacherUserId, tx);
      expect(walletAfter?.balance).toBe(walletBefore?.balance);
      const ledgerAfter = await WalletRepository.listTransactionsByWalletId(walletAfter?.id ?? -1, tx);
      expect(ledgerAfter).toHaveLength(ledgerBefore.length);
    });
  });

  test("confirmSessionCompletion by the TEACHER is an idempotent no-op: the row returns untouched, zero financial writes", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const row = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-d12-confirm-teacher"
      );
      await SessionLifecycleService.startSession(actors.teacherUserId, row.id, "en", tx);
      await SessionLifecycleService.completeSession(actors.teacherUserId, row.id, "en", tx);

      const result = await SessionLifecycleService.confirmSessionCompletion(actors.teacherUserId, row.id, "en", tx);

      // The teacher's stamp was already written by completion; the STUDENT
      // stamp is untouched and the hold is still frozen — no credit ran.
      expect(result.id).toBe(row.id);
      expect(result.confirmedByStudentAt).toBeNull();
      expect(result.feeHeld).toBe(true);
      const walletRow = await WalletRepository.findByTeacherId(actors.teacherUserId, tx);
      expect(walletRow).toBeNull();
    });
  });

  test("confirmSessionCompletion denials: scheduled row → SESSION_INVALID_TRANSITION; foreign caller → oracle-safe SESSION_NOT_FOUND", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const foreign = await createTestUser(tx, { role: "student" });
      const row = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-d12-confirm-denials"
      );

      const transitionError = await expectRepoError(() =>
        SessionLifecycleService.confirmSessionCompletion(actors.studentUserId, row.id, "en", tx)
      );
      expectDomainDenial(transitionError, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);

      const foreignError = await expectRepoError(() =>
        SessionLifecycleService.confirmSessionCompletion(foreign.id, row.id, "en", tx)
      );
      expectDomainDenial(foreignError, "SESSION_NOT_FOUND", t().sessionNotFound);
    });
  });
});

// ─── Confirm-path curriculum progress (the settled arm's pointer) ──

describe("SessionLifecycleService — confirm-path curriculum progress (runInRollback)", () => {
  test("the settled confirm advances the curriculum pointer: the first confirm inserts the row at the SECOND lesson in the same flow as the credit", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { tajweed: 1 });
      const { lessons } = await createCurriculum(tx, actors.studentUserId);
      const row = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Tajweed,
        "key-d12-progress-first"
      );
      await SessionLifecycleService.startSession(actors.teacherUserId, row.id, "en", tx);
      await SessionLifecycleService.completeSession(actors.teacherUserId, row.id, "en", tx);

      const confirmed = await SessionLifecycleService.confirmSessionCompletion(actors.studentUserId, row.id, "en", tx);

      // The financial slice still ran — the pointer advance composes
      // AFTER the credit on the SAME transaction.
      expect(confirmed.status).toBe(SessionStatus.Completed);
      expect(confirmed.feeHeld).toBe(false);
      const walletRow = await WalletRepository.findByTeacherId(actors.teacherUserId, tx);
      expect(walletRow?.balance).toBe(SESSION_FEE_TAJWEED);

      // The pointer: lazily created, pointing one slot ahead of the
      // just-completed first lesson.
      const pointerRows = await readProgressRows(tx, actors.studentUserId);
      expect(pointerRows).toHaveLength(1);
      expect(pointerRows[0]?.lessonId).toBe(lessons[1]?.id);
    });
  });

  test("the replayed confirm returns the settled row and the pointer does NOT move again", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { tajweed: 1 });
      const { lessons } = await createCurriculum(tx, actors.studentUserId);
      const row = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Tajweed,
        "key-d12-progress-replay"
      );
      await SessionLifecycleService.startSession(actors.teacherUserId, row.id, "en", tx);
      await SessionLifecycleService.completeSession(actors.teacherUserId, row.id, "en", tx);
      await SessionLifecycleService.confirmSessionCompletion(actors.studentUserId, row.id, "en", tx);
      const pointerBefore = await readProgressRows(tx, actors.studentUserId);
      expect(pointerBefore).toHaveLength(1);

      const replayed = await SessionLifecycleService.confirmSessionCompletion(actors.studentUserId, row.id, "en", tx);

      expect(replayed.id).toBe(row.id);
      expect(replayed.feeHeld).toBe(false);
      const pointerAfter = await readProgressRows(tx, actors.studentUserId);
      expect(pointerAfter).toHaveLength(1);
      expect(pointerAfter[0]?.id).toBe(pointerBefore[0]?.id);
      expect(pointerAfter[0]?.lessonId).toBe(lessons[1]?.id);
      const walletRow = await WalletRepository.findByTeacherId(actors.teacherUserId, tx);
      const ledger = await WalletRepository.listTransactionsByWalletId(walletRow?.id ?? -1, tx);
      expect(ledger).toHaveLength(1);
    });
  });

  test("an evaluation-intent settlement credits the wallet but NEVER moves the pointer", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      // The full curriculum context exists — the intent is the ONLY thing
      // that must keep the pointer frozen (the booking service refuses
      // the evaluation intent, so the settled shape is inserted directly,
      // mirroring the sweeper's completed-leg fixture).
      await createCurriculum(tx, actors.studentUserId);
      const evaluationSession = await insertSessionRow(tx, actors, {
        intent: SessionIntent.Evaluation,
        status: SessionStatus.Completed,
        confirmedByTeacherAt: new Date(),
        fee: SESSION_FEE_TAJWEED,
        feeHeld: true,
        heldBalanceLane: HeldBalanceLane.Tajweed,
      });

      const settled = await SessionLifecycleService.confirmSessionCompletion(
        actors.studentUserId,
        evaluationSession.id,
        "en",
        tx
      );

      // The settlement itself is intent-blind: the wallet is credited
      // through the same tajweed financial lane.
      expect(settled.feeHeld).toBe(false);
      const walletRow = await WalletRepository.findByTeacherId(actors.teacherUserId, tx);
      expect(walletRow?.balance).toBe(SESSION_FEE_TAJWEED);

      // …but the curriculum pointer is untouched.
      expect(await readProgressRows(tx, actors.studentUserId)).toHaveLength(0);
    });
  });

  test("a failed curriculum advance fails the WHOLE confirmation closed: hold frozen, wallet uncredited, zero pointer rows — a clean retry then settles", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { tajweed: 1 });
      const { lessons } = await createCurriculum(tx, actors.studentUserId);
      const row = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Tajweed,
        "key-d12-progress-chaos"
      );
      await SessionLifecycleService.startSession(actors.teacherUserId, row.id, "en", tx);
      await SessionLifecycleService.completeSession(actors.teacherUserId, row.id, "en", tx);

      // Chaos injection: a transactional trigger raises on THIS student's
      // progress inserts only (the advance's first write). The DDL lives
      // inside the rolled-back test transaction — nothing leaks into the
      // shared database.
      const failFn = `raise_progress_insert_fail_${randomUUID().slice(0, 8).replaceAll("-", "_")}`;
      const failTrigger = `fail_progress_insert_${randomUUID().slice(0, 8).replaceAll("-", "_")}`;
      await tx.execute(
        sql.raw(
          `CREATE FUNCTION ${failFn}() RETURNS trigger LANGUAGE plpgsql AS $fn$ ` +
            `BEGIN RAISE EXCEPTION 'forced progress-insert failure'; END; $fn$;`
        )
      );
      await tx.execute(
        sql.raw(
          `CREATE TRIGGER ${failTrigger} ` +
            `BEFORE INSERT ON progress FOR EACH ROW WHEN (NEW.student_id = ${actors.studentUserId}) ` +
            `EXECUTE FUNCTION ${failFn}()`
        )
      );

      const error = await expectRepoError(() =>
        SessionLifecycleService.confirmSessionCompletion(actors.studentUserId, row.id, "en", tx)
      );
      // The raw database failure surfaced untouched (no DomainError
      // masking) as a raise_exception from the trigger.
      expect(error).not.toBeInstanceOf(DomainError);
      expect(hasPostgresErrorCode(error, PG_RAISE_EXCEPTION)).toBe(true);

      // Fail-closed: the whole confirmation rolled back — the hold is
      // still frozen, the wallet was never ensured or credited, and no
      // pointer row exists.
      const rolledBack = await readSessionRow(tx, row.id);
      expect(rolledBack?.status).toBe(SessionStatus.Completed);
      expect(rolledBack?.feeHeld).toBe(true);
      expect(rolledBack?.confirmedByStudentAt).toBeNull();
      expect(await WalletRepository.findByTeacherId(actors.teacherUserId, tx)).toBeNull();
      expect(await readProgressRows(tx, actors.studentUserId)).toHaveLength(0);

      // Dropping the trigger and retrying settles the SAME session: the
      // failure was the injected fault, not a poisoned state.
      await tx.execute(sql.raw(`DROP TRIGGER ${failTrigger} ON progress`));
      const retried = await SessionLifecycleService.confirmSessionCompletion(actors.studentUserId, row.id, "en", tx);
      expect(retried.feeHeld).toBe(false);
      const walletRow = await WalletRepository.findByTeacherId(actors.teacherUserId, tx);
      expect(walletRow?.balance).toBe(SESSION_FEE_TAJWEED);
      const pointerRows = await readProgressRows(tx, actors.studentUserId);
      expect(pointerRows).toHaveLength(1);
      expect(pointerRows[0]?.lessonId).toBe(lessons[1]?.id);
    });
  });
});

describe("SessionLifecycleService — deadline sweeper (runInRollback)", () => {
  test("sweepExpiredSessions: expired scheduled rows cancel + same-lane refund; live rows untouched; second sweep is a zero-row no-op", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 2 });
      const expiredHeld = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-d12-sweep-held"
      );
      const live = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-d12-sweep-live"
      );

      // Force the first row past its deadline (deadline is never re-armed
      // by design — the test plays the clock, not the lifecycle).
      await tx
        .update(session)
        .set({ confirmationDeadline: new Date(Date.now() - 1000) })
        .where(eq(session.id, expiredHeld.id));

      const result = await SessionLifecycleService.sweepExpiredSessions(tx);

      expect(result.cancelled).toBe(1);
      expect(result.refunded).toBe(1);

      const swept = await readSessionRow(tx, expiredHeld.id);
      expect(swept?.status).toBe(SessionStatus.Cancelled);
      expect(swept?.feeHeld).toBe(false);
      const untouched = await readSessionRow(tx, live.id);
      expect(untouched?.status).toBe(SessionStatus.Scheduled);
      expect(untouched?.feeHeld).toBe(true);

      // The same-lane refund: the trial lane that funded the hold is
      // re-incremented exactly once.
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.trial).toBe(1);

      // Idempotent: the second sweep matches zero rows.
      const second = await SessionLifecycleService.sweepExpiredSessions(tx);
      expect(second.cancelled).toBe(0);
      expect(second.refunded).toBe(0);
    });
  });

  test("sweepExpiredSessions: a no-hold legacy row (NULL lane) cancels with NO refund counted", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
      const legacy = await bookSession(
        tx,
        actors.studentUserId,
        actors.teacherUserId,
        SessionIntent.Hifz,
        "key-d12-sweep-legacy"
      );
      // DEV1-era shape: no hold, no recorded lane.
      await tx
        .update(session)
        .set({ feeHeld: false, heldBalanceLane: null, confirmationDeadline: new Date(Date.now() - 1000) })
        .where(eq(session.id, legacy.id));

      const result = await SessionLifecycleService.sweepExpiredSessions(tx);

      expect(result.cancelled).toBe(1);
      expect(result.refunded).toBe(0);
      const swept = await readSessionRow(tx, legacy.id);
      expect(swept?.status).toBe(SessionStatus.Cancelled);
      expect(swept?.heldBalanceLane).toBeNull();
    });
  });
});

// ─── Completion-handshake composition (confirm prompt + two-leg sweep) ──

/**
 * Installs a counting no-op over the engine's publish contract so tests can
 * prove exactly WHICH flows hand receipts to the engine. Callers MUST
 * restore in a `finally` — the engine namespace is shared module state.
 */
function countPublishes(): { receipts: NotificationDeliveryReceipt[][]; stop: () => void } {
  const recorded: NotificationDeliveryReceipt[][] = [];
  const spy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async receipts => {
    recorded.push([...receipts]);
  });
  return { receipts: recorded, stop: () => spy.mockRestore() };
}

/**
 * Read-back oracle for the notification rows pinned to one session id —
 * optionally narrowed to one notification type (booking waves are
 * `SessionRequest`, completion/sweeper waves `SessionCompletion`), so a
 * lifecycle-flow assertion counts only the rows ITS flow writes.
 */
async function readWaveRows(tx: DBTransaction, sessionId: number, type?: NotificationType) {
  const predicate =
    type === undefined
      ? eq(notifications.relatedEntityId, sessionId)
      : and(eq(notifications.relatedEntityId, sessionId), eq(notifications.type, type));
  return tx.select().from(notifications).where(predicate);
}

/** The teacher fixture's display name (composed verbatim into wave copy). */
async function readTeacherName(tx: DBTransaction, teacherUserId: number): Promise<string> {
  const [row] = await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, teacherUserId));
  if (!row) {
    throw new Error("readTeacherName: teacher row vanished");
  }
  return row.fullName;
}

/** The student fixture's display name (composed verbatim into intake copy). */
async function readStudentName(tx: DBTransaction, studentUserId: number): Promise<string> {
  const [row] = await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, studentUserId));
  if (!row) {
    throw new Error("readStudentName: student row vanished");
  }
  return row.fullName;
}

describe("SessionLifecycleService — completion prompt wave (runInRollback)", () => {
  test("the receipt-bearing completion emits the student's confirm prompt ONCE on the caller's transaction and returns the receipt unpublished", async () => {
    await runInRollback(async tx => {
      const publish = countPublishes();
      try {
        const actors = await createSessionActors(tx);
        // The student persists an English locale so the recipient-locale
        // copy below is deterministic — a locale-less user falls back to
        // the platform default (Arabic), a fallback the wave suite pins.
        await tx.update(users).set({ locale: "en" }).where(eq(users.id, actors.studentUserId));
        await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
        const row = await bookSession(
          tx,
          actors.studentUserId,
          actors.teacherUserId,
          SessionIntent.Hifz,
          "key-wave-complete-once"
        );
        await SessionLifecycleService.startSession(actors.teacherUserId, row.id, "en", tx);
        const teacherName = await readTeacherName(tx, actors.teacherUserId);

        const result = await SessionLifecycleService.completeSessionWithReceipt(actors.teacherUserId, row.id, "en", tx);

        // The session half is the familiar guarded transition's answer.
        expect(result.session.id).toBe(row.id);
        expect(result.session.status).toBe(SessionStatus.Completed);
        expect(result.session.confirmedByTeacherAt).not.toBeNull();

        // The receipt: student-addressed (the recipient derives server-side
        // from the joined wave-context read). The deterministic claim-key
        // namespace itself is the wave suite's pinned contract — on this
        // production path the engine runs without an injected claim cache,
        // so the receipt carries no replay handle.
        expect(result.receipt.recipientUserIds).toEqual([actors.studentUserId]);
        expect(result.receipt.notifications).toHaveLength(1);

        // Exactly ONE completion prompt row (narrowed to the completion
        // type — the booking's own teacher intake wave shares the session
        // id), composed in the recipient's locale copy through the
        // notifications namespace (the request locale only feeds error
        // copy).
        const waveRows = await readWaveRows(tx, row.id, NotificationType.SessionCompletion);
        expect(waveRows).toHaveLength(1);
        expect(waveRows[0]?.userId).toBe(actors.studentUserId);
        expect(waveRows[0]?.type).toBe(NotificationType.SessionCompletion);
        expect(waveRows[0]?.title).toBe(NOTIFS_EN.eventSessionCompletionPromptTitle);
        expect(waveRows[0]?.body).toBe(NOTIFS_EN.eventSessionCompletionPromptBody(teacherName));

        // Caller-tx: the flow NEVER publishes — the caller owns the commit.
        expect(publish.receipts).toHaveLength(0);
      } finally {
        publish.stop();
      }
    });
  });

  test("the prompt is denial-free and once-per-session: a denied completion and a replayed completion write zero new notification rows", async () => {
    await runInRollback(async tx => {
      const publish = countPublishes();
      try {
        const actors = await createSessionActors(tx);
        await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
        const row = await bookSession(
          tx,
          actors.studentUserId,
          actors.teacherUserId,
          SessionIntent.Hifz,
          "key-wave-deny-replay"
        );

        // DENIED completion (row still scheduled): the classified conflict
        // writes zero COMPLETION rows (the booking's own teacher intake
        // wave is the only row for this session) — nothing to publish
        // either.
        const denied = await expectRepoError(() =>
          SessionLifecycleService.completeSession(actors.teacherUserId, row.id, "en", tx)
        );
        expectDomainDenial(denied, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);
        expect(await readWaveRows(tx, row.id, NotificationType.SessionCompletion)).toHaveLength(0);
        expect(publish.receipts).toHaveLength(0);

        // FIRST completion: the one and only prompt row.
        await SessionLifecycleService.startSession(actors.teacherUserId, row.id, "en", tx);
        const completed = await SessionLifecycleService.completeSession(actors.teacherUserId, row.id, "en", tx);
        expect(completed.status).toBe(SessionStatus.Completed);
        expect(await readWaveRows(tx, row.id, NotificationType.SessionCompletion)).toHaveLength(1);

        // REPLAYED completion: conflict again, still exactly one prompt row.
        const replay = await expectRepoError(() =>
          SessionLifecycleService.completeSession(actors.teacherUserId, row.id, "en", tx)
        );
        expectDomainDenial(replay, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);
        expect(await readWaveRows(tx, row.id, NotificationType.SessionCompletion)).toHaveLength(1);
        expect(publish.receipts).toHaveLength(0);
      } finally {
        publish.stop();
      }
    });
  });

  test("a prompt emitter failure fails closed: the completion rolls back, the row stays started, and zero receipts are published", async () => {
    await runInRollback(async tx => {
      const publish = countPublishes();
      const emitSpy = spyOn(SessionRequestNotificationService, "notifyStudentOfCompletionPrompt").mockRejectedValue(
        new Error("emit channel down")
      );
      try {
        const actors = await createSessionActors(tx);
        await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
        const row = await bookSession(
          tx,
          actors.studentUserId,
          actors.teacherUserId,
          SessionIntent.Hifz,
          "key-wave-emit-fail"
        );
        await SessionLifecycleService.startSession(actors.teacherUserId, row.id, "en", tx);

        await expectRepoError(() =>
          SessionLifecycleService.completeSessionWithReceipt(actors.teacherUserId, row.id, "en", tx)
        );

        // The completion leg rolled back: the stamp is unwritten, no
        // completion prompt row exists (the booking's own teacher intake
        // wave is the only row for this session), and nothing was published
        // for the failed attempt.
        const rolledBack = await readSessionRow(tx, row.id);
        expect(rolledBack?.status).toBe(SessionStatus.Started);
        expect(rolledBack?.confirmedByTeacherAt).toBeNull();
        expect(await readWaveRows(tx, row.id, NotificationType.SessionCompletion)).toHaveLength(0);
        expect(publish.receipts).toHaveLength(0);
      } finally {
        emitSpy.mockRestore();
        publish.stop();
      }
    });
  });
});

describe("SessionLifecycleService — booking intake wave (runInRollback)", () => {
  test("a FIRST booking emits exactly one session-request row addressed to the teacher, in the teacher's persisted locale, unpublished on the caller's transaction", async () => {
    await runInRollback(async tx => {
      const publish = countPublishes();
      try {
        const actors = await createSessionActors(tx);
        // The TEACHER persists an English locale so the recipient-locale
        // copy below is deterministic — a locale-less user falls back to
        // the platform default (Arabic), a fallback the wave suite pins.
        await tx.update(users).set({ locale: "en" }).where(eq(users.id, actors.teacherUserId));
        await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
        const row = await bookSession(
          tx,
          actors.studentUserId,
          actors.teacherUserId,
          SessionIntent.Hifz,
          "key-wave-booking-intake"
        );
        const studentName = await readStudentName(tx, actors.studentUserId);

        // Exactly ONE SessionRequest row for the booked session —
        // teacher-addressed, composed in the teacher's persisted-locale
        // copy (the request locale only feeds error copy).
        const intakeRows = await readWaveRows(tx, row.id, NotificationType.SessionRequest);
        expect(intakeRows).toHaveLength(1);
        expect(intakeRows[0]?.userId).toBe(actors.teacherUserId);
        expect(intakeRows[0]?.type).toBe(NotificationType.SessionRequest);
        expect(intakeRows[0]?.title).toBe(NOTIFS_EN.eventSessionRequestTitle);
        expect(intakeRows[0]?.body).toBe(NOTIFS_EN.eventSessionRequestBody(studentName, NOTIFS_EN.intentHifz));

        // The student receives nothing from their own booking.
        const studentRows = await tx.select().from(notifications).where(eq(notifications.userId, actors.studentUserId));
        expect(studentRows).toHaveLength(0);

        // Caller-tx: the flow NEVER publishes — the caller owns the commit.
        expect(publish.receipts).toHaveLength(0);
      } finally {
        publish.stop();
      }
    });
  });

  test("an intake emitter failure degrades: only the wave savepoint rolls back — the booking stays durable and the key is spent", async () => {
    await runInRollback(async tx => {
      const publish = countPublishes();
      const emitSpy = spyOn(SessionRequestNotificationService, "notifyTeacherOfSessionRequest").mockRejectedValue(
        new Error("emit channel down")
      );
      try {
        const actors = await createSessionActors(tx);
        // Trial = 2: the first booking spends one lane unit; the replayed
        // attempt must still clear the debit ladder to reach the spent-claim
        // conflict (the ladder runs BEFORE the claim insert).
        await setLaneBalances(tx, actors.studentUserId, { trial: 2 });

        const row = await bookSession(
          tx,
          actors.studentUserId,
          actors.teacherUserId,
          SessionIntent.Hifz,
          "key-wave-intake-fail"
        );

        // The booking commits: the row exists, the lane debit stands, and
        // zero wave rows exist for the failed dispatch.
        const stored = await readSessionRow(tx, row.id);
        expect(stored?.status).toBe(SessionStatus.Scheduled);
        const balances = await readLaneBalances(tx, actors.studentUserId);
        expect(balances.trial).toBe(1);
        expect(await readWaveRows(tx, row.id)).toHaveLength(0);

        // The claim is spent: the replayed key is the duplicate conflict.
        const replay = await expectRepoError(() =>
          SessionLifecycleService.createSession(
            actors.studentUserId,
            { teacherId: actors.teacherUserId, intent: SessionIntent.Hifz },
            "key-wave-intake-fail",
            "en",
            tx
          )
        );
        expectDomainDenial(replay, "DUPLICATE_REQUEST", t().duplicateRequest);

        // Caller-tx: nothing was published for the failed dispatch.
        expect(publish.receipts).toHaveLength(0);
      } finally {
        emitSpy.mockRestore();
        publish.stop();
      }
    });
  });
});

describe("SessionLifecycleService — two-leg sweeper composition (runInRollback)", () => {
  test("the sweeper composes both legs: honest counts, UNION refund walk, auto-cancel notice for completed-leg rows only — the scheduled leg stays notification-free", async () => {
    await runInRollback(async tx => {
      const publish = countPublishes();
      try {
        const actors = await createSessionActors(tx);
        // The student persists an English locale so the recipient-locale
        // copy below is deterministic — a locale-less user falls back to
        // the platform default (Arabic), a fallback the wave suite pins.
        await tx.update(users).set({ locale: "en" }).where(eq(users.id, actors.studentUserId));
        await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
        const expiredHeld = await bookSession(
          tx,
          actors.studentUserId,
          actors.teacherUserId,
          SessionIntent.Hifz,
          "key-wave-sweep-scheduled"
        );
        await tx
          .update(session)
          .set({ confirmationDeadline: new Date(Date.now() - 1000) })
          .where(eq(session.id, expiredHeld.id));

        // The completed leg: one overdue unconfirmed row (held, hifz
        // provenance) and one student-confirmed row the sweep must never
        // touch.
        const overdue = await insertSessionRow(tx, actors, {
          intent: SessionIntent.Hifz,
          status: SessionStatus.Completed,
          confirmedByTeacherAt: new Date(Date.now() - SESSION_CONFIRMATION_WINDOW_MS - 60_000),
          fee: "10.00",
          feeHeld: true,
          heldBalanceLane: HeldBalanceLane.Hifz,
        });
        const settled = await insertSessionRow(tx, actors, {
          intent: SessionIntent.Hifz,
          status: SessionStatus.Completed,
          confirmedByTeacherAt: new Date(Date.now() - SESSION_CONFIRMATION_WINDOW_MS - 60_000),
          confirmedByStudentAt: new Date(),
          fee: "10.00",
          feeHeld: false,
        });
        const teacherName = await readTeacherName(tx, actors.teacherUserId);

        const result = await SessionLifecycleService.sweepExpiredSessions(tx);

        // Honest counts across BOTH legs: the expired scheduled row and the
        // overdue completed row; both held rows refunded.
        expect(result.cancelled).toBe(2);
        expect(result.refunded).toBe(2);

        expect((await readSessionRow(tx, expiredHeld.id))?.status).toBe(SessionStatus.Cancelled);
        const sweptOverdue = await readSessionRow(tx, overdue.id);
        expect(sweptOverdue?.status).toBe(SessionStatus.Cancelled);
        expect(sweptOverdue?.feeHeld).toBe(false);
        const untouchedSettled = await readSessionRow(tx, settled.id);
        expect(untouchedSettled?.status).toBe(SessionStatus.Completed);
        expect(untouchedSettled?.confirmedByStudentAt).not.toBeNull();

        // The UNION refund walk: the trial lane that funded the scheduled
        // hold AND the hifz lane recorded on the overdue row each move once.
        const balances = await readLaneBalances(tx, actors.studentUserId);
        expect(balances.trial).toBe(1);
        expect(balances.hifz).toBe(1);

        // Exactly one auto-cancel notice — for the completed-leg row only,
        // in the recipient's locale copy. The scheduled-expiry leg gains
        // nothing from the SWEEP (its only row is the booking's own teacher
        // intake wave); the settled row is equally silent.
        const autoCancelRows = await readWaveRows(tx, overdue.id);
        expect(autoCancelRows).toHaveLength(1);
        expect(autoCancelRows[0]?.userId).toBe(actors.studentUserId);
        expect(autoCancelRows[0]?.type).toBe(NotificationType.SessionCompletion);
        expect(autoCancelRows[0]?.title).toBe(NOTIFS_EN.eventSessionAutoCancelledTitle);
        expect(autoCancelRows[0]?.body).toBe(NOTIFS_EN.eventSessionAutoCancelledBody(teacherName));
        expect(await readWaveRows(tx, expiredHeld.id, NotificationType.SessionCompletion)).toHaveLength(0);
        expect(await readWaveRows(tx, settled.id)).toHaveLength(0);

        // Caller-tx: the sweeper never publishes.
        expect(publish.receipts).toHaveLength(0);

        // Idempotent: the second sweep matches zero rows on both legs and
        // adds no second notice.
        const second = await SessionLifecycleService.sweepExpiredSessions(tx);
        expect(second.cancelled).toBe(0);
        expect(second.refunded).toBe(0);
        expect(await readWaveRows(tx, overdue.id)).toHaveLength(1);
      } finally {
        publish.stop();
      }
    });
  });

  test("a lane-less overdue completed row cancels with its auto-cancel notice and no refund counted", async () => {
    await runInRollback(async tx => {
      const publish = countPublishes();
      try {
        const actors = await createSessionActors(tx);
        await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
        const legacy = await insertSessionRow(tx, actors, {
          intent: SessionIntent.Hifz,
          status: SessionStatus.Completed,
          confirmedByTeacherAt: new Date(Date.now() - SESSION_CONFIRMATION_WINDOW_MS - 60_000),
          fee: "10.00",
          feeHeld: false,
          heldBalanceLane: null,
        });

        const result = await SessionLifecycleService.sweepExpiredSessions(tx);

        expect(result.cancelled).toBe(1);
        expect(result.refunded).toBe(0);
        expect((await readSessionRow(tx, legacy.id))?.status).toBe(SessionStatus.Cancelled);

        // The notice does not depend on a hold: the student is told even
        // when there was nothing to refund.
        expect(await readWaveRows(tx, legacy.id)).toHaveLength(1);
        const balances = await readLaneBalances(tx, actors.studentUserId);
        expect(balances.trial).toBe(1);
        expect(publish.receipts).toHaveLength(0);
      } finally {
        publish.stop();
      }
    });
  });

  test("an auto-cancel emitter failure fails closed: the whole sweep rolls back — both legs' rows untouched, zero notices, zero publishes", async () => {
    await runInRollback(async tx => {
      const publish = countPublishes();
      const emitSpy = spyOn(
        SessionRequestNotificationService,
        "notifyStudentOfCompletionAutoCancelled"
      ).mockRejectedValue(new Error("emit channel down"));
      try {
        const actors = await createSessionActors(tx);
        await setLaneBalances(tx, actors.studentUserId, { trial: 1 });
        const expiredHeld = await bookSession(
          tx,
          actors.studentUserId,
          actors.teacherUserId,
          SessionIntent.Hifz,
          "key-wave-sweep-fail"
        );
        await tx
          .update(session)
          .set({ confirmationDeadline: new Date(Date.now() - 1000) })
          .where(eq(session.id, expiredHeld.id));
        const overdue = await insertSessionRow(tx, actors, {
          intent: SessionIntent.Hifz,
          status: SessionStatus.Completed,
          confirmedByTeacherAt: new Date(Date.now() - SESSION_CONFIRMATION_WINDOW_MS - 60_000),
          fee: "10.00",
          feeHeld: true,
          heldBalanceLane: HeldBalanceLane.Hifz,
        });

        await expectRepoError(() => SessionLifecycleService.sweepExpiredSessions(tx));

        // The cancellations, the refunds, and the notices all rolled back
        // together — nothing published for the failed sweep.
        expect((await readSessionRow(tx, expiredHeld.id))?.status).toBe(SessionStatus.Scheduled);
        const rolledBackOverdue = await readSessionRow(tx, overdue.id);
        expect(rolledBackOverdue?.status).toBe(SessionStatus.Completed);
        expect(rolledBackOverdue?.feeHeld).toBe(true);
        const balances = await readLaneBalances(tx, actors.studentUserId);
        expect(balances.trial).toBe(0);
        expect(balances.hifz).toBe(0);
        expect(await readWaveRows(tx, overdue.id)).toHaveLength(0);
        expect(await readWaveRows(tx, expiredHeld.id, NotificationType.SessionCompletion)).toHaveLength(0);
        expect(publish.receipts).toHaveLength(0);
      } finally {
        emitSpy.mockRestore();
        publish.stop();
      }
    });
  });
});

describe("SessionLifecycleService — completion waves on the production commit path (committed fixtures)", () => {
  let commitTeacherId = 0;
  let commitStudentId = 0;
  let startedRowId = 0;
  let overdueRowId = 0;

  beforeAll(async () => {
    await db.transaction(async tx => {
      const actors = await createSessionActors(tx);
      commitTeacherId = actors.teacherUserId;
      commitStudentId = actors.studentUserId;
      await setLaneBalances(tx, commitStudentId, { trial: 1 });
      const started = await insertSessionRow(tx, actors, {
        intent: SessionIntent.Hifz,
        status: SessionStatus.Started,
        startedAt: new Date(),
        fee: "10.00",
        feeHeld: true,
        heldBalanceLane: HeldBalanceLane.Trial,
      });
      startedRowId = started.id;
      const overdue = await insertSessionRow(tx, actors, {
        intent: SessionIntent.Hifz,
        status: SessionStatus.Completed,
        confirmedByTeacherAt: new Date(Date.now() - SESSION_CONFIRMATION_WINDOW_MS - 60_000),
        fee: "10.00",
        feeHeld: true,
        heldBalanceLane: HeldBalanceLane.Trial,
      });
      overdueRowId = overdue.id;
    });
  });

  afterAll(async () => {
    // FK-safe hard delete: notifications → claims → sessions → users (the
    // users delete cascades the students/teacher role-child rows; the
    // notifications delete is explicit because this block committed some).
    await db.delete(notifications).where(eq(notifications.userId, commitStudentId));
    await db.delete(sessionRequestIdempotency).where(eq(sessionRequestIdempotency.userId, commitStudentId));
    await db.delete(session).where(eq(session.studentId, commitStudentId));
    await db.delete(users).where(eq(users.id, commitStudentId));
    await db.delete(users).where(eq(users.id, commitTeacherId));
  });

  test("the production completion publishes the prompt's receipt exactly once, strictly after its own commit", async () => {
    const publish = countPublishes();
    try {
      const result = await SessionLifecycleService.completeSessionWithReceipt(commitTeacherId, startedRowId, "en");

      expect(result.session.status).toBe(SessionStatus.Completed);
      expect(result.session.confirmedByTeacherAt).not.toBeNull();

      // The flow owns the commit boundary: exactly one post-commit publish
      // carrying THIS flow's receipt.
      expect(publish.receipts).toHaveLength(1);
      expect(publish.receipts[0]).toHaveLength(1);
      expect(publish.receipts[0]?.[0]).toBe(result.receipt);

      // The prompt row committed with the stamp.
      const [waveRow] = await db.select().from(notifications).where(eq(notifications.relatedEntityId, startedRowId));
      expect(waveRow?.userId).toBe(commitStudentId);
      expect(waveRow?.type).toBe(NotificationType.SessionCompletion);
    } finally {
      publish.stop();
    }
  });

  test("the production sweep publishes each completed-leg auto-cancel receipt exactly once after its commit", async () => {
    const publish = countPublishes();
    try {
      const result = await SessionLifecycleService.sweepExpiredSessions();

      expect(result.cancelled).toBe(1);
      expect(result.refunded).toBe(1);

      // One receipt, published post-commit, for the overdue row's student.
      expect(publish.receipts).toHaveLength(1);
      expect(publish.receipts[0]).toHaveLength(1);
      expect(publish.receipts[0]?.[0]?.recipientUserIds).toEqual([commitStudentId]);

      const [waveRow] = await db.select().from(notifications).where(eq(notifications.relatedEntityId, overdueRowId));
      expect(waveRow?.userId).toBe(commitStudentId);
      expect(waveRow?.type).toBe(NotificationType.SessionCompletion);
      expect((await readChaosSessionRow(overdueRowId))?.status).toBe(SessionStatus.Cancelled);

      // The trial lane re-incremented once for the swept hold (the
      // fixture's own unit plus the returned one).
      const [balance] = await db
        .select({ trial: students.balanceTrial })
        .from(students)
        .where(eq(students.id, commitStudentId));
      expect(balance?.trial).toBe(2);
    } finally {
      publish.stop();
    }
  });
});

/** Read-back oracle: the teacher row's is_online flag (tx-scoped). */
async function readTeacherOnline(tx: DBTransaction, teacherUserId: number): Promise<boolean | null> {
  const [row] = await tx.select({ isOnline: teacher.isOnline }).from(teacher).where(eq(teacher.id, teacherUserId));
  return row?.isOnline ?? null;
}

/**
 * Read-back oracle: the teacher row's full in-session lock state — the
 * offline flag AND the persisted pre-lock availability marker (tx-scoped).
 * The marker is the release direction's restore value, so every lock-side
 * verdict asserts BOTH columns together.
 */
async function readTeacherLockState(
  tx: DBTransaction,
  teacherUserId: number
): Promise<{ isOnline: boolean | null; wasOnlineBeforeLock: boolean | null }> {
  const [row] = await tx
    .select({ isOnline: teacher.isOnline, wasOnlineBeforeLock: teacher.wasOnlineBeforeLock })
    .from(teacher)
    .where(eq(teacher.id, teacherUserId));
  return { isOnline: row?.isOnline ?? null, wasOnlineBeforeLock: row?.wasOnlineBeforeLock ?? null };
}

/** Forces the fixture teacher online (the INV-S6 cast posture). */
async function forceTeacherOnline(tx: DBTransaction, teacherUserId: number): Promise<void> {
  await tx.update(teacher).set({ isOnline: true }).where(eq(teacher.id, teacherUserId));
}

// ─── INV-S6 in-session lock (start / complete / cancel / arbitration) ────

describe("SessionLifecycleService — INV-S6 in-session lock (runInRollback)", () => {
  test("start ⇒ the teacher is locked offline in the SAME transaction (online fixture)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await forceTeacherOnline(tx, actors.teacherUserId);
      const created = await insertSessionRow(tx, actors);

      const started = await SessionLifecycleService.startSession(actors.teacherUserId, created.id, "en", tx);

      expect(started.status).toBe(SessionStatus.Started);
      // The acquire captured the pre-lock availability (true) and drove the
      // row offline in the SAME statement — the marker is the value the
      // release direction restores.
      expect(await readTeacherLockState(tx, actors.teacherUserId)).toEqual({
        isOnline: false,
        wasOnlineBeforeLock: true,
      });
    });
  });

  test("start ⇒ the capture seeds the marker with the pre-start OFFLINE intent (the never-resurrect seed)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const created = await insertSessionRow(tx, actors);

      // Pre-start posture: the fresh teacher row carries no availability
      // (the repo's offline default) and no marker. The capture must seed
      // the marker with EXACTLY that pre-start value — the release restores
      // it verbatim instead of resurrecting the teacher.
      expect(await readTeacherLockState(tx, actors.teacherUserId)).toEqual({
        isOnline: false,
        wasOnlineBeforeLock: null,
      });

      const started = await SessionLifecycleService.startSession(actors.teacherUserId, created.id, "en", tx);

      expect(started.status).toBe(SessionStatus.Started);
      expect(await readTeacherLockState(tx, actors.teacherUserId)).toEqual({
        isOnline: false,
        wasOnlineBeforeLock: false,
      });
    });
  });

  test("a forced mid-flow fault (the acquire raises after the capture applies) rolls back the transition AND the capture", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await forceTeacherOnline(tx, actors.teacherUserId);
      const created = await insertSessionRow(tx, actors);

      // Chaos injection: the teacher-row UPDATE (the acquire — capture plus
      // lock in ONE statement) applies its row changes, THEN raises, so the
      // fault lands after the acquire. The DDL lives inside the rolled-back
      // test transaction — nothing leaks into the shared database.
      const failFn = `raise_teacher_lock_fail_${randomUUID().slice(0, 8).replaceAll("-", "_")}`;
      const failTrigger = `fail_teacher_lock_${randomUUID().slice(0, 8).replaceAll("-", "_")}`;
      await tx.execute(
        sql.raw(
          `CREATE FUNCTION ${failFn}() RETURNS trigger LANGUAGE plpgsql AS $fn$ ` +
            `BEGIN RAISE EXCEPTION 'forced teacher-lock failure'; END; $fn$;`
        )
      );
      await tx.execute(
        sql.raw(
          `CREATE TRIGGER ${failTrigger} ` +
            `AFTER UPDATE ON teacher FOR EACH ROW WHEN (OLD.id = ${actors.teacherUserId}) ` +
            `EXECUTE FUNCTION ${failFn}()`
        )
      );

      const error = await expectRepoError(() =>
        SessionLifecycleService.startSession(actors.teacherUserId, created.id, "en", tx)
      );
      expect(error).not.toBeInstanceOf(DomainError);
      expect(hasPostgresErrorCode(error, PG_RAISE_EXCEPTION)).toBe(true);

      await tx.execute(sql.raw(`DROP TRIGGER ${failTrigger} ON teacher`));

      // Full rollback: the session is STILL scheduled with no start stamp,
      // and the teacher is STILL online with NO captured marker — the
      // transition and the marker capture rolled back together (a captured
      // marker never survives a failed start).
      const row = await readSessionRow(tx, created.id);
      expect(row?.status).toBe(SessionStatus.Scheduled);
      expect(row?.startedAt).toBeNull();
      expect(await readTeacherLockState(tx, actors.teacherUserId)).toEqual({
        isOnline: true,
        wasOnlineBeforeLock: null,
      });
    });
  });

  test("a zero-row acquire fails the start closed and leaves the teacher row untouched", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await forceTeacherOnline(tx, actors.teacherUserId);
      const created = await insertSessionRow(tx, actors);

      // Simulate the zero-row acquire (a teacher row the FK otherwise
      // renders unreachable while the session row exists): the repo writer
      // matches zero rows and returns null.
      const acquire = spyOn(TeacherRepository, "acquireInSessionLock").mockResolvedValue(null);

      try {
        const error = await expectRepoError(() =>
          SessionLifecycleService.startSession(actors.teacherUserId, created.id, "en", tx)
        );
        // The fail-closed contract: the flow's own lifecycle failure, not a
        // downstream typed denial.
        expect(error).not.toBeInstanceOf(DomainError);
        expect(error.message).toBe(
          "SessionLifecycleService.startSession: in-session lock write matched zero teacher rows"
        );
        // The acquire was keyed on the TRANSITIONED row's teacher id —
        // server-derived, never the caller's input.
        expect(acquire.mock.calls).toHaveLength(1);
        expect(acquire.mock.calls[0]?.[0]).toBe(actors.teacherUserId);
      } finally {
        acquire.mockRestore();
      }

      // The transition rolled back with the flow: the session is STILL
      // scheduled, and the teacher row is untouched (still online, no
      // marker) — the failed start wrote nothing to availability.
      const row = await readSessionRow(tx, created.id);
      expect(row?.status).toBe(SessionStatus.Scheduled);
      expect(row?.startedAt).toBeNull();
      expect(await readTeacherLockState(tx, actors.teacherUserId)).toEqual({
        isOnline: true,
        wasOnlineBeforeLock: null,
      });
    });
  });

  test("complete-from-started ⇒ unlock in the same transaction", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await forceTeacherOnline(tx, actors.teacherUserId);
      const created = await insertSessionRow(tx, actors, { status: SessionStatus.Started, startedAt: new Date() });
      // The lock posture: the started session holds the teacher offline,
      // with the pre-start ONLINE intent captured in the marker.
      await tx
        .update(teacher)
        .set({ isOnline: false, wasOnlineBeforeLock: true })
        .where(eq(teacher.id, actors.teacherUserId));

      const completed = await SessionLifecycleService.completeSession(actors.teacherUserId, created.id, "en", tx);

      expect(completed.status).toBe(SessionStatus.Completed);
      expect(await readTeacherOnline(tx, actors.teacherUserId)).toBe(true);
    });
  });

  test("cancel-from-started ⇒ unlock; cancel-from-scheduled ⇒ no lock touch", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await forceTeacherOnline(tx, actors.teacherUserId);

      // In-progress leg: the locked teacher is restored by the cancel.
      const started = await insertSessionRow(tx, actors, {
        status: SessionStatus.Started,
        startedAt: new Date(),
        heldBalanceLane: null,
        feeHeld: false,
      });
      await tx
        .update(teacher)
        .set({ isOnline: false, wasOnlineBeforeLock: true })
        .where(eq(teacher.id, actors.teacherUserId));
      const cancelled = await SessionLifecycleService.cancelSession(actors.studentUserId, started.id, null, "en", tx);
      expect(cancelled.status).toBe(SessionStatus.Cancelled);
      expect(await readTeacherOnline(tx, actors.teacherUserId)).toBe(true);

      // Pre-start leg: the teacher's flag is untouched (no lock to release).
      const scheduled = await insertSessionRow(tx, actors, {
        heldBalanceLane: null,
        feeHeld: false,
      });
      await tx.update(teacher).set({ isOnline: false }).where(eq(teacher.id, actors.teacherUserId));
      const cancelledScheduled = await SessionLifecycleService.cancelSession(
        actors.teacherUserId,
        scheduled.id,
        null,
        "en",
        tx
      );
      expect(cancelledScheduled.status).toBe(SessionStatus.Cancelled);
      expect(cancelledScheduled.startedAt).toBeNull();
      expect(await readTeacherOnline(tx, actors.teacherUserId)).toBe(false);
    });
  });

  test("resolve-from-started-dispute ⇒ unlock (+ lane-intact refund); resolve-from-scheduled-dispute ⇒ none", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const actors = await createSessionActors(tx);
      await forceTeacherOnline(tx, actors.teacherUserId);
      await setLaneBalances(tx, actors.studentUserId, { hifz: 1 });

      // Started leg: dispute opened in-progress; the arbitration CANCEL
      // refunds the hifz lane and lifts the lock in one transaction.
      const started = await insertSessionRow(tx, actors, { status: SessionStatus.Started, startedAt: new Date() });
      await tx
        .update(teacher)
        .set({ isOnline: false, wasOnlineBeforeLock: true })
        .where(eq(teacher.id, actors.teacherUserId));
      await SessionLifecycleService.openSessionDispute(
        actors.studentUserId,
        started.id,
        "in-progress dispute",
        "en",
        tx
      );
      const resolvedStarted = await SessionLifecycleService.resolveSessionDispute(
        admin.id,
        started.id,
        DisputeResolution.Cancel,
        null,
        "en",
        tx
      );
      expect(resolvedStarted.status).toBe(SessionStatus.Cancelled);
      expect(resolvedStarted.feeHeld).toBe(false);
      expect(await readTeacherOnline(tx, actors.teacherUserId)).toBe(true);

      // Scheduled leg: a never-started dispute holds NO lock — the
      // arbitration leaves the teacher flag exactly as it was.
      const scheduled = await insertSessionRow(tx, actors);
      await tx.update(teacher).set({ isOnline: false }).where(eq(teacher.id, actors.teacherUserId));
      await SessionLifecycleService.openSessionDispute(
        actors.studentUserId,
        scheduled.id,
        "pre-start dispute",
        "en",
        tx
      );
      const resolvedScheduled = await SessionLifecycleService.resolveSessionDispute(
        admin.id,
        scheduled.id,
        DisputeResolution.Cancel,
        null,
        "en",
        tx
      );
      expect(resolvedScheduled.status).toBe(SessionStatus.Cancelled);
      expect(resolvedScheduled.startedAt).toBeNull();
      expect(await readTeacherOnline(tx, actors.teacherUserId)).toBe(false);
    });
  });

  test("resolve COMPLETE from a started dispute ⇒ unlock (the guarded predicate guarantees the start stamp)", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const actors = await createSessionActors(tx);
      await forceTeacherOnline(tx, actors.teacherUserId);

      const started = await insertSessionRow(tx, actors, {
        status: SessionStatus.Started,
        startedAt: new Date(),
      });
      await tx
        .update(teacher)
        .set({ isOnline: false, wasOnlineBeforeLock: true })
        .where(eq(teacher.id, actors.teacherUserId));
      await SessionLifecycleService.openSessionDispute(
        actors.studentUserId,
        started.id,
        "finish it via arbitration",
        "en",
        tx
      );

      const resolved = await SessionLifecycleService.resolveSessionDispute(
        admin.id,
        started.id,
        DisputeResolution.Complete,
        null,
        "en",
        tx
      );

      expect(resolved.status).toBe(SessionStatus.Completed);
      expect(resolved.startedAt).not.toBeNull();
      expect(await readTeacherOnline(tx, actors.teacherUserId)).toBe(true);
    });
  });

  test("complete with a captured OFFLINE intent ⇒ the release never resurrects the teacher", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const created = await insertSessionRow(tx, actors, { status: SessionStatus.Started, startedAt: new Date() });

      // The never-resurrect posture: the teacher was offline BEFORE the
      // session — a deliberate intent the start captured into the marker
      // (the exact row state a real start leaves for a pre-start offline
      // teacher).
      await tx
        .update(teacher)
        .set({ isOnline: false, wasOnlineBeforeLock: false })
        .where(eq(teacher.id, actors.teacherUserId));

      const completed = await SessionLifecycleService.completeSession(actors.teacherUserId, created.id, "en", tx);

      expect(completed.status).toBe(SessionStatus.Completed);
      // The restore writes the captured intent VERBATIM: an offline
      // pre-lock intent stays offline after the session, and the marker is
      // consumed — the release cannot mint availability.
      expect(await readTeacherLockState(tx, actors.teacherUserId)).toEqual({
        isOnline: false,
        wasOnlineBeforeLock: null,
      });
    });
  });

  test("cancel of a scheduled row with a reschedule-polluted start stamp ⇒ the marker gates — no spurious restore", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await forceTeacherOnline(tx, actors.teacherUserId);

      // The pollution posture: a SCHEDULED row carrying a stale start stamp
      // (the reschedule flow writes `started_at` onto rows that never
      // started and nothing clears it) — the stamp alone says "started"
      // while the row never held a lock.
      const polluted = await insertSessionRow(tx, actors, {
        startedAt: new Date(),
        heldBalanceLane: null,
        feeHeld: false,
      });
      // The teacher is offline WITHOUT a lock: no marker, no started row.
      await tx.update(teacher).set({ isOnline: false }).where(eq(teacher.id, actors.teacherUserId));
      expect(await readTeacherLockState(tx, actors.teacherUserId)).toEqual({
        isOnline: false,
        wasOnlineBeforeLock: null,
      });

      const cancelled = await SessionLifecycleService.cancelSession(actors.studentUserId, polluted.id, null, "en", tx);

      expect(cancelled.status).toBe(SessionStatus.Cancelled);
      // A start-stamp-classified release would spuriously restore the
      // teacher here; the marker-gated one no-ops instead — the offline
      // teacher stays offline and no marker is minted.
      expect(await readTeacherOnline(tx, actors.teacherUserId)).toBe(false);
      expect(await readTeacherLockState(tx, actors.teacherUserId)).toEqual({
        isOnline: false,
        wasOnlineBeforeLock: null,
      });
    });
  });

  test("release verdicts surface in logs: a no-lock exit logs EXACTLY one no-op debug; a real unlock stays silent", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await forceTeacherOnline(tx, actors.teacherUserId);

      // No-lock leg: cancelling a scheduled row (no marker) surfaces the
      // classified no-op as EXACTLY ONE bounded debug line, keyed on the
      // teacher id and the outcome alone — no session identifier.
      const scheduled = await insertSessionRow(tx, actors, { heldBalanceLane: null, feeHeld: false });
      const debug = spyOn(logger, "debug");
      try {
        await SessionLifecycleService.cancelSession(actors.teacherUserId, scheduled.id, null, "en", tx);
        const releaseLines = debug.mock.calls.filter(([message]) => message.startsWith("In-session lock release"));
        expect(releaseLines).toHaveLength(1);
        expect(releaseLines[0]?.[0]).toBe("In-session lock release no-op: no lock held");
        expect(releaseLines[0]?.[1]).toEqual({ teacherId: actors.teacherUserId, outcome: "no_lock_held" });
      } finally {
        debug.mockRestore();
      }

      // Real-unlock leg: the cancel of a started session (marker held)
      // releases silently — zero release lines at any level.
      const started = await insertSessionRow(tx, actors, {
        status: SessionStatus.Started,
        startedAt: new Date(),
        heldBalanceLane: null,
        feeHeld: false,
      });
      await tx
        .update(teacher)
        .set({ isOnline: false, wasOnlineBeforeLock: true })
        .where(eq(teacher.id, actors.teacherUserId));
      const unlockDebug = spyOn(logger, "debug");
      const unlockErrors = spyOn(logger, "error");
      try {
        const cancelled = await SessionLifecycleService.cancelSession(actors.studentUserId, started.id, null, "en", tx);
        expect(cancelled.status).toBe(SessionStatus.Cancelled);
        expect(await readTeacherOnline(tx, actors.teacherUserId)).toBe(true);
        expect(
          unlockDebug.mock.calls.filter(([message]) => message.startsWith("In-session lock release"))
        ).toHaveLength(0);
        expect(
          unlockErrors.mock.calls.filter(([message]) => message.startsWith("In-session lock release"))
        ).toHaveLength(0);
      } finally {
        unlockDebug.mockRestore();
        unlockErrors.mockRestore();
      }
    });
  });

  test("two started sessions ⇒ the first exit defers the release, the second restores the captured ONLINE intent", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await forceTeacherOnline(tx, actors.teacherUserId);
      const first = await insertSessionRow(tx, actors, { status: SessionStatus.Started, startedAt: new Date() });
      const last = await insertSessionRow(tx, actors, { status: SessionStatus.Started, startedAt: new Date() });
      // The lock posture: ONE captured ONLINE intent held over TWO started
      // sessions — the exact row state two real starts leave (first-lock-wins
      // capture; the re-acquire keeps the seeded marker).
      await tx
        .update(teacher)
        .set({ isOnline: false, wasOnlineBeforeLock: true })
        .where(eq(teacher.id, actors.teacherUserId));
      expect(await readTeacherLockState(tx, actors.teacherUserId)).toEqual({
        isOnline: false,
        wasOnlineBeforeLock: true,
      });

      // The FIRST exit: the sibling started session still holds the lock
      // open, so the restore is deferred — the classified no-op writes
      // NOTHING (the teacher stays locked offline, the marker stays).
      const deferredDebug = spyOn(logger, "debug");
      try {
        const completedFirst = await SessionLifecycleService.completeSession(actors.teacherUserId, first.id, "en", tx);
        expect(completedFirst.status).toBe(SessionStatus.Completed);
        const releaseLines = deferredDebug.mock.calls.filter(([message]) =>
          message.startsWith("In-session lock release")
        );
        expect(releaseLines).toHaveLength(1);
        expect(releaseLines[0]?.[0]).toBe("In-session lock release deferred: active sessions remain");
        expect(releaseLines[0]?.[1]).toEqual({ teacherId: actors.teacherUserId, outcome: "active_sessions_remain" });
      } finally {
        deferredDebug.mockRestore();
      }
      expect(await readTeacherLockState(tx, actors.teacherUserId)).toEqual({
        isOnline: false,
        wasOnlineBeforeLock: true,
      });

      // The LAST exit: no started session remains, so the deferred restore
      // lands now — the captured intent is written verbatim and the marker
      // consumed. The happy path is silent (zero release lines).
      const restoreDebug = spyOn(logger, "debug");
      const restoreErrors = spyOn(logger, "error");
      try {
        const completedLast = await SessionLifecycleService.completeSession(actors.teacherUserId, last.id, "en", tx);
        expect(completedLast.status).toBe(SessionStatus.Completed);
        expect(await readTeacherLockState(tx, actors.teacherUserId)).toEqual({
          isOnline: true,
          wasOnlineBeforeLock: null,
        });
        expect(
          restoreDebug.mock.calls.filter(([message]) => message.startsWith("In-session lock release"))
        ).toHaveLength(0);
        expect(
          restoreErrors.mock.calls.filter(([message]) => message.startsWith("In-session lock release"))
        ).toHaveLength(0);
      } finally {
        restoreDebug.mockRestore();
        restoreErrors.mockRestore();
      }
    });
  });

  test("two started sessions ⇒ the captured OFFLINE intent survives the deferral and restores verbatim (never resurrect)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const first = await insertSessionRow(tx, actors, { status: SessionStatus.Started, startedAt: new Date() });
      const last = await insertSessionRow(tx, actors, { status: SessionStatus.Started, startedAt: new Date() });

      // The never-resurrect posture: the teacher was offline BEFORE the
      // sessions — the captured intent must survive the sibling session's
      // exit UNRESTORED and land only on the last one.
      await tx
        .update(teacher)
        .set({ isOnline: false, wasOnlineBeforeLock: false })
        .where(eq(teacher.id, actors.teacherUserId));
      expect(await readTeacherLockState(tx, actors.teacherUserId)).toEqual({
        isOnline: false,
        wasOnlineBeforeLock: false,
      });

      // The FIRST exit: deferred — the row is untouched (still offline, the
      // OFFLINE intent still captured, never minted into availability).
      const deferredDebug = spyOn(logger, "debug");
      try {
        const completedFirst = await SessionLifecycleService.completeSession(actors.teacherUserId, first.id, "en", tx);
        expect(completedFirst.status).toBe(SessionStatus.Completed);
        const releaseLines = deferredDebug.mock.calls.filter(([message]) =>
          message.startsWith("In-session lock release")
        );
        expect(releaseLines).toHaveLength(1);
        expect(releaseLines[0]?.[0]).toBe("In-session lock release deferred: active sessions remain");
        expect(releaseLines[0]?.[1]).toEqual({ teacherId: actors.teacherUserId, outcome: "active_sessions_remain" });
      } finally {
        deferredDebug.mockRestore();
      }
      expect(await readTeacherLockState(tx, actors.teacherUserId)).toEqual({
        isOnline: false,
        wasOnlineBeforeLock: false,
      });

      // The LAST exit: the deferred restore writes the captured OFFLINE
      // intent VERBATIM — an offline pre-lock intent stays offline after
      // both sessions, and the marker is consumed (no resurrection).
      const restoreDebug = spyOn(logger, "debug");
      const restoreErrors = spyOn(logger, "error");
      try {
        const completedLast = await SessionLifecycleService.completeSession(actors.teacherUserId, last.id, "en", tx);
        expect(completedLast.status).toBe(SessionStatus.Completed);
        expect(await readTeacherLockState(tx, actors.teacherUserId)).toEqual({
          isOnline: false,
          wasOnlineBeforeLock: null,
        });
        expect(
          restoreDebug.mock.calls.filter(([message]) => message.startsWith("In-session lock release"))
        ).toHaveLength(0);
        expect(
          restoreErrors.mock.calls.filter(([message]) => message.startsWith("In-session lock release"))
        ).toHaveLength(0);
      } finally {
        restoreDebug.mockRestore();
        restoreErrors.mockRestore();
      }
    });
  });
});
