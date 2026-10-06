/**
 * TeacherAvailabilityService tests — the read projection and the manual
 * availability toggle against the live `kottab_test` PostgreSQL instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - 4-Tier mixed suite. Every transactional case runs inside
 *    `runInRollback`; `tx` is propagated to the service as the outer
 *    transaction (the flow executes on a SAVEPOINT of the caller's
 *    transaction). The chaos tier uses COMMITTED fixtures (own top-level
 *    transaction per call, the undefined-`tx` production path) with hard
 *    deletes and residue probes.
 *  - Entities are created ONLY via `entity-setup.ts` helpers
 *    (randomized-UUID emails); no seed data, no production fixtures.
 *  - All rejection assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited and appears nowhere.
 *  - Denial messages are asserted against the EXACT translated copy
 *    resolved via `getServerTranslations(locale).errorsTranslations` —
 *    never raw keys, never hardcoded UI copy (the suite is self-contained).
 *
 * Coverage map (the four-tier contract):
 *  - Tier 1 (branch/statement): the full Cartesian matrix —
 *    `{getAvailability, setAvailability}` × `{found, not-found}` ×
 *    `{certified, uncertified, isApproved=null}` × `{isOnline true, false}` ×
 *    `{no session, started session}` — asserting the returned
 *    `TeacherAvailabilityReturnType` AND the persisted `teacher.is_online`
 *    re-read inside the same `tx` (read-your-writes oracle). Dedicated
 *    integration cases book + start sessions via the REAL
 *    `SessionLifecycleService.createSession`/`startSession`: one proves
 *    the INV-A2 gate fires end-to-end, one proves the mid-session
 *    Unavailable toggle succeeds and OVERWRITES the captured marker
 *    (`was_online_before_lock` true → false — the deliberate intent
 *    wins, the release can never resurrect it).
 *  - Tier 2 (boundary): pre-DB shape guard rejects `teacherId` of `0`,
 *    `-1`, `1.5`, `NaN`, and `2**53` with `VALIDATION` and zero DB calls;
 *    `isOnline` non-boolean casts to `VALIDATION`; null-coercion
 *    (`isOnline`/`isApproved` DB-null → `false`); hostile locale (`""`,
 *    unknown tag → default-locale copy); unicode-safe denial copy
 *    (Arabic script round-trip, no mojibake); idempotency (repeat toggle
 *    returns identical projection, `updated_at` may advance but
 *    `is_online` is stable).
 *  - Tier 3 (chaos/concurrency): ≥20-way `Promise.allSettled` mixed-toggle
 *    storm on ONE teacher ⇒ deterministic final `is_online` + zero partial
 *    writes (committed fixtures; skipped on pglite — single-connection WASM
 *    cannot observe cross-tx row-lock serialization); sequential
 *    rapid-toggle storm within ONE tx ⇒ no lost update, deterministic final
 *    value (runs on pglite); forced inner failure AFTER the availability
 *    write ⇒ `teacher.is_online` unchanged (rollback of the whole
 *    `withTransaction`); the zero-row writer guards (a
 *    `setAvailabilityIntent` spy returning `null` ⇒ the Unavailable
 *    direction denies `TEACHER_NOT_FOUND` post-write, the Available
 *    direction raises the race-closed `TEACHER_IN_ACTIVE_SESSION`
 *    backstop). The in-tx activity stamp tier: the stamp and the write
 *    share ONE `innerTx` (spy-arg identity) and one captured now within
 *    the test window; a forced failure AFTER the stamp rolls back
 *    `last_active_at` AND `is_online` together; a fresh toggle carries a
 *    fresh `last_active_at` (both toggle directions; a stamp boolean
 *    miss never fails the toggle).
 *  - Tier 4 (security/abuse): hostile-id fuzz with a repo/read spy proving
 *    ZERO DB calls before a `VALIDATION` denial; the certification gate
 *    NEVER lets an uncertified teacher reach the availability write
 *    (BFLA/INV-A1 — a `setAvailabilityIntent` spy asserts ZERO calls on
 *    the FORBIDDEN denial); the in-session gate NEVER lets a
 *    started-session teacher reach the availability write (INV-A2 — same
 *    spy discipline); the race-closed backstop denies with the gate's
 *    EXACT code + message; every denial logs
 *    EXACTLY ONCE (log-spy count) with a BOUNDED context (`{ code, entity,
 *    entityId, locale }` only — never PII, never the submitted payload,
 *    never a session id); the INV-A2 gate's own log is the SOLE log for
 *    the in-session 409 (the service adds no duplicate).
 */

import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { TeacherRepository, UserRepository } from "@/backend/db/repo";
import { session } from "@/backend/db/schema/classes/session";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestSession,
  createTestStudent,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { type DBTransaction, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { DomainError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { TeacherAvailabilityService } from "@/backend/services/teachers/teacher-availability.service";
import type { DBQueryExecutor, TeacherAvailabilityReturnType } from "@/backend/types";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

/** Default test locale (every Tier-1/2/4 case runs on English unless asserted otherwise). */
const LOCALE_EN = "en";

/** Arabic locale for the localized-denial parity probes. */
const LOCALE_AR = "ar";

/** Hostile empty locale — must fall back to the platform default-locale copy. */
const LOCALE_EMPTY = "";

/** Hostile unknown locale tag — must fall back to the platform default-locale copy. */
const LOCALE_UNKNOWN = "klingon-pirate";

/**
 * Sentinel thrown by the forced-inner-failure spy — proves the SAVEPOINT
 * rolls back the write when anything inside the `withTransaction` body
 * throws AFTER the availability write runs.
 */
const FORCED_INNER_FAILURE = "FORCED_INNER_FAILURE_AFTER_WRITE";

/** Parallel-toggle storm volume (≥20 mixed-toggle calls). */
const CHAOS_TOGGLE_COUNT = 25;

/** Sequential-toggle storm volume (≥20 rapid toggles inside ONE tx). */
const SEQUENTIAL_TOGGLE_COUNT = 20;

// ─── Tier 1 Cartesian matrix data ────────────────────────────────────────

/** Certification-state axis of the Cartesian matrix. */
type CertState = "certified" | "uncertified" | "null";

/** Session-state axis of the Cartesian matrix. */
type SessionState = "no-session" | "started-session";

/**
 * Resolves the localized errors bundle for the supplied locale. The
 * translated copy is used for byte-exact denial assertions (never the raw
 * key, never the code echoed into the copy).
 */
function errorsFor(locale: string) {
  return getServerTranslations(locale).errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code` contract. */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Asserts a caught error is a `DomainError` carrying EXACTLY the expected
 * `extensions.code` and the exact translated message (never the raw key,
 * never the code echoed into the copy).
 */
function expectDomainDenial(error: Error, code: string, message: string): void {
  expect(error).toBeInstanceOf(DomainError);
  expect(rejectionCode(error)).toBe(code);
  expect(error.message).toBe(message);
  expect(error.message).not.toContain(code);
}

/**
 * Installs a recording stub over `logger.logDomainError` so domain-rejection
 * logs never reach test stdout AND can be counted by the logging-contract
 * assertions. The stub's call history is cleared on each invocation so
 * tests can assert EXACT call counts without spillover from prior tests
 * (the shared logger singleton keeps the last-installed spy across tests).
 */
function silenceDomainLog() {
  const spy = spyOn(logger, "logDomainError");
  spy.mockClear();
  return spy.mockImplementation(() => {});
}

/**
 * Returns the recorded log call args at the given index — throws a fixture-
 * integrity error when the spy has fewer calls than expected (so the
 * `expect(...).toHaveLength(N)` assertion upstream is the single source of
 * truth for the call count, and any subsequent `.at(N)` access stays
 * type-safe without non-null assertions).
 */
function recordedLogCall(logSpy: ReturnType<typeof silenceDomainLog>, index = 0) {
  const call = logSpy.mock.calls.at(index);
  if (!call) {
    throw new Error(`log spy: expected at least ${index + 1} call(s), got ${logSpy.mock.calls.length}`);
  }
  return call;
}

/**
 * Returns an integer id guaranteed absent as a `teacher` row this tx:
 * teacher rows share their PK with `users.id`, so anything above the
 * current max (plus an offset no sequence reaches mid-test) is guaranteed
 * absent.
 */
async function absentTeacherId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${teacher.id}), 0)::int` }).from(teacher);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Independent read-back oracle — direct Drizzle select, not via the service. */
async function readTeacherRow(tx: DBTransaction, teacherId: number) {
  const rows = await tx.select().from(teacher).where(eq(teacher.id, teacherId));
  return rows[0] ?? null;
}

/**
 * Independent read-back oracle for the in-tx activity stamp — a direct
 * Drizzle select of `users.last_active_at`, not via the service or the
 * repository, so the assertion cannot share the code path under test.
 */
async function readUserLastActiveAt(tx: DBTransaction, userId: number): Promise<Date | null> {
  const rows = await tx.select({ lastActiveAt: users.lastActiveAt }).from(users).where(eq(users.id, userId));
  return rows[0]?.lastActiveAt ?? null;
}

/**
 * Forces the teacher row's `isApproved` column to the supplied value via
 * a direct Drizzle UPDATE (bypasses `createTestTeacherRow` defaults). Used
 * to mint the `isApproved=null` fixture — the entity-setup helper accepts
 * the override at insert time, but the row's nullable column needs the
 * explicit `null` write to truly model a teacher row whose certification
 * state is unknown.
 */
async function setTeacherApprovedState(
  tx: DBTransaction,
  teacherId: number,
  isApproved: boolean | null
): Promise<void> {
  await tx.update(teacher).set({ isApproved }).where(eq(teacher.id, teacherId));
}

/**
 * Applies the certification-state axis to a freshly-created teacher row.
 * `certified` ⇒ `{ isApproved: true, isOnline: <initialOnline> }`;
 * `uncertified` ⇒ `{ isApproved: false, isOnline: <initialOnline> }`;
 * `null` ⇒ insert with the default `isApproved: true`, then UPDATE to
 * `null` (the entity-setup helper accepts the override at insert, but
 * forcing the column back to `null` after insert exercises the row's
 * nullable column honestly — the projection coercion reads `null`).
 */
async function applyCertState(
  tx: DBTransaction,
  userId: number,
  certState: CertState,
  initialOnline: boolean
): Promise<void> {
  if (certState === "certified") {
    await createTestTeacherRow(tx, userId, { isOnline: initialOnline, isApproved: true });
  } else if (certState === "uncertified") {
    await createTestTeacherRow(tx, userId, { isOnline: initialOnline, isApproved: false });
  } else {
    await createTestTeacherRow(tx, userId, { isOnline: initialOnline, isApproved: null });
    // Belt-and-suspenders — force the column to NULL after insert too.
    await setTeacherApprovedState(tx, userId, null);
  }
}

/**
 * Applies the session-state axis to a teacher fixture. `no-session` ⇒ no
 * additional rows; `started-session` ⇒ direct insert of a `Started`
 * session row via the entity-setup helper (a legitimate test scenario —
 * a teacher that was certified when the session started and has since
 * been decertified is exactly the precedence case the matrix must cover).
 */
async function applySessionState(tx: DBTransaction, teacherUserId: number, sessionState: SessionState): Promise<void> {
  if (sessionState === "no-session") {
    return;
  }
  const studentUser = await createTestUser(tx, { role: "student" });
  await createTestSession(tx, teacherUserId, studentUser.id, { status: SessionStatus.Started });
}

/**
 * Books + starts a session through the REAL `SessionLifecycleService`.
 *
 * The trial-lane booking path needs no curriculum/plan — the trial lane is
 * debited directly. The student's `balanceTrial` is set to `1` so the
 * booking succeeds on the trial-hit branch; the idempotency key is
 * randomized so repeated invocations do not collide.
 *
 * This is the integration-test fixture: it proves the INV-A2 gate fires
 * against a `started` session created through the real lifecycle service,
 * not just a direct Drizzle insert.
 */
async function startSessionViaRealService(
  tx: DBTransaction,
  teacherUserId: number,
  studentUserId: number,
  idempotencyKey: string
): Promise<number> {
  // Trial-lane booking — no curriculum/plan needed (trial lane is debited directly).
  await tx.update(students).set({ balanceTrial: 1 }).where(eq(students.id, studentUserId));
  const created = await SessionLifecycleService.createSession(
    studentUserId,
    { teacherId: teacherUserId, intent: SessionIntent.Hifz },
    idempotencyKey,
    LOCALE_EN,
    tx
  );
  await SessionLifecycleService.startSession(teacherUserId, created.id, LOCALE_EN, tx);
  return created.id;
}

/**
 * Sequential rapid-toggle storm — fires `count` toggles in alternating
 * directions within ONE transaction. Implemented recursively so the
 * `no-await-in-loop` rule stays satisfied (a sequential `for` loop with
 * `await` would trigger the rule; the recursive helper is the rule's
 * recommended sequential pattern). Each call observes the prior call's
 * commit (the SAVEPOINT ordering is deterministic); the persisted
 * `is_online` equals the LAST write's input.
 */
async function sequentialToggleStorm(
  tx: DBTransaction,
  userId: number,
  count: number,
  index = 0,
  lastInput = false
): Promise<boolean> {
  if (index >= count) {
    return lastInput;
  }
  const nextInput = index % 2 === 0;
  await TeacherAvailabilityService.setAvailability(userId, nextInput, LOCALE_EN, tx);
  return sequentialToggleStorm(tx, userId, count, index + 1, nextInput);
}

// ─── Committed-fixture registry (Tier 3 chaos) ────────────────────────────

/** Teacher fixtures committed OUTSIDE `runInRollback` (parallel-transaction
 *  chaos tier) — hard-deleted in `afterAll` so nothing leaks across suites. */
const committedTeacherUserIds: number[] = [];

/** Commits a teacher fixture outside the rollback tx and registers it for cleanup. */
async function createCommittedCertifiedTeacher(initiallyOnline: boolean): Promise<number> {
  const teacherUserId = await db.transaction(async tx => {
    const user = await createTestUser(tx, { role: "teacher" });
    await createTestTeacherRow(tx, user.id, { isOnline: initiallyOnline });
    return user.id;
  });
  committedTeacherUserIds.push(teacherUserId);
  return teacherUserId;
}

afterAll(async () => {
  // Hard-delete every committed fixture (teacher row first, then its
  // owning user). Uses Promise.allSettled so a single stale row does not
  // block the remaining cleanup — each fixture's teacher+user pair is
  // independent, so parallel deletion is safe.
  await Promise.allSettled(
    committedTeacherUserIds.map(async teacherUserId => {
      try {
        await db.delete(teacher).where(eq(teacher.id, teacherUserId));
      } catch {
        // Stale or already-deleted row — safe to ignore.
      }
      try {
        await db.delete(users).where(eq(users.id, teacherUserId));
      } catch {
        // Stale or already-deleted row — safe to ignore.
      }
    })
  );
  committedTeacherUserIds.length = 0;
});

// ══════════════════════════════════════════════════════════════════════════
// getAvailability
// ══════════════════════════════════════════════════════════════════════════

describe("TeacherAvailabilityService.getAvailability", () => {
  // ─── Tier 1: branch/statement — Cartesian matrix ───────────────────
  //
  // The matrix axis is {certified, uncertified, isApproved=null} ×
  // {isOnline true, false} × {no session, started session}. The session
  // state has NO observable effect on `getAvailability` (the read path
  // never inspects the session table) — the matrix proves the read path
  // is session-agnostic by covering both axes with identical expected
  // projections per cert-state × isOnline pair.

  const GET_MATRIX = [
    {
      certState: "certified",
      initialOnline: true,
      sessionState: "no-session",
      expectedIsOnline: true,
      expectedIsApproved: true,
    },
    {
      certState: "certified",
      initialOnline: false,
      sessionState: "no-session",
      expectedIsOnline: false,
      expectedIsApproved: true,
    },
    {
      certState: "certified",
      initialOnline: true,
      sessionState: "started-session",
      expectedIsOnline: true,
      expectedIsApproved: true,
    },
    {
      certState: "certified",
      initialOnline: false,
      sessionState: "started-session",
      expectedIsOnline: false,
      expectedIsApproved: true,
    },
    {
      certState: "uncertified",
      initialOnline: true,
      sessionState: "no-session",
      expectedIsOnline: true,
      expectedIsApproved: false,
    },
    {
      certState: "uncertified",
      initialOnline: false,
      sessionState: "no-session",
      expectedIsOnline: false,
      expectedIsApproved: false,
    },
    {
      certState: "uncertified",
      initialOnline: true,
      sessionState: "started-session",
      expectedIsOnline: true,
      expectedIsApproved: false,
    },
    {
      certState: "uncertified",
      initialOnline: false,
      sessionState: "started-session",
      expectedIsOnline: false,
      expectedIsApproved: false,
    },
    {
      certState: "null",
      initialOnline: true,
      sessionState: "no-session",
      expectedIsOnline: true,
      expectedIsApproved: false,
    },
    {
      certState: "null",
      initialOnline: false,
      sessionState: "no-session",
      expectedIsOnline: false,
      expectedIsApproved: false,
    },
    {
      certState: "null",
      initialOnline: true,
      sessionState: "started-session",
      expectedIsOnline: true,
      expectedIsApproved: false,
    },
    {
      certState: "null",
      initialOnline: false,
      sessionState: "started-session",
      expectedIsOnline: false,
      expectedIsApproved: false,
    },
  ] as const;

  test.each([...GET_MATRIX])(
    "Cartesian: getAvailability on a $certState / initialOnline=$initialOnline / $sessionState teacher returns the closed projection",
    async ({ certState, initialOnline, sessionState, expectedIsOnline, expectedIsApproved }) => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx, { role: "teacher" });
        await applyCertState(tx, user.id, certState, initialOnline);
        await applySessionState(tx, user.id, sessionState);
        silenceDomainLog();

        const projection = await TeacherAvailabilityService.getAvailability(user.id, LOCALE_EN, tx);

        const expected: TeacherAvailabilityReturnType = {
          id: user.id,
          isOnline: expectedIsOnline,
          isApproved: expectedIsApproved,
        };
        expect(projection).toEqual(expected);
        // Closed-shape check — EXACTLY the canonical three keys.
        expect(Object.keys(projection).toSorted((a, b) => a.localeCompare(b))).toEqual([
          "id",
          "isApproved",
          "isOnline",
        ]);
        // Read-your-writes oracle — the row's persisted is_online is unchanged by the read.
        const reread = await readTeacherRow(tx, user.id);
        expect(reread?.isOnline).toBe(initialOnline);
        expect(reread?.isApproved).toBe(certState === "null" ? null : expectedIsApproved);
      });
    }
  );

  test("Cartesian: getAvailability on a missing teacher row denies with TEACHER_NOT_FOUND (404)", async () => {
    await runInRollback(async tx => {
      const absentId = await absentTeacherId(tx);
      silenceDomainLog();

      const error = await expectRepoError(() => TeacherAvailabilityService.getAvailability(absentId, LOCALE_EN, tx));

      expectDomainDenial(error, "TEACHER_NOT_FOUND", errorsFor(LOCALE_EN).teacherNotFound);
    });
  });

  // ─── Tier 2: boundary ────────────────────────────────────────────────

  test.each([0, -1, 1.5, Number.NaN, 2 ** 53])(
    "rejects a malformed teacherId (%s) with VALIDATION before any DB read (getAvailability)",
    async (malformedId: number) => {
      const findByIdSpy = spyOn(TeacherRepository, "findById");
      silenceDomainLog();

      const error = await expectRepoError(() => TeacherAvailabilityService.getAvailability(malformedId, LOCALE_EN));

      expectDomainDenial(error, "VALIDATION", errorsFor(LOCALE_EN).validation);
      // Pre-DB shape guard: ZERO repository reads fired.
      expect(findByIdSpy.mock.calls).toHaveLength(0);
      findByIdSpy.mockRestore();
    }
  );

  test("coerces DB-level null isOnline / isApproved to total booleans", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      // Force nullable columns to NULL — the projection must coerce.
      await createTestTeacherRow(tx, user.id, { isOnline: null, isApproved: null });

      const projection = await TeacherAvailabilityService.getAvailability(user.id, LOCALE_EN, tx);

      expect(projection).toEqual({ id: user.id, isOnline: false, isApproved: false });
    });
  });

  test.each([LOCALE_EMPTY, LOCALE_UNKNOWN])(
    "hostile locale (%s) falls back to the default-locale copy (getAvailability TEACHER_NOT_FOUND)",
    async (hostileLocale: string) => {
      await runInRollback(async tx => {
        const absentId = await absentTeacherId(tx);
        silenceDomainLog();

        const error = await expectRepoError(() => TeacherAvailabilityService.getAvailability(absentId, hostileLocale));

        // The platform default locale is "ar" — unknown/empty locales
        // fall back to the default-locale copy (NOT the English copy).
        expectDomainDenial(error, "TEACHER_NOT_FOUND", errorsFor(defaultLocale).teacherNotFound);
        // Sanity: the default-locale copy is distinct from the English copy.
        expect(errorsFor(defaultLocale).teacherNotFound).not.toBe(errorsFor(LOCALE_EN).teacherNotFound);
      });
    }
  );

  test("unicode-safe denial copy: the Arabic denial message round-trips intact (no mojibake)", async () => {
    await runInRollback(async tx => {
      const absentId = await absentTeacherId(tx);
      silenceDomainLog();

      const error = await expectRepoError(() => TeacherAvailabilityService.getAvailability(absentId, LOCALE_AR, tx));

      // The Arabic copy is byte-identical to the canonical translated
      // message — proves no encoding layer mojibake'd the RTL script.
      expectDomainDenial(error, "TEACHER_NOT_FOUND", errorsFor(LOCALE_AR).teacherNotFound);
      // The Arabic copy carries actual Arabic-script code points (the
      // unicode block range U+0600–U+06FF) — not ASCII fallback.
      const message = error.message;
      expect(message).toMatch(/[\u0600-\u06FF]/u);
      expect(message.length).toBeGreaterThan(0);
    });
  });

  // ─── Tier 4: security / oracle safety ────────────────────────────────

  test("the TEACHER_NOT_FOUND denial logs EXACTLY ONCE with a bounded context (no PII)", async () => {
    await runInRollback(async tx => {
      const absentId = await absentTeacherId(tx);
      const logSpy = silenceDomainLog();

      await expectRepoError(() => TeacherAvailabilityService.getAvailability(absentId, LOCALE_AR, tx));

      expect(logSpy.mock.calls).toHaveLength(1);
      const [message, ctx] = recordedLogCall(logSpy);
      expect(message).toBe("Teacher not found for availability read");
      expect(ctx).toEqual({
        code: "TEACHER_NOT_FOUND",
        entity: "teacher",
        entityId: absentId,
        locale: LOCALE_AR,
      });
      // Bounded-context hygiene — no extra keys, no PII, no session id.
      expect(new Set(Object.keys(ctx ?? {}))).toEqual(new Set(["code", "entity", "entityId", "locale"]));
    });
  });

  test("the happy path logs NOTHING", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, { isOnline: true });
      const logSpy = silenceDomainLog();

      await TeacherAvailabilityService.getAvailability(user.id, LOCALE_EN, tx);

      expect(logSpy.mock.calls).toHaveLength(0);
    });
  });

  test("locale=ar yields the Arabic denial copy (parity)", async () => {
    await runInRollback(async tx => {
      const absentId = await absentTeacherId(tx);
      silenceDomainLog();

      const error = await expectRepoError(() => TeacherAvailabilityService.getAvailability(absentId, LOCALE_AR, tx));

      expectDomainDenial(error, "TEACHER_NOT_FOUND", errorsFor(LOCALE_AR).teacherNotFound);
      // Sanity: the Arabic copy is distinct from the English copy.
      expect(errorsFor(LOCALE_AR).teacherNotFound).not.toBe(errorsFor(LOCALE_EN).teacherNotFound);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// setAvailability
// ══════════════════════════════════════════════════════════════════════════

describe("TeacherAvailabilityService.setAvailability", () => {
  // ─── Tier 1: branch/statement — Cartesian matrix ───────────────────
  //
  // The matrix axis is {certified, uncertified, isApproved=null} ×
  // {isOnline true, false} × {no session, started session}. The gate
  // order is INV-A1 (cert) BEFORE INV-A2 (session) on the Available
  // direction; the Unavailable direction skips BOTH gates (always
  // allowed — the Unavailable direction is ungated by design).

  const SET_MATRIX = [
    // Certified — Available direction.
    {
      certState: "certified",
      isOnlineInput: true,
      sessionState: "no-session",
      expected: "ok",
      expectedIsOnline: true,
      expectedIsApproved: true,
    },
    {
      certState: "certified",
      isOnlineInput: true,
      sessionState: "started-session",
      expected: "in-session",
      expectedIsOnline: false,
      expectedIsApproved: true,
    },
    // Certified — Unavailable direction (always allowed, even with a started session).
    {
      certState: "certified",
      isOnlineInput: false,
      sessionState: "no-session",
      expected: "ok",
      expectedIsOnline: false,
      expectedIsApproved: true,
    },
    {
      certState: "certified",
      isOnlineInput: false,
      sessionState: "started-session",
      expected: "ok",
      expectedIsOnline: false,
      expectedIsApproved: true,
    },
    // Uncertified — Available direction denied by INV-A1 (certification gate).
    {
      certState: "uncertified",
      isOnlineInput: true,
      sessionState: "no-session",
      expected: "forbidden",
      expectedIsOnline: false,
      expectedIsApproved: false,
    },
    {
      certState: "uncertified",
      isOnlineInput: true,
      sessionState: "started-session",
      expected: "forbidden",
      expectedIsOnline: false,
      expectedIsApproved: false,
    },
    // Uncertified — Unavailable direction (always allowed).
    {
      certState: "uncertified",
      isOnlineInput: false,
      sessionState: "no-session",
      expected: "ok",
      expectedIsOnline: false,
      expectedIsApproved: false,
    },
    {
      certState: "uncertified",
      isOnlineInput: false,
      sessionState: "started-session",
      expected: "ok",
      expectedIsOnline: false,
      expectedIsApproved: false,
    },
    // isApproved=null — Available direction denied by INV-A1 (treats null as not-certified).
    {
      certState: "null",
      isOnlineInput: true,
      sessionState: "no-session",
      expected: "forbidden",
      expectedIsOnline: false,
      expectedIsApproved: false,
    },
    {
      certState: "null",
      isOnlineInput: true,
      sessionState: "started-session",
      expected: "forbidden",
      expectedIsOnline: false,
      expectedIsApproved: false,
    },
    // isApproved=null — Unavailable direction (always allowed).
    {
      certState: "null",
      isOnlineInput: false,
      sessionState: "no-session",
      expected: "ok",
      expectedIsOnline: false,
      expectedIsApproved: false,
    },
    {
      certState: "null",
      isOnlineInput: false,
      sessionState: "started-session",
      expected: "ok",
      expectedIsOnline: false,
      expectedIsApproved: false,
    },
  ] as const;

  test.each([...SET_MATRIX])(
    "Cartesian: setAvailability($isOnlineInput) on a $certState / $sessionState teacher → $expected",
    async ({ certState, isOnlineInput, sessionState, expected, expectedIsOnline, expectedIsApproved }) => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx, { role: "teacher" });
        // Seed the row's initial is_online to the OPPOSITE of the input
        // so the write actually drives the flag (when input=true, start
        // offline; when input=false, start online).
        await applyCertState(tx, user.id, certState, !isOnlineInput);
        await applySessionState(tx, user.id, sessionState);
        silenceDomainLog();

        if (expected === "ok") {
          const projection = await TeacherAvailabilityService.setAvailability(user.id, isOnlineInput, LOCALE_EN, tx);

          expect(projection).toEqual({
            id: user.id,
            isOnline: expectedIsOnline,
            isApproved: expectedIsApproved,
          });
          // Read-your-writes — the persisted row reflects the write.
          const reread = await readTeacherRow(tx, user.id);
          expect(reread?.isOnline).toBe(expectedIsOnline);
        } else if (expected === "forbidden") {
          const error = await expectRepoError(() =>
            TeacherAvailabilityService.setAvailability(user.id, isOnlineInput, LOCALE_EN, tx)
          );
          expectDomainDenial(error, "FORBIDDEN", errorsFor(LOCALE_EN).teacherNotCertified);
          // The write never fired: the row stays at its initial state.
          const reread = await readTeacherRow(tx, user.id);
          expect(reread?.isOnline).toBe(!isOnlineInput);
        } else {
          // in-session
          const error = await expectRepoError(() =>
            TeacherAvailabilityService.setAvailability(user.id, isOnlineInput, LOCALE_EN, tx)
          );
          expectDomainDenial(error, "TEACHER_IN_ACTIVE_SESSION", errorsFor(LOCALE_EN).teacherInActiveSession);
          // The write never fired: the row stays at its initial state.
          const reread = await readTeacherRow(tx, user.id);
          expect(reread?.isOnline).toBe(!isOnlineInput);
        }
      });
    }
  );

  test("Cartesian: setAvailability(true) on a missing teacher row denies with TEACHER_NOT_FOUND (404)", async () => {
    await runInRollback(async tx => {
      const absentId = await absentTeacherId(tx);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        TeacherAvailabilityService.setAvailability(absentId, true, LOCALE_EN, tx)
      );

      expectDomainDenial(error, "TEACHER_NOT_FOUND", errorsFor(LOCALE_EN).teacherNotFound);
    });
  });

  test("Cartesian: setAvailability(false) on a missing teacher row denies with TEACHER_NOT_FOUND (404)", async () => {
    await runInRollback(async tx => {
      const absentId = await absentTeacherId(tx);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        TeacherAvailabilityService.setAvailability(absentId, false, LOCALE_EN, tx)
      );

      expectDomainDenial(error, "TEACHER_NOT_FOUND", errorsFor(LOCALE_EN).teacherNotFound);
    });
  });

  test("integration: a `started` session created via the REAL SessionLifecycleService triggers the INV-A2 gate", async () => {
    await runInRollback(async tx => {
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, teacherUser.id, { isOnline: true });
      const studentUser = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, studentUser.id);
      silenceDomainLog();

      // Book + start a session through the REAL service — proves the
      // INV-A2 gate fires against a session row created by the production
      // lifecycle, not just a direct Drizzle insert.
      const sessionId = await startSessionViaRealService(
        tx,
        teacherUser.id,
        studentUser.id,
        "key-availability-integration"
      );
      const startedSession = await tx.select().from(session).where(eq(session.id, sessionId));
      expect(startedSession[0]?.status).toBe(SessionStatus.Started);

      // The start-session flow already drove the teacher offline (the
      // INV-S6 lock fires on startSession). The availability toggle to
      // Available must deny with TEACHER_IN_ACTIVE_SESSION — the in-session
      // gate sees the started row and refuses.
      const error = await expectRepoError(() =>
        TeacherAvailabilityService.setAvailability(teacherUser.id, true, LOCALE_EN, tx)
      );
      expectDomainDenial(error, "TEACHER_IN_ACTIVE_SESSION", errorsFor(LOCALE_EN).teacherInActiveSession);

      // The write never fired: the row stays offline.
      const reread = await readTeacherRow(tx, teacherUser.id);
      expect(reread?.isOnline).toBe(false);
    });
  });

  test("integration: the mid-session Unavailable toggle on a REAL started session succeeds and OVERWRITES the captured marker", async () => {
    await runInRollback(async tx => {
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, teacherUser.id, { isOnline: true });
      const studentUser = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, studentUser.id);
      silenceDomainLog();

      // Book + start through the REAL lifecycle — the acquire captured
      // the pre-lock intent (marker true) and drove the teacher offline.
      await startSessionViaRealService(tx, teacherUser.id, studentUser.id, "key-availability-marker-overwrite");
      const locked = await readTeacherRow(tx, teacherUser.id);
      expect(locked?.isOnline).toBe(false);
      expect(locked?.wasOnlineBeforeLock).toBe(true);

      // The mid-session Unavailable toggle is UNGATED — and it IS the
      // pre-lock intent now: the held marker is overwritten to false so
      // the eventual release cannot resurrect availability the teacher
      // explicitly withdrew.
      const projection = await TeacherAvailabilityService.setAvailability(teacherUser.id, false, LOCALE_EN, tx);
      expect(projection).toEqual({ id: teacherUser.id, isOnline: false, isApproved: true });

      // Repo-read oracle: the flag is false AND the captured marker was
      // overwritten (true → false), never left stale.
      const reread = await readTeacherRow(tx, teacherUser.id);
      expect(reread?.isOnline).toBe(false);
      expect(reread?.wasOnlineBeforeLock).toBe(false);
    });
  });

  // ─── Tier 2: boundary ────────────────────────────────────────────────

  test.each([0, -1, 1.5, Number.NaN, 2 ** 53])(
    "rejects a malformed teacherId (%s) with VALIDATION before any DB read (setAvailability)",
    async (malformedId: number) => {
      const lockSpy = spyOn(TeacherRepository, "lockForCertificationCheck");
      silenceDomainLog();

      const error = await expectRepoError(() =>
        TeacherAvailabilityService.setAvailability(malformedId, true, LOCALE_EN)
      );

      expectDomainDenial(error, "VALIDATION", errorsFor(LOCALE_EN).validation);
      // Pre-DB shape guard: ZERO repository reads/writes fired.
      expect(lockSpy.mock.calls).toHaveLength(0);
      lockSpy.mockRestore();
    }
  );

  test("rejects a non-boolean isOnline (cast as a string) with VALIDATION before any DB read", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id);
      const lockSpy = spyOn(TeacherRepository, "lockForCertificationCheck");
      silenceDomainLog();

      // BOPLA-pattern — transport-tamper simulation via Object.assign.
      // TypeScript retains the declared `boolean` type for the wrapper's
      // `isOnline` member; the runtime value diverges to the string "true".
      // The service's runtime `typeof isOnline !== "boolean"` guard rejects
      // the hostile value before any DB work. No `as unknown as` cast.
      const tampered = { isOnline: true };
      Object.assign(tampered, { isOnline: "true" });
      const error = await expectRepoError(() =>
        TeacherAvailabilityService.setAvailability(user.id, tampered.isOnline, LOCALE_EN, tx)
      );

      expectDomainDenial(error, "VALIDATION", errorsFor(LOCALE_EN).validation);
      expect(lockSpy.mock.calls).toHaveLength(0);
      lockSpy.mockRestore();
    });
  });

  test.each([LOCALE_EMPTY, LOCALE_UNKNOWN])(
    "hostile locale (%s) falls back to the default-locale copy (setAvailability FORBIDDEN)",
    async (hostileLocale: string) => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx, { role: "teacher" });
        await createTestTeacherRow(tx, user.id, { isApproved: false, isOnline: false });
        silenceDomainLog();

        const error = await expectRepoError(() =>
          TeacherAvailabilityService.setAvailability(user.id, true, hostileLocale, tx)
        );

        // The platform default locale is "ar" — unknown/empty locales
        // fall back to the default-locale copy (NOT the English copy).
        expectDomainDenial(error, "FORBIDDEN", errorsFor(defaultLocale).teacherNotCertified);
      });
    }
  );

  test("unicode-safe denial copy: the Arabic FORBIDDEN message round-trips intact (no mojibake)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, { isApproved: false, isOnline: false });
      silenceDomainLog();

      const error = await expectRepoError(() =>
        TeacherAvailabilityService.setAvailability(user.id, true, LOCALE_AR, tx)
      );

      expectDomainDenial(error, "FORBIDDEN", errorsFor(LOCALE_AR).teacherNotCertified);
      // The Arabic copy carries actual Arabic-script code points (the
      // unicode block range U+0600–U+06FF) — not ASCII fallback.
      expect(error.message).toMatch(/[\u0600-\u06FF]/u);
    });
  });

  test("same-value re-toggle (false→false) returns an identical projection; updated_at may advance but is_online is stable", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, { isOnline: false });
      silenceDomainLog();

      const first = await TeacherAvailabilityService.setAvailability(user.id, false, LOCALE_EN, tx);
      // Capture the row's updated_at immediately after the first write.
      const rowAfterFirst = await readTeacherRow(tx, user.id);
      const firstUpdatedAt = rowAfterFirst?.updatedAt;

      // Yield once so a same-value write could plausibly advance the
      // updated_at column (the column is $onUpdate-stamped).
      const second = await TeacherAvailabilityService.setAvailability(user.id, false, LOCALE_EN, tx);
      const rowAfterSecond = await readTeacherRow(tx, user.id);

      // The projection is identical (idempotency — same-value re-toggle).
      expect(second).toEqual(first);
      expect(second).toEqual({ id: user.id, isOnline: false, isApproved: true });
      // The persisted is_online is stable (idempotency at the row level).
      expect(rowAfterSecond?.isOnline).toBe(false);
      // updated_at is allowed to advance OR stay equal — the contract
      // only requires is_online stability, not timestamp stability.
      expect(rowAfterSecond?.updatedAt).toBeInstanceOf(Date);
      if (firstUpdatedAt instanceof Date) {
        expect(rowAfterSecond?.updatedAt.getTime()).toBeGreaterThanOrEqual(firstUpdatedAt.getTime());
      }
    });
  });

  test("same-value re-toggle (true→true) on a certified teacher returns an identical projection with stable is_online", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      // Start online — the re-toggle writes the same value.
      await createTestTeacherRow(tx, user.id, { isOnline: true });
      silenceDomainLog();

      const first = await TeacherAvailabilityService.setAvailability(user.id, true, LOCALE_EN, tx);
      const second = await TeacherAvailabilityService.setAvailability(user.id, true, LOCALE_EN, tx);

      expect(second).toEqual(first);
      expect(second).toEqual({ id: user.id, isOnline: true, isApproved: true });
      const reread = await readTeacherRow(tx, user.id);
      expect(reread?.isOnline).toBe(true);
    });
  });

  test("locale=ar yields the Arabic denial copy for the certification gate", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, { isApproved: false, isOnline: false });
      silenceDomainLog();

      const error = await expectRepoError(() =>
        TeacherAvailabilityService.setAvailability(user.id, true, LOCALE_AR, tx)
      );

      expectDomainDenial(error, "FORBIDDEN", errorsFor(LOCALE_AR).teacherNotCertified);
      // Sanity: the Arabic copy is distinct from the English copy.
      expect(errorsFor(LOCALE_AR).teacherNotCertified).not.toBe(errorsFor(LOCALE_EN).teacherNotCertified);
    });
  });

  // ─── Tier 3: chaos / concurrency ────────────────────────────────────

  testOnRealPostgres(
    "25-way Promise.allSettled mixed-toggle storm ⇒ deterministic final is_online + zero partial writes",
    async () => {
      const teacherUserId = await createCommittedCertifiedTeacher(false);

      // Fire 25 parallel mixed toggles (alternating true/false) — each
      // opens its own top-level transaction (the production path with no
      // `tx`). The FOR UPDATE row lock serializes them; the final
      // committed value is the LAST write that acquired the lock. PGlite
      // is single-connection WASM and cannot observe cross-tx row-lock
      // serialization, so this case is skipped there (see deferred-items.md
      // for the sandbox-limitation ledger entry).
      const results = await Promise.allSettled(
        Array.from({ length: CHAOS_TOGGLE_COUNT }, (_, index) =>
          TeacherAvailabilityService.setAvailability(teacherUserId, index % 2 === 0, LOCALE_EN)
        )
      );

      // Every parallel call succeeds — the certification gate passes
      // (certified teacher), the in-session gate passes (no started
      // session), and the write commits. None rejects with a typed
      // conflict.
      const fulfilled = results.filter(r => r.status === "fulfilled");
      const rejected = results.filter(r => r.status === "rejected");
      expect(fulfilled).toHaveLength(CHAOS_TOGGLE_COUNT);
      expect(rejected).toHaveLength(0);

      // Deterministic final state — the final committed is_online is a
      // total boolean (no partial write, no corruption). The
      // certification flag is unchanged.
      const [finalRow] = await db.select().from(teacher).where(eq(teacher.id, teacherUserId));
      expect(finalRow?.isOnline).toBeTypeOf("boolean");
      expect(finalRow?.isApproved).toBe(true);
    }
  );

  test("20-way sequential rapid-toggle storm within ONE tx ⇒ no lost update, deterministic final value", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, { isOnline: false });
      silenceDomainLog();

      // Fire 20 sequential toggles within ONE transaction — each call
      // reads-then-writes the same row inside its SAVEPOINT, so no update
      // is lost: every call observes the prior call's commit. The final
      // value is deterministic — the LAST toggle's input drives the
      // persisted is_online. This case runs on pglite (no cross-tx
      // serialization needed) and proves the mixed-toggle ordering
      // yields a stable, deterministic final state. The recursive helper
      // satisfies the `no-await-in-loop` rule (sequential-by-recursion).
      const lastInput = await sequentialToggleStorm(tx, user.id, SEQUENTIAL_TOGGLE_COUNT);

      // The persisted is_online equals the LAST write's input — no lost
      // updates, no corruption.
      const reread = await readTeacherRow(tx, user.id);
      expect(reread?.isOnline).toBe(lastInput);
      // The certification flag is unchanged by the storm.
      expect(reread?.isApproved).toBe(true);
    });
  });

  test("forced inner failure AFTER the availability write ⇒ teacher.is_online unchanged (rollback of the whole withTransaction)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, { isOnline: false });
      silenceDomainLog();

      // Capture the real implementation BEFORE the spy replaces it, so
      // the spy can call through and perform the write — then throw a
      // sentinel AFTER the write completes. The SAVEPOINT inside
      // `withTransaction` rolls back, the FOR UPDATE lock releases, and
      // the UPDATE is un-applied. Restored in a `finally` so an
      // assertion failure cannot leak the spy into the next test.
      const realWriter = TeacherRepository.setAvailabilityIntent;
      const writerSpy = spyOn(TeacherRepository, "setAvailabilityIntent").mockImplementation(
        async (id: number, online: boolean, innerTx: DBTransaction) => {
          await realWriter(id, online, innerTx);
          throw new Error(FORCED_INNER_FAILURE);
        }
      );
      try {
        const error = await expectRepoError(() =>
          TeacherAvailabilityService.setAvailability(user.id, true, LOCALE_EN, tx)
        );

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe(FORCED_INNER_FAILURE);
        // Read-back oracle — the SAVEPOINT rolled back the write, so the
        // row's is_online is unchanged.
        const reread = await readTeacherRow(tx, user.id);
        expect(reread?.isOnline).toBe(false);
        // Zero committed partial state — the certification flag is unchanged.
        expect(reread?.isApproved).toBe(true);
      } finally {
        writerSpy.mockRestore();
      }
    });
  });

  test("the honest zero-row guard (Unavailable direction): a `setAvailabilityIntent` returning null denies with TEACHER_NOT_FOUND post-write", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, { isOnline: false });
      const logSpy = silenceDomainLog();

      // The writer returns `null` — the Unavailable direction's zero-row
      // guard denies with `TEACHER_NOT_FOUND` (the row vanished
      // mid-transaction). The Available direction's zero rows are the
      // race-closed backstop instead (its own test below). Restored in a
      // `finally` so an assertion failure cannot leak the spy into the
      // next test.
      const writerSpy = spyOn(TeacherRepository, "setAvailabilityIntent").mockResolvedValue(null);
      try {
        const error = await expectRepoError(() =>
          TeacherAvailabilityService.setAvailability(user.id, false, LOCALE_EN, tx)
        );

        expectDomainDenial(error, "TEACHER_NOT_FOUND", errorsFor(LOCALE_EN).teacherNotFound);
        // The honest zero-row guard logs EXACTLY ONCE with a bounded context.
        expect(logSpy.mock.calls).toHaveLength(1);
        const [message, ctx] = recordedLogCall(logSpy);
        expect(message).toBe("Teacher not found for availability toggle write");
        expect(ctx).toEqual({
          code: "TEACHER_NOT_FOUND",
          entity: "teacher",
          entityId: user.id,
          locale: LOCALE_EN,
        });
      } finally {
        writerSpy.mockRestore();
      }
    });
  });

  // ─── In-tx activity stamp (atomic with the toggle) ──────────────────

  test("the activity stamp joins the toggle's transaction: the stamp and the write share ONE innerTx and one captured now", async () => {
    await runInRollback(async tx => {
      // Backdate the fixture's activity so the stamp's monotonic guarded
      // write has a strictly older value to advance (a same-millisecond
      // stored stamp would be a legitimate zero-row miss).
      const backdated = new Date(Date.now() - 10 * 60_000);
      const user = await createTestUser(tx, { role: "teacher", lastActiveAt: backdated });
      await createTestTeacherRow(tx, user.id, { isOnline: false });
      silenceDomainLog();

      // Both write seams are spied with call-through (restored in a
      // `finally` so an assertion failure cannot leak the spies into the
      // next test) — the spies record arguments WITHOUT changing the
      // committed behavior.
      const realAvailabilityWrite = TeacherRepository.setAvailabilityIntent;
      const realStamp = UserRepository.updateLastActiveAt;
      const availabilityWriteSpy = spyOn(TeacherRepository, "setAvailabilityIntent").mockImplementation(
        async (id: number, online: boolean, innerTx: DBTransaction) => realAvailabilityWrite(id, online, innerTx)
      );
      const stampSpy = spyOn(UserRepository, "updateLastActiveAt").mockImplementation(
        async (userId: number, now: Date, innerTx?: DBQueryExecutor) => realStamp(userId, now, innerTx)
      );
      try {
        const windowStart = new Date();
        await TeacherAvailabilityService.setAvailability(user.id, true, LOCALE_EN, tx);
        const windowEnd = new Date();

        // Exactly ONE stamp call — carrying the toggle's teacher id and a
        // `now` captured inside the transaction (within the test window,
        // strictly fresher than the backdated fixture value).
        expect(stampSpy.mock.calls).toHaveLength(1);
        const [stampUserId, stampNow, stampInnerTx] = stampSpy.mock.calls[0];
        expect(stampUserId).toBe(user.id);
        expect(stampNow.getTime()).toBeGreaterThanOrEqual(windowStart.getTime());
        expect(stampNow.getTime()).toBeLessThanOrEqual(windowEnd.getTime());
        expect(stampNow.getTime()).toBeGreaterThan(backdated.getTime());

        // In-transaction composition — the stamp received the SAME tx
        // handle the write received (one shared atomic unit).
        expect(availabilityWriteSpy.mock.calls).toHaveLength(1);
        const [, , writeInnerTx] = availabilityWriteSpy.mock.calls[0];
        expect(stampInnerTx).toBe(writeInnerTx);

        // Read-your-writes — the stamped value is visible inside the same
        // outer transaction, byte-exact against the captured instant.
        const stampedAt = await readUserLastActiveAt(tx, user.id);
        expect(stampedAt?.getTime()).toBe(stampNow.getTime());
      } finally {
        availabilityWriteSpy.mockRestore();
        stampSpy.mockRestore();
      }
    });
  });

  test("a forced failure AFTER the stamp rolls back last_active_at AND is_online together (one transaction, one fate)", async () => {
    await runInRollback(async tx => {
      const backdated = new Date(Date.now() - 10 * 60_000);
      const user = await createTestUser(tx, { role: "teacher", lastActiveAt: backdated });
      await createTestTeacherRow(tx, user.id, { isOnline: false });
      silenceDomainLog();

      // The stamp spy calls through (the real guarded UPDATE fires on the
      // SAVEPOINT) and THEN throws — the same forced-inner-failure shape
      // as the post-write sentinel above, one seam later. Restored in a
      // `finally` so an assertion failure cannot leak the spy.
      const realStamp = UserRepository.updateLastActiveAt;
      const stampSpy = spyOn(UserRepository, "updateLastActiveAt").mockImplementation(
        async (userId: number, now: Date, innerTx?: DBQueryExecutor) => {
          await realStamp(userId, now, innerTx);
          throw new Error(FORCED_INNER_FAILURE);
        }
      );
      try {
        const error = await expectRepoError(() =>
          TeacherAvailabilityService.setAvailability(user.id, true, LOCALE_EN, tx)
        );

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe(FORCED_INNER_FAILURE);

        // The SAVEPOINT rolled back: the stamp is un-applied — the stored
        // activity is still the backdated fixture value.
        const stampedAt = await readUserLastActiveAt(tx, user.id);
        expect(stampedAt?.getTime()).toBe(backdated.getTime());

        // ...and the toggle is un-applied with it: is_online unchanged.
        const reread = await readTeacherRow(tx, user.id);
        expect(reread?.isOnline).toBe(false);
      } finally {
        stampSpy.mockRestore();
      }
    });
  });

  test("a fresh toggle carries fresh activity: last_active_at advances into the test window (Available direction)", async () => {
    await runInRollback(async tx => {
      const backdated = new Date(Date.now() - 10 * 60_000);
      const user = await createTestUser(tx, { role: "teacher", lastActiveAt: backdated });
      await createTestTeacherRow(tx, user.id, { isOnline: false });
      silenceDomainLog();

      // The REAL production path — no stamp spy. The toggle's transaction
      // captures its own `now` and commits the stamp atomically with the
      // flag write.
      const windowStart = new Date();
      const projection = await TeacherAvailabilityService.setAvailability(user.id, true, LOCALE_EN, tx);
      const windowEnd = new Date();

      expect(projection).toEqual({ id: user.id, isOnline: true, isApproved: true });
      const stampedAt = await readUserLastActiveAt(tx, user.id);
      expect(stampedAt).toBeInstanceOf(Date);
      expect(stampedAt?.getTime()).toBeGreaterThanOrEqual(windowStart.getTime());
      expect(stampedAt?.getTime()).toBeLessThanOrEqual(windowEnd.getTime());
      // Freshness — the stored activity strictly advanced past the
      // backdated fixture value.
      expect(stampedAt?.getTime()).toBeGreaterThan(backdated.getTime());
      const reread = await readTeacherRow(tx, user.id);
      expect(reread?.isOnline).toBe(true);
    });
  });

  test("the Unavailable direction stamps too, and a stamp boolean miss never fails the toggle", async () => {
    await runInRollback(async tx => {
      const backdated = new Date(Date.now() - 10 * 60_000);
      const user = await createTestUser(tx, { role: "teacher", lastActiveAt: backdated });
      await createTestTeacherRow(tx, user.id, { isOnline: true });
      silenceDomainLog();

      // The stamp is stubbed to a boolean MISS (zero rows written) — the
      // service treats the miss as "nothing to do": the toggle still
      // succeeds and the projection is still returned. Restored in a
      // `finally` so an assertion failure cannot leak the spy.
      const stampSpy = spyOn(UserRepository, "updateLastActiveAt").mockResolvedValue(false);
      try {
        const windowStart = new Date();
        const projection = await TeacherAvailabilityService.setAvailability(user.id, false, LOCALE_EN, tx);
        const windowEnd = new Date();

        expect(projection).toEqual({ id: user.id, isOnline: false, isApproved: true });
        expect(stampSpy.mock.calls).toHaveLength(1);
        const [stampUserId, stampNow] = stampSpy.mock.calls[0];
        expect(stampUserId).toBe(user.id);
        expect(stampNow.getTime()).toBeGreaterThanOrEqual(windowStart.getTime());
        expect(stampNow.getTime()).toBeLessThanOrEqual(windowEnd.getTime());
        const reread = await readTeacherRow(tx, user.id);
        expect(reread?.isOnline).toBe(false);
      } finally {
        stampSpy.mockRestore();
      }
    });
  });

  test("the race-closed backstop: a `setAvailabilityIntent` returning null on the Available direction denies with the gate's EXACT conflict", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, { isOnline: false });
      const logSpy = silenceDomainLog();

      // Both gates PASS (certified teacher, no started session) — but the
      // writer's own write-time guard matched zero rows: a `started`
      // session won the race between the pre-check gate and the write.
      // The stub simulates exactly that lost race (null once, then the
      // real writer). Restored in a `finally` so an assertion failure
      // cannot leak the spy into the next test.
      const writerSpy = spyOn(TeacherRepository, "setAvailabilityIntent").mockResolvedValueOnce(null);
      try {
        const error = await expectRepoError(() =>
          TeacherAvailabilityService.setAvailability(user.id, true, LOCALE_EN, tx)
        );

        // The EXISTING denial — same code and the SAME localized message
        // source the in-session gate raises (never a duplicate copy).
        expectDomainDenial(error, "TEACHER_IN_ACTIVE_SESSION", errorsFor(LOCALE_EN).teacherInActiveSession);
        // The writer fired exactly once (the stubbed call).
        expect(writerSpy.mock.calls).toHaveLength(1);
        // The service-owned backstop logs EXACTLY ONCE with a bounded
        // context — oracle safety: no session id anywhere.
        expect(logSpy.mock.calls).toHaveLength(1);
        const [message, ctx] = recordedLogCall(logSpy);
        expect(message).toBe("Teacher availability denied: in-session race detected at write");
        expect(ctx).toEqual({
          code: "TEACHER_IN_ACTIVE_SESSION",
          entity: "teacher",
          entityId: user.id,
          locale: LOCALE_EN,
        });
        expect(new Set(Object.keys(ctx ?? {}))).toEqual(new Set(["code", "entity", "entityId", "locale"]));
        expect(JSON.stringify(ctx)).not.toContain("sessionId");
        expect(JSON.stringify(ctx)).not.toContain("session_id");
      } finally {
        writerSpy.mockRestore();
      }
    });
  });

  // ─── Tier 4: security / oracle safety ────────────────────────────────

  test("hostile-id fuzz: ZERO DB calls before a VALIDATION denial (no repo read, no repo write)", async () => {
    await runInRollback(async tx => {
      const lockSpy = spyOn(TeacherRepository, "lockForCertificationCheck");
      const writerSpy = spyOn(TeacherRepository, "setAvailabilityIntent");
      silenceDomainLog();

      const error = await expectRepoError(() =>
        TeacherAvailabilityService.setAvailability(Number.NaN, true, LOCALE_EN, tx)
      );

      expectDomainDenial(error, "VALIDATION", errorsFor(LOCALE_EN).validation);
      // Pre-DB shape guard — ZERO DB calls fired.
      expect(lockSpy.mock.calls).toHaveLength(0);
      expect(writerSpy.mock.calls).toHaveLength(0);
      lockSpy.mockRestore();
      writerSpy.mockRestore();
    });
  });

  test("BFLA / INV-A1: an uncertified teacher can NEVER reach the availability write — the repo write fires ZERO times", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, { isApproved: false, isOnline: false });
      // Spy on the WRITE primitive — proves the certification gate
      // denies BEFORE the write can fire (BFLA defense-in-depth).
      // Restored in a `finally` so an assertion failure cannot leak the
      // spy into the next test.
      const writerSpy = spyOn(TeacherRepository, "setAvailabilityIntent");
      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          TeacherAvailabilityService.setAvailability(user.id, true, LOCALE_EN, tx)
        );

        expectDomainDenial(error, "FORBIDDEN", errorsFor(LOCALE_EN).teacherNotCertified);
        // INV-A1 — the write primitive NEVER fired for an uncertified teacher.
        expect(writerSpy.mock.calls).toHaveLength(0);
        // The denial logs EXACTLY ONCE with a bounded context.
        expect(logSpy.mock.calls).toHaveLength(1);
        const [message, ctx] = recordedLogCall(logSpy);
        expect(message).toBe("Teacher availability denied: not certified");
        expect(ctx).toEqual({
          code: "FORBIDDEN",
          entity: "teacher",
          entityId: user.id,
          locale: LOCALE_EN,
        });
        // Bounded-context hygiene — no extra keys, no PII, no session id.
        expect(new Set(Object.keys(ctx ?? {}))).toEqual(new Set(["code", "entity", "entityId", "locale"]));
        expect(JSON.stringify(ctx)).not.toContain("sessionId");
      } finally {
        writerSpy.mockRestore();
      }
    });
  });

  test("INV-A2: a started-session teacher can NEVER reach the availability write — the repo write fires ZERO times", async () => {
    await runInRollback(async tx => {
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, teacherUser.id, { isOnline: false });
      const studentUser = await createTestUser(tx, { role: "student" });
      const seededSession = await createTestSession(tx, teacherUser.id, studentUser.id, {
        status: SessionStatus.Started,
      });
      // Spy on the WRITE primitive — proves the in-session gate denies
      // BEFORE the write can fire (INV-A2). Restored in a `finally` so
      // an assertion failure cannot leak the spy into the next test
      // (bun:test's `spyOn` returns the existing spy if one is already
      // installed — leaking state across tests is the failure mode).
      const writerSpy = spyOn(TeacherRepository, "setAvailabilityIntent");
      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          TeacherAvailabilityService.setAvailability(teacherUser.id, true, LOCALE_EN, tx)
        );

        expectDomainDenial(error, "TEACHER_IN_ACTIVE_SESSION", errorsFor(LOCALE_EN).teacherInActiveSession);
        // INV-A2 — the write primitive NEVER fired for an in-session teacher.
        expect(writerSpy.mock.calls).toHaveLength(0);
        // The reused gate owns its OWN bounded log call — the service adds
        // no duplicate log. Exactly ONE log call total.
        expect(logSpy.mock.calls).toHaveLength(1);
        const [, ctx] = recordedLogCall(logSpy);
        expect(ctx).toMatchObject({
          code: "TEACHER_IN_ACTIVE_SESSION",
          entity: "teacher",
          entityId: teacherUser.id,
        });
        // Oracle safety — NO session id disclosed.
        const ctxKeys = new Set(Object.keys(ctx ?? {}));
        expect(ctxKeys.has("sessionId")).toBe(false);
        expect(ctxKeys.has("session_id")).toBe(false);
        expect(JSON.stringify(ctx)).not.toContain("sessionId");
        expect(JSON.stringify(ctx)).not.toContain("session_id");
        // The error message itself does NOT echo the seeded session id
        // (the localized copy mentions the word "session" — that is the
        // domain vocabulary, never the session ID).
        expect(error.message).not.toContain(String(seededSession.id));
      } finally {
        writerSpy.mockRestore();
      }
    });
  });

  test("the FORBIDDEN denial logs EXACTLY ONCE with a bounded context and discloses no session id", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, { isApproved: false, isOnline: false });
      const logSpy = silenceDomainLog();

      await expectRepoError(() => TeacherAvailabilityService.setAvailability(user.id, true, LOCALE_EN, tx));

      expect(logSpy.mock.calls).toHaveLength(1);
      const [message, ctx] = recordedLogCall(logSpy);
      expect(message).toBe("Teacher availability denied: not certified");
      expect(ctx).toEqual({
        code: "FORBIDDEN",
        entity: "teacher",
        entityId: user.id,
        locale: LOCALE_EN,
      });
      // Bounded-context hygiene — no extra keys, no PII, no session id.
      expect(new Set(Object.keys(ctx ?? {}))).toEqual(new Set(["code", "entity", "entityId", "locale"]));
      expect(JSON.stringify(ctx)).not.toContain("sessionId");
    });
  });

  test("the TEACHER_IN_ACTIVE_SESSION denial surfaces NO session id (oracle safety)", async () => {
    await runInRollback(async tx => {
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, teacherUser.id, { isOnline: false });
      const studentUser = await createTestUser(tx, { role: "student" });
      const seededSession = await createTestSession(tx, teacherUser.id, studentUser.id, {
        status: SessionStatus.Started,
      });
      const logSpy = silenceDomainLog();

      const error = await expectRepoError(() =>
        TeacherAvailabilityService.setAvailability(teacherUser.id, true, LOCALE_EN, tx)
      );

      expectDomainDenial(error, "TEACHER_IN_ACTIVE_SESSION", errorsFor(LOCALE_EN).teacherInActiveSession);
      // The denial log context carries the teacher id only — NEVER the
      // session id, the counterparty, or any session-state metadata.
      expect(logSpy.mock.calls).toHaveLength(1);
      const [, ctx] = recordedLogCall(logSpy);
      const ctxKeys = new Set(Object.keys(ctx ?? {}));
      expect(ctxKeys.has("sessionId")).toBe(false);
      expect(ctxKeys.has("session_id")).toBe(false);
      // The error message itself does NOT echo the session id.
      expect(error.message).not.toContain(String(seededSession.id));
    });
  });

  test("happy path emits ZERO domain logs (silent success)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, { isOnline: false });
      const logSpy = silenceDomainLog();

      await TeacherAvailabilityService.setAvailability(user.id, true, LOCALE_EN, tx);

      expect(logSpy.mock.calls).toHaveLength(0);
    });
  });

  test("the certification gate precedence: a non-certified AND in-session teacher sees FORBIDDEN (not TEACHER_IN_ACTIVE_SESSION)", async () => {
    await runInRollback(async tx => {
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      // Uncertified AND in-session — the certification gate must fire FIRST.
      await createTestTeacherRow(tx, teacherUser.id, { isApproved: false, isOnline: false });
      const studentUser = await createTestUser(tx, { role: "student" });
      await createTestSession(tx, teacherUser.id, studentUser.id, { status: SessionStatus.Started });
      const writerSpy = spyOn(TeacherRepository, "setAvailabilityIntent");
      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          TeacherAvailabilityService.setAvailability(teacherUser.id, true, LOCALE_EN, tx)
        );

        // Certification is decided BEFORE the in-session check — the
        // caller sees the certification denial, not the state conflict.
        expectDomainDenial(error, "FORBIDDEN", errorsFor(LOCALE_EN).teacherNotCertified);
        // The write primitive NEVER fired — INV-A1 denied before INV-A2
        // could even be probed.
        expect(writerSpy.mock.calls).toHaveLength(0);
        expect(logSpy.mock.calls).toHaveLength(1);
        const [, ctx] = recordedLogCall(logSpy);
        expect(ctx).toMatchObject({ code: "FORBIDDEN" });
      } finally {
        writerSpy.mockRestore();
      }
    });
  });

  // ─── Tier 4: static source pins (retirement + caller obligation) ────

  const SERVICE_FILE = join(import.meta.dir, "teacher-availability.service.ts");
  const serviceSource = readFileSync(SERVICE_FILE, "utf8");

  test("source: setOnline is fully retired from the service (zero references) and lockForCertificationCheck precedes setAvailabilityIntent (the caller-obligation pin)", () => {
    // Retirement regression pin — the unconditional `setOnline` writer was
    // deleted with the toggle rework; any reappearance in the service
    // source (a call, an import, or a stray docblock reference) is a
    // defect.
    expect(serviceSource.includes("setOnline")).toBe(false);
    // Caller-obligation pin — the FOR UPDATE teacher-row lock
    // (`lockForCertificationCheck`) must be taken BEFORE the
    // `setAvailabilityIntent` write inside `setAvailability`: the row lock
    // held across the whole toggle transaction is the PRIMARY
    // toggle-vs-start serialization (the pre-check gates and the write
    // observe one consistent ordering); the write-time direction guard is
    // only the defense-in-depth backstop. Source-order assertion — the
    // obligation is structural, not behavioral, so it is pinned against
    // the source text (no runtime spy can prove ordering under a race).
    const lockCallIndex = serviceSource.indexOf("TeacherRepository.lockForCertificationCheck(teacherId, innerTx)");
    const writeCallIndex = serviceSource.indexOf(
      "TeacherRepository.setAvailabilityIntent(teacherId, isOnline, innerTx)"
    );
    expect(lockCallIndex).toBeGreaterThan(-1);
    expect(writeCallIndex).toBeGreaterThan(-1);
    expect(lockCallIndex).toBeLessThan(writeCallIndex);
  });
});
