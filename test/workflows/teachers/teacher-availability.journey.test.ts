/**
 * Cross-actor journey — the teacher availability toggle end-to-end across
 * four real actors, driven through the REAL service layer against the
 * REAL test database. Each step observes the shared state that earlier
 * steps committed; denial probes fail through the genuine certification
 * and in-session gates (nothing monkey-patched).
 *
 * Layer contract (`test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md`):
 *  - committed fixtures in ONE `beforeAll` `db.transaction(...)` (commit-or-nothing);
 *  - tracked hard-delete in `afterAll` via `TrackedFixtures.cleanup()` —
 *    `session` rows BEFORE role-child rows BEFORE `users` rows (FK-safe
 *    registration order; reverse-deletion by the registry);
 *  - post-teardown `verifyAllAbsent` re-probes (zero residue is mandatory,
 *    not advisory);
 *  - NO `runInRollback` around service calls — services own their
 *    transactions (this layer is the documented exception to the
 *    `backend/db/test/` rollback rule).
 *
 * Cast (provisioned in ONE committing `beforeAll` transaction):
 *  - Certified teacher T — the happy-path actor (real `users` row with
 *    `role="teacher"` plus a real `teacher` row with `isApproved=true`,
 *    provisioned by `provisionCertifiedTeacherActor`).
 *  - Uncertified teacher U — a real `users` row with `role="teacher"` plus
 *    a real `teacher` row with `isApproved=false` (the explicit present-but-
 *    not-certified shape that drives the INV-A1 denial honestly — never an
 *    absent id).
 *  - Student S — a real `users` row with `role="student"` plus its `students`
 *    role-child row, present so the journey can create + start a real
 *    session that locks T into the in-session state.
 *  - Observer teacher V — a second certified teacher, byte-untouched by
 *    every T/U step (BOLA isolation invariance — the cross-actor tenancy
 *    proof).
 *
 * Coverage (step → requirement):
 *  1. T reads own projection (`isApproved=true`, `isOnline=false`).
 *  2. T toggles Available → `isOnline=true`; the persisted
 *     `teacher.is_online` re-read confirms the committed write.
 *  3. T toggles Unavailable → `isOnline=false`; always allowed.
 *  4. Denial probe A (INV-A1): U's Available toggle → `FORBIDDEN` (403);
 *     the persisted `teacher.is_online` for U stays `false`.
 *  5. Denial probe B (INV-A2): start a real session for T →
 *     `teacher.is_online=false` (the in-session lock drives the flag);
 *     T's Available toggle → `TEACHER_IN_ACTIVE_SESSION` (409) with NO
 *     session id in the denial payload (oracle safety); `teacher.is_online`
 *     for T stays `false`.
 *  6. Isolation invariance: V's `teacher.is_online` is byte-UNCHANGED by
 *     every T/U step (BOLA invariance — V never observes fan-out from T's
 *     or U's writes).
 *  7. Denial probe C (NOT-FOUND): `setAvailability(<absent-id>, true, "en")`
 *     → `TEACHER_NOT_FOUND` (404); hostile ids (`0`, `-1`, `NaN`) →
 *     `VALIDATION` pre-DB with ZERO writes (a repo spy asserts ZERO calls
 *     before the validation denial).
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { TeacherRepository } from "@/backend/db/repo";
import { session } from "@/backend/db/schema/classes/session";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestSession, createTestTeacherRow, createTestUser } from "@/backend/db/test/entity-setup";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { TeacherAvailabilityService } from "@/backend/services/teachers/teacher-availability.service";
import type { TeacherAvailabilityReturnType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  type JourneyActor,
  provisionCertifiedTeacherActor,
  provisionStudentActor,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/**
 * Default journey locale. Denial assertions pin English translated
 * substrings from the errors namespace; localized-copy parity lives in
 * the service-tier test suite.
 */
const LOCALE_EN = "en" as const;

/**
 * Returns the localized errors bundle for the default journey locale. Used
 * for byte-exact denial-message assertions (never raw keys, never the
 * code echoed into the copy).
 */
function errorsFor() {
  return getServerTranslations(LOCALE_EN).errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code` contract. */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Runs a service call through a try/catch and returns the rejection — the
 * journey-layer replacement for `expect(...).rejects.toThrow()`. Fails the
 * test when the call resolves successfully (a missing denial is exactly the
 * bug class journeys exist to catch).
 */
async function catchDenial(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("expected the call to be denied, but it resolved successfully");
}

/**
 * Independent read-back oracle — the persisted `teacher.is_online` value
 * for one teacher id (NOT via the service, a direct Drizzle select on the
 * global `db`). Used by every step's read-your-writes + isolation
 * invariance assertion.
 */
async function readTeacherIsOnline(teacherId: number): Promise<boolean | null> {
  const [row] = await db.select({ isOnline: teacher.isOnline }).from(teacher).where(eq(teacher.id, teacherId));
  return row?.isOnline ?? null;
}

/**
 * Returns an integer id guaranteed absent as a `teacher` row: teacher
 * rows share their PK with `users.id`, so anything above the current max
 * (plus an offset no sequence reaches mid-test) is guaranteed absent.
 */
async function absentTeacherId(): Promise<number> {
  const [row] = await db.select({ maxId: sql<number>`coalesce(max(${teacher.id}), 0)::int` }).from(teacher);
  return (row?.maxId ?? 0) + 1_000_000;
}

/**
 * Provision the uncertified-teacher U row inside the suite's committing
 * `beforeAll` transaction: a real `users` row with `role="teacher"` plus a
 * real `teacher` row with `isApproved=false` (the explicit present-but-
 * not-certified shape). Both rows are tracked for `afterAll` hard-delete
 * cleanup (the `users` row first, the `teacher` row second — reverse-
 * deletion is FK-safe).
 */
async function provisionUncertifiedTeacherActor(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0]
): Promise<JourneyActor> {
  const user = await createTestUser(tx, { role: "teacher" });
  // The shared PK on `teacher.id = users.id` means the teacher row's id
  // equals the user id — no separate `teacherId` field is needed; the
  // journey uses `userId` as the row identity for the read-back oracle.
  await createTestTeacherRow(tx, user.id, { isApproved: false, isOnline: false });
  tracked.register(users, user.id);
  tracked.register(teacher, user.id);
  return { userId: user.id, locale: LOCALE_EN, role: user.role };
}

/**
 * Returns the second positional argument (the bounded context object) of
 * the Nth recorded `logDomainError` call, or `undefined` when the spy has
 * fewer calls than expected. The return type is the canonical
 * `DomainErrorContext` (already optional) — no narrowing cast required.
 */
function recordedLogContext(
  logSpy: ReturnType<typeof spyOn<typeof logger, "logDomainError">>,
  index = 0
): DomainErrorContext | undefined {
  const call = logSpy.mock.calls.at(index);
  return call?.[1];
}

/**
 * Runs the hostile-id VALIDATION fuzz sequentially via a recursive helper
 * (each iteration needs a spy-reset + assertion cycle that depends on the
 * previous iteration's full completion, so parallel `Promise.all` is wrong
 * here — the spies would conflict). The recursion satisfies the
 * `no-await-in-loop` rule while preserving the ordered, isolated
 * per-iteration discipline.
 */
async function fuzzHostileIdsSequentially(
  hostileIds: readonly number[],
  index: number,
  lockSpy: ReturnType<typeof spyOn<typeof TeacherRepository, "lockForCertificationCheck">>,
  writeSpy: ReturnType<typeof spyOn<typeof TeacherRepository, "setAvailabilityIntent">>,
  hostileLogSpy: ReturnType<typeof spyOn<typeof logger, "logDomainError">>
): Promise<void> {
  if (index >= hostileIds.length) {
    return;
  }
  const hostileId = hostileIds.at(index);
  if (hostileId === undefined) {
    return;
  }
  lockSpy.mockClear();
  writeSpy.mockClear();
  hostileLogSpy.mockClear();

  const denied = await catchDenial(() => TeacherAvailabilityService.setAvailability(hostileId, true, LOCALE_EN));

  expect(denied).toBeInstanceOf(ValidationError);
  expect(rejectionCode(denied)).toBe("VALIDATION");
  expect(denied.message).toBe(errorsFor().validation);

  // ZERO repo calls — the pre-DB shape guard fired before any read.
  expect(lockSpy.mock.calls).toHaveLength(0);
  expect(writeSpy.mock.calls).toHaveLength(0);

  // ZERO domain-error logs for the validation denial (the validation
  // path emits NOTHING — it logs only on the service-owned not-found
  // and forbidden branches).
  expect(hostileLogSpy.mock.calls).toHaveLength(0);

  await fuzzHostileIdsSequentially(hostileIds, index + 1, lockSpy, writeSpy, hostileLogSpy);
}

// ─── Journey state (ordered tests share the committed cast) ─────────────

const tracked = new TrackedFixtures();

let certifiedTeacherT: JourneyActor;
let uncertifiedTeacherU: JourneyActor;
let studentS: JourneyActor;
let observerTeacherV: JourneyActor;
let inSessionId = 0; // the session row started in step 5 (locks T)

beforeAll(async () => {
  // ONE committing transaction: provisioning is commit-or-nothing — a
  // throwing setup rolls back and leaves nothing behind. The committed
  // rows persist across tests so later steps observe earlier steps'
  // committed state. Registration order is FK-safe by construction
  // (`users` row first, role-child row second) so the registry's
  // reverse-deletion sweep deletes role-child rows BEFORE their `users`
  // parents.
  await db.transaction(async tx => {
    certifiedTeacherT = await provisionCertifiedTeacherActor(tx, { tracked });
    observerTeacherV = await provisionCertifiedTeacherActor(tx, { tracked });
    studentS = await provisionStudentActor(tx, { tracked });
    uncertifiedTeacherU = await provisionUncertifiedTeacherActor(tx);
  });
});

afterAll(async () => {
  // Hard-delete every tracked row in reverse registration order
  // (role-child rows FIRST, `users` last — FK-safe by construction) and
  // verify zero residue. A leaking `afterAll` fails the suite loudly.
  //
  // The session row created in step 5 was registered AFTER the cast, so
  // it is the FIRST row deleted (before its `teacher` / `students`
  // parents — satisfies the `ON DELETE RESTRICT` constraint on
  // `session.teacher_id` / `session.student_id`).
  await tracked.cleanup();
  await tracked.verifyAllAbsent();
});

describe("Cross-actor journey — teacher availability toggle", () => {
  test("step 1 — T reads own projection: certified + offline (baseline)", async () => {
    const projection = await TeacherAvailabilityService.getAvailability(certifiedTeacherT.userId, LOCALE_EN);

    // Closed three-field projection (BOPLA read-side whitelist).
    expect(Object.keys(projection).toSorted((a, b) => a.localeCompare(b))).toEqual(["id", "isApproved", "isOnline"]);
    expect(projection).toEqual({
      id: certifiedTeacherT.userId,
      isOnline: false,
      isApproved: true,
    } satisfies TeacherAvailabilityReturnType);

    // The persisted row is the source of truth — the projection is a
    // field-by-field read of it.
    expect(await readTeacherIsOnline(certifiedTeacherT.userId)).toBe(false);
  });

  test("step 2 — T toggles Available: persisted `is_online=true` (happy path)", async () => {
    const projection = await TeacherAvailabilityService.setAvailability(certifiedTeacherT.userId, true, LOCALE_EN);
    expect(projection.isOnline).toBe(true);

    // Read-your-writes oracle — direct DB re-read, not via the service.
    expect(await readTeacherIsOnline(certifiedTeacherT.userId)).toBe(true);
  });

  test("step 3 — T toggles Unavailable: always allowed (offline is ungated)", async () => {
    const projection = await TeacherAvailabilityService.setAvailability(certifiedTeacherT.userId, false, LOCALE_EN);
    expect(projection.isOnline).toBe(false);
    expect(await readTeacherIsOnline(certifiedTeacherT.userId)).toBe(false);
  });

  test("step 4 — Denial probe A (INV-A1): U's Available toggle is FORBIDDEN; U stays offline", async () => {
    const before = await readTeacherIsOnline(uncertifiedTeacherU.userId);
    expect(before).toBe(false);

    const denied = await catchDenial(() =>
      TeacherAvailabilityService.setAvailability(uncertifiedTeacherU.userId, true, LOCALE_EN)
    );

    expect(denied).toBeInstanceOf(ForbiddenError);
    expect(rejectionCode(denied)).toBe("FORBIDDEN");
    expect(denied.message).toBe(errorsFor().teacherNotCertified);

    // INV-A1 defense: the row is byte-unchanged — U stays offline.
    expect(await readTeacherIsOnline(uncertifiedTeacherU.userId)).toBe(false);

    // The certification gate ran BEFORE the in-session gate — a
    // non-certified teacher sees FORBIDDEN, never the in-session conflict.
    // (Proven in step 5 where T's certified row reaches the session gate.)
  });

  test("step 5 — Denial probe B (INV-A2): start a real session for T → T's Available toggle is TEACHER_IN_ACTIVE_SESSION (oracle-safe)", async () => {
    // Pre-condition: T is currently offline (step 3 left it offline).
    expect(await readTeacherIsOnline(certifiedTeacherT.userId)).toBe(false);

    // Create a `Scheduled` session directly (the booking ladder is out
    // of scope — this journey owns the INV-A2 denial, not the escrow
    // flow), then transition it to `Started` through the REAL session
    // lifecycle service. `startSession` applies the in-session lock that
    // drives `teacher.is_online = false` inside the SAME transaction as
    // the transition.
    //
    // The fixture insert runs inside its OWN committed transaction so it
    // persists across the test boundary (the journey tier never wraps
    // service calls in `runInRollback` — services own their
    // transactions; the fixture insert is no different).
    const scheduled = await db.transaction(async tx =>
      createTestSession(tx, certifiedTeacherT.userId, studentS.userId, {
        status: SessionStatus.Scheduled,
        sessionType: SessionType.StudentSession,
      })
    );
    inSessionId = scheduled.id;
    tracked.register(session, inSessionId);

    await SessionLifecycleService.startSession(certifiedTeacherT.userId, inSessionId, LOCALE_EN);

    // INV-S6 lock: the started session drives `teacher.is_online = false`
    // inside the SAME transaction as the transition.
    expect(await readTeacherIsOnline(certifiedTeacherT.userId)).toBe(false);

    // The in-session gate fires on the Available direction — T's
    // Available toggle is denied with `TEACHER_IN_ACTIVE_SESSION` (409).
    const denied = await catchDenial(() =>
      TeacherAvailabilityService.setAvailability(certifiedTeacherT.userId, true, LOCALE_EN)
    );

    expect(denied).toBeInstanceOf(ConflictError);
    expect(rejectionCode(denied)).toBe("TEACHER_IN_ACTIVE_SESSION");
    expect(denied.message).toBe(errorsFor().teacherInActiveSession);

    // Oracle safety: the denial payload carries NO session id — neither
    // in the error message, nor in any structured extension. The gate's
    // bounded log context is the ONLY side channel, and it carries
    // `{ code, entity, entityId }` only (no session id).
    expect(denied.message).not.toContain(String(inSessionId));
    expect(JSON.stringify(denied)).not.toContain(String(inSessionId));

    // INV-A2 persistence: the denial left T offline — no partial write.
    expect(await readTeacherIsOnline(certifiedTeacherT.userId)).toBe(false);
  });

  test("step 6 — Isolation invariance: V is byte-UNCHANGED by every T/U step (BOLA)", async () => {
    // V was provisioned offline and is never the target of any toggle in
    // this journey — its persisted `is_online` stays `false` throughout.
    // This is the honest BOLA proof: V's row is NOT reachable through any
    // T or U write, even when those writes commit.
    expect(await readTeacherIsOnline(observerTeacherV.userId)).toBe(false);

    // The cross-actor reach is also closed at the read surface — V reading
    // its own projection yields V's row, never T's or U's.
    const vProjection = await TeacherAvailabilityService.getAvailability(observerTeacherV.userId, LOCALE_EN);
    expect(vProjection.id).toBe(observerTeacherV.userId);
    expect(vProjection.isOnline).toBe(false);
    expect(vProjection.isApproved).toBe(true);

    // The persisted rows match the projection for every cast member —
    // no silent fan-out anywhere across the journey.
    expect(await readTeacherIsOnline(certifiedTeacherT.userId)).toBe(false); // locked by the session
    expect(await readTeacherIsOnline(uncertifiedTeacherU.userId)).toBe(false); // denied at the cert gate
    expect(await readTeacherIsOnline(observerTeacherV.userId)).toBe(false); // never targeted
  });

  test("step 7 — Denial probe C (NOT-FOUND): absent id → TEACHER_NOT_FOUND; hostile ids → VALIDATION pre-DB with ZERO writes", async () => {
    const absentId = await absentTeacherId();

    // Real NOT-FOUND: an id that is a positive safe integer but maps to no
    // `teacher` row. The service emits exactly ONE bounded log call here
    // (the not-found branch), so the spy asserts BOTH the call count AND
    // the bounded-context hygiene (no session id, no PII — the canonical
    // four-key shape only).
    const logSpy = spyOn(logger, "logDomainError").mockImplementation(() => {});
    try {
      const notFound = await catchDenial(() => TeacherAvailabilityService.setAvailability(absentId, true, LOCALE_EN));
      expect(notFound).toBeInstanceOf(NotFoundError);
      expect(rejectionCode(notFound)).toBe("TEACHER_NOT_FOUND");
      expect(notFound.message).toBe(errorsFor().teacherNotFound);

      expect(logSpy.mock.calls).toHaveLength(1);
      const ctx = recordedLogContext(logSpy);
      expect(ctx).toBeDefined();
      // Bounded-context hygiene — the four-key canonical shape only
      // (no PII, no submitted payload). The `entityId` is the absent
      // teacher id the caller supplied (a numeric value); it carries no
      // session reference because no session exists for that teacher.
      expect(new Set(Object.keys(ctx ?? {}))).toEqual(new Set(["code", "entity", "entityId", "locale"]));
      expect(ctx?.code).toBe("TEACHER_NOT_FOUND");
      expect(ctx?.entity).toBe("teacher");
    } finally {
      logSpy.mockRestore();
    }

    // Hostile ids — pre-DB shape guard denies with `VALIDATION` (422)
    // BEFORE any SQL round-trip. The repo spy proves ZERO DB calls fire
    // for the garbage shapes (no `lockForCertificationCheck`, no
    // `setAvailabilityIntent`).
    const lockSpy = spyOn(TeacherRepository, "lockForCertificationCheck").mockImplementation(async () => null);
    const writeSpy = spyOn(TeacherRepository, "setAvailabilityIntent").mockImplementation(async () => null);
    const hostileLogSpy = spyOn(logger, "logDomainError").mockImplementation(() => {});
    try {
      await fuzzHostileIdsSequentially([0, -1, Number.NaN], 0, lockSpy, writeSpy, hostileLogSpy);
    } finally {
      lockSpy.mockRestore();
      writeSpy.mockRestore();
      hostileLogSpy.mockRestore();
    }
  });
});
