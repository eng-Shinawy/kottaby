/**
 * Journey-harness self-test — proves the shared `test/workflows/helpers/`
 * scaffolding contract before any domain journey relies on it.
 *
 * Coverage map:
 *  - TrackedFixtures: registration → committed rows exist → `cleanup()`
 *    hard-deletes in REVERSE registration order → post-teardown existence
 *    checks return absent (zero residue) → residue detection is load-bearing
 *    (verification fails while rows still exist) → repeated cleanup is a
 *    no-op.
 *  - SpiedFanoutTransport: `publishFanout` records (userIds, payload) pairs
 *    in order, replays them for assertions, freezes the log against
 *    mutation, and `clear()` re-arms it; the spy is structurally installable
 *    wherever a fan-out transport port is expected.
 *  - actor-context: the provisioning factory creates REAL users with REAL
 *    role rows (`users.role` + `students`/`teacher`/`parents`/`admin`
 *    children) — honest permissions by construction.
 *
 * This suite follows the journey-layer rules itself: fixtures are COMMITTED
 * in `beforeAll` (inside one committing `db.transaction` — provisioning is
 * commit-or-nothing, so a throwing setup rolls back and leaves nothing) and
 * hard-deleted in `afterAll` via `TrackedFixtures` — `runInRollback` is never
 * used here. Error assertions use the try/catch helper pattern.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import type { RealtimeNotificationPayload } from "@/backend/types";
import {
  type FanoutTransportLike,
  type JourneyActor,
  provisionAdminActor,
  provisionCertifiedTeacherActor,
  provisionParentActor,
  provisionStudentActor,
  SpiedFanoutTransport,
  type TrackedFixtureRecord,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/**
 * Try/catch rejection helper (the journey-layer pattern —
 * `expect(...).rejects.toThrow()` is prohibited). Returns the caught error;
 * fails the test when the call resolves successfully.
 */
async function expectHarnessError(fn: () => Promise<unknown>): Promise<Error> {
  let errorCaught: unknown = null;
  try {
    await fn();
  } catch (error) {
    errorCaught = error;
  }
  if (errorCaught === null) {
    throw new Error("expected the call to throw, but it resolved successfully");
  }
  if (errorCaught instanceof Error) {
    return errorCaught;
  }
  return new Error(`[non-Error throw: ${typeof errorCaught}]`);
}

/** Deterministic realtime payload fixture addressed to one notification row. */
function realtimePayloadFixture(id: number, title: string): RealtimeNotificationPayload {
  return {
    v: 1,
    kind: "notification",
    data: {
      id,
      type: "session_request",
      title,
      body: null,
      relatedEntityType: "session",
      relatedEntityId: 700 + id,
      createdAt: new Date("2026-01-15T10:30:00.000Z"),
    },
  };
}

describe("TrackedFixtures — register → tracked teardown → zero residue", () => {
  const tracked = new TrackedFixtures();
  let userRecord: TrackedFixtureRecord;
  let studentRecord: TrackedFixtureRecord;

  beforeAll(async () => {
    await db.transaction(async tx => {
      const user = await createTestUser(tx, { role: "student" });
      const student = await createTestStudent(tx, user.id);
      tracked.register(users, user.id);
      tracked.register(students, student.id);
    });
    [userRecord, studentRecord] = tracked.records;
  });

  afterAll(async () => {
    // No-op when an earlier test already cleaned up (registry empties on success).
    await tracked.cleanup();
  });

  test("registers both committed rows with derived table keys, in FK-safe order", () => {
    expect(tracked.size).toBe(2);
    expect(tracked.records.map(record => record.key)).toEqual(["users", "students"]);
  });

  test("existence probe confirms the committed rows are present before teardown", async () => {
    const present = await Promise.all([tracked.exists(userRecord), tracked.exists(studentRecord)]);
    expect(present).toEqual([true, true]);
  });

  test("residue detection is load-bearing — verification fails while rows exist", async () => {
    const error = await expectHarnessError(() => tracked.verifyAllAbsent());

    expect(error.message).toContain("users#");
    expect(error.message).toContain("students#");
  });

  test("cleanup hard-deletes in reverse registration order and verifies zero residue", async () => {
    const report = await tracked.cleanup();

    expect(report.deletedCount).toBe(2);
    expect(report.verifiedAbsentCount).toBe(2);
    // Child row (registered second) is deleted BEFORE its owning user row.
    expect(report.deletedKeys).toEqual(["students", "users"]);
  });

  test("post-teardown existence checks return absent for every registered row", async () => {
    const present = await Promise.all([tracked.exists(userRecord), tracked.exists(studentRecord)]);
    expect(present).toEqual([false, false]);
  });

  test("registry empties after successful cleanup — repeated cleanup is a no-op", async () => {
    expect(tracked.size).toBe(0);

    const report = await tracked.cleanup();

    expect(report.deletedCount).toBe(0);
    expect(report.verifiedAbsentCount).toBe(0);
    expect(report.deletedKeys).toEqual([]);
  });
});

describe("SpiedFanoutTransport — publish log replay for assertions", () => {
  const transport = new SpiedFanoutTransport();
  const teacherPayload = realtimePayloadFixture(421, "New session request");
  const broadcastPayload = realtimePayloadFixture(422, "System maintenance window");

  test("starts with an empty publish log", () => {
    expect(transport.publishCount).toBe(0);
    expect(transport.calls).toEqual([]);
    expect(transport.lastCall).toBeNull();
    expect(transport.publishedUserIds).toEqual([]);
  });

  test("records each publish with its recipient ids and payload, in order", async () => {
    await transport.publishFanout([11, 12], teacherPayload);
    await transport.publishFanout([13], broadcastPayload);

    expect(transport.publishCount).toBe(2);
    expect(transport.calls[0]?.userIds).toEqual([11, 12]);
    expect(transport.calls[0]?.payload).toEqual(teacherPayload);
    expect(transport.calls[1]?.userIds).toEqual([13]);
    expect(transport.calls[1]?.payload.data.id).toBe(422);
    expect(transport.lastCall?.userIds).toEqual([13]);
    expect(transport.publishedUserIds).toEqual([11, 12, 13]);
  });

  test("publish log is frozen — mutation attempts cannot rewrite history", () => {
    expect(Object.isFrozen(transport.calls)).toBe(true);

    const firstCall = transport.calls[0];
    if (!firstCall) {
      throw new Error("expected a recorded publish call");
    }
    expect(Object.isFrozen(firstCall.userIds)).toBe(true);

    // Frozen in strict mode: index writes are rejected, log content unchanged.
    const rejected = Reflect.set(transport.calls, 0, { userIds: [999], payload: broadcastPayload });
    expect(rejected).toBe(false);
    expect(transport.calls[0]).toBe(firstCall);

    const rejectedId = Reflect.set(firstCall.userIds, 0, 999);
    expect(rejectedId).toBe(false);
    expect(firstCall.userIds[0]).toBe(11);
  });

  test("clear() resets the log for the next journey step", () => {
    transport.clear();

    expect(transport.publishCount).toBe(0);
    expect(transport.calls).toEqual([]);
    expect(transport.lastCall).toBeNull();
    expect(transport.publishedUserIds).toEqual([]);
  });

  test("is installable wherever a fan-out transport port is expected (structural compatibility)", async () => {
    const asPort: FanoutTransportLike = transport;

    await asPort.publishFanout([21], teacherPayload);

    expect(transport.publishCount).toBe(1);
    expect(transport.calls[0]?.userIds).toEqual([21]);
    expect(transport.calls[0]?.payload.data.title).toBe("New session request");
    transport.clear();
  });
});

describe("actor-context — real users with real role rows (honest permissions)", () => {
  const tracked = new TrackedFixtures();
  let student: JourneyActor;
  let certifiedTeacher: JourneyActor;
  let parent: JourneyActor;
  let adminActor: JourneyActor;

  beforeAll(async () => {
    await db.transaction(async tx => {
      student = await provisionStudentActor(tx, { tracked });
      certifiedTeacher = await provisionCertifiedTeacherActor(tx, { tracked });
      parent = await provisionParentActor(tx, { tracked });
      adminActor = await provisionAdminActor(tx, { tracked, locale: "ar" });
    });
  });

  afterAll(async () => {
    // No-op when the teardown test below already cleaned up.
    await tracked.cleanup();
  });

  test("actors carry distinct positive userIds and their requested locales", () => {
    const ids = [student.userId, certifiedTeacher.userId, parent.userId, adminActor.userId];

    expect(new Set(ids).size).toBe(4);
    for (const id of ids) {
      expect(Number.isSafeInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
    }
    expect(student.locale).toBe("en");
    expect(certifiedTeacher.locale).toBe("en");
    expect(parent.locale).toBe("en");
    expect(adminActor.locale).toBe("ar");
  });

  test("every actor's users row carries its real role in the database", async () => {
    const roleRows = await Promise.all([
      db.select({ role: users.role }).from(users).where(eq(users.id, student.userId)).limit(1),
      db.select({ role: users.role }).from(users).where(eq(users.id, certifiedTeacher.userId)).limit(1),
      db.select({ role: users.role }).from(users).where(eq(users.id, parent.userId)).limit(1),
      db.select({ role: users.role }).from(users).where(eq(users.id, adminActor.userId)).limit(1),
    ]);

    expect(roleRows[0][0]?.role).toBe("student");
    expect(roleRows[1][0]?.role).toBe("teacher");
    expect(roleRows[2][0]?.role).toBe("parent");
    expect(roleRows[3][0]?.role).toBe("admin");
  });

  test("role-child rows REALLY exist — real role membership, never patched permissions", async () => {
    const childRows = await Promise.all([
      db.select().from(students).where(eq(students.id, student.userId)).limit(1),
      db.select().from(teacher).where(eq(teacher.id, certifiedTeacher.userId)).limit(1),
      db.select().from(parents).where(eq(parents.id, parent.userId)).limit(1),
      db.select().from(admin).where(eq(admin.id, adminActor.userId)).limit(1),
    ]);

    expect(childRows[0]).toHaveLength(1);
    expect(childRows[1]).toHaveLength(1);
    expect(childRows[1][0]?.isApproved).toBe(true); // certified teacher
    expect(childRows[2]).toHaveLength(1);
    expect(childRows[3]).toHaveLength(1);
  });

  test("tracked teardown removes users AND role rows with zero residue", async () => {
    expect(tracked.size).toBe(8); // 4 users rows + 4 role-child rows
    const records = [...tracked.records];

    const report = await tracked.cleanup();

    expect(report.deletedCount).toBe(8);
    expect(report.verifiedAbsentCount).toBe(8);
    // Reverse registration order: each role-child row is deleted BEFORE its
    // owning user row (last registered actor is torn down first).
    expect(report.deletedKeys).toEqual(["admin", "users", "parents", "users", "teacher", "users", "students", "users"]);

    const present = await Promise.all(records.map(record => tracked.exists(record)));
    expect(present.every(exists => !exists)).toBe(true);
  });
});
