/**
 * Cross-actor journey — session-request notification waves (session intake →
 * teacher request wave → student outcome waves → isolation invariance →
 * denial probes → zero-residue teardown).
 *
 * Exercises the shipped `SessionRequestNotificationService` emitters end to end
 * on the own-commit path (no caller transaction).
 *
 * Journey rules honored (`test/workflows/AGENTS.md`):
 * - fixtures COMMITTED in `beforeAll` inside ONE committing transaction and
 *   hard-deleted in `afterAll` via `TrackedFixtures` with post-teardown
 *   existence checks (zero residue); never `runInRollback`;
 * - actor cast = real `users` rows + real role-child rows: students through
 *   `createTestUser`/`createTestStudent`; teacher rows (incl. the
 *   `requestPreference` variants the actor-context factory cannot express and
 *   per-user `users.locale` pinning) via DIRECT Drizzle inserts in the same
 *   committing transaction — both tracked in `TrackedFixtures`;
 * - external effects intercepted at the injection seam: `SpiedFanoutTransport`
 *   + a suite-local Map-backed `NotificationIdempotencyClaimCache` passed
 *   through the emitters' `options` param — no Redis, no WebSocket, ever;
 * - error assertions through `catchJourneyError` + translated substrings from
 *   `getServerTranslations(...)` — never `.rejects.toThrow()`;
 * - cross-actor visibility asserted BOTH directions: recipients see their own
 *   rows; isolation actors (X/Y) and named counterparties (U/V/W) observe
 *   zero rows and zero envelopes addressed to them.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { notifications } from "@/backend/db/schema/notifications";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { TeacherRequestPreference } from "@/backend/enum/teachers/teacher-request-preference.enum";
import { NotFoundError, ValidationError } from "@/backend/lib/errors";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import { SessionRequestNotificationService } from "@/backend/services";
import type { NotificationEngineCallOptions } from "@/backend/services/notifications";
import {
  buildEmitClaimKey,
  type NotificationIdempotencyClaimCache,
} from "@/backend/services/notifications/emit-idempotency";
import type {
  DBTransaction,
  NotificationDeliveryReceipt,
  NotificationReturnType,
  SessionSelectType,
  TeacherSelectType,
  UserSelectType,
} from "@/backend/types";
import type { AppLocale } from "@/shared/locale";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  catchJourneyError,
  type JourneyActor,
  provisionCertifiedTeacherActor,
  provisionStudentActor,
  SpiedFanoutTransport,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/** Per-run unique prefix embedded in every fixture identity field. */
const RUN_PREFIX = `jrn_sessreq_${randomUUID().slice(0, 8)}`;

/** Polymorphic entity pointer every wave row must carry. */
const RELATED_ENTITY_TYPE = "session";

/** Session id far beyond any identity sequence — guaranteed absent. */
const ABSENT_SESSION_ID = 2_000_000_000;

/** English translated error copy — denial assertions pin translated substrings. */
const ERRORS_EN = getServerTranslations("en").errorsTranslations;
/** English notification copy — student outcome waves compose in the student's locale. */
const NOTIFS_EN = getServerTranslations("en").notificationsTranslations;
/** Arabic notification copy — the teacher request wave composes in the teacher's locale. */
const NOTIFS_AR = getServerTranslations("ar").notificationsTranslations;

/** One recorded domain-log call (code + entity only — copy never asserted from logs). */
interface DomainLogRecord {
  readonly code: string;
  readonly entity: string;
}

/**
 * Map-backed claim-cache double implementing SET-NX-EX semantics in memory:
 * the first `claim` for a key wins, replays report held, and `store` attaches
 * the serialized receipt a replay reads back. `claimedKeys` records every raw
 * claim key the engine attempted so the journey can pin key determinism and
 * per-wave distinctness.
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

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }

  async store(key: string, value: string, _ttlSeconds: number): Promise<void> {
    this.entries.set(key, value);
  }
}

/**
 * Installs a recording stub over `logger.logDomainError` so domain rejections
 * stay silent in test output AND become assertable. Callers MUST `stop()`
 * (use try/finally).
 */
function recordDomainLogs(): { records: DomainLogRecord[]; stop: () => void } {
  const records: DomainLogRecord[] = [];
  const spy = spyOn(logger, "logDomainError").mockImplementation((_message: string, ctx?: DomainErrorContext) => {
    records.push({ code: ctx?.code ?? "<missing>", entity: ctx?.entity ?? "<missing>" });
  });
  return { records, stop: () => spy.mockRestore() };
}

/** Independent read-back oracle — direct Drizzle count on the inbox. */
async function inboxCount(userId: number): Promise<number> {
  return db.$count(notifications, eq(notifications.userId, userId));
}

/** First row of a wave receipt — throws when the receipt is unexpectedly empty. */
function firstReceiptRow(receipt: NotificationDeliveryReceipt): NotificationReturnType {
  const row = receipt.notifications.at(0);
  if (!row) {
    throw new Error("expected the wave receipt to carry exactly one notification row");
  }
  return row;
}

/** Inputs for one directly-inserted teacher cast member. */
interface TeacherCastInput {
  readonly fullName: string;
  readonly locale: AppLocale;
  readonly requestPreference: TeacherRequestPreference;
}

/** A teacher cast member: the `users` row plus its `teacher` role-child row. */
interface TeacherCastRow {
  readonly user: UserSelectType;
  readonly teacherRow: TeacherSelectType;
}

/**
 * Provisions a teacher actor the actor-context factory cannot express
 * (per-user `users.locale` pinning and `requestPreference` variants): a real
 * `users` row via `createTestUser` plus a DIRECT `teacher` insert in the same
 * transaction. Both rows are registered for tracked teardown.
 */
async function insertTeacherCastRow(
  tx: DBTransaction,
  tracked: TrackedFixtures,
  input: TeacherCastInput
): Promise<TeacherCastRow> {
  const user = await createTestUser(tx, {
    role: "teacher",
    locale: input.locale,
    fullName: input.fullName,
  });
  const [teacherRow] = await tx
    .insert(teacher)
    .values({ id: user.id, isApproved: true, requestPreference: input.requestPreference })
    .returning();
  if (!teacherRow) {
    throw new Error("journey fixture: teacher insert returned no rows");
  }
  tracked.register(users, user.id);
  tracked.register(teacher, teacherRow.id);
  return { user, teacherRow };
}

/**
 * Commits one session row for a (student, teacher) pair — the production
 * intake path does not exist yet, so the row is a DIRECT fixture insert (the
 * sanctioned fixture-level pattern), registered for tracked teardown.
 */
async function insertSessionRow(
  tx: DBTransaction,
  tracked: TrackedFixtures,
  studentId: number,
  teacherId: number,
  intent: SessionIntent
): Promise<SessionSelectType> {
  const [row] = await tx.insert(session).values({ teacherId, studentId, intent }).returning();
  if (!row) {
    throw new Error("journey fixture: session insert returned no rows");
  }
  tracked.register(session, row.id);
  return row;
}

describe("cross-actor journey: session-request notification waves", () => {
  const tracked = new TrackedFixtures();
  const transportSpy = new SpiedFanoutTransport();
  const claimCache = new MapBackedClaimCache();
  const engineOptions: NotificationEngineCallOptions = { transport: transportSpy, cache: claimCache };

  // Error-copy locale for every emitter call; recipient copy locale is derived
  // from the persisted row, never from this argument.
  const CALLER_LOCALE = "en";

  let studentUser: UserSelectType;
  let teacherT: TeacherCastRow;
  let teacherU: TeacherCastRow;
  let teacherV: TeacherCastRow;
  let teacherW: TeacherCastRow;
  let observerX: JourneyActor;
  let observerY: JourneyActor;
  let sessionST: SessionSelectType;
  let sessionSU: SessionSelectType;
  let sessionSV: SessionSelectType;
  let sessionSW: SessionSelectType;
  let sessionCorrupt: SessionSelectType;
  let teacherWaveRowId: number;
  let acceptedWaveRowId: number;

  beforeAll(async () => {
    // ONE committing transaction: commit-or-nothing fixture provisioning.
    await db.transaction(async tx => {
      const sUser = await createTestUser(tx, {
        role: "student",
        locale: "en",
        fullName: `${RUN_PREFIX} student`,
      });
      const studentRow = await createTestStudent(tx, sUser.id);
      tracked.register(users, sUser.id);
      tracked.register(students, studentRow.id);
      studentUser = sUser;

      teacherT = await insertTeacherCastRow(tx, tracked, {
        fullName: `${RUN_PREFIX} teacher T`,
        locale: "ar",
        requestPreference: TeacherRequestPreference.Queue,
      });
      teacherU = await insertTeacherCastRow(tx, tracked, {
        fullName: `${RUN_PREFIX} teacher U`,
        locale: "en",
        requestPreference: TeacherRequestPreference.Reject,
      });
      teacherV = await insertTeacherCastRow(tx, tracked, {
        fullName: `${RUN_PREFIX} teacher V`,
        locale: "en",
        requestPreference: TeacherRequestPreference.Queue,
      });
      teacherW = await insertTeacherCastRow(tx, tracked, {
        fullName: `${RUN_PREFIX} teacher W`,
        locale: "en",
        requestPreference: TeacherRequestPreference.OfferAlternatives,
      });

      observerX = await provisionStudentActor(tx, { tracked });
      observerY = await provisionCertifiedTeacherActor(tx, { tracked });

      sessionST = await insertSessionRow(tx, tracked, studentUser.id, teacherT.user.id, SessionIntent.Hifz);
      sessionSU = await insertSessionRow(tx, tracked, studentUser.id, teacherU.user.id, SessionIntent.Tajweed);
      sessionSV = await insertSessionRow(tx, tracked, studentUser.id, teacherV.user.id, SessionIntent.Evaluation);
      sessionSW = await insertSessionRow(tx, tracked, studentUser.id, teacherW.user.id, SessionIntent.Hifz);
      sessionCorrupt = await insertSessionRow(tx, tracked, studentUser.id, teacherT.user.id, SessionIntent.Tajweed);
    });
  });

  afterAll(async () => {
    // Reverse-registration-order hard delete + zero-residue re-probes for
    // EVERY tracked row (a leaking teardown fails the suite loudly).
    await tracked.cleanup();
  });

  test("step 1 — System: cast committed; every actor inbox empty and zero publishes", async () => {
    const actorIds = [
      studentUser.id,
      teacherT.user.id,
      teacherU.user.id,
      teacherV.user.id,
      teacherW.user.id,
      observerX.userId,
      observerY.userId,
    ];
    const counts = await Promise.all(actorIds.map(id => inboxCount(id)));
    for (const count of counts) {
      expect(count).toBe(0);
    }
    expect(transportSpy.publishCount).toBe(0);
    // 7 users + 7 role-child rows (2 students + 5 teachers) + 5 sessions.
    expect(tracked.size).toBe(19);
  });

  test("step 2 — teacher wave: ONE Arabic session_request row for T, ONE publish to T only", async () => {
    const receipt = await SessionRequestNotificationService.notifyTeacherOfSessionRequest(
      sessionST.id,
      CALLER_LOCALE,
      undefined,
      engineOptions
    );

    const row = firstReceiptRow(receipt);
    teacherWaveRowId = row.id;
    tracked.register(notifications, row.id);

    expect(receipt.recipientUserIds).toEqual([teacherT.user.id]);
    expect(row.userId).toBe(teacherT.user.id);
    expect(row.type).toBe(NotificationType.SessionRequest);
    expect(row.relatedEntityType).toBe(RELATED_ENTITY_TYPE);
    expect(row.relatedEntityId).toBe(sessionST.id);
    expect(row.isRead).toBe(false);

    // Copy composed in T's persisted locale (Arabic), carrying S's name and
    // the Arabic intent label — asserted as recomposed translation output.
    expect(row.title).toBe(NOTIFS_AR.eventSessionRequestTitle);
    expect(row.body).toBe(NOTIFS_AR.eventSessionRequestBody(studentUser.fullName, NOTIFS_AR.intentHifz));
    if (row.body === null) {
      throw new Error("expected the teacher wave body to be non-null");
    }
    expect(row.body).toContain(studentUser.fullName);

    // Shared state re-read: exactly one row, owned by T.
    expect(await inboxCount(teacherT.user.id)).toBe(1);
    expect(await inboxCount(studentUser.id)).toBe(0);

    // Exactly ONE publish envelope, addressed to T only.
    expect(transportSpy.publishCount).toBe(1);
    const publish = transportSpy.lastCall;
    if (!publish) {
      throw new Error("expected the spied transport to record the teacher-wave publish");
    }
    expect(publish.userIds).toEqual([teacherT.user.id]);
    expect(transportSpy.publishedUserIds).toEqual([teacherT.user.id]);
  });

  test("step 3 — replay under the held claim key: prior receipt returned, zero new rows/publishes", async () => {
    const replayed = await SessionRequestNotificationService.notifyTeacherOfSessionRequest(
      sessionST.id,
      CALLER_LOCALE,
      undefined,
      engineOptions
    );

    const replayedRow = firstReceiptRow(replayed);
    expect(replayedRow.id).toBe(teacherWaveRowId);
    expect(replayed.recipientUserIds).toEqual([teacherT.user.id]);

    // The replay produced nothing new: inbox and publish counts are unchanged.
    expect(await inboxCount(teacherT.user.id)).toBe(1);
    expect(transportSpy.publishCount).toBe(1);
  });

  test("step 4 — accept wave: ONE English row for S naming T; T's inbox unchanged", async () => {
    const publishesBefore = transportSpy.publishCount;

    const receipt = await SessionRequestNotificationService.notifyStudentOfSessionAccepted(
      sessionST.id,
      CALLER_LOCALE,
      undefined,
      engineOptions
    );

    const row = firstReceiptRow(receipt);
    acceptedWaveRowId = row.id;
    tracked.register(notifications, row.id);

    expect(receipt.recipientUserIds).toEqual([studentUser.id]);
    expect(row.userId).toBe(studentUser.id);
    expect(row.type).toBe(NotificationType.SessionRequest);
    expect(row.relatedEntityType).toBe(RELATED_ENTITY_TYPE);
    expect(row.relatedEntityId).toBe(sessionST.id);
    expect(row.isRead).toBe(false);
    expect(row.title).toBe(NOTIFS_EN.eventSessionAcceptedTitle);
    expect(row.body).toBe(NOTIFS_EN.eventSessionAcceptedBody(teacherT.user.fullName));

    // T observes nothing: his inbox stays at the single request-wave row.
    expect(await inboxCount(studentUser.id)).toBe(1);
    expect(await inboxCount(teacherT.user.id)).toBe(1);

    // Exactly one new publish, addressed to S only.
    expect(transportSpy.publishCount).toBe(publishesBefore + 1);
    const publish = transportSpy.lastCall;
    if (!publish) {
      throw new Error("expected the spied transport to record the accept-wave publish");
    }
    expect(publish.userIds).toEqual([studentUser.id]);
  });

  test("step 5 — decline wave: a SECOND, distinct English row for S (append-only, never overwrite)", async () => {
    const publishesBefore = transportSpy.publishCount;

    const receipt = await SessionRequestNotificationService.notifyStudentOfSessionDeclined(
      sessionST.id,
      CALLER_LOCALE,
      undefined,
      engineOptions
    );

    const row = firstReceiptRow(receipt);
    tracked.register(notifications, row.id);

    expect(row.userId).toBe(studentUser.id);
    expect(row.id).not.toBe(acceptedWaveRowId);
    expect(row.title).toBe(NOTIFS_EN.eventSessionDeclinedTitle);
    expect(row.body).toBe(NOTIFS_EN.eventSessionDeclinedBody(teacherT.user.fullName));
    expect(row.relatedEntityId).toBe(sessionST.id);
    expect(row.isRead).toBe(false);

    // Append-only: the decline row is a NEW row, not an overwrite of accept.
    const studentRowIds = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.userId, studentUser.id));
    expect(studentRowIds).toHaveLength(2);
    expect(studentRowIds.map(entry => entry.id)).not.toContain(teacherWaveRowId);
    expect(new Set(studentRowIds.map(entry => entry.id)).size).toBe(2);

    // Teacher inbox untouched by either outcome wave.
    expect(await inboxCount(teacherT.user.id)).toBe(1);
    expect(transportSpy.publishCount).toBe(publishesBefore + 1);
    const publish = transportSpy.lastCall;
    if (!publish) {
      throw new Error("expected the spied transport to record the decline-wave publish");
    }
    expect(publish.userIds).toEqual([studentUser.id]);
  });

  test("step 6 — three preference waves: S gains one row per wave naming U/V/W, under three distinct keys", async () => {
    const publishesBefore = transportSpy.publishCount;

    const rejected = await SessionRequestNotificationService.notifyStudentOfSessionAutoRejected(
      sessionSU.id,
      CALLER_LOCALE,
      undefined,
      engineOptions
    );
    const queued = await SessionRequestNotificationService.notifyStudentOfSessionQueued(
      sessionSV.id,
      CALLER_LOCALE,
      undefined,
      engineOptions
    );
    const offered = await SessionRequestNotificationService.notifyStudentOfAlternativesOffered(
      sessionSW.id,
      CALLER_LOCALE,
      undefined,
      engineOptions
    );

    const rejectedRow = firstReceiptRow(rejected);
    const queuedRow = firstReceiptRow(queued);
    const offeredRow = firstReceiptRow(offered);
    tracked.register(notifications, rejectedRow.id);
    tracked.register(notifications, queuedRow.id);
    tracked.register(notifications, offeredRow.id);

    // Each copy names the CORRECT counterparty for its own session row.
    expect(rejectedRow.title).toBe(NOTIFS_EN.eventSessionAutoRejectedTitle);
    expect(rejectedRow.body).toBe(NOTIFS_EN.eventSessionAutoRejectedBody(teacherU.user.fullName));
    expect(rejectedRow.relatedEntityId).toBe(sessionSU.id);
    expect(queuedRow.title).toBe(NOTIFS_EN.eventSessionQueuedTitle);
    expect(queuedRow.body).toBe(NOTIFS_EN.eventSessionQueuedBody(teacherV.user.fullName));
    expect(queuedRow.relatedEntityId).toBe(sessionSV.id);
    expect(offeredRow.title).toBe(NOTIFS_EN.eventSessionAlternativesOfferedTitle);
    expect(offeredRow.body).toBe(NOTIFS_EN.eventSessionAlternativesOfferedBody(teacherW.user.fullName));
    expect(offeredRow.relatedEntityId).toBe(sessionSW.id);

    // S now has EXACTLY the two S↔T outcome rows plus the three wave rows.
    expect(await inboxCount(studentUser.id)).toBe(5);

    // Each wave published once, to S only (3 new envelopes).
    expect(transportSpy.publishCount).toBe(publishesBefore + 3);
    for (const publish of transportSpy.calls.slice(publishesBefore)) {
      expect(publish.userIds).toEqual([studentUser.id]);
    }

    // Deterministic per-(session, wave) claim keys — six distinct keys total.
    const expectedKeys = new Set([
      buildEmitClaimKey([teacherT.user.id], NotificationType.SessionRequest, `session:${sessionST.id}:teacher_request`),
      buildEmitClaimKey([studentUser.id], NotificationType.SessionRequest, `session:${sessionST.id}:outcome_accepted`),
      buildEmitClaimKey([studentUser.id], NotificationType.SessionRequest, `session:${sessionST.id}:outcome_declined`),
      buildEmitClaimKey(
        [studentUser.id],
        NotificationType.SessionRequest,
        `session:${sessionSU.id}:outcome_auto_rejected`
      ),
      buildEmitClaimKey([studentUser.id], NotificationType.SessionRequest, `session:${sessionSV.id}:outcome_queued`),
      buildEmitClaimKey(
        [studentUser.id],
        NotificationType.SessionRequest,
        `session:${sessionSW.id}:outcome_alternatives_offered`
      ),
    ]);
    expect(new Set(claimCache.claimedKeys)).toEqual(expectedKeys);
  });

  test("step 7 — isolation invariance: X/Y hold zero rows; no envelope ever addressed to a non-participant", async () => {
    expect(await inboxCount(observerX.userId)).toBe(0);
    expect(await inboxCount(observerY.userId)).toBe(0);
    // The named counterparties are copy context only — they receive nothing.
    expect(await inboxCount(teacherU.user.id)).toBe(0);
    expect(await inboxCount(teacherV.user.id)).toBe(0);
    expect(await inboxCount(teacherW.user.id)).toBe(0);

    // Every envelope ever published was addressed to a wave participant only.
    const addressees = new Set(transportSpy.publishedUserIds);
    expect(addressees.has(observerX.userId)).toBe(false);
    expect(addressees.has(observerY.userId)).toBe(false);
    expect(addressees.has(teacherU.user.id)).toBe(false);
    expect(addressees.has(teacherV.user.id)).toBe(false);
    expect(addressees.has(teacherW.user.id)).toBe(false);
    expect([...addressees].toSorted((a, b) => a - b)).toEqual(
      [studentUser.id, teacherT.user.id].toSorted((a, b) => a - b)
    );
  });

  test("step 8a — denial probes: missing id → SESSION_NOT_FOUND with ONE domain log, zero rows/publishes", async () => {
    const logs = recordDomainLogs();
    const publishesBefore = transportSpy.publishCount;
    const teacherInboxBefore = await inboxCount(teacherT.user.id);
    const studentInboxBefore = await inboxCount(studentUser.id);
    try {
      const missingError = await catchJourneyError(() =>
        SessionRequestNotificationService.notifyTeacherOfSessionRequest(
          ABSENT_SESSION_ID,
          CALLER_LOCALE,
          undefined,
          engineOptions
        )
      );
      if (!(missingError instanceof NotFoundError)) {
        throw new Error(`expected NotFoundError (got ${missingError.name}: ${missingError.message})`);
      }
      expect(missingError.code).toBe("SESSION_NOT_FOUND");
      expect(missingError.message).toContain(ERRORS_EN.sessionNotFound);
      expect(logs.records).toEqual([{ code: "SESSION_NOT_FOUND", entity: "session" }]);

      // Hostile ids are rejected pre-DB with VALIDATION and produce NO log.
      logs.records.length = 0;
      const zeroError = await catchJourneyError(() =>
        SessionRequestNotificationService.notifyStudentOfSessionAccepted(0, CALLER_LOCALE, undefined, engineOptions)
      );
      const negativeError = await catchJourneyError(() =>
        SessionRequestNotificationService.notifyStudentOfSessionAccepted(-1, CALLER_LOCALE, undefined, engineOptions)
      );
      const nanError = await catchJourneyError(() =>
        SessionRequestNotificationService.notifyTeacherOfSessionRequest(
          Number.NaN,
          CALLER_LOCALE,
          undefined,
          engineOptions
        )
      );
      for (const hostileError of [zeroError, negativeError, nanError]) {
        if (!(hostileError instanceof ValidationError)) {
          throw new Error(`expected ValidationError (got ${hostileError.name}: ${hostileError.message})`);
        }
        expect(hostileError.code).toBe("VALIDATION");
        expect(hostileError.message).toContain(ERRORS_EN.validation);
      }
      expect(logs.records).toEqual([]);
    } finally {
      logs.stop();
    }

    expect(await inboxCount(teacherT.user.id)).toBe(teacherInboxBefore);
    expect(await inboxCount(studentUser.id)).toBe(studentInboxBefore);
    expect(transportSpy.publishCount).toBe(publishesBefore);
  });

  test("step 8b — denial probe: corrupt stored intent fails closed with SESSION_INTENT_CORRUPT, zero rows/publishes", async () => {
    // Corrupt the fixture row's intent directly: `session.intent` is a native
    // pgEnum, so a non-member value cannot be stored at all — NULL is the only
    // persistable corrupt state, and the emitters must fail closed on it.
    await db.update(session).set({ intent: null }).where(eq(session.id, sessionCorrupt.id));

    const logs = recordDomainLogs();
    const publishesBefore = transportSpy.publishCount;
    const studentInboxBefore = await inboxCount(studentUser.id);
    try {
      const corruptError = await catchJourneyError(() =>
        SessionRequestNotificationService.notifyStudentOfSessionQueued(
          sessionCorrupt.id,
          CALLER_LOCALE,
          undefined,
          engineOptions
        )
      );
      if (!(corruptError instanceof ValidationError)) {
        throw new Error(`expected ValidationError (got ${corruptError.name}: ${corruptError.message})`);
      }
      expect(corruptError.code).toBe("SESSION_INTENT_CORRUPT");
      expect(corruptError.message).toContain(ERRORS_EN.sessionIntentCorrupt);
      expect(logs.records).toEqual([{ code: "SESSION_INTENT_CORRUPT", entity: "session" }]);
    } finally {
      logs.stop();
    }

    expect(await inboxCount(studentUser.id)).toBe(studentInboxBefore);
    expect(transportSpy.publishCount).toBe(publishesBefore);
  });
});
