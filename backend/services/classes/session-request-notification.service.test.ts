/**
 * SessionRequestNotificationService — 4-tier suite (branch / boundary /
 * chaos / security) for the six session-request wave emitters.
 *
 * Per `backend/db/test/AGENTS.md` + `backend/services/AGENTS.md`:
 *  - Transactional (caller-tx) cases run inside `runInRollback`; `tx` is
 *    handed to EVERY service call and direct Drizzle query.
 *  - Own-commit behavior (durable row + stored claim receipt + internal
 *    publish) cannot be proven under a rollback, so Tier 3 provisions its
 *    cast in ONE committing `beforeAll` transaction and hard-deletes it in
 *    `afterAll` in FK-safe order (Rule 9).
 *  - Error assertions use the `expectRepoError` try/catch helper — NEVER
 *    `expect(...).rejects.toThrow()`.
 *  - Fan-out is spied (`SpiedFanoutTransport`); the idempotency claim cache
 *    is an in-memory map injected through the emitters' `options` seam — no
 *    Redis, no WebSocket.
 *  - Entity rows come from `entity-setup.ts` helpers where they exist;
 *    `session` and `teacher` rows (incl. intent-corrupt and locale-pin
 *    variants) are DIRECT Drizzle inserts inside the same transaction.
 *
 * Coverage map:
 *  - Tier 1: all six emitters on the caller-tx path (row shape, derived
 *    recipient, recipient-locale copy, deterministic claim key, happy-path
 *    log silence, zero publishes inside the caller tx) + the three rejection
 *    branches with exact log-spy counts and zero written rows.
 *  - Tier 2: int4-ceiling miss; the hostile-id pre-DB matrix; null
 *    `users.locale` → default-locale copy for both directions; hostile
 *    unicode/RTL/emoji participant names composed verbatim.
 *  - Tier 3: 25-way distinct-wave storm with exact final row-set; keyed
 *    replay → prior receipt with zero new rows/publishes; cache-absent
 *    fail-open with exactly one engine warn; forced mid-tx failure (zero
 *    rows, zero publishes); engine contract-breach guard.
 *  - Tier 4: repo-spy zero-call proof on hostile ids; derived-recipient
 *    invariance across two distinct participant pairs.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { SessionRepository } from "@/backend/db/repo";
import { session } from "@/backend/db/schema/classes/session";
import { notifications } from "@/backend/db/schema/notifications";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SessionIntent, TeacherRequestPreference } from "@/backend/enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { DomainError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import { SessionRequestNotificationService } from "@/backend/services/classes/session-request-notification.service";
import { NotificationEngine, type NotificationEngineCallOptions } from "@/backend/services/notifications";
import {
  buildEmitClaimKey,
  type NotificationIdempotencyClaimCache,
} from "@/backend/services/notifications/emit-idempotency";
import type {
  DBTransaction,
  NotificationDeliveryReceipt,
  NotificationReturnType,
  SessionRequestWaveKind,
  SessionSelectType,
  TeacherSelectType,
} from "@/backend/types";
import type { AppLocale } from "@/shared/locale";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { SpiedFanoutTransport } from "@/test/workflows/helpers";

/** English translated error copy — denial assertions pin translated strings. */
const ERRORS_EN = getServerTranslations("en").errorsTranslations;
/** English wave copy — student-facing outcome fixtures use locale `en`. */
const NOTIFS_EN = getServerTranslations("en").notificationsTranslations;
/** Arabic wave copy — teacher-facing fixtures use locale `ar`. */
const NOTIFS_AR = getServerTranslations("ar").notificationsTranslations;
/** Highest storable value of the int4 session primary key (valid shape, guaranteed absent). */
const INT4_MAX_SESSION_ID = 2_147_483_647;

/** Notifications namespace shape: string title slots + function body slots. */
type NotificationLabels = ReturnType<typeof getServerTranslations>["notificationsTranslations"];

/** One recorded domain-log call (code/entity/entityId/locale — copy never asserted from logs). */
interface DomainLogRecord {
  readonly code: string;
  readonly entity: string;
  readonly entityId: string | number | undefined;
  readonly locale: string | undefined;
}

/**
 * Map-backed claim cache with SET-NX-EX semantics: the first `claim` for a
 * key wins, later claims report held, `store` attaches the receipt a replay
 * reads back. `claimedKeys` records every raw claim key the engine attempted
 * so tests can pin key determinism and per-wave distinctness.
 */
class MapBackedClaimCache implements NotificationIdempotencyClaimCache {
  private readonly entries = new Map<string, string>();
  readonly claimedKeys: string[] = [];

  async claim(key: string, _ttlSeconds: number): Promise<boolean> {
    this.claimedKeys.push(key);
    if (this.entries.has(key)) {
      return false;
    }
    this.entries.set(key, "");
    return true;
  }

  async store(key: string, value: string, _ttlSeconds: number): Promise<void> {
    this.entries.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }
}

/**
 * Installs a recording stub over `logger.logDomainError` so domain logs stay
 * silent in test output AND become countable. Callers MUST `stop()`
 * (use try/finally).
 */
function recordDomainLogs(): { records: DomainLogRecord[]; stop: () => void } {
  const records: DomainLogRecord[] = [];
  const spy = spyOn(logger, "logDomainError").mockImplementation((_message: string, ctx?: DomainErrorContext) => {
    records.push({
      code: ctx?.code ?? "<missing>",
      entity: ctx?.entity ?? "<missing>",
      entityId: ctx?.entityId,
      locale: ctx?.locale,
    });
  });
  return { records, stop: () => spy.mockRestore() };
}

/** First row of a wave receipt — throws when the receipt is unexpectedly empty. */
function firstReceiptRow(receipt: NotificationDeliveryReceipt): NotificationReturnType {
  const row = receipt.notifications.at(0);
  if (!row) {
    throw new Error("expected the wave receipt to carry exactly one notification row");
  }
  return row;
}

/** Direct-INSERT of a teacher role-child row — no factory exists for this table. */
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

/** Direct-INSERT of a session row — no factory exists for this table. */
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

/** One wave fixture: the two participant users, their role children, and the session between them. */
interface WaveFixture {
  readonly sessionRow: SessionSelectType;
  readonly studentUserId: number;
  readonly teacherUserId: number;
  readonly studentName: string;
  readonly teacherName: string;
}

interface WaveFixtureInput {
  readonly intent: SessionIntent;
  readonly studentLocale?: AppLocale;
  readonly teacherLocale?: AppLocale;
  readonly studentName?: string;
  readonly teacherName?: string;
  readonly requestPreference?: TeacherRequestPreference;
}

/**
 * Provisions both participants and their session inside the caller's tx.
 * Omitting a locale leaves the `users.locale` column NULL (the
 * default-locale-fallback fixture).
 */
async function provisionWaveFixture(tx: DBTransaction, input: WaveFixtureInput): Promise<WaveFixture> {
  const studentName = input.studentName ?? `svc-student-${randomUUID().slice(0, 8)}`;
  const teacherName = input.teacherName ?? `svc-teacher-${randomUUID().slice(0, 8)}`;
  const studentUser = await createTestUser(tx, {
    fullName: studentName,
    ...(input.studentLocale === undefined ? {} : { locale: input.studentLocale }),
  });
  await createTestStudent(tx, studentUser.id);
  const teacherUser = await createTestUser(tx, {
    role: "teacher",
    fullName: teacherName,
    ...(input.teacherLocale === undefined ? {} : { locale: input.teacherLocale }),
  });
  await insertTestTeacher(tx, teacherUser.id, { requestPreference: input.requestPreference });
  const sessionRow = await insertTestSession(tx, teacherUser.id, studentUser.id, { intent: input.intent });
  return { sessionRow, studentUserId: studentUser.id, teacherUserId: teacherUser.id, studentName, teacherName };
}

/** Session id guaranteed absent inside the caller's transactional view. */
async function absentSessionId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${session.id}), 0)::int` }).from(session);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Scoped notification row-count oracle (tx or global db), never a whole-table count. */
async function countNotificationsFor(executor: DBTransaction | typeof db, userIds: readonly number[]): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(notifications)
    .where(inArray(notifications.userId, [...userIds]));
  return row?.value ?? 0;
}

/** Scoped notification rows oracle (global db) for exact final-set assertions. */
async function notificationRowsFor(userIds: readonly number[]): Promise<NotificationReturnType[]> {
  return db
    .select()
    .from(notifications)
    .where(inArray(notifications.userId, [...userIds]));
}

/** One wave under test: emitter call, recipient side, and vacuously-recomposed expected copy. */
interface WaveCase {
  readonly waveKind: SessionRequestWaveKind;
  readonly side: "student" | "teacher";
  readonly emit: (
    sessionId: number,
    locale: string,
    tx: DBTransaction | undefined,
    options: NotificationEngineCallOptions | undefined
  ) => Promise<NotificationDeliveryReceipt>;
  readonly titleOf: (labels: NotificationLabels) => string;
  readonly bodyOf: (
    labels: NotificationLabels,
    names: { readonly studentName: string; readonly teacherName: string }
  ) => string;
}

/** The six waves, with copy recomposed through the translation slots — never hand-written strings. */
const WAVE_CASES: readonly WaveCase[] = [
  {
    waveKind: "teacher_request",
    side: "teacher",
    emit: (sessionId, locale, tx, options) =>
      SessionRequestNotificationService.notifyTeacherOfSessionRequest(sessionId, locale, tx, options),
    titleOf: labels => labels.eventSessionRequestTitle,
    bodyOf: (labels, names) => labels.eventSessionRequestBody(names.studentName, labels.intentHifz),
  },
  {
    waveKind: "outcome_accepted",
    side: "student",
    emit: (sessionId, locale, tx, options) =>
      SessionRequestNotificationService.notifyStudentOfSessionAccepted(sessionId, locale, tx, options),
    titleOf: labels => labels.eventSessionAcceptedTitle,
    bodyOf: (labels, names) => labels.eventSessionAcceptedBody(names.teacherName),
  },
  {
    waveKind: "outcome_declined",
    side: "student",
    emit: (sessionId, locale, tx, options) =>
      SessionRequestNotificationService.notifyStudentOfSessionDeclined(sessionId, locale, tx, options),
    titleOf: labels => labels.eventSessionDeclinedTitle,
    bodyOf: (labels, names) => labels.eventSessionDeclinedBody(names.teacherName),
  },
  {
    waveKind: "outcome_auto_rejected",
    side: "student",
    emit: (sessionId, locale, tx, options) =>
      SessionRequestNotificationService.notifyStudentOfSessionAutoRejected(sessionId, locale, tx, options),
    titleOf: labels => labels.eventSessionAutoRejectedTitle,
    bodyOf: (labels, names) => labels.eventSessionAutoRejectedBody(names.teacherName),
  },
  {
    waveKind: "outcome_queued",
    side: "student",
    emit: (sessionId, locale, tx, options) =>
      SessionRequestNotificationService.notifyStudentOfSessionQueued(sessionId, locale, tx, options),
    titleOf: labels => labels.eventSessionQueuedTitle,
    bodyOf: (labels, names) => labels.eventSessionQueuedBody(names.teacherName),
  },
  {
    waveKind: "outcome_alternatives_offered",
    side: "student",
    emit: (sessionId, locale, tx, options) =>
      SessionRequestNotificationService.notifyStudentOfAlternativesOffered(sessionId, locale, tx, options),
    titleOf: labels => labels.eventSessionAlternativesOfferedTitle,
    bodyOf: (labels, names) => labels.eventSessionAlternativesOfferedBody(names.teacherName),
  },
];

/** Wave-case lookup — throws when a kind is not registered (test-internal guard). */
function waveCaseByKind(waveKind: SessionRequestWaveKind): WaveCase {
  const found = WAVE_CASES.find(entry => entry.waveKind === waveKind);
  if (!found) {
    throw new Error(`no wave case registered for ${waveKind}`);
  }
  return found;
}

// ─── Tier 1: caller-tx happy path — one row per wave, zero publishes ────────

describe("Tier 1 — caller-tx happy path: derived recipient + recipient-locale copy + receipt verbatim", () => {
  for (const waveCase of WAVE_CASES) {
    test(`wave ${waveCase.waveKind}: row rides the caller tx with the joined-read recipient and localized copy`, async () => {
      await runInRollback(async tx => {
        const fixture = await provisionWaveFixture(tx, {
          intent: SessionIntent.Hifz,
          studentLocale: "en",
          teacherLocale: "ar",
        });
        const recipientId = waveCase.side === "teacher" ? fixture.teacherUserId : fixture.studentUserId;
        const labels = waveCase.side === "teacher" ? NOTIFS_AR : NOTIFS_EN;
        const counterpartyName = waveCase.side === "teacher" ? fixture.studentName : fixture.teacherName;
        const transportSpy = new SpiedFanoutTransport();
        const cache = new MapBackedClaimCache();
        const logs = recordDomainLogs();
        try {
          const receipt = await waveCase.emit(fixture.sessionRow.id, "en", tx, {
            transport: transportSpy,
            cache,
          });

          expect(receipt.notifications).toHaveLength(1);
          expect(receipt.recipientUserIds).toEqual([recipientId]);
          const row = firstReceiptRow(receipt);
          expect(row.userId).toBe(recipientId);
          expect(row.type).toBe(NotificationType.SessionRequest);
          expect(row.relatedEntityType).toBe("session");
          expect(row.relatedEntityId).toBe(fixture.sessionRow.id);
          expect(row.isRead).toBe(false);
          expect(row.title).toBe(waveCase.titleOf(labels));
          expect(row.body).toBe(
            waveCase.bodyOf(labels, { studentName: fixture.studentName, teacherName: fixture.teacherName })
          );
          expect(row.body).toContain(counterpartyName);

          // The row rides the caller's transaction; the module NEVER publishes.
          expect(await countNotificationsFor(tx, [recipientId])).toBe(1);
          expect(transportSpy.publishCount).toBe(0);

          // Happy-path silence + ONE deterministic claim attempt.
          expect(logs.records).toEqual([]);
          expect(cache.claimedKeys).toEqual([
            buildEmitClaimKey(
              [recipientId],
              NotificationType.SessionRequest,
              `session:${fixture.sessionRow.id}:${waveCase.waveKind}`
            ),
          ]);
        } finally {
          logs.stop();
        }
      });
    });
  }
});

// ─── Tier 1: failure taxonomy — exactly one bounded log per logged rejection, ZERO rows ──

describe("Tier 1 — failure taxonomy: exact log-spy counts and zero written rows", () => {
  test("missing session → NotFoundError SESSION_NOT_FOUND with EXACTLY ONE domain log, zero rows/publishes", async () => {
    await runInRollback(async tx => {
      const fixture = await provisionWaveFixture(tx, { intent: SessionIntent.Hifz });
      const missingId = await absentSessionId(tx);
      const transportSpy = new SpiedFanoutTransport();
      const logs = recordDomainLogs();
      try {
        const error = await expectRepoError(() =>
          waveCaseByKind("teacher_request").emit(missingId, "en", tx, {
            transport: transportSpy,
            cache: new MapBackedClaimCache(),
          })
        );
        if (!(error instanceof NotFoundError)) {
          throw new Error(`expected NotFoundError (got ${error.name}: ${error.message})`);
        }
        expect(error.code).toBe("SESSION_NOT_FOUND");
        expect(error.message).toContain(ERRORS_EN.sessionNotFound);
        expect(logs.records).toEqual([
          { code: "SESSION_NOT_FOUND", entity: "session", entityId: missingId, locale: "en" },
        ]);
        expect(await countNotificationsFor(tx, [fixture.studentUserId, fixture.teacherUserId])).toBe(0);
        expect(transportSpy.publishCount).toBe(0);
      } finally {
        logs.stop();
      }
    });
  });

  test("corrupt stored intent (null) → ValidationError SESSION_INTENT_CORRUPT with EXACTLY ONE domain log", async () => {
    await runInRollback(async tx => {
      const fixture = await provisionWaveFixture(tx, { intent: SessionIntent.Tajweed });
      // `session.intent` is a native pgEnum: a non-member literal cannot be
      // stored at all — NULL is the only persistable corrupt state, and the
      // emitters must fail closed on it.
      await tx.update(session).set({ intent: null }).where(eq(session.id, fixture.sessionRow.id));
      const transportSpy = new SpiedFanoutTransport();
      const logs = recordDomainLogs();
      try {
        const error = await expectRepoError(() =>
          waveCaseByKind("outcome_queued").emit(fixture.sessionRow.id, "en", tx, {
            transport: transportSpy,
            cache: new MapBackedClaimCache(),
          })
        );
        if (!(error instanceof ValidationError)) {
          throw new Error(`expected ValidationError (got ${error.name}: ${error.message})`);
        }
        expect(error.code).toBe("SESSION_INTENT_CORRUPT");
        expect(error.message).toContain(ERRORS_EN.sessionIntentCorrupt);
        expect(logs.records).toEqual([
          { code: "SESSION_INTENT_CORRUPT", entity: "session", entityId: fixture.sessionRow.id, locale: "en" },
        ]);
        expect(await countNotificationsFor(tx, [fixture.studentUserId])).toBe(0);
        expect(transportSpy.publishCount).toBe(0);
      } finally {
        logs.stop();
      }
    });
  });

  test("hostile session id (0) → ValidationError VALIDATION with ZERO domain logs and ZERO rows", async () => {
    const transportSpy = new SpiedFanoutTransport();
    const logs = recordDomainLogs();
    try {
      const error = await expectRepoError(() =>
        waveCaseByKind("outcome_declined").emit(0, "en", undefined, {
          transport: transportSpy,
          cache: new MapBackedClaimCache(),
        })
      );
      if (!(error instanceof ValidationError)) {
        throw new Error(`expected ValidationError (got ${error.name}: ${error.message})`);
      }
      expect(error.code).toBe("VALIDATION");
      expect(error.message).toContain(ERRORS_EN.validation);
      // Pre-DB rejection is silent: the claim cache was never touched either.
      expect(logs.records).toEqual([]);
      expect(transportSpy.publishCount).toBe(0);
    } finally {
      logs.stop();
    }
  });
});

// ─── Tier 2: boundaries ─────────────────────────────────────────────────────

describe("Tier 2 — boundaries", () => {
  test("int4-ceiling session id is a valid shape but missing → SESSION_NOT_FOUND with ONE log", async () => {
    // The session primary key is int4, so `Number.MAX_SAFE_INTEGER` overflows
    // the column; the numeric ceiling of the column itself is the faithful
    // "valid shape, guaranteed missing" probe.
    const logs = recordDomainLogs();
    try {
      const error = await expectRepoError(() =>
        waveCaseByKind("teacher_request").emit(INT4_MAX_SESSION_ID, "en", undefined, {
          transport: new SpiedFanoutTransport(),
          cache: new MapBackedClaimCache(),
        })
      );
      if (!(error instanceof NotFoundError)) {
        throw new Error(`expected NotFoundError (got ${error.name}: ${error.message})`);
      }
      expect(error.code).toBe("SESSION_NOT_FOUND");
      expect(error.message).toContain(ERRORS_EN.sessionNotFound);
      expect(logs.records).toEqual([
        { code: "SESSION_NOT_FOUND", entity: "session", entityId: INT4_MAX_SESSION_ID, locale: "en" },
      ]);
    } finally {
      logs.stop();
    }
  });

  test("hostile session ids (0 / -1 / 1.5 / NaN / 2**53 / MIN_SAFE_INTEGER) reject with VALIDATION pre-DB", async () => {
    const logs = recordDomainLogs();
    try {
      const hostileIds = [0, -1, 1.5, Number.NaN, 2 ** 53, Number.MIN_SAFE_INTEGER] as const;
      const errors = await Promise.all(
        hostileIds.map(hostileId =>
          expectRepoError(() =>
            waveCaseByKind("outcome_accepted").emit(hostileId, "en", undefined, {
              transport: new SpiedFanoutTransport(),
              cache: new MapBackedClaimCache(),
            })
          )
        )
      );
      for (const [index, error] of errors.entries()) {
        if (!(error instanceof ValidationError)) {
          throw new Error(`expected ValidationError for id ${String(hostileIds[index])} (got ${error.name})`);
        }
        expect(error.code).toBe("VALIDATION");
        expect(error.message).toContain(ERRORS_EN.validation);
      }
      expect(logs.records).toEqual([]);
    } finally {
      logs.stop();
    }
  });

  test("null participant locale falls back to the default locale for BOTH wave directions", async () => {
    await runInRollback(async tx => {
      const fixture = await provisionWaveFixture(tx, {
        intent: SessionIntent.Tajweed,
        // Neither participant carries a persisted locale.
        studentName: `svc-nolocale-st-${randomUUID().slice(0, 8)}`,
        teacherName: `svc-nolocale-te-${randomUUID().slice(0, 8)}`,
      });
      const options = { transport: new SpiedFanoutTransport(), cache: new MapBackedClaimCache() };

      const teacherReceipt = await waveCaseByKind("teacher_request").emit(fixture.sessionRow.id, "en", tx, options);
      const teacherRow = firstReceiptRow(teacherReceipt);
      expect(teacherRow.title).toBe(NOTIFS_AR.eventSessionRequestTitle);
      expect(teacherRow.body).toBe(NOTIFS_AR.eventSessionRequestBody(fixture.studentName, NOTIFS_AR.intentTajweed));

      const studentReceipt = await waveCaseByKind("outcome_accepted").emit(fixture.sessionRow.id, "en", tx, options);
      const studentRow = firstReceiptRow(studentReceipt);
      expect(studentRow.title).toBe(NOTIFS_AR.eventSessionAcceptedTitle);
      expect(studentRow.body).toBe(NOTIFS_AR.eventSessionAcceptedBody(fixture.teacherName));
    });
  });

  test("hostile unicode/RTL/emoji participant names are composed VERBATIM into the copy", async () => {
    await runInRollback(async tx => {
      const hostileStudentName = `طالبة 🎓 ‎<script>alert(1)</script> s-${randomUUID().slice(0, 8)}`;
      const hostileTeacherName = `أستاذ \\o/ "quoted" 100% t-${randomUUID().slice(0, 8)}`;
      const fixture = await provisionWaveFixture(tx, {
        intent: SessionIntent.Evaluation,
        studentLocale: "en",
        teacherLocale: "ar",
        studentName: hostileStudentName,
        teacherName: hostileTeacherName,
      });
      const options = { transport: new SpiedFanoutTransport(), cache: new MapBackedClaimCache() };

      const teacherReceipt = await waveCaseByKind("teacher_request").emit(fixture.sessionRow.id, "en", tx, options);
      const teacherRow = firstReceiptRow(teacherReceipt);
      expect(teacherRow.body).toBe(NOTIFS_AR.eventSessionRequestBody(hostileStudentName, NOTIFS_AR.intentEvaluation));
      expect(teacherRow.body).toContain(hostileStudentName);

      const studentReceipt = await waveCaseByKind("outcome_declined").emit(fixture.sessionRow.id, "en", tx, options);
      const studentRow = firstReceiptRow(studentReceipt);
      expect(studentRow.body).toBe(NOTIFS_EN.eventSessionDeclinedBody(hostileTeacherName));
      expect(studentRow.body).toContain(hostileTeacherName);
    });
  });
});

// ─── Tier 3: chaos on the own-commit path (committed fixtures) ──────────────
// runInRollback can never prove own-commit semantics (durable row, stored
// claim receipt, internal publish), so this tier provisions its cast in ONE
// committing `beforeAll` transaction and hard-deletes it in FK-safe order.

/** Distinct wave kinds fired per storm session (1 request + 4 outcomes = 5 × 5 = 25). */
const STORM_WAVE_KINDS: readonly SessionRequestWaveKind[] = [
  "teacher_request",
  "outcome_accepted",
  "outcome_declined",
  "outcome_auto_rejected",
  "outcome_queued",
];

interface CommittedCast {
  readonly studentUserId: number;
  readonly studentName: string;
  readonly teacherUserId: number;
  readonly teacherName: string;
  /** 8 sessions: [0-4] storm · [5] replay · [6] cache-absent · [7] forced-failure. */
  readonly sessionIds: readonly number[];
}

let committedCast: CommittedCast | null = null;

/** Unwraps the committed cast, failing loudly if beforeAll did not run. */
function requireCast(cast: CommittedCast | null): CommittedCast {
  if (!cast) {
    throw new Error("expected the committed beforeAll cast to exist");
  }
  return cast;
}

beforeAll(async () => {
  committedCast = await db.transaction(async tx => {
    const studentUser = await createTestUser(tx, {
      locale: "en",
      fullName: `svc-storm-st-${randomUUID().slice(0, 8)}`,
    });
    await createTestStudent(tx, studentUser.id);
    const teacherUser = await createTestUser(tx, {
      role: "teacher",
      locale: "ar",
      fullName: `svc-storm-te-${randomUUID().slice(0, 8)}`,
    });
    await insertTestTeacher(tx, teacherUser.id, { requestPreference: TeacherRequestPreference.Queue });
    const intentCycle = [SessionIntent.Hifz, SessionIntent.Tajweed, SessionIntent.Evaluation];
    const insertedSessions = await tx
      .insert(session)
      .values(
        Array.from({ length: 8 }, (_, index) => {
          const intent = intentCycle[index % 3] ?? SessionIntent.Hifz;
          return { teacherId: teacherUser.id, studentId: studentUser.id, intent };
        })
      )
      .returning();
    const sessionIds = insertedSessions.map(row => row.id);
    return {
      studentUserId: studentUser.id,
      studentName: studentUser.fullName,
      teacherUserId: teacherUser.id,
      teacherName: teacherUser.fullName,
      sessionIds,
    };
  });
});

afterAll(async () => {
  const cast = committedCast;
  if (!cast) {
    return;
  }
  // FK-safe order: notifications (cascade-linked to users) → session (restrict
  // on the participants) → role-child rows → users.
  await db.delete(notifications).where(inArray(notifications.userId, [cast.studentUserId, cast.teacherUserId]));
  await db.delete(session).where(inArray(session.id, [...cast.sessionIds]));
  await db.delete(teacher).where(eq(teacher.id, cast.teacherUserId));
  await db.delete(students).where(eq(students.id, cast.studentUserId));
  await db.delete(users).where(inArray(users.id, [cast.studentUserId, cast.teacherUserId]));
});

describe("Tier 3 — chaos on the own-commit path (committed fixtures)", () => {
  test("25-way distinct-wave storm: all fulfill, exact final row-set, one publish per wave", async () => {
    const cast = requireCast(committedCast);
    const transportSpy = new SpiedFanoutTransport();
    const cache = new MapBackedClaimCache();
    const logs = recordDomainLogs();
    const rowsBefore = await notificationRowsFor([cast.studentUserId, cast.teacherUserId]);
    try {
      const stormCalls: Array<() => Promise<NotificationDeliveryReceipt>> = [];
      for (const stormSessionId of cast.sessionIds.slice(0, 5)) {
        for (const waveKind of STORM_WAVE_KINDS) {
          const waveCase = waveCaseByKind(waveKind);
          stormCalls.push(() => waveCase.emit(stormSessionId, "en", undefined, { transport: transportSpy, cache }));
        }
      }
      expect(stormCalls).toHaveLength(25);

      const results = await Promise.allSettled(stormCalls.map(call => call()));
      const receipts: NotificationDeliveryReceipt[] = [];
      for (const result of results) {
        expect(result.status).toBe("fulfilled");
        if (result.status === "fulfilled") {
          receipts.push(result.value);
        }
      }
      expect(receipts).toHaveLength(25);

      for (const receipt of receipts) {
        expect(receipt.notifications).toHaveLength(1);
        const row = firstReceiptRow(receipt);
        expect(row.type).toBe(NotificationType.SessionRequest);
        expect(row.relatedEntityType).toBe("session");
        if (row.relatedEntityId === null) {
          throw new Error("expected the wave row to carry the session entity pointer");
        }
        expect([...cast.sessionIds]).toContain(row.relatedEntityId);
        expect([cast.studentUserId, cast.teacherUserId]).toContain(row.userId);
        expect(row.isRead).toBe(false);
      }

      // Exact final row-set: the 25 receipt rows are precisely the new rows.
      const idsBefore = new Set(rowsBefore.map(row => row.id));
      const rowsAfter = await notificationRowsFor([cast.studentUserId, cast.teacherUserId]);
      expect(rowsAfter).toHaveLength(rowsBefore.length + 25);
      const newIds = rowsAfter.filter(row => !idsBefore.has(row.id)).map(row => row.id);
      expect(new Set(newIds)).toEqual(new Set(receipts.map(receipt => firstReceiptRow(receipt).id)));

      expect(transportSpy.publishCount).toBe(25);
      expect(new Set(cache.claimedKeys).size).toBe(25);
      expect(logs.records).toEqual([]);
    } finally {
      logs.stop();
    }
  });

  test("deterministic-key replay returns the prior receipt with ZERO new rows and ZERO new publishes", async () => {
    const cast = requireCast(committedCast);
    expect(cast.sessionIds).toHaveLength(8);
    const replaySessionId = cast.sessionIds[5];
    const transportSpy = new SpiedFanoutTransport();
    const cache = new MapBackedClaimCache();
    const options = { transport: transportSpy, cache };
    const before = await countNotificationsFor(db, [cast.studentUserId]);

    const first = await waveCaseByKind("outcome_accepted").emit(replaySessionId, "en", undefined, options);
    const firstRow = firstReceiptRow(first);
    expect(await countNotificationsFor(db, [cast.studentUserId])).toBe(before + 1);
    expect(transportSpy.publishCount).toBe(1);

    const replayed = await waveCaseByKind("outcome_accepted").emit(replaySessionId, "en", undefined, options);
    expect(firstReceiptRow(replayed).id).toBe(firstRow.id);
    expect(replayed.recipientUserIds).toEqual([cast.studentUserId]);

    // The replay produced nothing new: no row, no publish, no drift.
    expect(await countNotificationsFor(db, [cast.studentUserId])).toBe(before + 1);
    expect(transportSpy.publishCount).toBe(1);
    expect(cache.claimedKeys).toHaveLength(2);
  });
});

describe("Tier 3 — degradation + rollback purity", () => {
  test("cache-absent keyed wave fails OPEN: row lands, EXACTLY ONE engine NOTIFICATION_IDEMPOTENCY_DEGRADED warn", async () => {
    const cast = requireCast(committedCast);
    expect(cast.sessionIds).toHaveLength(8);
    const failOpenSessionId = cast.sessionIds[6];
    const transportSpy = new SpiedFanoutTransport();
    const logs = recordDomainLogs();
    const before = await countNotificationsFor(db, [cast.studentUserId]);
    try {
      const receipt = await waveCaseByKind("outcome_queued").emit(failOpenSessionId, "en", undefined, {
        transport: transportSpy,
      });
      expect(receipt.notifications).toHaveLength(1);
      expect(receipt.recipientUserIds).toEqual([cast.studentUserId]);
      expect(await countNotificationsFor(db, [cast.studentUserId])).toBe(before + 1);
      expect(transportSpy.publishCount).toBe(1);
      // Exactly one log total, and it is the engine's fail-open warn.
      expect(logs.records).toEqual([
        { code: "NOTIFICATION_IDEMPOTENCY_DEGRADED", entity: "notifications", entityId: undefined, locale: undefined },
      ]);
    } finally {
      logs.stop();
    }
  });

  test("forced mid-tx failure rolls the row back and NEVER publishes — ghost pushes are impossible", async () => {
    const cast = requireCast(committedCast);
    expect(cast.sessionIds).toHaveLength(8);
    const rollbackSessionId = cast.sessionIds[7];
    const transportSpy = new SpiedFanoutTransport();
    const before = await countNotificationsFor(db, [cast.teacherUserId]);

    const error = await expectRepoError(() =>
      db.transaction(async tx => {
        const receipt = await waveCaseByKind("teacher_request").emit(rollbackSessionId, "en", tx, {
          transport: transportSpy,
          cache: new MapBackedClaimCache(),
        });
        // Inside the caller's transaction: the row exists and nothing published.
        expect(receipt.notifications).toHaveLength(1);
        expect(await countNotificationsFor(tx, [cast.teacherUserId])).toBe(before + 1);
        expect(transportSpy.publishCount).toBe(0);
        throw new Error("forced mid-tx failure after the wave rode the caller transaction");
      })
    );

    expect(error.message).toContain("forced mid-tx failure");
    expect(await countNotificationsFor(db, [cast.teacherUserId])).toBe(before);
    expect(transportSpy.publishCount).toBe(0);
  });

  test("caller-tx path rejects an engine contract breach (bare row) as a typed internal error", async () => {
    await runInRollback(async tx => {
      const fixture = await provisionWaveFixture(tx, { intent: SessionIntent.Hifz });
      const bareRow: NotificationReturnType = {
        id: 1,
        userId: fixture.teacherUserId,
        type: NotificationType.SessionRequest,
        title: "engine-breach probe",
        body: null,
        isRead: false,
        relatedEntityType: null,
        relatedEntityId: null,
        createdAt: new Date(0),
      };
      const engineSpy = spyOn(NotificationEngine, "emitForUser").mockResolvedValue(bareRow);
      try {
        const error = await expectRepoError(() =>
          waveCaseByKind("teacher_request").emit(fixture.sessionRow.id, "en", tx, {
            transport: new SpiedFanoutTransport(),
            cache: new MapBackedClaimCache(),
          })
        );
        if (!(error instanceof DomainError)) {
          throw new Error(`expected DomainError (got ${error.name}: ${error.message})`);
        }
        expect(error.code).toBe("INTERNAL_SERVER_ERROR");
        expect(engineSpy).toHaveBeenCalledTimes(1);
      } finally {
        engineSpy.mockRestore();
      }
    });
  });
});

// ─── Tier 4: security ───────────────────────────────────────────────────────

describe("Tier 4 — security", () => {
  test("hostile-id fuzz: the repository is NEVER called before a pre-DB validation rejection", async () => {
    const repoSpy = spyOn(SessionRepository, "findWaveContextById");
    const logs = recordDomainLogs();
    try {
      const hostileIds = [0, -1, 1.5, Number.NaN, 2 ** 53, Number.MIN_SAFE_INTEGER, Number.POSITIVE_INFINITY] as const;
      const errors = await Promise.all(
        hostileIds.map(hostileId =>
          expectRepoError(() =>
            waveCaseByKind("outcome_declined").emit(hostileId, "en", undefined, {
              transport: new SpiedFanoutTransport(),
              cache: new MapBackedClaimCache(),
            })
          )
        )
      );
      for (const [index, error] of errors.entries()) {
        if (!(error instanceof ValidationError)) {
          throw new Error(`expected ValidationError for id ${String(hostileIds[index])} (got ${error.name})`);
        }
        expect(error.code).toBe("VALIDATION");
      }
      // Validation strictly precedes persistence reads — zero calls for ALL probes.
      expect(repoSpy).toHaveBeenCalledTimes(0);
      expect(logs.records).toEqual([]);
    } finally {
      repoSpy.mockRestore();
      logs.stop();
    }
  });

  test("derived-recipient invariance: recipients come ONLY from the joined read (two participant pairs)", async () => {
    await runInRollback(async tx => {
      const first = await provisionWaveFixture(tx, { intent: SessionIntent.Hifz, studentLocale: "en" });
      const second = await provisionWaveFixture(tx, { intent: SessionIntent.Tajweed, studentLocale: "en" });

      // Teacher-direction waves target each pair's OWN teacher.
      const firstTeacherRow = firstReceiptRow(
        await waveCaseByKind("teacher_request").emit(first.sessionRow.id, "en", tx, {
          transport: new SpiedFanoutTransport(),
          cache: new MapBackedClaimCache(),
        })
      );
      const secondTeacherRow = firstReceiptRow(
        await waveCaseByKind("teacher_request").emit(second.sessionRow.id, "en", tx, {
          transport: new SpiedFanoutTransport(),
          cache: new MapBackedClaimCache(),
        })
      );
      expect(firstTeacherRow.userId).toBe(first.teacherUserId);
      expect(secondTeacherRow.userId).toBe(second.teacherUserId);
      expect(firstTeacherRow.userId).not.toBe(second.teacherUserId);
      expect(firstTeacherRow.relatedEntityId).toBe(first.sessionRow.id);
      expect(secondTeacherRow.relatedEntityId).toBe(second.sessionRow.id);

      // Student-direction waves target each pair's OWN student.
      const firstStudentRow = firstReceiptRow(
        await waveCaseByKind("outcome_auto_rejected").emit(first.sessionRow.id, "en", tx, {
          transport: new SpiedFanoutTransport(),
          cache: new MapBackedClaimCache(),
        })
      );
      const secondStudentRow = firstReceiptRow(
        await waveCaseByKind("outcome_auto_rejected").emit(second.sessionRow.id, "en", tx, {
          transport: new SpiedFanoutTransport(),
          cache: new MapBackedClaimCache(),
        })
      );
      expect(firstStudentRow.userId).toBe(first.studentUserId);
      expect(secondStudentRow.userId).toBe(second.studentUserId);
      expect(firstStudentRow.userId).not.toBe(second.studentUserId);

      // No wave can be redirected to the OTHER pair in either direction.
      expect(await countNotificationsFor(tx, [first.teacherUserId, first.studentUserId])).toBe(2);
      expect(await countNotificationsFor(tx, [second.teacherUserId, second.studentUserId])).toBe(2);
    });
  });
});
