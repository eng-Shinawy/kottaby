/**
 * Cross-actor journey — the consolidated parent full journey: registration →
 * handshake discovery → link request/confirm → expiry leg → session
 * booking/completion/report → parent monitoring portal → tenancy denial
 * probes → read-only enforcement probes.
 *
 * Sequential, actor-attributed steps run against REAL services on the REAL
 * test database; later steps observe the shared state earlier steps
 * committed. Cast: Parent P, Student S1 (P's linked child), Student S2
 * (control tenant of the expiry leg), Parent P2 (foreign parent), and
 * certified Teacher T.
 *
 * P and S1 are registered through the REAL RegistrationService (real
 * `users` + role-child rows, committed); S1 is provisioned with a trial-lane
 * balance so the booking leg runs the real debit ladder. S2, P2, and T are
 * provisioned in ONE committing transaction as real users rows plus real
 * role-child rows.
 *
 * Notification boundary: the fan-out transport is SPIED at the injected
 * `options.transport` seam for the flows that accept engine options; the
 * flows that publish without an injection seam are intercepted with a
 * recording no-op over the engine's publish contract. Nothing ever reaches
 * a real channel. Denials resolve through the REAL actor re-check — never
 * monkey-patched.
 *
 * Harness: the shared helpers at `test/workflows/helpers/` (TrackedFixtures,
 * SpiedFanoutTransport, createJourneyCast, actor-context provisioning) are
 * REUSED — no helper is created or modified here. No `runInRollback`
 * anywhere: services spawn their own top-level transactions. Committed
 * fixtures are hard-deleted in `afterAll` in FK-safe order with mandatory
 * zero-residue re-probes; fixture identity fields carry the per-run
 * `jrn_parentfull_<uuid8>` prefix.
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/parents/parent-full-journey.journey.test.ts
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/backend/db";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { reports } from "@/backend/db/schema/classes/reports";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parentLinkRequests } from "@/backend/db/schema/parents/parent-link-requests";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { LinkStatus } from "@/backend/enum/shared/link-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import * as SessionReportService from "@/backend/services/classes/session-report.service";
import { NotificationEngine, type NotificationEngineCallOptions } from "@/backend/services/notifications";
import {
  buildEmitClaimKey,
  type NotificationIdempotencyClaimCache,
} from "@/backend/services/notifications/emit-idempotency";
import { ParentLinkRequestService } from "@/backend/services/parents/parent-link-request.service";
import { ParentMonitoringService } from "@/backend/services/parents/parent-monitoring.service";
import { StudentHandshakeService } from "@/backend/services/students/student-handshake.service";
import type { DBTransaction, HomeWorkBlockInput, SessionReturnType, UserSelectType } from "@/backend/types";
import { PARENT_LINK_REQUEST_MS, PARENT_LINK_REQUEST_TTL_DAYS } from "@/shared/constants/parent-link-request.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  catchJourneyError,
  createJourneyCast,
  type JourneyActor,
  type JourneyCastType,
  type ParentActorType,
  provisionCertifiedTeacherActor,
  provisionParentActor,
  provisionStudentActor,
  SpiedFanoutTransport,
  type StudentActorType,
  TrackedFixtures,
} from "@/test/workflows/helpers";

const LOCALE = "en";

/** Translated error copy source — never hardcoded English expectation strings (layer rule 6). */
const ERRORS_EN = getServerTranslations(LOCALE).errorsTranslations;

/** English notification copy — the report-wave composition oracle for the en-locale cast. */
const NOTIFS_EN = getServerTranslations(LOCALE).notificationsTranslations;

/** One cast per suite: P + S1 register through the REAL RegistrationService. */
const cast: JourneyCastType = createJourneyCast("parentfull");

/** Committed-fixture registry — S2, P2, T plus every service-created row. */
const tracked = new TrackedFixtures();

/** Fan-out transport spy — installed at every engine-options injection seam. */
const transportSpy = new SpiedFanoutTransport();

/** Map-backed claim cache with SET-NX-EX semantics in memory (no DB claim rows). */
const claimCache: NotificationIdempotencyClaimCache & { claimedKeys: readonly string[] } = (() => {
  const stored = new Map<string, string>();
  const attempted: string[] = [];
  return {
    claimedKeys: attempted,
    async claim(key: string): Promise<boolean> {
      attempted.push(key);
      const fresh = !stored.has(key);
      if (fresh) {
        stored.set(key, "");
      }
      return fresh;
    },
    async get(key: string): Promise<string | null> {
      return stored.get(key) ?? null;
    },
    async store(key: string, value: string): Promise<void> {
      stored.set(key, value);
    },
  };
})();

/** The engine call options every spied call passes — transport + claim cache injected. */
function engineOptions(): NotificationEngineCallOptions {
  return { transport: transportSpy, cache: claimCache };
}

/** Polymorphic entity pointer the session-family waves carry. */
const RELATED_ENTITY_TYPE_SESSION = "session";

/** The pinned portal deep-link landing shape for a completion notification. */
const LANDING_URL_PREFIX = "/parent/children/";
const LANDING_URL_QUERY = "?tab=reports&session=";

/** Teacher's notes and rating for S1's session report. */
const REPORT_NOTES = "Steady memorization; the revision plan continues next lesson.";
const REPORT_RATING = 4;

/** Jadid + Madi blocks for the report's homework assignment. */
const JADID_BLOCK: HomeWorkBlockInput = { fromAyah: 1, toAyah: 7, surahJuz: SurahJuzRef.SurahAlFatihah };
const MADI_BLOCK: HomeWorkBlockInput = { fromAyah: 1, toAyah: 5, surahJuz: SurahJuzRef.Juz1 };

/** Per-run booking idempotency key. */
const BOOKING_KEY = `${cast.prefix}-k-booking-s1`;

/** Garbage code — valid shape violation rejected pre-DB. */
const GARBAGE_CODE = "not-a-handshake-code";

/** Persisted-notification row shape used by the inbox oracles. */
interface NotificationRow {
  readonly id: number;
  readonly userId: number;
  readonly type: string;
  readonly title: string | null;
  readonly relatedEntityType: string | null;
  readonly relatedEntityId: number | null;
}

/**
 * The session-completion notification type widened to its primitive string
 * value — the DB column infers a string union, so comparisons go through
 * this constant.
 */
const SESSION_COMPLETION_TYPE: string = NotificationType.SessionCompletion;

/** The committed journey state — provisioned once, observed by every step. */
interface JourneyState {
  readonly parentP: ParentActorType;
  readonly studentS1: StudentActorType;
  readonly studentS2: JourneyActor;
  readonly parentP2: JourneyActor;
  readonly teacherT: JourneyActor;
  readonly s2Code: string;
  readonly absentCode: string;
}

/** Captured service outputs — steps later in the chain consume them. */
let reqPToS1 = -1;
let reqP2ToS1 = -1;
let reqP2ToS2 = -1;
let bookedSession: SessionReturnType | null = null;
let state: JourneyState | null = null;

/** Throws if the cast was not provisioned — every step starts by resolving the state. */
function requireState(): JourneyState {
  if (state === null) {
    throw new Error("journey state missing: cast was not provisioned");
  }
  return state;
}

/** Every cast member's user id — the scope for side-effect and residue probes. */
function castUserIds(s: JourneyState): number[] {
  return [s.parentP.userId, s.studentS1.userId, s.studentS2.userId, s.parentP2.userId, s.teacherT.userId];
}

/** Every session id the journey created — the scope for session-family residue probes. */
function journeySessionIds(): number[] {
  return bookedSession === null ? [] : [bookedSession.id];
}

/** One recorded domain-log call (code only — copy is never asserted from logs). */
interface DomainLogRecord {
  readonly code: string;
}

/** Recording stub over `logger.logDomainError` — callers MUST `stop()` it (try/finally). */
function recordDomainLogs(): { records: DomainLogRecord[]; stop: () => void } {
  const records: DomainLogRecord[] = [];
  const spy = spyOn(logger, "logDomainError").mockImplementation((_message: string, ctx?: DomainErrorContext) => {
    records.push({ code: ctx?.code ?? "<missing>" });
  });
  return { records, stop: () => spy.mockRestore() };
}

/** The parent-link inbox rows for one user (request + decision rows). */
async function linkInboxRowsFor(userId: number): Promise<readonly NotificationRow[]> {
  const rows = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      type: notifications.type,
      title: notifications.title,
      relatedEntityType: notifications.relatedEntityType,
      relatedEntityId: notifications.relatedEntityId,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId));
  return rows.filter(row => row.relatedEntityType?.startsWith("parent_link_request"));
}

/**
 * The session-report-ready wave rows for one user bound to one session.
 * The dual-confirmation completion-prompt row shares the SAME wire type and
 * session pointer with the report-ready wave, so the count is scoped to the
 * wave's distinct title copy (the prompt composes a different title).
 */
async function reportWaveRowsFor(userId: number, sessionId: number): Promise<readonly NotificationRow[]> {
  const rows = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      type: notifications.type,
      title: notifications.title,
      relatedEntityType: notifications.relatedEntityType,
      relatedEntityId: notifications.relatedEntityId,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId));
  return rows.filter(
    row =>
      row.type === SESSION_COMPLETION_TYPE &&
      row.relatedEntityType === RELATED_ENTITY_TYPE_SESSION &&
      row.relatedEntityId === sessionId &&
      row.title === NOTIFS_EN.eventSessionReportReadyTitle
  );
}

/** Live pending link-request rows for one student. */
async function pendingCountForStudent(studentId: number): Promise<number> {
  return db.$count(parentLinkRequests, eq(parentLinkRequests.studentId, studentId));
}

/** The student's link field (null when unlinked). */
async function studentParentId(studentId: number): Promise<number | null> {
  const rows = await db.select({ parentId: students.parentId }).from(students).where(eq(students.id, studentId));
  return rows.at(0)?.parentId ?? null;
}

/** The user row by id (null when absent). */
async function userRowById(id: number): Promise<UserSelectType | null> {
  const rows = await db.select().from(users).where(eq(users.id, id));
  return rows.at(0) ?? null;
}

/** The student's trial-lane balance. */
async function trialBalance(studentId: number): Promise<number> {
  const rows = await db
    .select({ balanceTrial: students.balanceTrial })
    .from(students)
    .where(eq(students.id, studentId));
  return rows.at(0)?.balanceTrial ?? -1;
}

/** Registers the booking idempotency claim the committed booking spent, for teardown. */
async function registerClaimRow(key: string, label: string): Promise<void> {
  const rows = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  const claim = rows.at(0);
  if (!claim) {
    throw new Error(`journey: idempotency claim for ${label} not found (fixture tracking failure)`);
  }
  tracked.register(sessionRequestIdempotency, claim.id);
}

/** Publish oracle: EXACTLY ONE spied publish, addressed to `targetUserId` alone. */
function expectSinglePublish(
  targetUserId: number,
  relatedEntityId: number,
  relatedEntityType = "parent_link_request"
): void {
  expect(transportSpy.publishCount).toBe(1);
  const call = transportSpy.lastCall;
  if (call === null) {
    throw new Error("expected one recorded publish");
  }
  expect(call.userIds).toEqual([targetUserId]);
  expect(call.payload.data.relatedEntityType).toBe(relatedEntityType);
  expect(call.payload.data.relatedEntityId).toBe(relatedEntityId);
}

/** Captures the constant-shape ForbiddenError fingerprint of a denial (byte-stable). */
function expectForbiddenFingerprint(error: Error): string {
  expect(error).toBeInstanceOf(ForbiddenError);
  if (!(error instanceof ForbiddenError)) {
    throw new Error("journey: expected a FORBIDDEN domain denial");
  }
  expect(error.code).toBe("FORBIDDEN");
  expect(error.message).toContain(ERRORS_EN.forbidden);
  return JSON.stringify({ code: error.code, message: error.message });
}

/** The committed-fixture snapshot used by the read-only enforcement probes. */
async function s1RowSnapshot(): Promise<string> {
  const rows = await db.select().from(students).where(eq(students.id, requireState().studentS1.userId));
  return JSON.stringify(rows);
}

/** The session-family snapshot used by the read-only enforcement probes. */
async function s1SessionRowsSnapshot(): Promise<string> {
  const ids = journeySessionIds();
  const rows = await db.select().from(session).where(inArray(session.id, ids));
  return JSON.stringify(rows);
}

describe("Journey — parent full journey (registration → link → session → portal → denials)", () => {
  beforeAll(async () => {
    // Step 1 — System: Parent P and Student S1 register through the REAL
    // RegistrationService (real committed `users` + role-child rows; S1
    // holds a generated handshake code).
    const parentP = await cast.registerParentActor(`${cast.prefix} parent P`);
    const studentS1 = await cast.registerStudentActor(`${cast.prefix} student S1`);

    // Step 2 — System: the remaining cast (S2, foreign P2, certified T) is
    // provisioned in ONE committing transaction — commit-or-nothing.
    const provisioned = await db.transaction(async (tx: DBTransaction): Promise<JourneyState> => {
      const studentS2 = await provisionStudentActor(tx, { tracked, locale: LOCALE });
      const parentP2 = await provisionParentActor(tx, { tracked, locale: LOCALE });
      const teacherT = await provisionCertifiedTeacherActor(tx, { tracked, locale: LOCALE });

      // Run-unique identity stamps on the provisioned actors (prefix
      // discipline), plus the English persisted locale so every wave the
      // journey asserts composes in the locale this suite pins.
      const stamped = [
        { id: studentS2.userId, label: "student S2" },
        { id: parentP2.userId, label: "parent P2" },
        { id: teacherT.userId, label: "teacher T" },
        { id: parentP.userId, label: "parent P" },
        { id: studentS1.userId, label: "student S1" },
      ];
      await Promise.all(
        stamped.map(({ id, label }) =>
          tx
            .update(users)
            .set({
              fullName: `${cast.prefix} ${label}`,
              email: `${cast.prefix}.${id}.journey@test.invalid`,
              locale: "en",
            })
            .where(eq(users.id, id))
        )
      );

      // The booking leg's trial lane: S1's debit ladder must find a real
      // balance to spend (fixture control, committed with the cast).
      await tx.update(students).set({ balanceTrial: 1 }).where(eq(students.id, studentS1.userId));

      // S2's handshake code — read back through the real repository read path.
      const rows = await tx
        .select({ handshakeCode: students.handshakeCode })
        .from(students)
        .where(eq(students.id, studentS2.userId));
      const s2Code = rows.at(0)?.handshakeCode;
      if (s2Code === undefined) {
        throw new Error("journey cast: a provisioned student has no readable handshake code");
      }

      // A valid-format code matching no students row (the unknown-code channel).
      const s1Rows = await tx
        .select({ handshakeCode: students.handshakeCode })
        .from(students)
        .where(eq(students.id, studentS1.userId));
      const s1Code = s1Rows.at(0)?.handshakeCode;
      if (s1Code === undefined) {
        throw new Error("journey cast: the registered student has no readable handshake code");
      }
      const absentCode = `${s1Code.slice(0, -1)}${s1Code.slice(-1) === "0" ? "1" : "0"}`;

      return {
        parentP,
        studentS1,
        studentS2,
        parentP2,
        teacherT,
        s2Code,
        absentCode,
      };
    });

    state = provisioned;

    // Cast grounding: canonical codes, honest pre-state, S1's trial lane armed.
    expect(provisioned.studentS1.handshakeCode).toMatch(/^KSB-[0-9A-F]{8}$/);
    expect(provisioned.s2Code).toMatch(/^KSB-[0-9A-F]{8}$/);
    expect(await trialBalance(provisioned.studentS1.userId)).toBe(1);
    expect(await studentParentId(provisioned.studentS1.userId)).toBeNull();
    expect(await studentParentId(provisioned.studentS2.userId)).toBeNull();
    await Promise.all(
      castUserIds(provisioned).map(id => linkInboxRowsFor(id).then(rows => expect(rows).toHaveLength(0)))
    );
    expect(PARENT_LINK_REQUEST_TTL_DAYS).toBe(7);
  });

  test("Step 3 — Student S1 reads own handshake code verbatim; no other student's code surfaces", async () => {
    const s = requireState();
    const ownCode = await StudentHandshakeService.getMyHandshakeCode(s.studentS1.userId, LOCALE);
    expect(ownCode).toBe(s.studentS1.handshakeCode);
    // The other student's own read resolves THEIR code — never S1's.
    const s2OwnCode = await StudentHandshakeService.getMyHandshakeCode(s.studentS2.userId, LOCALE);
    expect(s2OwnCode).toBe(s.s2Code);
    expect(s2OwnCode).not.toBe(ownCode);
  });

  test("Step 4 — Parent P resolves S1 by code; garbage code rejected pre-DB; unknown code returns null", async () => {
    const s = requireState();
    const logs = recordDomainLogs();
    try {
      // The live, not-yet-linked target resolves as linkable — masked only.
      const resolved = await StudentHandshakeService.findStudentByHandshakeCode(s.studentS1.handshakeCode, LOCALE);
      expect(resolved?.linkable).toBe(true);
      expect(resolved?.maskedName).not.toContain(s.studentS1.fullName);

      // Garbage code: normalized→validated strictly before any database
      // read — the translated shape violation, never a lookup.
      const garbageError = await catchJourneyError(() =>
        StudentHandshakeService.findStudentByHandshakeCode(GARBAGE_CODE, LOCALE)
      );
      expect(garbageError).toBeInstanceOf(ValidationError);
      expect(garbageError.message).toContain(ERRORS_EN.handshakeCodeInvalid);

      // Unknown-but-valid code: the null collapse — no payload, no leak.
      const unknown = await StudentHandshakeService.findStudentByHandshakeCode(s.absentCode, LOCALE);
      expect(unknown).toBeNull();

      expect(logs.records).toEqual([{ code: "VALIDATION" }]);
    } finally {
      logs.stop();
    }
  });

  test("Step 5 — Parent P2 requests S2: ONE pending row (+7d), ONE inbox row to S2, EXACTLY ONE publish", async () => {
    const s = requireState();
    transportSpy.clear();
    const created = await ParentLinkRequestService.requestLink(
      s.s2Code,
      s.parentP2.userId,
      LOCALE,
      undefined,
      engineOptions()
    );
    if (created === null) {
      throw new Error("expected a creation payload for the live unlinked target S2");
    }
    tracked.register(parentLinkRequests, created.id);
    reqP2ToS2 = created.id;

    expect(created.status).toBe(LinkStatus.Pending);
    expect(created.respondedAt).toBeNull();
    const windowMs = created.expiresAt.getTime() - created.createdAt.getTime();
    expect(Math.abs(windowMs - PARENT_LINK_REQUEST_MS)).toBeLessThan(1000);

    expect(await pendingCountForStudent(s.studentS2.userId)).toBe(1);
    const s2Inbox = await linkInboxRowsFor(s.studentS2.userId);
    expect(s2Inbox).toHaveLength(1);
    expect(s2Inbox.at(0)?.relatedEntityType).toBe("parent_link_request");
    expect(s2Inbox.at(0)?.relatedEntityId).toBe(created.id);
    const otherInboxRows = await Promise.all(
      castUserIds(s)
        .filter(id => id !== s.studentS2.userId)
        .map(id => linkInboxRowsFor(id))
    );
    for (const rows of otherInboxRows) {
      expect(rows).toHaveLength(0);
    }
    expectSinglePublish(s.studentS2.userId, created.id);
    transportSpy.clear();
  });

  test("Step 6 — Parent P requests S1: ONE pending row with the +7d TTL window, ONE inbox row to S1", async () => {
    const s = requireState();
    const created = await ParentLinkRequestService.requestLink(
      s.studentS1.handshakeCode,
      s.parentP.userId,
      LOCALE,
      undefined,
      engineOptions()
    );
    if (created === null) {
      throw new Error("expected a creation payload for the live unlinked target S1");
    }
    tracked.register(parentLinkRequests, created.id);
    reqPToS1 = created.id;

    expect(created.status).toBe(LinkStatus.Pending);
    expect(created.respondedAt).toBeNull();
    const windowMs = created.expiresAt.getTime() - created.createdAt.getTime();
    expect(Math.abs(windowMs - PARENT_LINK_REQUEST_MS)).toBeLessThan(1000);

    expect(await pendingCountForStudent(s.studentS1.userId)).toBe(1);
    const s1Inbox = await linkInboxRowsFor(s.studentS1.userId);
    expect(s1Inbox).toHaveLength(1);
    expect(s1Inbox.at(0)?.relatedEntityType).toBe("parent_link_request");
    expect(s1Inbox.at(0)?.relatedEntityId).toBe(created.id);
    expectSinglePublish(s.studentS1.userId, created.id);
    transportSpy.clear();
  });

  test("Step 7 — Parent P2's live contention request on S1 (the future expiry sibling)", async () => {
    const s = requireState();
    const created = await ParentLinkRequestService.requestLink(
      s.studentS1.handshakeCode,
      s.parentP2.userId,
      LOCALE,
      undefined,
      engineOptions()
    );
    if (created === null) {
      throw new Error("expected a creation payload for the still-unlinked target S1");
    }
    tracked.register(parentLinkRequests, created.id);
    reqP2ToS1 = created.id;
    expect(created.status).toBe(LinkStatus.Pending);
    expect(await pendingCountForStudent(s.studentS1.userId)).toBe(2);
    expectSinglePublish(s.studentS1.userId, created.id);
    transportSpy.clear();
  });

  test("Step 8 — Student S1 lists the incoming requests: self-scoped, both parents visible, P2→S2 invisible", async () => {
    const s = requireState();
    const incoming = await ParentLinkRequestService.listMyIncoming(s.studentS1.userId, LOCALE);
    expect(incoming).toHaveLength(2);
    const ownIds = incoming.map(row => row.id).toSorted((a, b) => a - b);
    expect(ownIds).toEqual([reqPToS1, reqP2ToS1].toSorted((a, b) => a - b));
    const pRow = incoming.find(row => row.id === reqPToS1);
    if (pRow === undefined) {
      throw new Error("expected P's request in S1's incoming list");
    }
    const parentPRow = await userRowById(s.parentP.userId);
    if (parentPRow === null) {
      throw new Error("fixture parent row vanished mid-journey");
    }
    expect(pRow.status).toBe(LinkStatus.Pending);
    expect(pRow.parentFullName).toBe(parentPRow.fullName);
    // The S2-scoped request NEVER surfaces in S1's list (self-scope).
    const s1IncomingIds = new Set(incoming.map(row => row.id));
    expect(s1IncomingIds.has(reqP2ToS2)).toBe(false);
  });

  test("Step 9 — Student S1 confirms P: parent_id written, the P2 sibling expired, ONE acceptance notification to P", async () => {
    const s = requireState();
    const confirmed = await ParentLinkRequestService.respondToLinkRequest(
      reqPToS1,
      true,
      s.studentS1.userId,
      LOCALE,
      undefined,
      engineOptions()
    );
    expect(confirmed.id).toBe(reqPToS1);
    expect(confirmed.status).toBe(LinkStatus.Confirmed);
    expect(confirmed.respondedAt).not.toBeNull();
    const parentPRow = await userRowById(s.parentP.userId);
    if (parentPRow === null) {
      throw new Error("fixture parent row vanished mid-journey");
    }
    expect(confirmed.parentFullName).toBe(parentPRow.fullName);

    // The winner write: S1's link field is P's id.
    expect(await studentParentId(s.studentS1.userId)).toBe(s.parentP.userId);

    // The sibling contention request expired with the win (one-parent-per-student).
    const rows = await db
      .select({ status: parentLinkRequests.status })
      .from(parentLinkRequests)
      .where(eq(parentLinkRequests.id, reqP2ToS1));
    expect(rows.at(0)?.status).toBe(LinkStatus.Expired);

    // Exactly ONE acceptance notification to P, bound to the request row.
    const pInbox = await linkInboxRowsFor(s.parentP.userId);
    expect(pInbox).toHaveLength(1);
    expect(pInbox.at(0)?.relatedEntityType).toBe("parent_link_request_decision");
    expect(pInbox.at(0)?.relatedEntityId).toBe(reqPToS1);
    expectSinglePublish(s.parentP.userId, reqPToS1, "parent_link_request_decision");
    transportSpy.clear();
  });

  test("Step 10 — Parent P2 re-requests the now-linked S1: one-parent collapse, zero new rows, zero publishes", async () => {
    const s = requireState();
    transportSpy.clear();
    const requestsBefore = await db
      .select({ id: parentLinkRequests.id })
      .from(parentLinkRequests)
      .where(
        or(eq(parentLinkRequests.parentId, s.parentP2.userId), eq(parentLinkRequests.studentId, s.studentS1.userId))
      );
    const error = await catchJourneyError(() =>
      ParentLinkRequestService.requestLink(
        s.studentS1.handshakeCode,
        s.parentP2.userId,
        LOCALE,
        undefined,
        engineOptions()
      )
    );
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toContain(ERRORS_EN.parentLinkTargetAlreadyLinked);
    const requestsAfter = await db
      .select({ id: parentLinkRequests.id })
      .from(parentLinkRequests)
      .where(
        or(eq(parentLinkRequests.parentId, s.parentP2.userId), eq(parentLinkRequests.studentId, s.studentS1.userId))
      );
    expect(requestsAfter).toHaveLength(requestsBefore.length);
    expect(await studentParentId(s.studentS1.userId)).toBe(s.parentP.userId);
    expect(transportSpy.publishCount).toBe(0);
    expect(await linkInboxRowsFor(s.studentS1.userId).then(rows => rows.length)).toBe(2);
  });

  test("Step 11 — System backdates the P2→S2 request's expiry into the past", async () => {
    const stale = new Date(Date.now() - 24 * 3_600_000);
    await db.update(parentLinkRequests).set({ expiresAt: stale }).where(eq(parentLinkRequests.id, reqP2ToS2));
    const rows = await db
      .select({ expiresAt: parentLinkRequests.expiresAt })
      .from(parentLinkRequests)
      .where(eq(parentLinkRequests.id, reqP2ToS2));
    expect(rows.at(0)?.expiresAt.getTime()).toBe(stale.getTime());
  });

  test("Step 12 — Student S2's confirm on the stale request: translated expired error, no link written", async () => {
    const s = requireState();
    transportSpy.clear();
    const logs = recordDomainLogs();
    try {
      const error = await catchJourneyError(() =>
        ParentLinkRequestService.respondToLinkRequest(
          reqP2ToS2,
          true,
          s.studentS2.userId,
          LOCALE,
          undefined,
          engineOptions()
        )
      );
      expect(error).toBeInstanceOf(DomainError);
      expect(error.message).toContain(ERRORS_EN.parentLinkRequestExpired);

      // The stale row materializes expired; NO link is ever written.
      const rows = await db
        .select({ status: parentLinkRequests.status })
        .from(parentLinkRequests)
        .where(eq(parentLinkRequests.id, reqP2ToS2));
      expect(rows.at(0)?.status).toBe(LinkStatus.Expired);
      expect(await studentParentId(s.studentS2.userId)).toBeNull();
      expect(transportSpy.publishCount).toBe(0);
      expect(logs.records).toEqual([{ code: "PARENT_LINK_REQUEST_EXPIRED" }]);
    } finally {
      logs.stop();
    }
  });

  test("Step 13 — Student S1 books a session through the real debit ladder; Teacher T starts and completes it", async () => {
    const s = requireState();
    const publishedTargets: number[] = [];
    const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async receipts => {
      publishedTargets.push(...receipts.flatMap(receipt => receipt.recipientUserIds));
    });
    try {
      // The booking: real SessionLifecycleService, real debit ladder — S1's
      // trial lane is spent by the booking itself.
      const booked = await SessionLifecycleService.createSession(
        s.studentS1.userId,
        { teacherId: s.teacherT.userId, intent: SessionIntent.Hifz },
        BOOKING_KEY,
        LOCALE
      );
      bookedSession = booked;
      tracked.register(session, booked.id);
      await registerClaimRow(BOOKING_KEY, "S1 booking");
      expect(booked.studentId).toBe(s.studentS1.userId);
      expect(booked.teacherId).toBe(s.teacherT.userId);
      expect(booked.status).toBe(SessionStatus.Scheduled);

      // The debit ladder: the trial lane was decremented by exactly one.
      expect(await trialBalance(s.studentS1.userId)).toBe(0);

      // Teacher T runs the real lifecycle: start → complete.
      const started = await SessionLifecycleService.startSession(s.teacherT.userId, booked.id, LOCALE);
      expect(started.status).toBe(SessionStatus.Started);
      const completed = await SessionLifecycleService.completeSession(s.teacherT.userId, booked.id, LOCALE);
      expect(completed.status).toBe(SessionStatus.Completed);

      // Every publish the booking/completion waves attempted targeted ONLY
      // cast members (the teacher's request wave, then S1's completion
      // prompt) — nothing reached a real channel (engine spy, rule 5).
      expect(new Set(publishedTargets).difference(new Set([s.studentS1.userId, s.teacherT.userId])).size).toBe(0);
    } finally {
      publishSpy.mockRestore();
    }
  });

  test("Step 14 — Teacher T submits the report: fan-out targets exactly {S1, P}; P's inbox carries the deep-link triple; P2 gets nothing", async () => {
    const s = requireState();
    const sigma = bookedSession;
    if (sigma === null) {
      throw new Error("journey state missing: the booked session was not created");
    }
    transportSpy.clear();
    const logs = recordDomainLogs();
    try {
      await SessionReportService.submitSessionReport(
        s.teacherT.userId,
        sigma.id,
        {
          teacherNotes: REPORT_NOTES,
          studentRatingByTeacher: REPORT_RATING,
          homework: { jadid: JADID_BLOCK, madi: MADI_BLOCK },
        },
        LOCALE,
        undefined,
        engineOptions()
      );
      expect(logs.records).toEqual([]);

      // The report and homework rows persist, bound to the session.
      const reportRows = await db.select().from(reports).where(eq(reports.sessionId, sigma.id));
      expect(reportRows).toHaveLength(1);
      const reportRow = reportRows.at(0);
      if (reportRow === undefined) {
        throw new Error("journey: expected the report row to exist after the valid submit");
      }
      tracked.register(reports, reportRow.id);
      expect(reportRow.teacherNotes).toBe(REPORT_NOTES);
      const homeworkRows = await db.select().from(homeWork).where(eq(homeWork.sessionId, sigma.id));
      expect(homeworkRows).toHaveLength(1);
      const homeworkRow = homeworkRows.at(0);
      if (homeworkRow === undefined) {
        throw new Error("journey: expected the homework row to exist after the valid submit");
      }
      tracked.register(homeWork, homeworkRow.id);

      // The completion wave: EXACTLY ONE persisted row for the student AND
      // ONE for the linked parent — each carrying the deep-link triple.
      const s1Waves = await reportWaveRowsFor(s.studentS1.userId, sigma.id);
      expect(s1Waves).toHaveLength(1);
      const s1Wave = s1Waves.at(0);
      if (s1Wave === undefined) {
        throw new Error("journey: expected one student wave for the session");
      }
      tracked.register(notifications, s1Wave.id);
      expect(s1Wave.relatedEntityType).toBe(RELATED_ENTITY_TYPE_SESSION);
      expect(s1Wave.relatedEntityId).toBe(sigma.id);

      const pWaves = await reportWaveRowsFor(s.parentP.userId, sigma.id);
      expect(pWaves).toHaveLength(1);
      const pWave = pWaves.at(0);
      if (pWave === undefined) {
        throw new Error("journey: expected one parent wave for the session");
      }
      tracked.register(notifications, pWave.id);
      expect(pWave.relatedEntityType).toBe(RELATED_ENTITY_TYPE_SESSION);
      expect(pWave.relatedEntityId).toBe(sigma.id);

      // The foreign parent's isolation probe: P2 observes nothing.
      expect(await reportWaveRowsFor(s.parentP2.userId, sigma.id)).toHaveLength(0);

      // Dispatch boundary: EXACTLY TWO publishes — one envelope per
      // recipient, addressed to {S1, P} alone.
      expect(transportSpy.publishCount).toBe(2);
      const publishes = transportSpy.calls.slice(0, 2);
      expect(publishes.map(publish => JSON.stringify(publish.userIds)).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [s.studentS1.userId, s.parentP.userId].map(id => JSON.stringify([id])).toSorted((a, b) => a.localeCompare(b))
      );

      // The engine claim keys are the deterministic per-recipient report keys.
      const expectedKeys = new Set(
        [s.studentS1.userId, s.parentP.userId].map(id =>
          buildEmitClaimKey([id], NotificationType.SessionCompletion, `session:${String(sigma.id)}:report`)
        )
      );
      expect(new Set(claimCache.claimedKeys).intersection(expectedKeys).size).toBe(expectedKeys.size);
    } finally {
      logs.stop();
      transportSpy.clear();
    }
  });

  test("Step 15 — Parent P reads all seven monitoring surfaces for S1: S1-scoped rows including the report", async () => {
    const s = requireState();
    const sigma = bookedSession;
    if (sigma === null) {
      throw new Error("journey state missing: the booked session was not created");
    }
    transportSpy.clear();

    // 1. The linked-children list: exactly [S1].
    const children = await ParentMonitoringService.listLinkedChildren(s.parentP.userId, LOCALE);
    expect(children.map(child => child.id)).toEqual([s.studentS1.userId]);

    // 2-4. The per-session per-child reads: S1-scoped pages containing the
    // journey's session, its report, and its homework.
    const sessionsPage = await ParentMonitoringService.listChildSessions(
      s.parentP.userId,
      s.studentS1.userId,
      undefined,
      LOCALE
    );
    expect(sessionsPage.totalCount).toBe(1);
    expect(sessionsPage.items.some(item => item.id === sigma.id && item.status === SessionStatus.Completed)).toBe(true);

    const reportsPage = await ParentMonitoringService.listChildReports(
      s.parentP.userId,
      s.studentS1.userId,
      undefined,
      LOCALE
    );
    expect(reportsPage.totalCount).toBe(1);
    const deepLinkedRow = reportsPage.items.find(item => item.sessionId === sigma.id);
    expect(deepLinkedRow?.teacherNotes).toBe(REPORT_NOTES);
    expect(deepLinkedRow?.studentRatingByTeacher).toBe(REPORT_RATING);

    const homeworkPage = await ParentMonitoringService.listChildHomework(
      s.parentP.userId,
      s.studentS1.userId,
      undefined,
      LOCALE
    );
    expect(homeworkPage.items.some(item => item.sessionId === sigma.id)).toBe(true);

    // 5. The child progress header echo: names the linked child.
    const progress = await ParentMonitoringService.getChildProgress(s.parentP.userId, s.studentS1.userId, LOCALE);
    expect(progress.child.id).toBe(s.studentS1.userId);

    // 6. The closed session-target pair — the deep-link resolution.
    const target = await ParentMonitoringService.getSessionTarget(s.parentP.userId, sigma.id, LOCALE);
    expect(target.sessionId).toBe(sigma.id);
    expect(target.studentId).toBe(s.studentS1.userId);

    // The canonical landing URL is constructible from the resolved pair.
    const landingUrl = `${LANDING_URL_PREFIX}${target.studentId}${LANDING_URL_QUERY}${target.sessionId}`;
    expect(landingUrl).toBe(`${LANDING_URL_PREFIX}${s.studentS1.userId}${LANDING_URL_QUERY}${sigma.id}`);

    // 7. The parent-level upcoming-sessions glance: exactly S1's block.
    const upcoming = await ParentMonitoringService.listChildrenUpcomingSessions(s.parentP.userId, LOCALE);
    expect(upcoming.map(block => block.child.id)).toEqual([s.studentS1.userId]);

    // Portal reads publish nothing.
    expect(transportSpy.publishCount).toBe(0);
  });

  test("Step 16 — Parent P2 is denied on every per-child read for S1: constant ForbiddenError, zero data", async () => {
    const s = requireState();
    const sigma = bookedSession;
    if (sigma === null) {
      throw new Error("journey state missing: the booked session was not created");
    }
    const logs = recordDomainLogs();
    try {
      const fingerprints = new Set<string>();
      const denials: Array<[string, () => Promise<unknown>]> = [
        [
          "getChildProgress",
          () => ParentMonitoringService.getChildProgress(s.parentP2.userId, s.studentS1.userId, LOCALE),
        ],
        [
          "listChildSessions",
          () => ParentMonitoringService.listChildSessions(s.parentP2.userId, s.studentS1.userId, undefined, LOCALE),
        ],
        [
          "listChildReports",
          () => ParentMonitoringService.listChildReports(s.parentP2.userId, s.studentS1.userId, undefined, LOCALE),
        ],
        [
          "listChildHomework",
          () => ParentMonitoringService.listChildHomework(s.parentP2.userId, s.studentS1.userId, undefined, LOCALE),
        ],
        ["getSessionTarget", () => ParentMonitoringService.getSessionTarget(s.parentP2.userId, sigma.id, LOCALE)],
      ];
      const denialFingerprints = await Promise.all(
        denials.map(([label, probe]) =>
          catchJourneyError(probe).then(error => {
            fingerprints.add(expectForbiddenFingerprint(error));
            return label;
          })
        )
      );
      expect(denialFingerprints).toHaveLength(denials.length);
      // The denial shape is constant across every per-child read — the
      // foreign-parent probe cannot distinguish linked from absent targets.
      expect(fingerprints.size).toBe(1);
      expect(logs.records.filter(record => record.code === "FORBIDDEN")).toHaveLength(denials.length);
    } finally {
      logs.stop();
    }
  });

  test("Step 17 — Parent P's write attempts are all denied: zero rows, S1's rows byte-identical", async () => {
    const s = requireState();
    const sigma = bookedSession;
    if (sigma === null) {
      throw new Error("journey state missing: the booked session was not created");
    }
    const studentsBefore = await s1RowSnapshot();
    const sessionRowsBefore = await s1SessionRowsSnapshot();
    const sessionCountBefore = await db.$count(session);
    const reportCountBefore = await db.$count(reports);
    const notificationCountBefore = await db.$count(notifications);

    const logs = recordDomainLogs();
    transportSpy.clear();
    try {
      // createSession — the parent carries no student lane, so the real
      // debit ladder denies the booking before any row is written.
      const bookingError = await catchJourneyError(() =>
        SessionLifecycleService.createSession(
          s.parentP.userId,
          { teacherId: s.teacherT.userId, intent: SessionIntent.Hifz },
          `${cast.prefix}-k-denied-booking`,
          LOCALE
        )
      );
      expect(bookingError).toBeInstanceOf(ValidationError);
      expect(bookingError.message).toContain(ERRORS_EN.insufficientBalance);

      // confirmSessionCompletion — the parent is not the session's student;
      // the real re-check collapses to the constant not-found denial shape.
      const confirmError = await catchJourneyError(() =>
        SessionLifecycleService.confirmSessionCompletion(s.parentP.userId, sigma.id, LOCALE)
      );
      expect(confirmError).toBeInstanceOf(NotFoundError);
      expect(confirmError.message).toContain(ERRORS_EN.sessionNotFound);

      // submitSessionReport — the parent is not the session's teacher.
      const reportError = await catchJourneyError(() =>
        SessionReportService.submitSessionReport(
          s.parentP.userId,
          sigma.id,
          {
            teacherNotes: `${cast.prefix} denied probe notes`,
            studentRatingByTeacher: 1,
            homework: { jadid: JADID_BLOCK, madi: MADI_BLOCK },
          },
          LOCALE,
          undefined,
          engineOptions()
        )
      );
      expectForbiddenFingerprint(reportError);

      // respondToLinkRequest — the parent is not the deciding student.
      const respondError = await catchJourneyError(() =>
        ParentLinkRequestService.respondToLinkRequest(
          reqP2ToS2,
          true,
          s.parentP.userId,
          LOCALE,
          undefined,
          engineOptions()
        )
      );
      expectForbiddenFingerprint(respondError);

      // Zero side effects: no new session, report, or notification rows, no
      // idempotency claim, and S1's rows are byte-identical.
      expect(await db.$count(session)).toBe(sessionCountBefore);
      expect(await db.$count(reports)).toBe(reportCountBefore);
      expect(await db.$count(notifications)).toBe(notificationCountBefore);
      expect(await s1RowSnapshot()).toBe(studentsBefore);
      expect(await s1SessionRowsSnapshot()).toBe(sessionRowsBefore);
      expect(await studentParentId(s.studentS1.userId)).toBe(s.parentP.userId);
      expect(transportSpy.publishCount).toBe(0);
      expect(logs.records.filter(record => record.code === "FORBIDDEN")).toHaveLength(2);
      expect(logs.records.filter(record => record.code === "INSUFFICIENT_BALANCE")).toHaveLength(1);
      expect(logs.records.filter(record => record.code === "SESSION_NOT_FOUND")).toHaveLength(1);
    } finally {
      logs.stop();
    }
  });

  afterAll(async () => {
    const s = state;
    // Side-effect rows the services created are tracked for teardown too:
    // every persisted notification addressed to a cast member is registered
    // (registration order ⇒ notifications delete BEFORE the users rows).
    if (s !== null) {
      const inbox = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(inArray(notifications.userId, castUserIds(s)));
      for (const row of inbox) {
        tracked.register(notifications, row.id);
      }
    }

    try {
      // Tracked teardown first (requests, notifications, reports, homework,
      // session + claim, then S2/P2/T role-child + users rows) — then the
      // registered cast's own teardown (role-child rows, then P/S1 users).
      await tracked.cleanup();
      await cast.teardown();
    } finally {
      // Mandatory zero-residue re-probes — by tracked id set AND by the
      // per-run prefix (nothing with this run's identity remains).
      if (s !== null) {
        const ids = [...castUserIds(s), ...cast.trackedUserIds()];
        const sessionIds = journeySessionIds();
        const [
          userResidue,
          studentResidue,
          parentResidue,
          teacherResidue,
          requestResidue,
          notificationResidue,
          sessionResidue,
          reportResidue,
          homeworkResidue,
          prefixResidue,
        ] = await Promise.all([
          db.$count(users, inArray(users.id, ids)),
          db.$count(students, inArray(students.id, ids)),
          db.$count(parents, inArray(parents.id, ids)),
          db.$count(teacher, inArray(teacher.id, ids)),
          db.$count(
            parentLinkRequests,
            or(inArray(parentLinkRequests.parentId, ids), inArray(parentLinkRequests.studentId, ids))
          ),
          db.$count(notifications, inArray(notifications.userId, ids)),
          db.$count(session, inArray(session.id, sessionIds)),
          db.$count(reports, inArray(reports.sessionId, sessionIds)),
          db.$count(homeWork, inArray(homeWork.sessionId, sessionIds)),
          db.$count(users, like(users.email, `${cast.prefix}%`)),
        ]);
        expect(userResidue).toBe(0);
        expect(studentResidue).toBe(0);
        expect(parentResidue).toBe(0);
        expect(teacherResidue).toBe(0);
        expect(requestResidue).toBe(0);
        expect(notificationResidue).toBe(0);
        expect(sessionResidue).toBe(0);
        expect(reportResidue).toBe(0);
        expect(homeworkResidue).toBe(0);
        expect(prefixResidue).toBe(0);
      }

      // The registered cast's own residue oracle: every attributable row
      // set the cast created (notifications, audit rows) is empty too.
      const residue = await cast.residueCounts();
      expect(residue.users).toBe(0);
      expect(residue.students).toBe(0);
      expect(residue.parents).toBe(0);
      expect(residue.notifications).toBe(0);
      expect(residue.auditLogs).toBe(0);
    }
  });
});
