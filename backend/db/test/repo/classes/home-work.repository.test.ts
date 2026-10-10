/**
 * HomeWorkRepository tests — the `home_work` table's data-access layer
 * (`insertHomeWork`, `findBySessionId`, `findLatestByStudentId`,
 * `gradeHomeWorkOnce`) against the live test database.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query (on
 *    every method under test `tx` is the LAST parameter).
 *  - Entities are created ONLY via `entity-setup.ts` helpers plus the
 *    file-local actor helper — never seed data.
 *  - No `expect(...).rejects.toThrow()` — constraint probes go through
 *    `expectRepoError` inside an explicit SAVEPOINT bracket so the outer
 *    transaction stays queryable.
 *  - A separate committed-fixture group covers the STANDALONE executor
 *    branches (`queryDb` reads + the `tx ?? db` write fallbacks). Those
 *    branches by definition run without a transaction, so their fixtures
 *    must be committed (an uncommitted row is invisible outside the tx);
 *    they are registered and hard-deleted in `afterAll` (rule 9), keeping
 *    the repo/ directory's 100%-coverage mandate (rule 14) honest.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): full Jadid+Madi insert; NULL-grades insert (an
 *    assignment without grades is a normal row state); `findBySessionId`
 *    hit and miss (null); `findLatestByStudentId` returns the NEWEST row
 *    whatever its grade state (no grade predicate — graded,
 *    partially-graded and ungraded rows are all eligible probes);
 *    `gradeHomeWorkOnce` happy path returns the
 *    updated row with both grades and an advanced `updated_at`.
 *  - Tier 2 (boundary): grade values at the exact CHECK bounds 0 and 100
 *    (raw repo tier — the service guards range semantics); ordering
 *    determinism with out-of-insertion-order seeds, including the
 *    same-instant `id DESC` tiebreak.
 *  - Tier 3 (chaos/guard): double `gradeHomeWorkOnce` — the second call
 *    returns `null` and leaves the grades untouched; duplicated re-grade
 *    attempts produce exactly ONE winner; unique-race on
 *    `home_work.session_id` produces the RAW `23505` naming
 *    `home_work_session_id_unique` (the repository does not translate it).
 *  - Schema-tier invariant probes: the session link is mandatory and live
 *    (a NULL `session_id` raises 23502; an orphan `session_id` raises
 *    23503 on `home_work_session_id_session_id_fkey`; deleting the
 *    session row cascades the homework row), and the 0-100 grade CHECKs
 *    backstop the guard-free `gradeHomeWorkOnce` path (101/-1 raise 23514
 *    naming `home_work_current_grade_check` /
 *    `home_work_revision_grade_check`; the row survives every rejected
 *    write).
 *  - Tier 4 (security): an out-of-enum surah/juz value is rejected at the
 *    DB tier via a raw executor probe (`22P02`, the enum type is the
 *    defense-in-depth backstop behind the service's `isSurahJuzRef`
 *    guard); a metacharacter payload bound as the enum parameter fails as
 *    a TYPE error, never as injected SQL (the table stays intact); static
 *    source pins — bound parameters only, no wildcard select, no prepared
 *    statements, no SQL line-comment sequences, `tx` last everywhere, no
 *    console / logger / i18n, one namespace, no plan-artifact references.
 *  - tx propagation: an insert made with the explicit `tx` inside
 *    `runInRollback` is absent afterwards, observed via a fresh executor
 *    read against the table.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { HomeWorkRepository } from "@/backend/db/repo";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { session } from "@/backend/db/schema/classes/session";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestHomeWork,
  createTestSession,
  createTestStudent,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import {
  expectCheckViolation,
  expectFkViolation,
  expectNotNullViolation,
  probeInsideSavepoint,
} from "@/backend/db/test/logic/invariants/invariant-probe.helpers";
import { hasPostgresErrorCode } from "@/backend/db/test/pg-error";
import { constraintNameOf, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import type { DBTransaction, HomeWorkSelectType } from "@/backend/types";

/** PostgreSQL error code for `unique_violation`. */
const PG_UNIQUE_VIOLATION = "23505";

/** PostgreSQL error code for `invalid_text_representation` (bad enum input). */
const PG_INVALID_ENUM_INPUT = "22P02";

/** The `home_work` select-shape keys (TS property names), locale-sorted. */
const HOME_WORK_ROW_KEYS = [
  "createdAt",
  "currentFromAyah",
  "currentGrade",
  "currentSurahJuz",
  "currentToAyah",
  "id",
  "revisionFromAyah",
  "revisionGrade",
  "revisionSurahJuz",
  "revisionToAyah",
  "sessionId",
  "updatedAt",
] as const;

/** Shared-PK ids for one booking pair (session.teacher_id / session.student_id). */
interface SessionActors {
  teacherUserId: number;
  studentUserId: number;
}

/** Creates one certified teacher + one student pair with shared-PK rows. */
async function createSessionActors(tx: DBTransaction): Promise<SessionActors> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id);
  const studentUser = await createTestUser(tx, { role: "student" });
  await createTestStudent(tx, studentUser.id);
  return { teacherUserId: teacherUser.id, studentUserId: studentUser.id };
}

/** Creates a completed session for the actor pair (reports hang off completed sessions). */
async function createCompletedSession(tx: DBTransaction, actors: SessionActors) {
  return createTestSession(tx, actors.teacherUserId, actors.studentUserId, {
    status: SessionStatus.Completed,
    startedAt: new Date(),
    endedAt: new Date(),
    confirmedByTeacherAt: new Date(),
  });
}

/** Full Jadid+Madi assignment payload over one session row. */
function jadidMadiOverrides() {
  return {
    currentFromAyah: 1,
    currentToAyah: 10,
    currentSurahJuz: SurahJuzRef.SurahAlFatihah,
    revisionFromAyah: 11,
    revisionToAyah: 20,
    revisionSurahJuz: SurahJuzRef.SurahAlBaqarah,
  };
}

/**
 * Walks the Drizzle `DrizzleQueryError.cause` chain to find whether the
 * original PostgreSQL error carries the given SQLSTATE code — Drizzle wraps
 * driver errors behind its own generic "failed query" message.
 */

/**
 * Walks the same cause chain searching for an `Error.message` containing
 * the given substring — used to confirm the underlying PostgreSQL
 * diagnostic (which names the rejecting type/constraint) is reachable
 * through the Drizzle wrapper.
 */
function causeChainContainsMessage(error: unknown, substring: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (typeof current.message === "string" && current.message.includes(substring)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Reads the homework row straight off the table (read-back oracle). */
async function readHomeWorkRow(tx: DBTransaction, id: number): Promise<HomeWorkSelectType> {
  const [row] = await tx.select().from(homeWork).where(eq(homeWork.id, id)).limit(1);
  if (!row) {
    throw new Error("readHomeWorkRow: expected the home_work row to exist");
  }
  return row;
}

/** An integer session id that cannot exist as a `session` row in this transaction. */
async function absentSessionId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${session.id}), 0)::int` }).from(session);
  return (row?.maxId ?? 0) + 1_000_000;
}

describe("HomeWorkRepository — transactional paths (runInRollback)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("insertHomeWork returns the inserted row for a full Jadid+Madi payload", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sessionRow = await createCompletedSession(tx, actors);

      const inserted = await HomeWorkRepository.insertHomeWork(
        { sessionId: sessionRow.id, ...jadidMadiOverrides() },
        tx
      );

      expect(inserted.id).toBeGreaterThan(0);
      expect(inserted.sessionId).toBe(sessionRow.id);
      expect(inserted.currentFromAyah).toBe(1);
      expect(inserted.currentToAyah).toBe(10);
      expect(inserted.currentGrade).toBeNull();
      expect(inserted.currentSurahJuz).toBe(SurahJuzRef.SurahAlFatihah);
      expect(inserted.revisionFromAyah).toBe(11);
      expect(inserted.revisionToAyah).toBe(20);
      expect(inserted.revisionGrade).toBeNull();
      expect(inserted.revisionSurahJuz).toBe(SurahJuzRef.SurahAlBaqarah);
      expect(inserted.createdAt).not.toBeNull();
      expect(inserted.updatedAt).not.toBeNull();
      // RETURNING mirrors the $inferSelect shape 1:1 — exactly the twelve
      // table columns, nothing added, nothing dropped.
      expect(Object.keys(inserted).toSorted((a, b) => a.localeCompare(b))).toEqual([...HOME_WORK_ROW_KEYS]);
    });
  });

  test("insertHomeWork stores an assignment with NULL grades (grading happens later, once)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sessionRow = await createCompletedSession(tx, actors);

      const inserted = await HomeWorkRepository.insertHomeWork(
        { sessionId: sessionRow.id, currentFromAyah: 5, currentToAyah: 7, currentSurahJuz: SurahJuzRef.Juz1 },
        tx
      );

      expect(inserted.currentGrade).toBeNull();
      expect(inserted.revisionGrade).toBeNull();
      expect(inserted.revisionSurahJuz).toBeNull();
      const readBack = await HomeWorkRepository.findBySessionId(sessionRow.id, tx);
      expect(readBack?.currentGrade).toBeNull();
      expect(readBack?.revisionGrade).toBeNull();
    });
  });

  test("findBySessionId returns the assignment row for a session that carries one", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sessionRow = await createCompletedSession(tx, actors);
      const inserted = await HomeWorkRepository.insertHomeWork(
        { sessionId: sessionRow.id, ...jadidMadiOverrides() },
        tx
      );

      const found = await HomeWorkRepository.findBySessionId(sessionRow.id, tx);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(inserted.id);
      expect(found?.currentSurahJuz).toBe(SurahJuzRef.SurahAlFatihah);
      expect(found?.revisionSurahJuz).toBe(SurahJuzRef.SurahAlBaqarah);
      expect(Object.keys(found ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([...HOME_WORK_ROW_KEYS]);
    });
  });

  test("findBySessionId returns null for a session without an assignment", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sessionRow = await createCompletedSession(tx, actors);

      const found = await HomeWorkRepository.findBySessionId(sessionRow.id, tx);

      expect(found).toBeNull();
    });
  });

  test("findLatestByStudentId returns the NEWEST row whatever its grade state (no grade predicate)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const gradedSession = await createCompletedSession(tx, actors);
      const partialSession = await createCompletedSession(tx, actors);
      const newestSession = await createCompletedSession(tx, actors);

      const graded = await HomeWorkRepository.insertHomeWork(
        { sessionId: gradedSession.id, currentFromAyah: 1, currentToAyah: 3 },
        tx
      );
      const gradedOutcome = await HomeWorkRepository.gradeHomeWorkOnce(
        graded.id,
        { currentGrade: 90, revisionGrade: 80 },
        tx
      );
      expect(gradedOutcome).not.toBeNull();

      // Partially graded on ONE track only — still an eligible probe row.
      const partial = await HomeWorkRepository.insertHomeWork(
        { sessionId: partialSession.id, currentFromAyah: 4, currentToAyah: 6 },
        tx
      );
      const partialOutcome = await HomeWorkRepository.gradeHomeWorkOnce(
        partial.id,
        { currentGrade: 70, revisionGrade: 0 },
        tx
      );
      expect(partialOutcome).not.toBeNull();
      await tx.update(homeWork).set({ revisionGrade: null }).where(eq(homeWork.id, partial.id));

      // The NEWEST row is fully graded — the read carries NO grade
      // predicate, so it surfaces the newest row whatever its state and
      // leaves gradeability to the caller's guarded UPDATE.
      const newest = await HomeWorkRepository.insertHomeWork(
        { sessionId: newestSession.id, currentFromAyah: 7, currentToAyah: 9 },
        tx
      );
      const newestOutcome = await HomeWorkRepository.gradeHomeWorkOnce(
        newest.id,
        { currentGrade: 55, revisionGrade: 45 },
        tx
      );
      expect(newestOutcome).not.toBeNull();

      const latest = await HomeWorkRepository.findLatestByStudentId(actors.studentUserId, tx);

      expect(latest).not.toBeNull();
      expect(latest?.id).toBe(newest.id);
      expect(latest?.sessionId).toBe(newestSession.id);
      expect(latest?.currentGrade).toBe(55);
      expect(latest?.revisionGrade).toBe(45);
    });
  });

  test("gradeHomeWorkOnce writes both grades and advances updated_at exactly once", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sessionRow = await createCompletedSession(tx, actors);
      // The stamp override gives the statement's own `now()` reading an
      // unambiguous later-than anchor (transaction_timestamp is fixed for
      // the whole transaction, so the pre-stamp must be pushed back).
      const staleStamp = new Date(Date.now() - 60_000);
      const inserted = await createTestHomeWork(tx, sessionRow.id, {
        createdAt: staleStamp,
        updatedAt: staleStamp,
      });

      const graded = await HomeWorkRepository.gradeHomeWorkOnce(
        inserted.id,
        { currentGrade: 88, revisionGrade: 75 },
        tx
      );

      expect(graded).not.toBeNull();
      expect(graded?.id).toBe(inserted.id);
      expect(graded?.currentGrade).toBe(88);
      expect(graded?.revisionGrade).toBe(75);
      expect(graded?.updatedAt.getTime()).toBeGreaterThan(staleStamp.getTime());
      // No other column may change.
      expect(graded?.sessionId).toBe(inserted.sessionId);
      expect(graded?.currentSurahJuz).toBe(inserted.currentSurahJuz);
    });
  });

  // ─── Tier 2: boundary + ordering determinism ─────────────────────────

  test("gradeHomeWorkOnce accepts the exact CHECK bounds 0 and 100 (raw repo tier)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const first = await createCompletedSession(tx, actors);
      const second = await createCompletedSession(tx, actors);
      const zeroTarget = await createTestHomeWork(tx, first.id);
      const hundredTarget = await createTestHomeWork(tx, second.id);

      const zero = await HomeWorkRepository.gradeHomeWorkOnce(zeroTarget.id, { currentGrade: 0, revisionGrade: 0 }, tx);
      const hundred = await HomeWorkRepository.gradeHomeWorkOnce(
        hundredTarget.id,
        { currentGrade: 100, revisionGrade: 100 },
        tx
      );

      expect(zero?.currentGrade).toBe(0);
      expect(zero?.revisionGrade).toBe(0);
      expect(hundred?.currentGrade).toBe(100);
      expect(hundred?.revisionGrade).toBe(100);
    });
  });

  test("findLatestByStudentId is deterministic across out-of-insertion-order seeds (newest stamp first, id tiebreak)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const oldSession = await createCompletedSession(tx, actors);
      const middleSession = await createCompletedSession(tx, actors);
      const tieA = await createCompletedSession(tx, actors);
      const tieB = await createCompletedSession(tx, actors);

      // Insert OLDEST-stamped first, newest-stamped last — the read must
      // still surface the newest stamp, not the first-inserted row.
      const oldRow = await HomeWorkRepository.insertHomeWork({ sessionId: oldSession.id }, tx);
      await tx
        .update(homeWork)
        .set({ createdAt: new Date(Date.now() - 120_000) })
        .where(eq(homeWork.id, oldRow.id));
      const middleRow = await HomeWorkRepository.insertHomeWork({ sessionId: middleSession.id }, tx);
      await tx
        .update(homeWork)
        .set({ createdAt: new Date(Date.now() - 60_000) })
        .where(eq(homeWork.id, middleRow.id));

      expect((await HomeWorkRepository.findLatestByStudentId(actors.studentUserId, tx))?.id).toBe(middleRow.id);

      // Same-instant rows resolve by the id DESC tiebreak (the greater id
      // is the later-authored row).
      const shared = new Date(Date.now() - 30_000);
      const tieRowA = await HomeWorkRepository.insertHomeWork({ sessionId: tieA.id }, tx);
      await tx.update(homeWork).set({ createdAt: shared }).where(eq(homeWork.id, tieRowA.id));
      const tieRowB = await HomeWorkRepository.insertHomeWork({ sessionId: tieB.id }, tx);
      await tx.update(homeWork).set({ createdAt: shared }).where(eq(homeWork.id, tieRowB.id));
      expect(tieRowB.id).toBeGreaterThan(tieRowA.id);

      const latest = await HomeWorkRepository.findLatestByStudentId(actors.studentUserId, tx);
      expect(latest?.id).toBe(tieRowB.id);
    });
  });

  // ─── Tier 3: chaos/guard ─────────────────────────────────────────────

  test("a second gradeHomeWorkOnce on the same row returns null and leaves the grades untouched", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sessionRow = await createCompletedSession(tx, actors);
      const target = await createTestHomeWork(tx, sessionRow.id, { currentFromAyah: 1, currentToAyah: 5 });

      const winner = await HomeWorkRepository.gradeHomeWorkOnce(target.id, { currentGrade: 95, revisionGrade: 85 }, tx);
      expect(winner).not.toBeNull();

      const loser = await HomeWorkRepository.gradeHomeWorkOnce(target.id, { currentGrade: 10, revisionGrade: 20 }, tx);

      expect(loser).toBeNull();
      const finalRow = await readHomeWorkRow(tx, target.id);
      expect(finalRow.currentGrade).toBe(95);
      expect(finalRow.revisionGrade).toBe(85);
    });
  });

  test("duplicated re-grade attempts produce exactly one winner", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sessionRow = await createCompletedSession(tx, actors);
      const target = await createTestHomeWork(tx, sessionRow.id);

      const outcomes = await Promise.allSettled([
        HomeWorkRepository.gradeHomeWorkOnce(target.id, { currentGrade: 60, revisionGrade: 50 }, tx),
        HomeWorkRepository.gradeHomeWorkOnce(target.id, { currentGrade: 60, revisionGrade: 50 }, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const winners = outcomes.flatMap(outcome =>
        outcome.status === "fulfilled" && outcome.value !== null ? [outcome.value] : []
      );
      expect(winners).toHaveLength(1);
      expect(winners[0]?.currentGrade).toBe(60);
      expect(winners[0]?.revisionGrade).toBe(50);
    });
  });

  test("a second insert for the same session raises the RAW 23505 on home_work_session_id_unique", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sessionRow = await createCompletedSession(tx, actors);
      const first = await HomeWorkRepository.insertHomeWork({ sessionId: sessionRow.id }, tx);
      expect(first.id).toBeGreaterThan(0);

      await tx.execute(sql`savepoint home_work_unique_probe`);
      const duplicateError = await expectRepoError(() =>
        HomeWorkRepository.insertHomeWork({ sessionId: sessionRow.id }, tx)
      );
      await tx.execute(sql`rollback to savepoint home_work_unique_probe`);

      expect(hasPostgresErrorCode(duplicateError, PG_UNIQUE_VIOLATION)).toBe(true);
      expect(constraintNameOf(duplicateError)).toBe("home_work_session_id_unique");
      // The repository surfaces the raw driver error untouched — the
      // service layer owns the domain mapping.
      expect(duplicateError.constructor.name).not.toBe("ConflictError");
      expect(duplicateError.constructor.name).not.toBe("DomainError");

      // The savepoint bracket kept the transaction queryable and the
      // winner's row intact.
      const winner = await HomeWorkRepository.findBySessionId(sessionRow.id, tx);
      expect(winner?.id).toBe(first.id);
    });
  });

  // ─── Schema-tier invariant probes (session link + grade bounds) ─────

  test("INV-HW1: a NULL session_id raises 23502; an orphan session_id raises 23503 on home_work_session_id_session_id_fkey; a session-row delete cascades the homework row", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sessionRow = await createCompletedSession(tx, actors);
      const assignment = await HomeWorkRepository.insertHomeWork({ sessionId: sessionRow.id }, tx);
      expect(assignment.id).toBeGreaterThan(0);

      // NOT NULL leg: the session link is mandatory — a link-less
      // homework row is rejected by the column itself (raw wire-level
      // probe; the typed insert surface never offers the null).
      const nullLinkError = await probeInsideSavepoint(tx, "home work null session link", () =>
        tx.execute(sql`INSERT INTO home_work (session_id) VALUES (NULL)`)
      );
      expectNotNullViolation(nullLinkError, "session_id");

      // FK leg: a session id beyond the sequence cannot be referenced.
      const orphanId = await absentSessionId(tx);
      const orphanError = await probeInsideSavepoint(tx, "home work orphan session link", () =>
        tx.execute(sql`INSERT INTO home_work (session_id) VALUES (${orphanId})`)
      );
      expectFkViolation(orphanError, "home_work_session_id_session_id_fkey");

      // The savepoint brackets kept the transaction queryable — the
      // fixture assignment row is intact and still ungraded.
      const survivor = await HomeWorkRepository.findBySessionId(sessionRow.id, tx);
      expect(survivor?.id).toBe(assignment.id);
      expect(survivor?.currentGrade).toBeNull();
      expect(survivor?.revisionGrade).toBeNull();

      // Cascade leg: removing the session row removes its homework row
      // (the FK's ON DELETE CASCADE contract — homework never outlives
      // its session).
      await tx.delete(session).where(eq(session.id, sessionRow.id));
      expect(await HomeWorkRepository.findBySessionId(sessionRow.id, tx)).toBeNull();
    });
  });

  test("INV-HW2: gradeHomeWorkOnce (bypassing service validation) with 101/-1 raises 23514 on home_work_current_grade_check / home_work_revision_grade_check (row survives)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sessionRow = await createCompletedSession(tx, actors);
      const target = await createTestHomeWork(tx, sessionRow.id);

      // The guarded one-shot UPDATE carries NO range guard — the DB CHECKs
      // are the only backstop on this path. Each rejected statement is
      // atomic, so the row stays ungraded after every probe.
      const overCurrent = await probeInsideSavepoint(tx, "home work current grade ceiling", () =>
        HomeWorkRepository.gradeHomeWorkOnce(target.id, { currentGrade: 101, revisionGrade: 50 }, tx)
      );
      expectCheckViolation(overCurrent, "home_work_current_grade_check");

      const underCurrent = await probeInsideSavepoint(tx, "home work current grade floor", () =>
        HomeWorkRepository.gradeHomeWorkOnce(target.id, { currentGrade: -1, revisionGrade: 50 }, tx)
      );
      expectCheckViolation(underCurrent, "home_work_current_grade_check");

      const overRevision = await probeInsideSavepoint(tx, "home work revision grade ceiling", () =>
        HomeWorkRepository.gradeHomeWorkOnce(target.id, { currentGrade: 50, revisionGrade: 101 }, tx)
      );
      expectCheckViolation(overRevision, "home_work_revision_grade_check");

      const underRevision = await probeInsideSavepoint(tx, "home work revision grade floor", () =>
        HomeWorkRepository.gradeHomeWorkOnce(target.id, { currentGrade: 50, revisionGrade: -1 }, tx)
      );
      expectCheckViolation(underRevision, "home_work_revision_grade_check");

      // Row survives: still ungraded after four rejected writes, and the
      // very next legal grade lands through the same guarded statement —
      // the transaction is fully alive, never poisoned.
      const intact = await readHomeWorkRow(tx, target.id);
      expect(intact.currentGrade).toBeNull();
      expect(intact.revisionGrade).toBeNull();
      const graded = await HomeWorkRepository.gradeHomeWorkOnce(target.id, { currentGrade: 90, revisionGrade: 80 }, tx);
      expect(graded?.currentGrade).toBe(90);
      expect(graded?.revisionGrade).toBe(80);
    });
  });

  // ─── Tier 4: security — enum backstop + binding proof ────────────────

  test("an out-of-enum surah/juz value is rejected at the DB tier by the raw executor probe (22P02)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sessionRow = await createCompletedSession(tx, actors);

      await tx.execute(sql`savepoint home_work_enum_probe`);
      const enumError = await expectRepoError(() =>
        tx.execute(sql`INSERT INTO home_work (session_id, current_surah_juz) VALUES (${sessionRow.id}, 'juz_99')`)
      );
      await tx.execute(sql`rollback to savepoint home_work_enum_probe`);

      expect(hasPostgresErrorCode(enumError, PG_INVALID_ENUM_INPUT)).toBe(true);
      expect(constraintNameOf(enumError)).toBe("");
      expect(causeChainContainsMessage(enumError, "surah_juz_ref")).toBe(true);
      expect(causeChainContainsMessage(enumError, "juz_99")).toBe(true);

      // The savepoint bracket kept the transaction queryable and the enum
      // vocabulary closed — only shipped members ever persist.
      const intact = await HomeWorkRepository.insertHomeWork(
        { sessionId: sessionRow.id, currentSurahJuz: SurahJuzRef.SurahAlMaidah },
        tx
      );
      expect(intact.currentSurahJuz).toBe(SurahJuzRef.SurahAlMaidah);
    });
  });

  test("a metacharacter payload bound as the enum parameter fails as a TYPE error, never as injected SQL", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sessionRow = await createCompletedSession(tx, actors);
      const hostile = "surah_al_fatihah'; DROP TABLE home_work;--";

      await tx.execute(sql`savepoint home_work_binding_probe`);
      const bindingError = await expectRepoError(() =>
        tx.execute(sql`INSERT INTO home_work (session_id, current_surah_juz) VALUES (${sessionRow.id}, ${hostile})`)
      );
      await tx.execute(sql`rollback to savepoint home_work_binding_probe`);

      // The whole hostile string rode ONE bound parameter — PostgreSQL
      // rejected the VALUE against the enum type, no statement escaped.
      expect(hasPostgresErrorCode(bindingError, PG_INVALID_ENUM_INPUT)).toBe(true);
      // Scoped to THIS probe's session: the parallel db-test workers share one
      // database, so a table-wide read would race another worker's committed
      // home_work row (observed once on CI). The oracle only needs "the
      // hostile payload wrote nothing for this session".
      const intact = await tx
        .select({ id: homeWork.id })
        .from(homeWork)
        .where(eq(homeWork.sessionId, sessionRow.id))
        .limit(1);
      expect(intact).toHaveLength(0);
    });
  });

  // ─── tx propagation ─────────────────────────────────────────────────

  test("an insert made with the explicit tx inside runInRollback rolls back with the block", async () => {
    let rolledBackSessionId = 0;
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sessionRow = await createCompletedSession(tx, actors);
      const inserted = await HomeWorkRepository.insertHomeWork({ sessionId: sessionRow.id }, tx);
      rolledBackSessionId = inserted.sessionId;
      expect(inserted.id).toBeGreaterThan(0);
    });

    // Fresh executor read — the forced rollback removed the row.
    const absent = await db.select().from(homeWork).where(eq(homeWork.sessionId, rolledBackSessionId)).limit(1);
    expect(absent).toHaveLength(0);
  });

  // ─── Static source pins (Tier 4) ────────────────────────────────────

  const repoSource = readFileSync(join(import.meta.dir, "../../../repo/classes/home-work.repository.ts"), "utf8");

  test("source: executor discipline — pool-fallback write branches, queryDb read branches, tx last on every signature", () => {
    expect(repoSource.match(/const executor = tx \?\? db;/g) ?? []).toHaveLength(2);
    expect(repoSource.match(/queryDb</g) ?? []).toHaveLength(4);
    const signatures = repoSource.match(/export async function [a-zA-Z]+\([^)]*\)/g) ?? [];
    expect(signatures).toHaveLength(6);
    for (const signature of signatures) {
      const flattened = signature.replace(/\s+/g, " ").replace(/ \)/g, ")").trim();
      expect(flattened.endsWith("tx?: DBTransaction)") || flattened.endsWith("tx?: DBQueryExecutor)")).toBe(true);
    }
  });

  test("source: bound parameters only, no wildcard select, no prepared statements, no SQL line comments", () => {
    expect(repoSource.includes("session_id = $1")).toBe(true);
    expect(repoSource.includes("s.student_id = $1")).toBe(true);
    // The `SELECT *` prohibition is scoped to actual SQL — the JSDoc text
    // `no \`SELECT *\`` would false-positive a naive `includes` check, so
    // the regex anchors on the SQL shape `SELECT * FROM`.
    expect(/SELECT \* FROM/i.test(repoSource)).toBe(false);
    expect(repoSource.includes(".prepare(")).toBe(false);
    expect(repoSource.includes("sql.placeholder")).toBe(false);
    expect(repoSource.includes("inArray")).toBe(false);
    expect(repoSource.includes("sql.raw")).toBe(false);
    expect(repoSource.includes("--")).toBe(false);
    // The newest-first ordering is pinned in source: homework creation
    // stamp DESC with the id DESC tiebreak.
    expect(repoSource.includes("desc(homeWork.createdAt), desc(homeWork.id)")).toBe(true);
    expect(repoSource.includes("ORDER BY created_at DESC, id DESC")).toBe(true);
    // The parent-portal list+count pair orders by the owning session's
    // started_at DESC NULLS LAST (scheduled-but-not-started sessions pin
    // after live sessions) with the homework id DESC deterministic tiebreak.
    expect(repoSource.includes("DESC NULLS LAST, hw.id DESC")).toBe(true);
    expect(repoSource.includes("desc(homeWork.id)")).toBe(true);
    // The fused BOTH-NULL grade predicate (never one-sided) lives ONLY in
    // the guarded UPDATE — the latest-row read carries NO grade predicate.
    expect(repoSource.match(/isNull\(homeWork\.currentGrade\)/g) ?? []).toHaveLength(1);
    expect(repoSource.match(/isNull\(homeWork\.revisionGrade\)/g) ?? []).toHaveLength(1);
  });

  test("source: no i18n, no logger, no console, one namespace, no plan-artifact references", () => {
    expect(repoSource.includes("getServerTranslations")).toBe(false);
    expect(repoSource.includes("logger")).toBe(false);
    expect(repoSource.includes("console.")).toBe(false);
    expect(repoSource.includes("export namespace HomeWorkRepository")).toBe(true);
    expect(/REQ-\d|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(repoSource)).toBe(false);
  });
});

/**
 * Standalone executor branches — the queryDb read paths and the `tx ?? db`
 * write fallbacks. These branches run WITHOUT a transaction by definition,
 * so their fixtures must be COMMITTED (an uncommitted row is invisible to
 * the pool path). They are registered here and hard-deleted in `afterAll`
 * (rule 9) in FK-dependency order (sessions first — the teacher/student
 * FKs are restrict-bound while sessions reference them; homework rows
 * cascade with their session).
 */
describe("HomeWorkRepository — standalone executor paths (committed fixtures)", () => {
  const committedSessionIds: number[] = [];
  const committedUserIds: number[] = [];
  let actors: SessionActors = { teacherUserId: 0, studentUserId: 0 };
  let ungradedSessionId = 0;
  let emptySessionId = 0;
  let ungradedHomeWorkId = 0;
  let gradedHomeWorkId = 0;

  afterAll(async () => {
    await Promise.all(committedSessionIds.map(id => db.delete(session).where(eq(session.id, id))));
    committedSessionIds.length = 0;
    await Promise.all(
      committedUserIds.map(async userId => {
        await db.delete(teacher).where(eq(teacher.id, userId));
        await db.delete(students).where(eq(students.id, userId));
        await db.delete(users).where(eq(users.id, userId));
      })
    );
    committedUserIds.length = 0;
  });

  test("insertHomeWork runs on the pool fallback and returns the inserted row", async () => {
    const committed = await db.transaction(async tx => {
      const pair = await createSessionActors(tx);
      committedUserIds.push(pair.teacherUserId, pair.studentUserId);
      actors = pair;
      const gradedTarget = await createCompletedSession(tx, pair);
      const ungradedTarget = await createCompletedSession(tx, pair);
      const emptyTarget = await createCompletedSession(tx, pair);
      committedSessionIds.push(gradedTarget.id, ungradedTarget.id, emptyTarget.id);
      ungradedSessionId = ungradedTarget.id;
      emptySessionId = emptyTarget.id;
      return { gradedTarget, ungradedTarget };
    });

    const gradedRow = await HomeWorkRepository.insertHomeWork({
      sessionId: committed.gradedTarget.id,
      currentFromAyah: 1,
      currentToAyah: 4,
    });
    const ungradedRow = await HomeWorkRepository.insertHomeWork({
      sessionId: committed.ungradedTarget.id,
      currentFromAyah: 5,
      currentToAyah: 8,
    });
    gradedHomeWorkId = gradedRow.id;
    ungradedHomeWorkId = ungradedRow.id;

    expect(gradedRow.id).toBeGreaterThan(0);
    expect(ungradedRow.id).toBeGreaterThan(0);
    expect(gradedRow.currentGrade).toBeNull();
  });

  test("findBySessionId runs standalone via the queryDb read path (hit and miss)", async () => {
    const found = await HomeWorkRepository.findBySessionId(ungradedSessionId);
    expect(found).not.toBeNull();
    expect(found?.sessionId).toBe(ungradedSessionId);
    expect(Object.keys(found ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([...HOME_WORK_ROW_KEYS]);

    const miss = await HomeWorkRepository.findBySessionId(emptySessionId);
    expect(miss).toBeNull();
  });

  test("findLatestByStudentId runs standalone via the queryDb read path", async () => {
    // Grade the committed graded row first (pool fallback write) so the
    // read has a graded row AND an ungraded row across sessions — the
    // newest row (the ungraded one, created last) is the one returned.
    const gradedRow = await HomeWorkRepository.gradeHomeWorkOnce(gradedHomeWorkId, {
      currentGrade: 80,
      revisionGrade: 70,
    });
    expect(gradedRow?.currentGrade).toBe(80);

    const latest = await HomeWorkRepository.findLatestByStudentId(actors.studentUserId);
    expect(latest).not.toBeNull();
    expect(latest?.id).toBe(ungradedHomeWorkId);
    expect(latest?.currentGrade).toBeNull();
    expect(latest?.revisionGrade).toBeNull();
  });

  test("gradeHomeWorkOnce hits on the pool fallback and reports a guarded miss afterwards", async () => {
    const winner = await HomeWorkRepository.gradeHomeWorkOnce(ungradedHomeWorkId, {
      currentGrade: 99,
      revisionGrade: 3,
    });
    expect(winner?.currentGrade).toBe(99);
    expect(winner?.revisionGrade).toBe(3);

    const loser = await HomeWorkRepository.gradeHomeWorkOnce(ungradedHomeWorkId, {
      currentGrade: 1,
      revisionGrade: 1,
    });
    expect(loser).toBeNull();
  });
});
