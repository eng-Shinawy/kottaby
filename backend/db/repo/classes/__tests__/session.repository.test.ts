/**
 * SessionRepository tests — the bare PK read (`findById`) and the joined
 * two-participant wave-context read (`findWaveContextById`).
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Transactional cases run inside `runInRollback`; `tx` is passed to EVERY
 *    repository call, entity-setup helper, and direct Drizzle query.
 *  - User/student fixtures come from `entity-setup.ts` helpers
 *    (`createTestUser`, `createTestStudent`); `teacher` and `session` rows
 *    have no factory, so they are DIRECT Drizzle inserts inside the same
 *    transaction.
 *  - The non-transactional branch (`queryDb` on the global pool) cannot see
 *    rows of a rolled-back transaction, so it is exercised against a
 *    COMMITTED fixture created in `beforeAll` and hard-deleted in `afterAll`
 *    (Rule 9 — sanctioned for shared static fixture data).
 *  - Read-purity is proven with scoped row-count oracles (fixture ids only)
 *    taken before and after the read calls — never a whole-table count.
 *
 * Coverage map:
 *  - Tier 1 (transactional branch): findById hit (full row, defaults intact)
 *    and miss; findWaveContextById joined shape with BOTH participants'
 *    fullName/locale present, a locale-NULL participant (fallback mapping),
 *    and a miss; all reads return `null` on absence, never throw.
 *  - Tier 2 (purity): zero writes on the read paths — scoped session/user
 *    row counts are unchanged around the read calls.
 *  - Tier 3 (non-transactional branch): both reads against the committed
 *    fixture (hit) and a guaranteed-absent id (miss → null).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { SessionRepository } from "@/backend/db/repo";
import { session } from "@/backend/db/schema/classes/session";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { SessionIntent, TeacherRequestPreference } from "@/backend/enum";
import type { DBTransaction, SessionSelectType, TeacherSelectType } from "@/backend/types";

/**
 * Inserts a `teacher` role-child row for a previously-created user — no
 * factory exists for this table, so the row is written directly.
 */
async function insertTestTeacher(
  tx: DBTransaction,
  userId: number,
  overrides: Partial<TeacherSelectType> = {}
): Promise<TeacherSelectType> {
  const [row] = await tx
    .insert(teacher)
    .values({ id: userId, isApproved: true, ...overrides })
    .returning();
  if (!row) {
    throw new Error("insertTestTeacher: insert returned no rows");
  }
  return row;
}

/**
 * Inserts a `session` row between the given teacher/student ids — no
 * factory exists for this table, so the row is written directly.
 */
async function insertTestSession(
  tx: DBTransaction,
  teacherId: number,
  studentId: number,
  overrides: Partial<SessionSelectType> = {}
): Promise<SessionSelectType> {
  const [row] = await tx
    .insert(session)
    .values({ teacherId, studentId, ...overrides })
    .returning();
  if (!row) {
    throw new Error("insertTestSession: insert returned no rows");
  }
  return row;
}

interface WaveFixture {
  readonly studentUserId: number;
  readonly teacherUserId: number;
  readonly studentFullName: string;
  readonly teacherFullName: string;
}

/**
 * Provisions both wave participants: the student user + `students` row via
 * entity-setup helpers, the teacher user + `teacher` row via mixed
 * helper/direct insert. A `null` locale override leaves the user row's
 * `locale` column NULL (the fallback-mapping fixture).
 */
async function provisionWaveFixture(
  tx: DBTransaction,
  studentLocale: "ar" | "en" | null,
  teacherLocale: "ar" | "en" | null,
  requestPreference: TeacherRequestPreference = TeacherRequestPreference.Queue
): Promise<WaveFixture> {
  const studentUser = await createTestUser(tx, studentLocale === null ? {} : { locale: studentLocale });
  await createTestStudent(tx, studentUser.id);
  const teacherUser = await createTestUser(tx, {
    role: "teacher",
    ...(teacherLocale === null ? {} : { locale: teacherLocale }),
  });
  await insertTestTeacher(tx, teacherUser.id, { requestPreference });
  return {
    studentUserId: studentUser.id,
    teacherUserId: teacherUser.id,
    studentFullName: studentUser.fullName,
    teacherFullName: teacherUser.fullName,
  };
}

/** Returns a session id guaranteed absent from the visible table state. */
async function absentSessionId(executor: Pick<DBTransaction, "select">): Promise<number> {
  const [row] = await executor.select({ maxId: sql<number>`coalesce(max(${session.id}), 0)::int` }).from(session);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Scoped count of the given session row — read-purity oracle. */
async function countSessionsById(tx: DBTransaction, sessionId: number): Promise<number> {
  const rows = await tx.select({ count: sql<number>`count(*)::int` }).from(session).where(eq(session.id, sessionId));
  return rows[0]?.count ?? 0;
}

/** Scoped count of the given user rows — read-purity oracle. */
async function countUsersByIds(tx: DBTransaction, ids: readonly number[]): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(inArray(users.id, [...ids]));
  return rows[0]?.count ?? 0;
}

describe("SessionRepository.findById — transactional branch", () => {
  test("returns the full session row for an existing session", async () => {
    await runInRollback(async tx => {
      const fixture = await provisionWaveFixture(tx, "ar", "en");
      const created = await insertTestSession(tx, fixture.teacherUserId, fixture.studentUserId, {
        intent: SessionIntent.Hifz,
      });

      const found = await SessionRepository.findById(created.id, tx);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.teacherId).toBe(fixture.teacherUserId);
      expect(found?.studentId).toBe(fixture.studentUserId);
      expect(found?.intent).toBe("hifz");
      // Schema defaults flow through the full-row read.
      expect(found?.status).toBe("scheduled");
      expect(found?.sessionType).toBe("student_session");
      expect(found?.feeHeld).toBe(false);
      expect(found?.createdAt).toBeInstanceOf(Date);
    });
  });

  test("returns null for a guaranteed-absent session id", async () => {
    await runInRollback(async tx => {
      const missingId = await absentSessionId(tx);

      const found = await SessionRepository.findById(missingId, tx);

      expect(found).toBeNull();
    });
  });
});

describe("SessionRepository.findWaveContextById — transactional branch", () => {
  test("returns the joined row with BOTH participants' userId/fullName/locale", async () => {
    await runInRollback(async tx => {
      const fixture = await provisionWaveFixture(tx, "ar", "en");
      const created = await insertTestSession(tx, fixture.teacherUserId, fixture.studentUserId, {
        intent: SessionIntent.Tajweed,
      });

      const row = await SessionRepository.findWaveContextById(created.id, tx);

      expect(row).not.toBeNull();
      expect(row?.sessionId).toBe(created.id);
      expect(row?.intent).toBe("tajweed");
      expect(row?.studentUserId).toBe(fixture.studentUserId);
      expect(row?.studentFullName).toBe(fixture.studentFullName);
      expect(row?.studentLocale).toBe("ar");
      expect(row?.teacherUserId).toBe(fixture.teacherUserId);
      expect(row?.teacherFullName).toBe(fixture.teacherFullName);
      expect(row?.teacherLocale).toBe("en");
    });
  });

  test("maps a locale-NULL participant to null (fallback mapping), regardless of request preference", async () => {
    await runInRollback(async tx => {
      // Teacher has NO locale and a non-default request preference — the read
      // selects neither requestPreference nor any governance/PII column.
      const fixture = await provisionWaveFixture(tx, null, "en", TeacherRequestPreference.Reject);
      const created = await insertTestSession(tx, fixture.teacherUserId, fixture.studentUserId, {
        intent: SessionIntent.Evaluation,
      });

      const row = await SessionRepository.findWaveContextById(created.id, tx);

      expect(row).not.toBeNull();
      expect(row?.sessionId).toBe(created.id);
      expect(row?.intent).toBe("evaluation");
      expect(row?.studentUserId).toBe(fixture.studentUserId);
      expect(row?.studentFullName).toBe(fixture.studentFullName);
      expect(row?.studentLocale).toBeNull();
      expect(row?.teacherUserId).toBe(fixture.teacherUserId);
      expect(row?.teacherFullName).toBe(fixture.teacherFullName);
      expect(row?.teacherLocale).toBe("en");
    });
  });

  test("returns null for a guaranteed-absent session id", async () => {
    await runInRollback(async tx => {
      const missingId = await absentSessionId(tx);

      const row = await SessionRepository.findWaveContextById(missingId, tx);

      expect(row).toBeNull();
    });
  });
});

describe("SessionRepository — read purity", () => {
  test("findById and findWaveContextById perform zero writes (scoped row-count oracle)", async () => {
    await runInRollback(async tx => {
      const fixture = await provisionWaveFixture(tx, "ar", "en");
      const created = await insertTestSession(tx, fixture.teacherUserId, fixture.studentUserId, {
        intent: SessionIntent.Hifz,
      });

      const sessionsBefore = await countSessionsById(tx, created.id);
      const usersBefore = await countUsersByIds(tx, [fixture.studentUserId, fixture.teacherUserId]);

      // Both read paths must run AND return the row — otherwise the oracle
      // would pass vacuously on calls that did nothing.
      const byId = await SessionRepository.findById(created.id, tx);
      const wave = await SessionRepository.findWaveContextById(created.id, tx);
      expect(byId).not.toBeNull();
      expect(wave).not.toBeNull();

      expect(await countSessionsById(tx, created.id)).toBe(sessionsBefore);
      expect(await countUsersByIds(tx, [fixture.studentUserId, fixture.teacherUserId])).toBe(usersBefore);
    });
  });
});

// ─── Non-transactional branch (queryDb fast path) ─────────────────────────
// The global-pool read branch cannot see rolled-back rows, so it is exercised
// against ONE committed fixture (beforeAll) that is hard-deleted afterwards
// (afterAll) in FK-safe order.

interface CommittedWaveFixture extends WaveFixture {
  readonly sessionId: number;
}

let committedFixture: CommittedWaveFixture | null = null;

/** Unwraps the committed fixture, failing loudly if beforeAll did not run. */
function requireCommittedFixture(fixture: CommittedWaveFixture | null): CommittedWaveFixture {
  if (!fixture) {
    throw new Error("expected the committed beforeAll fixture to exist");
  }
  return fixture;
}

beforeAll(async () => {
  committedFixture = await db.transaction(async tx => {
    const fixture = await provisionWaveFixture(tx, "ar", "en", TeacherRequestPreference.OfferAlternatives);
    const created = await insertTestSession(tx, fixture.teacherUserId, fixture.studentUserId, {
      intent: SessionIntent.Hifz,
    });
    return { ...fixture, sessionId: created.id };
  });
});

afterAll(async () => {
  const fixture = committedFixture;
  if (!fixture) {
    return;
  }
  // FK-safe delete order: session (restrict) → teacher/students → users.
  await db.delete(session).where(eq(session.id, fixture.sessionId));
  await db.delete(teacher).where(eq(teacher.id, fixture.teacherUserId));
  await db.delete(students).where(eq(students.id, fixture.studentUserId));
  await Promise.all([
    db.delete(users).where(eq(users.id, fixture.studentUserId)),
    db.delete(users).where(eq(users.id, fixture.teacherUserId)),
  ]);
});

describe("SessionRepository — non-transactional branch (committed fixture)", () => {
  test("findById returns the committed session row without a tx", async () => {
    const fixture = requireCommittedFixture(committedFixture);

    const found = await SessionRepository.findById(fixture.sessionId);

    expect(found).not.toBeNull();
    expect(found?.id).toBe(fixture.sessionId);
    expect(found?.intent).toBe("hifz");
    expect(found?.teacherId).toBe(fixture.teacherUserId);
    expect(found?.studentId).toBe(fixture.studentUserId);
  });

  test("findById returns null for a guaranteed-absent id without a tx", async () => {
    const missingId = await absentSessionId(db);

    const found = await SessionRepository.findById(missingId);

    expect(found).toBeNull();
  });

  test("findWaveContextById returns the joined committed row without a tx", async () => {
    const fixture = requireCommittedFixture(committedFixture);

    const row = await SessionRepository.findWaveContextById(fixture.sessionId);

    expect(row).not.toBeNull();
    expect(row?.sessionId).toBe(fixture.sessionId);
    expect(row?.intent).toBe("hifz");
    expect(row?.studentUserId).toBe(fixture.studentUserId);
    expect(row?.studentFullName).toBe(fixture.studentFullName);
    expect(row?.studentLocale).toBe("ar");
    expect(row?.teacherUserId).toBe(fixture.teacherUserId);
    expect(row?.teacherFullName).toBe(fixture.teacherFullName);
    expect(row?.teacherLocale).toBe("en");
  });

  test("findWaveContextById returns null for a guaranteed-absent id without a tx", async () => {
    const missingId = await absentSessionId(db);

    const row = await SessionRepository.findWaveContextById(missingId);

    expect(row).toBeNull();
  });
});
