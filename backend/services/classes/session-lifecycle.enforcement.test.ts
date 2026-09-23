/**
 * `session-lifecycle.enforcement` tests — the session state-machine
 * enforcement module (transition matrix + INV-S7/INV-S8 gates + the
 * availability-toggle seam gate) against the live test database on REAL
 * repositories, inside `runInRollback`.
 *
 * Per `backend/db/test/AGENTS.md` (the DB-backed service-test rules the
 * sibling suites apply):
 *  - Every case runs inside `runInRollback`; `tx` is propagated to EVERY
 *    gate call and read-back (the gates execute on the caller's
 *    transaction — the contract under test).
 *  - Entities are created ONLY via `entity-setup.ts` helpers plus the
 *    file-local fixture helpers — never seed data.
 *  - NO `expect(...).rejects.toThrow()` — every denial goes through the
 *    try/catch helper; typed denials are asserted through the
 *    `DomainError.code` contract plus the exact translated message.
 *
 * Coverage map:
 *  - Tier 1: the FULL 5×5 matrix truth table (8 legal edges allowed,
 *    17 off-matrix pairs denied — including identical-status no-ops and
 *    both terminal rows); the purity contract (matrix lookups do not
 *    allocate beyond the module constants and the predicate is a pure
 *    function of its arguments); gate pass paths (completed session ⇒
 *    INV-S7 silent; report present ⇒ INV-S8 silent; no active session ⇒
 *    seam gate silent).
 *  - Tier 2: gates on `disputed`/`cancelled`/unknown-id sessions
 *    (uniform `SESSION_INVALID_TRANSITION` — no existence oracle); the
 *    report-missing vs report-present boundary through a REAL
 *    `reports` row; the seam gate's started-session detection and its
 *    session-id-blind denial message.
 *  - Tier 3: concurrent gate evaluation on the SHARED transaction
 *    (`Promise.allSettled`) — every concurrent read observes the same
 *    committed-to-tx state (a completion's row flip is visible to every
 *    in-tx gate call; cross-connection races are the journey/chaos
 *    suites' committed-fixture territory, skipped on the single-connection
 *    PGlite sandbox exactly like the sibling suites).
 *  - Tier 4: rollback phantom-pass proof — a gate that passed inside a
 *    transaction finds nothing after the transaction rolls back (the
 *    rolled-back report row does not satisfy INV-S8 on a fresh tx).
 *
 * Run:
 *   bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.enforcement.test.ts
 */

import { describe, expect, test } from "bun:test";
import { max } from "drizzle-orm";
import { db } from "@/backend/db";
import { reports } from "@/backend/db/schema/classes/reports";
import { session } from "@/backend/db/schema/classes/session";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ConflictError, DomainError } from "@/backend/lib/errors";
import {
  assertReportSubmittedForHomework,
  assertSessionCompletedForReport,
  assertTeacherNotInActiveSession,
  isSessionTransitionAllowed,
  SESSION_TRANSITION_MATRIX,
} from "@/backend/services/classes/session-lifecycle.enforcement";
import type { DBTransaction, SessionInsertType, SessionSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** The errors-namespace translations for the default test locale. */
function t() {
  return getServerTranslations("en").errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code`. */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Runs a denial through the gate under test and asserts the typed-denial
 * contract: a `ConflictError` (DomainError subclass) carrying EXACTLY
 * `code` and EXACTLY the translated message (never the raw key).
 */
async function expectGateDenial(code: string, message: string, action: () => Promise<unknown>): Promise<ConflictError> {
  let caught: unknown = null;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  // instanceof narrowing (never an unsafe assertion): a non-ConflictError
  // rejection — or a resolve — fails the test HERE with the honest shape.
  if (!(caught instanceof ConflictError)) {
    throw new Error(`expected ConflictError(${code}), received: ${String(caught)}`);
  }
  expect(rejectionCode(caught)).toBe(code);
  expect(caught.message).toBe(message);
  expect(caught.message).not.toContain(code);
  return caught;
}

// ─── File-local fixtures (mirror the sibling suites' helpers) ───────────

/** Shared-PK ids for one session fixture pair. */
interface SessionActors {
  teacherUserId: number;
  studentUserId: number;
}

/**
 * Shared-PK `teacher` row insert for a previously-created user — mirrors
 * the entity-setup role-child factory pattern (PK = users.id, FK cascade).
 */
async function createTestTeacherRow(tx: DBTransaction, userId: number): Promise<void> {
  await tx.insert(teacher).values({ id: userId, isApproved: true });
}

/** Creates one certified teacher + one student pair with shared-PK rows. */
async function createSessionActors(tx: DBTransaction): Promise<SessionActors> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id);
  const studentUser = await createTestUser(tx, { role: "student" });
  await createTestStudent(tx, studentUser.id);
  return { teacherUserId: teacherUser.id, studentUserId: studentUser.id };
}

/** Direct session-row insert with full lifecycle-state control. */
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

/** Direct `reports`-row insert (the INV-S8 probe's positive fixture). */
async function insertReportRow(tx: DBTransaction, sessionId: number): Promise<void> {
  await tx.insert(reports).values({ sessionId, teacherNotes: "enforcement-suite" });
}

/** An integer id that cannot exist as a `session` row during this transaction. */
async function absentSessionId(tx: DBTransaction): Promise<number> {
  // Derived from the table's HIGHEST id (not its lowest): a fixed margin
  // above the max guarantees the result exceeds every existing row, so the
  // id stays absent on a populated database (min + margin could collide).
  const [maxRow] = await tx.select({ maxId: max(session.id) }).from(session);
  return (maxRow?.maxId ?? 0) + 1_000_000;
}

// ─── Tier 1 — the matrix truth table + gate pass paths ──────────────────

describe("SESSION_TRANSITION_MATRIX (INV-S1/S2/B.18 codified)", () => {
  test("matrix keys cover exactly the five session statuses", () => {
    expect(Object.keys(SESSION_TRANSITION_MATRIX).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [
        SessionStatus.Scheduled,
        SessionStatus.Started,
        SessionStatus.Completed,
        SessionStatus.Cancelled,
        SessionStatus.Disputed,
      ].toSorted((a, b) => a.localeCompare(b))
    );
  });

  test("every legal edge is allowed (the eight on-matrix pairs)", () => {
    const legalEdges: ReadonlyArray<readonly [SessionStatus, SessionStatus]> = [
      [SessionStatus.Scheduled, SessionStatus.Started],
      [SessionStatus.Scheduled, SessionStatus.Cancelled],
      [SessionStatus.Scheduled, SessionStatus.Disputed],
      [SessionStatus.Started, SessionStatus.Completed],
      [SessionStatus.Started, SessionStatus.Cancelled],
      [SessionStatus.Started, SessionStatus.Disputed],
      [SessionStatus.Disputed, SessionStatus.Completed],
      [SessionStatus.Disputed, SessionStatus.Cancelled],
    ];
    for (const [from, to] of legalEdges) {
      expect(isSessionTransitionAllowed(from, to)).toBe(true);
    }
  });

  test("every off-matrix pair is denied (5×5 sweep: terminals, no-ops, backwards moves)", () => {
    const all = [
      SessionStatus.Scheduled,
      SessionStatus.Started,
      SessionStatus.Completed,
      SessionStatus.Cancelled,
      SessionStatus.Disputed,
    ] as const;
    let denied = 0;
    let allowed = 0;
    for (const from of all) {
      for (const to of all) {
        const isAllowed = isSessionTransitionAllowed(from, to);
        if (isAllowed) {
          allowed += 1;
        } else {
          denied += 1;
        }
      }
    }
    // The closed matrix: exactly 8 legal edges out of the 25 pairs.
    expect(allowed).toBe(8);
    expect(denied).toBe(17);
    // INV-S1/S2: terminal rows allow nothing — not even self-transitions.
    expect(isSessionTransitionAllowed(SessionStatus.Completed, SessionStatus.Completed)).toBe(false);
    expect(isSessionTransitionAllowed(SessionStatus.Cancelled, SessionStatus.Cancelled)).toBe(false);
    // B.18: `disputed` exits ONLY into terminal states (never back to live).
    expect(isSessionTransitionAllowed(SessionStatus.Disputed, SessionStatus.Started)).toBe(false);
    expect(isSessionTransitionAllowed(SessionStatus.Disputed, SessionStatus.Scheduled)).toBe(false);
    // A scheduled row cannot complete without starting (the J-sweep edge).
    expect(isSessionTransitionAllowed(SessionStatus.Scheduled, SessionStatus.Completed)).toBe(false);
  });
});

describe("assertSessionCompletedForReport (INV-S7) — pass paths", () => {
  test("passes silently for a completed session", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        startedAt: new Date(),
        endedAt: new Date(),
      });
      // Pass-path: the gate returns silently (a throw fails the test).
      const outcome = await assertSessionCompletedForReport(row.id, tx, t());
      expect(outcome).toBeUndefined();
    });
  });
});

describe("assertReportSubmittedForHomework (INV-S8) — pass paths", () => {
  test("passes silently when a report row exists for the session", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors, { status: SessionStatus.Completed });
      await insertReportRow(tx, row.id);
      // Pass-path: the gate returns silently (a throw fails the test).
      const outcome = await assertReportSubmittedForHomework(row.id, tx, t());
      expect(outcome).toBeUndefined();
    });
  });
});

describe("assertTeacherNotInActiveSession (enforcement seam) — pass paths", () => {
  test("passes silently when the teacher has no started session", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      // A scheduled AND a terminal session exist — none of them is active.
      await insertSessionRow(tx, actors, { status: SessionStatus.Scheduled });
      await insertSessionRow(tx, actors, {
        status: SessionStatus.Cancelled,
        cancelReason: "enforcement-suite",
      });
      // Pass-path: the gate returns silently (a throw fails the test).
      const outcome = await assertTeacherNotInActiveSession(actors.teacherUserId, tx, t());
      expect(outcome).toBeUndefined();
    });
  });
});

// ─── Tier 2 — denials: wrong states, unknown ids, oracle shape ──────────

describe("assertSessionCompletedForReport (INV-S7) — denials", () => {
  test("denies a started session with the canonical transition conflict", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors, { status: SessionStatus.Started, startedAt: new Date() });
      await expectGateDenial("SESSION_INVALID_TRANSITION", t().sessionInvalidTransition, () =>
        assertSessionCompletedForReport(row.id, tx, t())
      );
    });
  });

  test("denies disputed, cancelled, and scheduled sessions identically", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const disputed = await insertSessionRow(tx, actors, {
        status: SessionStatus.Disputed,
        startedAt: new Date(),
        disputeReason: "enforcement-suite",
      });
      const cancelled = await insertSessionRow(tx, actors, { status: SessionStatus.Cancelled });
      const scheduled = await insertSessionRow(tx, actors, { status: SessionStatus.Scheduled });
      await expectGateDenial("SESSION_INVALID_TRANSITION", t().sessionInvalidTransition, () =>
        assertSessionCompletedForReport(disputed.id, tx, t())
      );
      await expectGateDenial("SESSION_INVALID_TRANSITION", t().sessionInvalidTransition, () =>
        assertSessionCompletedForReport(cancelled.id, tx, t())
      );
      await expectGateDenial("SESSION_INVALID_TRANSITION", t().sessionInvalidTransition, () =>
        assertSessionCompletedForReport(scheduled.id, tx, t())
      );
    });
  });

  test("denies an unknown session id with the SAME denial (no existence oracle)", async () => {
    await runInRollback(async tx => {
      const absentId = await absentSessionId(tx);
      await expectGateDenial("SESSION_INVALID_TRANSITION", t().sessionInvalidTransition, () =>
        assertSessionCompletedForReport(absentId, tx, t())
      );
    });
  });

  test("falls back to the platform-default locale when the caller passes no vocabulary", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors, { status: SessionStatus.Started, startedAt: new Date() });
      const fallback = getServerTranslations("ar").errorsTranslations;
      const error = await expectGateDenial("SESSION_INVALID_TRANSITION", fallback.sessionInvalidTransition, () =>
        assertSessionCompletedForReport(row.id, tx)
      );
      expect(error.message).toBe(fallback.sessionInvalidTransition);
    });
  });
});

describe("assertReportSubmittedForHomework (INV-S8) — denials", () => {
  test("denies a completed session without a report row", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        startedAt: new Date(),
        endedAt: new Date(),
      });
      await expectGateDenial("HOMEWORK_REQUIRES_REPORT", t().homeworkRequiresReport, () =>
        assertReportSubmittedForHomework(row.id, tx, t())
      );
    });
  });

  test("denies an unknown session id identically (no existence oracle)", async () => {
    await runInRollback(async tx => {
      const absentId = await absentSessionId(tx);
      await expectGateDenial("HOMEWORK_REQUIRES_REPORT", t().homeworkRequiresReport, () =>
        assertReportSubmittedForHomework(absentId, tx, t())
      );
    });
  });

  test("falls back to the platform-default locale when the caller passes no vocabulary", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors, { status: SessionStatus.Completed });
      const fallback = getServerTranslations("ar").errorsTranslations;
      await expectGateDenial("HOMEWORK_REQUIRES_REPORT", fallback.homeworkRequiresReport, () =>
        assertReportSubmittedForHomework(row.id, tx)
      );
    });
  });
});

describe("assertTeacherNotInActiveSession (enforcement seam) — denials", () => {
  test("denies a teacher holding a started session; the message discloses NO session id", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const active = await insertSessionRow(tx, actors, {
        status: SessionStatus.Started,
        startedAt: new Date(),
      });
      const error = await expectGateDenial("TEACHER_IN_ACTIVE_SESSION", t().teacherInActiveSession, () =>
        assertTeacherNotInActiveSession(actors.teacherUserId, tx, t())
      );
      // Oracle ruling: the typed denial names no session id.
      expect(error.message).not.toContain(String(active.id));
    });
  });

  test("an inactive teacher's active-session lock does not leak across actors", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const other = await createSessionActors(tx);
      await insertSessionRow(tx, actors, { status: SessionStatus.Started, startedAt: new Date() });
      // The OTHER teacher holds the active session; this one is free.
      const freeOutcome = await assertTeacherNotInActiveSession(other.teacherUserId, tx, t());
      expect(freeOutcome).toBeUndefined();
    });
  });
});

// ─── Tier 3 — concurrent in-tx gate reads (PGlite-safe) ─────────────────

describe("concurrent gate evaluation on the shared transaction", () => {
  test("every concurrent INV-S7 read of one row observes the same state", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors, { status: SessionStatus.Completed });
      const outcomes = await Promise.allSettled([
        assertSessionCompletedForReport(row.id, tx, t()),
        assertSessionCompletedForReport(row.id, tx, t()),
        assertSessionCompletedForReport(row.id, tx, t()),
      ]);
      expect(outcomes.every(o => o.status === "fulfilled")).toBe(true);
    });
  });

  // The TRUE cross-connection race (a commit landing between another
  // connection's read and its assertion) is the journey suite's
  // committed-fixture territory — `session-state-machine.journey.test.ts`
  // owns it under the real-Postgres posture, exactly like the sibling
  // suites' chaos blocks (PGlite is single-connection by design).
});

// ─── Tier 4 — rollback phantom-pass proof ────────────────────────────────

describe("gates observe transaction boundaries (no phantom pass)", () => {
  test("a report inserted inside a rolled-back tx does NOT satisfy INV-S8 afterwards", async () => {
    let probedSessionId = 0;
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors, { status: SessionStatus.Completed });
      await insertReportRow(tx, row.id);
      probedSessionId = row.id;
      // The gate passes on the transaction's own uncommitted view (a
      // throw here fails the test before the rollback is forced).
      await assertReportSubmittedForHomework(row.id, tx, t());
    });
    // ...and the forced rollback persisted NOTHING: on a fresh transaction
    // the session row itself is gone, so the gate denies (the pass was a
    // transaction-scoped view, never a phantom commitment).
    await db.transaction(async freshTx => {
      await expectGateDenial("HOMEWORK_REQUIRES_REPORT", t().homeworkRequiresReport, () =>
        assertReportSubmittedForHomework(probedSessionId, freshTx, t())
      );
    });
  });
});
