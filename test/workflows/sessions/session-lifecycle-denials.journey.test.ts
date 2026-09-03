/**
 * Journey J2 — Hostile & Boundary Legs (session lifecycle denials).
 *
 * The hostile twin of the happy-lifecycle journey: every leg drives a
 * cross-actor denial through the REAL `SessionLifecycleService` on the REAL
 * test database, with actors holding only their real role rows (never
 * monkey-patched) and every side-effect absence proven by row-count deltas.
 *
 * Layer contract (`test/workflows/AGENTS.md`): committed fixtures in
 * `beforeAll` (one short `db.transaction`), tracked hard-deletes in
 * `afterAll` via the fixture registry — NO `runInRollback` in this layer;
 * denials asserted through a try/catch helper on the `DomainError` code
 * contract plus the exact translated message — never
 * `expect(...).rejects.toThrow()`.
 *
 * Coverage map (leg → requirements):
 *  1. Booking a teacher applicant (no `teacher` row) → `TEACHER_NOT_FOUND`;
 *     the caller's balance lanes and the claim table stay untouched
 *     (INV-TV1 — booking impossibility by construction, nothing mints
 *     certification).                                  REQ-J5 · REQ-011 · REQ-030
 *  2. A zero-balance student's booking → `INSUFFICIENT_BALANCE` with ZERO
 *     writes in `session` / `students` / claim tables, and THE SAME
 *     idempotency key succeeds in a later funded attempt (a failed booking
 *     never burns its key — the rollback releases it).  REQ-J5 · REQ-040 · REQ-041
 *  3. A second student's foreign `cancelSession` → `SESSION_NOT_FOUND` and
 *     foreign `getSessionById` → `null`, both byte-indistinguishable from
 *     the nonexistent-id pairings (same class, code, and message; owner row
 *     byte-identical through the probes).               REQ-J4 · REQ-030 · REQ-033
 *  4. The teacher applicant has NO session surface: start/complete/cancel/
 *     read over any id → `SESSION_NOT_FOUND` (no session can ever exist for
 *     him — no teacher row, no teachable id).           REQ-J4 · REQ-030 · INV-TV1
 *  5. `createSession` with `intent=evaluation` → pre-DB `VALIDATION`
 *     (invalidSessionIntent) with zero writes; no `teacher_evaluation`
 *     row is producible through this surface.           REQ-J5 · REQ-032 · REQ-047
 *  6. Admin & Parent callers get no bypass: every participant-surface
 *     attempt is oracle-denied (`SESSION_NOT_FOUND`/`null`), the write
 *     surfaces surface the service's governance `FORBIDDEN` (defense-in-
 *     depth re-check on create/start/complete; cancel EXEMPT), the owner's
 *     list stays empty of others' data, and ZERO audit-log / notification
 *     rows appear (count-delta).                        REQ-064 · REQ-023 · REQ-019 · REQ-033
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import type { SessionSelectType, SessionSubmitInput } from "@/backend/types";
import { SESSION_CONFIRMATION_WINDOW_MS, SESSION_FEE_HIFZ } from "@/shared/constants/session-fees.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  buildSessionJourneyCast,
  countAuditLogsForActor,
  countNotificationsForUser,
  createSessionFixtureRegistry,
  journeyPrefix,
  type SessionJourneyCast,
} from "@/test/workflows/helpers";

/** The errors-namespace translations for the default journey locale. */
function t() {
  return getServerTranslations("en").errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code` contract. */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/** The denial fingerprint used for the identical-shape oracle pairings. */
interface DenialShape {
  readonly name: string;
  readonly code: string;
  readonly message: string;
}

/** Captures the denial fingerprint (class name, code, exact message). */
function denialShape(error: Error): DenialShape {
  return { name: error.name, code: rejectionCode(error), message: error.message };
}

/**
 * Runs a hostile service call through a try/catch and returns the denial —
 * the journey-layer replacement for `expect(...).rejects.toThrow()`.
 */
async function catchDenial(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("expected the hostile call to be denied, but it resolved");
}

/**
 * Independent read-back oracle: one student's escrow lane balances. The
 * paid-lane columns are schema-nullable (default 0), so the projection
 * carries the column types verbatim — fixtures always hold concrete units.
 */
async function readLaneBalances(
  studentId: number
): Promise<{ trial: number; hifz: number | null; tajweed: number | null }> {
  const [row] = await db
    .select({ trial: students.balanceTrial, hifz: students.balanceHifz, tajweed: students.balanceTajweed })
    .from(students)
    .where(eq(students.id, studentId));
  if (!row) {
    throw new Error(`readLaneBalances: students row ${String(studentId)} vanished`);
  }
  return row;
}

/** Every `session` row booked by one student (count oracle). */
async function countSessionsForStudent(studentId: number): Promise<number> {
  const rows = await db.select({ id: session.id }).from(session).where(eq(session.studentId, studentId));
  return rows.length;
}

/** Every idempotency claim spent by one user (count oracle). */
async function countClaimsForUser(userId: number): Promise<number> {
  const rows = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.userId, userId));
  return rows.length;
}

/** Independent read-back oracle: the full session row (NOT via the service). */
async function readSessionRow(sessionId: number): Promise<SessionSelectType | null> {
  const [row] = await db.select().from(session).where(eq(session.id, sessionId));
  return row ?? null;
}

/**
 * An id that is guaranteed NOT to exist: one million past the current
 * identity high-water mark, so repeated or parallel journey runs (each with
 * their own fresh rows) can never collide with it.
 */
async function nonexistentSessionId(): Promise<number> {
  const [row] = await db.select({ maxId: sql<number>`coalesce(max(${session.id}), 0)` }).from(session);
  return (row?.maxId ?? 0) + 1_000_000;
}

// ─── Journey state (ordered tests share the committed cast) ─────────────

const registry = createSessionFixtureRegistry();
const PREFIX = journeyPrefix("sessions");
let cast: SessionJourneyCast;
let secondSessionId = 0; // the zero-balance student's funded booking (leg 2)
let primarySessionId = 0; // the primary student's booking (leg 3)
let secondSnapshot: SessionSelectType | null = null;

beforeAll(async () => {
  await db.transaction(async tx => {
    cast = await buildSessionJourneyCast(tx, registry, {
      prefix: PREFIX,
      // The hostile booking caller must hold NONTRIVIAL balances so leg 1's
      // "untouched" assertion cannot pass vacuously.
      primaryStudent: { trial: 1, hifz: 1 },
    });
  });
});

afterAll(async () => {
  // Defensive totality sweep before the FK-ordered hard delete: ANY session
  // row or claim row referencing the fixture actors is tracked, so a
  // mid-test failure can never strand restrict-FK children and block the
  // `users` deletes (the same sessions/claims the success legs tracked).
  const fixtureStudentIds = [cast.primaryStudent.userId, cast.secondStudent.userId];
  const fixtureTeacherIds = [cast.teacher.userId, cast.secondTeacher.userId];
  const residualSessions = await db
    .select({ id: session.id })
    .from(session)
    .where(or(inArray(session.studentId, fixtureStudentIds), inArray(session.teacherId, fixtureTeacherIds)));
  registry.trackAll(
    "session",
    residualSessions.map(row => row.id)
  );
  const residualClaims = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(inArray(sessionRequestIdempotency.userId, fixtureStudentIds));
  registry.trackAll(
    "session_request_idempotency",
    residualClaims.map(row => row.id)
  );
  await registry.cleanup();
});

describe("Journey J2 — session lifecycle hostile & boundary legs", () => {
  test("leg 1 — booking the applicant is TEACHER_NOT_FOUND; caller balances untouched (INV-TV1)", async () => {
    const caller = cast.primaryStudent;
    const lanesBefore = await readLaneBalances(caller.userId);
    const sessionsBefore = await countSessionsForStudent(caller.userId);
    const claimsBefore = await countClaimsForUser(caller.userId);

    const denied = await catchDenial(() =>
      SessionLifecycleService.createSession(
        caller.userId,
        { teacherId: cast.applicant.userId, intent: SessionIntent.Tajweed },
        `${PREFIX}-leg1-key`,
        "en"
      )
    );

    expect(denied).toBeInstanceOf(NotFoundError);
    expect(rejectionCode(denied)).toBe("TEACHER_NOT_FOUND");
    expect(denied.message).toBe(t().teacherNotFound);

    // INV-TV1: the honest not-a-teacher failure writes NOTHING — the caller's
    // lanes are byte-untouched and no claim was created (the key is not burned).
    expect(await readLaneBalances(caller.userId)).toEqual(lanesBefore);
    expect(await countSessionsForStudent(caller.userId)).toBe(sessionsBefore);
    expect(await countClaimsForUser(caller.userId)).toBe(claimsBefore);

    // Nothing mints certification: the applicant still has NO `teacher` row.
    const [applicantTeacherRow] = await db
      .select({ id: teacher.id })
      .from(teacher)
      .where(eq(teacher.id, cast.applicant.userId));
    expect(applicantTeacherRow).toBeUndefined();

    // No external effects: the denied caller holds zero notification rows.
    expect(await countNotificationsForUser(caller.userId)).toBe(0);
  });

  test("leg 2 — zero-balance booking: INSUFFICIENT_BALANCE, zero writes, then THE SAME key succeeds funded", async () => {
    const caller = cast.secondStudent;
    const lanesBefore = await readLaneBalances(caller.userId);
    expect(lanesBefore).toEqual({ trial: 0, hifz: 0, tajweed: 0 });
    const sessionsBefore = await countSessionsForStudent(caller.userId);
    const claimsBefore = await countClaimsForUser(caller.userId);
    const rollbackKey = `${PREFIX}-key-rollback-proof`;

    // The zero-balance denial (422-class ValidationError per REQ-050).
    const denied = await catchDenial(() =>
      SessionLifecycleService.createSession(
        caller.userId,
        { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz },
        rollbackKey,
        "en"
      )
    );
    expect(denied).toBeInstanceOf(ValidationError);
    expect(rejectionCode(denied)).toBe("INSUFFICIENT_BALANCE");
    expect(denied.message).toBe(t().insufficientBalance);

    // Zero writes across all three tables — the rollback is the only cleanup.
    expect(await countSessionsForStudent(caller.userId)).toBe(sessionsBefore);
    expect(await countClaimsForUser(caller.userId)).toBe(claimsBefore);
    expect(await readLaneBalances(caller.userId)).toEqual(lanesBefore);

    // Fund the student (a real committed journey step) and replay THE SAME
    // idempotency key: the failed attempt released it, so the funded retry
    // books normally — the key-rollback proof.
    await db.update(students).set({ balanceHifz: 1 }).where(eq(students.id, caller.userId));
    const callStart = new Date();
    const funded = await SessionLifecycleService.createSession(
      caller.userId,
      { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz },
      rollbackKey,
      "en"
    );
    const callEnd = new Date();

    expect(funded.id).toBeGreaterThan(0);
    expect(funded.studentId).toBe(caller.userId);
    expect(funded.teacherId).toBe(cast.teacher.userId);
    expect(funded.status).toBe(SessionStatus.Scheduled);
    expect(funded.intent).toBe(SessionIntent.Hifz);
    expect(funded.feeHeld).toBe(true);
    expect(funded.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    expect(funded.fee).toBe(SESSION_FEE_HIFZ);
    // The confirmation deadline derives from ONE captured instant: now + 24h
    // EXACTLY (bracketed by the call's start/end instants). A null deadline
    // degrades to -1 and fails both brackets loudly.
    const deadlineMs = funded.confirmationDeadline?.getTime() ?? -1;
    expect(deadlineMs - callEnd.getTime()).toBeLessThanOrEqual(SESSION_CONFIRMATION_WINDOW_MS);
    expect(deadlineMs - callStart.getTime()).toBeGreaterThanOrEqual(SESSION_CONFIRMATION_WINDOW_MS);

    // The hold: exactly one unit left the intent lane (the trial lane was empty).
    expect(await readLaneBalances(caller.userId)).toEqual({ trial: 0, hifz: 0, tajweed: 0 });

    // The claim committed with the session and carries the backfilled pointer.
    const [claim] = await db
      .select()
      .from(sessionRequestIdempotency)
      .where(eq(sessionRequestIdempotency.idempotencyKey, rollbackKey));
    expect(claim).toBeDefined();
    expect(claim?.userId).toBe(caller.userId);
    expect(claim?.sessionId).toBe(funded.id);
    registry.track("session", funded.id);
    if (claim) {
      registry.track("session_request_idempotency", claim.id);
    }

    // The owner sees exactly this one session in their own list.
    const ownPage = await SessionLifecycleService.listMyStudentSessions(caller.userId, { status: null }, 1, 25);
    expect(ownPage.totalCount).toBe(sessionsBefore + 1);
    expect(ownPage.items.map(item => item.id)).toContain(funded.id);

    secondSessionId = funded.id;
    secondSnapshot = await readSessionRow(funded.id);
  });

  test("leg 3 — foreign student cancel/read is indistinguishable from nonexistent (REQ-J4 oracle pairing)", async () => {
    // Give the primary student a real session to be hostile against.
    const primaryKey = `${PREFIX}-leg3-primary-key`;
    const lanesBeforeBooking = await readLaneBalances(cast.primaryStudent.userId);
    const primarySession = await SessionLifecycleService.createSession(
      cast.primaryStudent.userId,
      { teacherId: cast.secondTeacher.userId, intent: SessionIntent.Hifz },
      primaryKey,
      "en"
    );
    primarySessionId = primarySession.id;
    const [primaryClaim] = await db
      .select({ id: sessionRequestIdempotency.id })
      .from(sessionRequestIdempotency)
      .where(eq(sessionRequestIdempotency.idempotencyKey, primaryKey));
    expect(primaryClaim).toBeDefined();
    if (primaryClaim) {
      registry.track("session_request_idempotency", primaryClaim.id);
    }
    // Trial-first: the primary student's trial lane funded this hold.
    expect(await readLaneBalances(cast.primaryStudent.userId)).toEqual({
      trial: lanesBeforeBooking.trial - 1,
      hifz: lanesBeforeBooking.hifz,
      tajweed: lanesBeforeBooking.tajweed,
    });

    const snapshotBefore = await readSessionRow(primarySession.id);
    expect(snapshotBefore).not.toBeNull();

    // Hostile cancel of another student's session — oracle-safe not-found.
    const foreignCancel = await catchDenial(() =>
      SessionLifecycleService.cancelSession(cast.secondStudent.userId, primarySession.id, null, "en")
    );
    expect(foreignCancel).toBeInstanceOf(NotFoundError);
    const foreignShape = denialShape(foreignCancel);
    expect(foreignShape.code).toBe("SESSION_NOT_FOUND");
    expect(foreignShape.message).toBe(t().sessionNotFound);

    // Hostile read of another student's session — the identical null.
    expect(await SessionLifecycleService.getSessionById(cast.secondStudent.userId, primarySession.id)).toBeNull();

    // The nonexistent-id pairing: SAME class, SAME code, SAME message — the
    // foreign case is byte-indistinguishable from a session that never was.
    const ghostId = await nonexistentSessionId();
    const ghostCancel = await catchDenial(() =>
      SessionLifecycleService.cancelSession(cast.secondStudent.userId, ghostId, null, "en")
    );
    expect(denialShape(ghostCancel)).toEqual(foreignShape);
    expect(await SessionLifecycleService.getSessionById(cast.secondStudent.userId, ghostId)).toBeNull();

    // The owner-visible row is byte-identical to its pre-probe state, and no
    // refund path fired (the hostile cancel matched zero rows).
    expect(await readSessionRow(primarySession.id)).toEqual(snapshotBefore);
    expect(await readLaneBalances(cast.primaryStudent.userId)).toEqual({
      trial: lanesBeforeBooking.trial - 1,
      hifz: lanesBeforeBooking.hifz,
      tajweed: lanesBeforeBooking.tajweed,
    });

    // The foreign caller's OWN session (leg 2) stays readable and intact.
    expect(secondSnapshot).not.toBeNull();
    expect(await SessionLifecycleService.getSessionById(cast.secondStudent.userId, secondSessionId)).not.toBeNull();
    expect(await readSessionRow(secondSessionId)).toEqual(secondSnapshot);
  });

  test("leg 4 — the applicant has NO session surface: every transition is SESSION_NOT_FOUND", async () => {
    const applicant = cast.applicant;
    const snapshotBefore = await readSessionRow(primarySessionId);
    expect(snapshotBefore).not.toBeNull();

    // startSession(any) — the role scope would admit a teacher, but NO session
    // can ever exist for the applicant (no teacher row ⇒ no teachable id).
    const foreignStart = await catchDenial(() =>
      SessionLifecycleService.startSession(applicant.userId, primarySessionId, "en")
    );
    expect(foreignStart).toBeInstanceOf(NotFoundError);
    const foreignStartShape = denialShape(foreignStart);
    expect(foreignStartShape.code).toBe("SESSION_NOT_FOUND");
    expect(foreignStartShape.message).toBe(t().sessionNotFound);

    // The nonexistent-id pairing carries the identical shape.
    const ghostId = await nonexistentSessionId();
    const ghostStart = await catchDenial(() => SessionLifecycleService.startSession(applicant.userId, ghostId, "en"));
    expect(denialShape(ghostStart)).toEqual(foreignStartShape);

    // Complete, cancel, and read observe nothing either.
    const completeDenial = await catchDenial(() =>
      SessionLifecycleService.completeSession(applicant.userId, primarySessionId, "en")
    );
    expect(denialShape(completeDenial).code).toBe("SESSION_NOT_FOUND");
    const cancelDenial = await catchDenial(() =>
      SessionLifecycleService.cancelSession(applicant.userId, primarySessionId, null, "en")
    );
    expect(denialShape(cancelDenial).code).toBe("SESSION_NOT_FOUND");
    expect(await SessionLifecycleService.getSessionById(applicant.userId, primarySessionId)).toBeNull();

    // His own teacher list is honestly EMPTY (never others' data).
    const ownList = await SessionLifecycleService.listMyTeacherSessions(applicant.userId, { status: null }, 1, 25);
    expect(ownList.items).toEqual([]);
    expect(ownList.totalCount).toBe(0);

    // Still no teacher row anywhere along the way.
    const [applicantTeacherRow] = await db
      .select({ id: teacher.id })
      .from(teacher)
      .where(eq(teacher.id, applicant.userId));
    expect(applicantTeacherRow).toBeUndefined();

    // The probed row remains byte-identical for its owners.
    expect(await readSessionRow(primarySessionId)).toEqual(snapshotBefore);
  });

  test("leg 5 — intent=evaluation is VALIDATION pre-DB; no teacher_evaluation row is producible", async () => {
    const caller = cast.primaryStudent;
    const sessionsBefore = await countSessionsForStudent(caller.userId);
    const claimsBefore = await countClaimsForUser(caller.userId);
    const lanesBefore = await readLaneBalances(caller.userId);
    const evalKey = `${PREFIX}-leg5-key`;

    // The hostile intent is smuggled onto an otherwise valid submission base
    // (the evaluation member is structurally unreachable from the submit
    // whitelist — the overlay is the only way to present it).
    const base: SessionSubmitInput = { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz };
    const hostile = Object.assign({}, base, { intent: SessionIntent.Evaluation });

    const denied = await catchDenial(() =>
      SessionLifecycleService.createSession(caller.userId, hostile, evalKey, "en")
    );

    expect(denied).toBeInstanceOf(ValidationError);
    expect(rejectionCode(denied)).toBe("VALIDATION");
    expect(denied.message).toBe(t().invalidSessionIntent);

    // Pre-DB: the guard fired before ANY database work — zero writes in the
    // session table, the claim table, and the caller's balance lanes (the
    // idempotency key was never burned either).
    expect(await countSessionsForStudent(caller.userId)).toBe(sessionsBefore);
    expect(await countClaimsForUser(caller.userId)).toBe(claimsBefore);
    expect(await readLaneBalances(caller.userId)).toEqual(lanesBefore);

    // No teacher-evaluation row is producible by this surface — neither as a
    // session TYPE nor as an evaluation INTENT, scoped to the fixture actors.
    const fixtureTeacherIds = [cast.teacher.userId, cast.secondTeacher.userId];
    const evaluationTypeRows = await db
      .select({ id: session.id })
      .from(session)
      .where(
        and(
          eq(session.sessionType, SessionType.TeacherEvaluation),
          or(eq(session.studentId, caller.userId), inArray(session.teacherId, fixtureTeacherIds))
        )
      );
    expect(evaluationTypeRows).toEqual([]);
    const evaluationIntentRows = await db
      .select({ id: session.id })
      .from(session)
      .where(
        and(
          eq(session.intent, SessionIntent.Evaluation),
          or(eq(session.studentId, caller.userId), inArray(session.teacherId, fixtureTeacherIds))
        )
      );
    expect(evaluationIntentRows).toEqual([]);
  });

  test("leg 6 — admin & parent: no bypass, governance FORBIDDEN on writes, zero audit rows (REQ-064)", async () => {
    const admin = cast.admin;
    const parent = cast.parent;
    const snapshotBefore = await readSessionRow(primarySessionId);
    expect(snapshotBefore).not.toBeNull();

    const [adminAuditBefore, parentAuditBefore, adminNotifBefore, parentNotifBefore] = await Promise.all([
      countAuditLogsForActor(admin.userId),
      countAuditLogsForActor(parent.userId),
      countNotificationsForUser(admin.userId),
      countNotificationsForUser(parent.userId),
    ]);

    // ── Clean-state oracle probes: the privileged roles observe NOTHING.
    expect(await SessionLifecycleService.getSessionById(admin.userId, primarySessionId)).toBeNull();
    expect(await SessionLifecycleService.getSessionById(parent.userId, secondSessionId)).toBeNull();

    const adminCancel = await catchDenial(() =>
      SessionLifecycleService.cancelSession(admin.userId, primarySessionId, null, "en")
    );
    expect(denialShape(adminCancel).code).toBe("SESSION_NOT_FOUND");
    const parentStart = await catchDenial(() =>
      SessionLifecycleService.startSession(parent.userId, primarySessionId, "en")
    );
    expect(denialShape(parentStart).code).toBe("SESSION_NOT_FOUND");
    const adminComplete = await catchDenial(() =>
      SessionLifecycleService.completeSession(admin.userId, secondSessionId, "en")
    );
    expect(denialShape(adminComplete).code).toBe("SESSION_NOT_FOUND");

    // Owner-scoped lists honestly resolve to EMPTY for both — never others' data.
    const adminStudentList = await SessionLifecycleService.listMyStudentSessions(admin.userId, { status: null }, 1, 25);
    expect(adminStudentList.items).toEqual([]);
    expect(adminStudentList.totalCount).toBe(0);
    const parentTeacherList = await SessionLifecycleService.listMyTeacherSessions(
      parent.userId,
      { status: null },
      1,
      25
    );
    expect(parentTeacherList.items).toEqual([]);
    expect(parentTeacherList.totalCount).toBe(0);

    // The probes left the owner-visible rows byte-identical.
    expect(await readSessionRow(primarySessionId)).toEqual(snapshotBefore);
    expect(await readSessionRow(secondSessionId)).toEqual(secondSnapshot);

    // ── Governed write attempts: with the accounts in the real governed
    // state (blocked), the service's defense-in-depth re-check denies
    // create/start/complete with the typed FORBIDDEN denial — the admin
    // gets NO bypass through the service surface either.
    await db.update(users).set({ isBlocked: true }).where(eq(users.id, admin.userId));
    await db.update(users).set({ isBlocked: true }).where(eq(users.id, parent.userId));

    const adminCreate = await catchDenial(() =>
      SessionLifecycleService.createSession(
        admin.userId,
        { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz },
        `${PREFIX}-leg6-admin-key`,
        "en"
      )
    );
    expect(adminCreate).toBeInstanceOf(ForbiddenError);
    expect(rejectionCode(adminCreate)).toBe("FORBIDDEN");
    expect(adminCreate.message).toBe(t().forbidden);

    // The parent's denial carries the identical shape (REQ-033).
    const parentCreate = await catchDenial(() =>
      SessionLifecycleService.createSession(
        parent.userId,
        { teacherId: cast.teacher.userId, intent: SessionIntent.Tajweed },
        `${PREFIX}-leg6-parent-key`,
        "en"
      )
    );
    expect(denialShape(parentCreate)).toEqual(denialShape(adminCreate));

    const adminStart = await catchDenial(() =>
      SessionLifecycleService.startSession(admin.userId, primarySessionId, "en")
    );
    expect(rejectionCode(adminStart)).toBe("FORBIDDEN");
    const parentComplete = await catchDenial(() =>
      SessionLifecycleService.completeSession(parent.userId, secondSessionId, "en")
    );
    expect(rejectionCode(parentComplete)).toBe("FORBIDDEN");

    // Cancel is EXEMPT from the governance re-check: the governed caller is
    // NOT denied with FORBIDDEN — the participant predicate still governs,
    // so the non-participant denial stays the oracle-safe not-found.
    const governedAdminCancel = await catchDenial(() =>
      SessionLifecycleService.cancelSession(admin.userId, primarySessionId, null, "en")
    );
    expect(denialShape(governedAdminCancel).code).toBe("SESSION_NOT_FOUND");
    expect(denialShape(governedAdminCancel)).not.toEqual(denialShape(adminCreate));

    // The governance re-check fired pre-transaction: the denied bookings
    // never reached the claim table (their keys are unburned) and the
    // owner-visible rows are still byte-identical.
    expect(await countClaimsForUser(admin.userId)).toBe(0);
    expect(await countClaimsForUser(parent.userId)).toBe(0);
    expect(await readSessionRow(primarySessionId)).toEqual(snapshotBefore);
    expect(await readSessionRow(secondSessionId)).toEqual(secondSnapshot);

    // Zero audit-log and notification rows across EVERY hostile attempt —
    // the denial surfaces write nothing externally (count-delta oracle).
    expect(await countAuditLogsForActor(admin.userId)).toBe(adminAuditBefore);
    expect(await countAuditLogsForActor(parent.userId)).toBe(parentAuditBefore);
    expect(await countNotificationsForUser(admin.userId)).toBe(adminNotifBefore);
    expect(await countNotificationsForUser(parent.userId)).toBe(parentNotifBefore);
  });
});
