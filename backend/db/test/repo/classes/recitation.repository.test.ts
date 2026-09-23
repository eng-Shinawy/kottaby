/**
 * RecitationRepository tests — the closed write-once + lookup surface over
 * the per-session `recitation` record.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Transactional cases run inside `runInRollback`; `tx` is passed to EVERY
 *    repository call, entity-setup helper, and direct Drizzle query.
 *  - User/student fixtures come from `entity-setup.ts` helpers; `teacher`
 *    and `session` rows have no factory, so they are DIRECT Drizzle inserts
 *    inside the same transaction.
 *  - The non-transactional branches (insert on the global `db` handle, read
 *    via `queryDb` on the global pool) cannot see rows of a rolled-back
 *    transaction, so they are exercised against a COMMITTED fixture created
 *    in `beforeAll` and hard-deleted in `afterAll` (rule 9 — sanctioned for
 *    shared static fixture data); every committed write is hard-deleted
 *    immediately after its assertions with a zero-residue probe.
 *  - NEVER `expect(...).rejects.toThrow()` — error surfaces are asserted
 *    via the `expectRepoError` try/catch helper.
 *
 * Tier map (the repo suite's 4-Tier DB test convention):
 *  - Tier 1 (contract): insertOnce returns the created row and
 *    findBySessionId reads it back on the caller's transaction; an explicit
 *    `null` description round-trips; misses (recorded session without a
 *    record, guaranteed-absent session id) return `null`, never throw.
 *  - Tier 2 (executors/boundary): both executor branches — the
 *    transactional Drizzle branch above, and the standalone branches
 *    (insert on `db`, read on the `queryDb` pool path) against the
 *    committed fixture.
 *  - Tier 3 (chaos): a duplicate insert surfaces the RAW `23505` with
 *    `recitation_session_id_unique` (no translation at the repo layer);
 *    two concurrent inserts for one committed session produce exactly ONE
 *    winner row and one raw `23505` (skip-gated under PGlite via
 *    `isPgliteProvider` — this environment is real PostgreSQL, so it RUNS).
 *  - Tier 4 (isolation): the record of one session never leaks through a
 *    read for a sibling session of the same cast.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { RecitationRepository } from "@/backend/db/repo";
import { recitation } from "@/backend/db/schema/classes/recitation";
import { session } from "@/backend/db/schema/classes/session";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { constraintNameOf, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import type { DBTransaction, RecitationSelectType, SessionSelectType } from "@/backend/types";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

/** pg constraint name of the per-session uniqueness arbiter. */
const RECITATION_SESSION_UNIQUE = "recitation_session_id_unique";

/** Inserts a `teacher` role-child row for a previously-created user. */
async function insertTestTeacher(tx: DBTransaction, userId: number): Promise<void> {
  const [row] = await tx.insert(teacher).values({ id: userId, isApproved: true }).returning();
  if (!row) {
    throw new Error("insertTestTeacher: insert returned no rows");
  }
}

/**
 * Inserts a `session` row between the given teacher/student ids — no
 * factory exists for this table, so the row is written directly.
 */
async function insertTestSession(tx: DBTransaction, teacherId: number, studentId: number): Promise<SessionSelectType> {
  const [row] = await tx.insert(session).values({ teacherId, studentId }).returning();
  if (!row) {
    throw new Error("insertTestSession: insert returned no rows");
  }
  return row;
}

/**
 * Provisions the minimum session cast: a teacher (user + `teacher` row)
 * and a student (user + `students` row). Every identity field is unique
 * per call (random suffixes in the helpers).
 */
async function provisionSessionCast(tx: DBTransaction): Promise<{ teacherUserId: number; studentUserId: number }> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await insertTestTeacher(tx, teacherUser.id);
  const studentUser = await createTestUser(tx);
  await createTestStudent(tx, studentUser.id);
  return { teacherUserId: teacherUser.id, studentUserId: studentUser.id };
}

/** Returns a session id guaranteed absent from the visible table state. */
async function absentSessionId(executor: Pick<DBTransaction, "select">): Promise<number> {
  const [row] = await executor.select({ maxId: sql<number>`coalesce(max(${session.id}), 0)::int` }).from(session);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Scoped count of the recitation rows of one session — residue oracle. */
async function countRecitationsForSession(executor: Pick<DBTransaction, "select">, sessionId: number): Promise<number> {
  const rows = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(recitation)
    .where(eq(recitation.sessionId, sessionId));
  return rows[0]?.count ?? 0;
}

/**
 * Walks the Drizzle error cause chain hunting the PostgreSQL
 * unique-violation code (`23505`) — Drizzle masks driver errors behind its
 * generic "failed query" message, so the raw code lives on the
 * cause-chain pg error (mirrors the traversal precedent of
 * `isUniqueViolation` in `user-provisioning.helpers.ts`).
 */
function hasUniqueViolationCode(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === "23505") {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** A committed session fixture (default-executor branch target). */
interface CommittedSessionFixture {
  readonly teacherUserId: number;
  readonly studentUserId: number;
  readonly sessionId: number;
}

let committedFixture: CommittedSessionFixture | null = null;

/** Narrows the committed fixture, failing loudly if `beforeAll` did not run. */
function requireCommittedFixture(): CommittedSessionFixture {
  if (!committedFixture) {
    throw new Error("expected the committed beforeAll fixture to exist");
  }
  return committedFixture;
}

beforeAll(async () => {
  committedFixture = await db.transaction(async tx => {
    const cast = await provisionSessionCast(tx);
    const created = await insertTestSession(tx, cast.teacherUserId, cast.studentUserId);
    return { teacherUserId: cast.teacherUserId, studentUserId: cast.studentUserId, sessionId: created.id };
  });
});

afterAll(async () => {
  const fixture = committedFixture;
  if (!fixture) {
    return;
  }
  // FK-safe delete order: recitation (cascade child) → session →
  // teacher/students → users.
  await db.delete(recitation).where(eq(recitation.sessionId, fixture.sessionId));
  await db.delete(session).where(eq(session.id, fixture.sessionId));
  await db.delete(teacher).where(eq(teacher.id, fixture.teacherUserId));
  await db.delete(students).where(eq(students.id, fixture.studentUserId));
  await Promise.all([
    db.delete(users).where(eq(users.id, fixture.teacherUserId)),
    db.delete(users).where(eq(users.id, fixture.studentUserId)),
  ]);
});

describe("RecitationRepository — namespace closure", () => {
  test("exposes exactly insertOnce and findBySessionId — nothing more", () => {
    expect(Object.keys(RecitationRepository).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "findBySessionId",
      "insertOnce",
    ]);
  });
});

describe("RecitationRepository — transactional branch (runInRollback)", () => {
  test("insertOnce returns the created row and findBySessionId reads it back", async () => {
    await runInRollback(async tx => {
      const cast = await provisionSessionCast(tx);
      const created = await insertTestSession(tx, cast.teacherUserId, cast.studentUserId);

      const saved = await RecitationRepository.insertOnce(
        { sessionId: created.id, name: "Surah Al-Mulk revision", description: "First pass with tajweed notes" },
        tx
      );

      expect(typeof saved.id).toBe("number");
      expect(saved.sessionId).toBe(created.id);
      expect(saved.name).toBe("Surah Al-Mulk revision");
      expect(saved.description).toBe("First pass with tajweed notes");
      expect(saved.createdAt).toBeInstanceOf(Date);
      expect(saved.updatedAt).toBeInstanceOf(Date);

      const found = await RecitationRepository.findBySessionId(created.id, tx);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(saved.id);
      expect(found?.sessionId).toBe(created.id);
      expect(found?.name).toBe(saved.name);
      expect(found?.description).toBe(saved.description);
      expect(found?.createdAt).toBeInstanceOf(Date);
    });
  });

  test("an explicit null description round-trips as null", async () => {
    await runInRollback(async tx => {
      const cast = await provisionSessionCast(tx);
      const created = await insertTestSession(tx, cast.teacherUserId, cast.studentUserId);

      const saved = await RecitationRepository.insertOnce(
        { sessionId: created.id, name: "Surah Ya-Sin memorization", description: null },
        tx
      );

      expect(saved.description).toBeNull();

      const found = await RecitationRepository.findBySessionId(created.id, tx);

      expect(found).not.toBeNull();
      expect(found?.description).toBeNull();
    });
  });

  test("findBySessionId returns null for a session with no record yet", async () => {
    await runInRollback(async tx => {
      const cast = await provisionSessionCast(tx);
      const created = await insertTestSession(tx, cast.teacherUserId, cast.studentUserId);

      const found = await RecitationRepository.findBySessionId(created.id, tx);

      expect(found).toBeNull();
    });
  });

  test("findBySessionId returns null for a guaranteed-absent session id", async () => {
    await runInRollback(async tx => {
      const missingId = await absentSessionId(tx);

      const found = await RecitationRepository.findBySessionId(missingId, tx);

      expect(found).toBeNull();
    });
  });
});

describe("RecitationRepository — standalone branches (committed fixture)", () => {
  test("insertOnce without a tx writes via the cold executor; findBySessionId without a tx reads it back", async () => {
    const fixture = requireCommittedFixture();

    const saved = await RecitationRepository.insertOnce({
      sessionId: fixture.sessionId,
      name: "Committed cold-path record",
      description: null,
    });

    expect(saved.sessionId).toBe(fixture.sessionId);

    const found = await RecitationRepository.findBySessionId(fixture.sessionId);

    expect(found).not.toBeNull();
    expect(found?.id).toBe(saved.id);
    expect(found?.sessionId).toBe(fixture.sessionId);
    expect(found?.name).toBe("Committed cold-path record");

    // Hard-delete the committed write immediately (rule 9) — no residue.
    await db.delete(recitation).where(eq(recitation.sessionId, fixture.sessionId));
    expect(await countRecitationsForSession(db, fixture.sessionId)).toBe(0);
  });

  test("findBySessionId without a tx returns null for the record-less committed session", async () => {
    const fixture = requireCommittedFixture();

    // Establish the record-less precondition locally — never inherit it from a sibling test's cleanup.
    await db.delete(recitation).where(eq(recitation.sessionId, fixture.sessionId));

    const found = await RecitationRepository.findBySessionId(fixture.sessionId);

    expect(found).toBeNull();
  });

  test("findBySessionId without a tx returns null for a guaranteed-absent session id", async () => {
    const missingId = await absentSessionId(db);

    const found = await RecitationRepository.findBySessionId(missingId);

    expect(found).toBeNull();
  });
});

describe("RecitationRepository — duplicate insert (raw unique violation)", () => {
  test("a second insert for the same session surfaces the RAW 23505 with the constraint name", async () => {
    await runInRollback(async tx => {
      const cast = await provisionSessionCast(tx);
      const created = await insertTestSession(tx, cast.teacherUserId, cast.studentUserId);
      await RecitationRepository.insertOnce({ sessionId: created.id, name: "Original record", description: null }, tx);

      // The colliding insert runs inside a SAVEPOINT (Drizzle nested
      // transaction): the 23505 rolls back ONLY the savepoint, leaving the
      // outer rollback-tx usable for the post-conflict probe below. The
      // repo propagates the raw unique violation untranslated — the
      // SERVICE owns the final domain mapping.
      const error = await expectRepoError(() =>
        tx.transaction(async sp =>
          RecitationRepository.insertOnce({ sessionId: created.id, name: "Duplicate attempt", description: null }, sp)
        )
      );

      expect(constraintNameOf(error)).toBe(RECITATION_SESSION_UNIQUE);
      expect(hasUniqueViolationCode(error)).toBe(true);

      // The savepoint rollback killed only the colliding insert — the
      // original record is intact.
      expect(await countRecitationsForSession(tx, created.id)).toBe(1);
    });
  });
});

/** Wholesale-skip wrapper for the true-concurrency arm — PGlite cannot host cross-connection races. */
const describeOnRealPostgres = isPgliteProvider() ? describe.skip : describe;

describeOnRealPostgres("RecitationRepository — concurrent double-insert race (real PostgreSQL)", () => {
  test("two concurrent inserts for one session: exactly one winner, one raw 23505", async () => {
    const fixture = requireCommittedFixture();

    const attempt = (): Promise<RecitationSelectType> =>
      RecitationRepository.insertOnce({ sessionId: fixture.sessionId, name: "Race record", description: null });

    const outcomes = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<RecitationSelectType> => outcome.status === "fulfilled"
    );
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const loserError: unknown = rejected[0]?.reason;
    expect(loserError).toBeInstanceOf(Error);
    expect(constraintNameOf(loserError)).toBe(RECITATION_SESSION_UNIQUE);
    expect(hasUniqueViolationCode(loserError)).toBe(true);

    // Exactly one winner row survived on the committed session.
    expect(await countRecitationsForSession(db, fixture.sessionId)).toBe(1);
    const winner = await RecitationRepository.findBySessionId(fixture.sessionId);
    expect(winner).not.toBeNull();
    expect(winner?.name).toBe("Race record");

    // Hard-delete the committed winner IMMEDIATELY (rule 9) — no residue.
    await db.delete(recitation).where(eq(recitation.sessionId, fixture.sessionId));
    expect(await countRecitationsForSession(db, fixture.sessionId)).toBe(0);
  });
});

describe("RecitationRepository — sibling-session isolation", () => {
  test("the record of one session never leaks through a read for a sibling session", async () => {
    await runInRollback(async tx => {
      const cast = await provisionSessionCast(tx);
      const sessionA = await insertTestSession(tx, cast.teacherUserId, cast.studentUserId);
      const sessionB = await insertTestSession(tx, cast.teacherUserId, cast.studentUserId);

      await RecitationRepository.insertOnce(
        { sessionId: sessionA.id, name: "Session A record", description: null },
        tx
      );

      const leaked = await RecitationRepository.findBySessionId(sessionB.id, tx);
      expect(leaked).toBeNull();
      expect(await countRecitationsForSession(tx, sessionB.id)).toBe(0);

      // The write landed on its own session only.
      const ownRecord = await RecitationRepository.findBySessionId(sessionA.id, tx);
      expect(ownRecord).not.toBeNull();
      expect(ownRecord?.sessionId).toBe(sessionA.id);
    });
  });
});
