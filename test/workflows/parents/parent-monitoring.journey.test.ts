/**
 * Cross-actor journey — the parent's read-only monitoring portal across
 * teacher production (J1), severance revocation (J2), constant-shape
 * denial probes (J3), and multi-child switching (J4).
 *
 * Observer in every step: the parent. The portal's spine is the
 * `ParentMonitoringService` — every read funnels through ONE
 * per-student gate (`requireLinkedChild`) run inside the SAME
 * transaction as the data reads, so the link grant and the row scan
 * share one READ COMMITTED snapshot; a severance that lands mid-flight
 * cannot extend a returned payload (the TOCTOU seal).
 *
 *  - J1 step 1  — System: cast committed, σ1 completed via the REAL
 *                  session lifecycle path (book → start → complete),
 *                  σ3/σ4 provisioned for J4. Baseline pinned (zero
 *                  reports/homework/notifications).
 *  - J1 step 2  — Teacher T submits σ1 report + homework (Jadid +
 *                  Madi blocks): rows land; EXACTLY ONE parent-wave
 *                  publish to the linked parent P (en recipient
 *                  locale); ZERO publishes to anyone else.
 *  - J1 step 3  — Parent P reads σ1 surfaces: children list contains
 *                  S1; reports/homework/progress/sessions each return
 *                  σ1's row; progress's latest positions match the
 *                  homework blocks.
 *  - J1 step 4  — Deep-link: the reports list contains a row whose
 *                  sessionId === σ1.id (the deep-link target the
 *                  frontend resolves client-side).
 *  - J1 step 5  — DENIAL: P_foreign (never linked to S1) reads S1 →
 *                  constant 403, zero data.
 *  - J2 step 1  — Sever via clearing `students.parentId`: P's list
 *                  EXCLUDES S1; EVERY portal read of S1 immediately
 *                  403s; constant shape byte-identical across all
 *                  four per-student surfaces.
 *  - J2 step 2  — Sever via soft-delete (re-link + flip
 *                  `users.isDeleted`): same constant denial shape;
 *                  list EXCLUDES S1; no branch disclosure between the
 *                  two severance paths.
 *  - J3 step 1  — EN locale: P_foreign probes foreign / nonexistent /
 *                  malformed ids — byte-identical constant 403 across
 *                  every cause (one fingerprint per locale).
 *  - J3 step 2  — AR locale: the same probes — byte-identical
 *                  constant 403 in Arabic (localized copy per locale,
 *                  the `code` is `FORBIDDEN` in both).
 *  - J3 step 3  — Cross-locale: code is `FORBIDDEN` in both en and
 *                  ar; the message differs (locale-composed copy);
 *                  repeated probes are stable (no state drift across
 *                  repeats — the abuse-repeat arm).
 *  - J4 step 1  — Teacher T submits σ3 + σ4 reports/homework: each
 *                  submission publishes EXACTLY ONE parent-wave to P2
 *                  (ar recipient locale).
 *  - J4 step 2  — P2's `listLinkedChildren` returns [S3, S4] in
 *                  stable createdAt-ASC order (the list-correctness
 *                  contract: every confirmed-linked child appears,
 *                  nothing else).
 *  - J4 step 3  — P2 per-child reads return ONLY that child's rows:
 *                  parentChildReports(S3) yields σ3's report row;
 *                  parentChildReports(S4) yields σ4's report row;
 *                  cross-contamination is structurally impossible
 *                  (the per-student gate rejects every foreign id).
 *
 * Cast (the monitoring workflow's actor table):
 *  - Teacher T        — certified, en persisted locale (produces the
 *                       sessions + reports + homework that the portal
 *                       observes).
 *  - Parent P         — en persisted locale; linked to S1 (the J1/J2
 *                       observer; recipient-locale composition pin).
 *  - Parent P2        — ar persisted locale; linked to S3 and S4 (the
 *                       J4 multi-child observer; the ar-locale denial
 *                       copy source for J3).
 *  - Student S1       — linked to P; books σ1.
 *  - Student S2       — foreign / never linked (the J3 probe target
 *                       for the "exists-but-not-yours" arm).
 *  - Student S3, S4   — linked to P2; each books one session for J4.
 *
 * Harness (shared helpers at `test/workflows/helpers/`):
 *  - `TrackedFixtures` — the committed-fixture registry; `afterAll`
 *    hard-deletes every registered row in reverse-registration order
 *    (FK-safe) and re-probes the DB for zero residue (a leak fails the
 *    suite loudly).
 *  - `SpiedFanoutTransport` — the in-process fan-out transport spy
 *    installed at the engine's `options.transport` injection seam;
 *    nothing reaches a real channel; every publish is recorded.
 *  - `setGovernanceFixture` — the soft-delete severance writer (owns
 *    its own committing transaction).
 *  - `catchJourneyError` — the try/catch denial-capture helper (rule
 *    6: never `expect(...).rejects.toThrow()`).
 *
 * Layer contract (`test/workflows/AGENTS.md`):
 *  - NO `runInRollback` anywhere in this file — services spawn their
 *    own top-level transactions; an outer rollback wrapper would
 *    deadlock or miss committed rows.
 *  - Committed fixtures in `beforeAll` inside ONE committing
 *    transaction (commit-or-nothing: a throwing setup leaves nothing).
 *  - Tracked hard-delete cleanup in `afterAll` (FK-safe order; zero
 *    residue re-probes).
 *  - Honest authorization only — the cast is REAL `users` rows + REAL
 *    role-child rows; no role/permission monkey-patching; denial
 *    steps fail through the real `requireLinkedChild` gate.
 *  - Notification dispatch boundary SPIED at `options.transport`;
 *    side effects are asserted via `publishCount` + `lastCall.userIds`.
 *  - Per-run `jrn_pmonitor_<uuid8>` prefix on every fixture identity
 *    field (rule 3); parallel/repeated runs never collide.
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/parents/parent-monitoring.journey.test.ts
 *   bun run test/scripts/run-test.ts test/workflows
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/backend/db";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { reports } from "@/backend/db/schema/classes/reports";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestParent,
  createTestStudent,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { DomainError, ForbiddenError } from "@/backend/lib/errors";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import * as SessionReportService from "@/backend/services/classes/session-report.service";
import type { NotificationEngineCallOptions } from "@/backend/services/notifications";
import {
  buildEmitClaimKey,
  type NotificationIdempotencyClaimCache,
} from "@/backend/services/notifications/emit-idempotency";
import { ParentMonitoringService } from "@/backend/services/parents/parent-monitoring.service";
import type {
  DBTransaction,
  HomeWorkBlockInput,
  ParentAttendancePageReturnType,
  ParentChildProgressReturnType,
  ParentHomeworkPageReturnType,
  ParentLinkedChildReturnType,
  ParentReportPageReturnType,
  SessionReturnType,
  UserSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  catchJourneyError,
  SpiedFanoutTransport,
  setGovernanceFixture,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/** Default journey locale (English) — every English denial copy resolves through this. */
const LOCALE_EN = "en";

/** The Arabic locale — exercised by J3 step 2 to prove locale-composed denial copy. */
const LOCALE_AR = "ar";

/** English translated error copy source — never hardcoded English expectation strings (rule 6). */
const ERRORS_EN = getServerTranslations(LOCALE_EN).errorsTranslations;

/** Arabic translated error copy source — the J3 ar-locale denial composition oracle. */
const ERRORS_AR = getServerTranslations(LOCALE_AR).errorsTranslations;

/** English notification copy — the parent-wave composition oracle for P (en persisted locale). */
const NOTIFS_EN = getServerTranslations(LOCALE_EN).notificationsTranslations;

/** Arabic notification copy — the parent-wave composition oracle for P2 (ar persisted locale). */
const NOTIFS_AR = getServerTranslations(LOCALE_AR).notificationsTranslations;

/** Per-run unique prefix embedded in every fixture identity field (rule 3). */
const RUN_PREFIX = `jrn_pmonitor_${randomUUID().slice(0, 8)}`;

/** Session id far beyond any identity sequence — guaranteed absent (J3 nonexistent probe). */
const ABSENT_STUDENT_ID = 2_000_000_000;

/** Malformed id — the canonical non-positive arm of the J3 constant-denial set. */
const MALFORMED_STUDENT_ID = 0;

/** Polymorphic entity pointer every report-wave row carries. */
const RELATED_ENTITY_TYPE = "session";

/** Valid free-text notes reused by every accepted report submission. */
const VALID_NOTES = "Steady progress this session; the revision plan continues next lesson.";

/** Jadid + Madi blocks for the σ1 homework assignment. */
const JADID_BLOCK_SIGMA1: HomeWorkBlockInput = {
  fromAyah: 1,
  toAyah: 7,
  surahJuz: SurahJuzRef.SurahAlFatihah,
};
const MADI_BLOCK_SIGMA1: HomeWorkBlockInput = {
  fromAyah: 1,
  toAyah: 5,
  surahJuz: SurahJuzRef.Juz1,
};

/** Jadid + Madi blocks for the σ3 homework assignment (distinct from σ1's so cross-contamination is detectable). */
const JADID_BLOCK_SIGMA3: HomeWorkBlockInput = {
  fromAyah: 8,
  toAyah: 14,
  surahJuz: SurahJuzRef.SurahAlBaqarah,
};
const MADI_BLOCK_SIGMA3: HomeWorkBlockInput = {
  fromAyah: 6,
  toAyah: 11,
  surahJuz: SurahJuzRef.Juz2,
};

/** Jadid + Madi blocks for the σ4 homework assignment (distinct from σ3's so cross-contamination is detectable). */
const JADID_BLOCK_SIGMA4: HomeWorkBlockInput = {
  fromAyah: 15,
  toAyah: 22,
  surahJuz: SurahJuzRef.SurahAalImran,
};
const MADI_BLOCK_SIGMA4: HomeWorkBlockInput = {
  fromAyah: 12,
  toAyah: 19,
  surahJuz: SurahJuzRef.Juz3,
};

/** Per-run idempotency keys — one per booked session (rule 3 prefixes). */
const KEY_SIGMA1 = `${RUN_PREFIX}-k-sigma-1`;
const KEY_SIGMA3 = `${RUN_PREFIX}-k-sigma-3`;
const KEY_SIGMA4 = `${RUN_PREFIX}-k-sigma-4`;

/** One recorded domain-log call (code only — copy is never asserted from logs). */
interface DomainLogRecord {
  readonly code: string;
}

/** Cast bundle — every actor row the journey creates in `beforeAll`. */
interface JourneyCast {
  readonly teacherT: UserSelectType;
  readonly parentP: UserSelectType;
  readonly parentP2: UserSelectType;
  readonly studentS1: UserSelectType;
  readonly studentS2: UserSelectType;
  readonly studentS3: UserSelectType;
  readonly studentS4: UserSelectType;
  readonly sigma1: SessionReturnType;
  readonly sigma3: SessionReturnType;
  readonly sigma4: SessionReturnType;
}

let cast: JourneyCast | null = null;

/** Suite-scoped fixture registry — registration order IS the FK-safe deletion order. */
const tracked = new TrackedFixtures();

/** Fan-out transport spy — installed at the `options.transport` seam of every notify-boundary call. */
const transportSpy = new SpiedFanoutTransport();

/** Map-backed claim cache with SET-NX-EX semantics in memory + the raw attempted-key list. */
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

/** The engine call options every journey call passes — transport spied, claim cache injected. */
function engineOptions(): NotificationEngineCallOptions {
  return { transport: transportSpy, cache: claimCache };
}

/** Throws if the cast was not provisioned — every step starts by resolving the cast. */
function requireCast(): JourneyCast {
  if (cast === null) {
    throw new Error("journey state missing: cast was not provisioned");
  }
  return cast;
}

/** Byte fingerprint of a denial — the constant-shape oracle (code + message only). */
function errorFingerprint(error: DomainError): string {
  return JSON.stringify({ code: error.code, message: error.message });
}

/**
 * Installs a recording stub over `logger.logDomainError` so domain rejections
 * stay silent in test output AND become assertable (exactly one bounded log
 * per denial; none on success). Callers MUST `stop()` (use try/finally).
 */
function recordDomainLogs(): { records: DomainLogRecord[]; stop: () => void } {
  const records: DomainLogRecord[] = [];
  const spy = spyOn(logger, "logDomainError").mockImplementation((_message: string, ctx?: DomainErrorContext) => {
    records.push({ code: ctx?.code ?? "<missing>" });
  });
  return { records, stop: () => spy.mockRestore() };
}

/**
 * Captures the constant-shape ForbiddenError fingerprint of a portal denial
 * and pins its translated copy. The catchJourneyError helper is the rule-6
 * try/catch oracle — never `expect(...).rejects.toThrow()`.
 */
async function expectForbiddenFingerprint(fn: () => Promise<unknown>, translatedCopy: string): Promise<string> {
  const error = await catchJourneyError(fn);
  expect(error).toBeInstanceOf(ForbiddenError);
  if (!(error instanceof DomainError)) {
    throw new Error(`expected a FORBIDDEN DomainError (got ${error.name})`);
  }
  expect(error.code).toBe("FORBIDDEN");
  expect(error.message).toContain(translatedCopy);
  return errorFingerprint(error);
}

/** Registers the idempotency claim a committed booking spent, for teardown. */
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

/** Books, starts, and completes one session through the REAL lifecycle path. */
async function provisionCompletedSession(
  studentUserId: number,
  teacherUserId: number,
  key: string,
  tx: DBTransaction
): Promise<SessionReturnType> {
  const booked = await SessionLifecycleService.createSession(
    studentUserId,
    { teacherId: teacherUserId, intent: SessionIntent.Hifz },
    key,
    LOCALE_EN,
    tx
  );
  await SessionLifecycleService.startSession(teacherUserId, booked.id, LOCALE_EN, tx);
  return SessionLifecycleService.completeSession(teacherUserId, booked.id, LOCALE_EN, tx);
}

/** Persisted report-wave notification row shape — the recipient-locale composition oracle. */
interface ReportWaveRow {
  readonly id: number;
  readonly title: string | null;
  readonly body: string | null;
  readonly relatedEntityType: string | null;
  readonly relatedEntityId: number | null;
}

/** Persisted report-wave notification rows for one user, scoped to one session's wave (full row for copy assertions). */
async function completionRowsFor(userId: number, sessionId: number): Promise<readonly ReportWaveRow[]> {
  // The dual-confirmation handshake's completion-prompt row shares the SAME
  // `SessionCompletion` type and session `relatedEntityId` with the report-
  // ready wave, so the count is scoped to the wave's distinct `title` copy
  // slot in EITHER recipient locale (the student wave composes the English
  // copy, the parent wave the Arabic one — a user only ever receives waves
  // in their own persisted locale; the prompt composes a different title
  // which matches neither).
  return db
    .select({
      id: notifications.id,
      title: notifications.title,
      body: notifications.body,
      relatedEntityType: notifications.relatedEntityType,
      relatedEntityId: notifications.relatedEntityId,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, NotificationType.SessionCompletion),
        eq(notifications.relatedEntityId, sessionId),
        inArray(notifications.title, [NOTIFS_EN.eventSessionReportReadyTitle, NOTIFS_AR.eventSessionReportReadyTitle])
      )
    );
}

/** Direct read of one session's report row (independent read-back oracle). */
async function reportRowBySessionId(sessionId: number): Promise<{ id: number; sessionId: number } | null> {
  const rows = await db
    .select({ id: reports.id, sessionId: reports.sessionId })
    .from(reports)
    .where(eq(reports.sessionId, sessionId));
  return rows.at(0) ?? null;
}

/** Direct read of one session's homework row (independent read-back oracle). */
async function homeworkRowBySessionId(sessionId: number): Promise<{ id: number; sessionId: number } | null> {
  const rows = await db
    .select({ id: homeWork.id, sessionId: homeWork.sessionId })
    .from(homeWork)
    .where(eq(homeWork.sessionId, sessionId));
  return rows.at(0) ?? null;
}

/** Fresh read of `students.parent_id` for one student. */
async function studentParentId(studentId: number): Promise<number | null> {
  const rows = await db.select({ parentId: students.parentId }).from(students).where(eq(students.id, studentId));
  return rows.at(0)?.parentId ?? null;
}

/** Clears `students.parent_id` for one student (severance arm A — committed write). */
async function severLinkClearParentId(studentId: number): Promise<void> {
  await db.transaction(async tx => {
    await tx.update(students).set({ parentId: null }).where(eq(students.id, studentId));
  });
}

/** Restores `students.parent_id` (re-link before the soft-delete arm). */
async function restoreLink(studentId: number, parentId: number): Promise<void> {
  await db.transaction(async tx => {
    await tx.update(students).set({ parentId }).where(eq(students.id, studentId));
  });
}

describe("Journey — parent read-only monitoring portal (J1–J4)", () => {
  beforeAll(async () => {
    // ONE committing transaction: commit-or-nothing fixture provisioning.
    // Every actor is a REAL users row + its REAL role-child row; every
    // session reaches `completed` through the REAL lifecycle path (never
    // raw status surgery); every link is a committed `students.parent_id`
    // write emulating the shipped link-request mutation's end state.
    const provisioned = await db.transaction(async (tx: DBTransaction): Promise<JourneyCast> => {
      // Teacher T — certified, en persisted locale.
      const teacherT = await createTestUser(tx, {
        role: "teacher",
        locale: LOCALE_EN,
        fullName: `${RUN_PREFIX} teacher T`,
      });
      const teacherTRow = await createTestTeacherRow(tx, teacherT.id, { isApproved: true });
      tracked.register(users, teacherT.id);
      tracked.register(teacher, teacherTRow.id);

      // Parent P — en persisted locale (the J1/J2 observer).
      const parentP = await createTestUser(tx, {
        role: "parent",
        locale: LOCALE_EN,
        fullName: `${RUN_PREFIX} parent P`,
      });
      const parentPRow = await createTestParent(tx, parentP.id);
      tracked.register(users, parentP.id);
      tracked.register(parents, parentPRow.id);

      // Parent P2 — ar persisted locale (the J4 multi-child observer;
      // the J3 ar-locale denial-copy source).
      const parentP2 = await createTestUser(tx, {
        role: "parent",
        locale: LOCALE_AR,
        fullName: `${RUN_PREFIX} parent P2`,
      });
      const parentP2Row = await createTestParent(tx, parentP2.id);
      tracked.register(users, parentP2.id);
      tracked.register(parents, parentP2Row.id);

      // Student S1 — linked to P; books σ1.
      const studentS1 = await createTestUser(tx, {
        role: "student",
        locale: LOCALE_EN,
        fullName: `${RUN_PREFIX} student S1`,
      });
      const studentS1Row = await createTestStudent(tx, studentS1.id, { balanceTrial: 1 });
      tracked.register(users, studentS1.id);
      tracked.register(students, studentS1Row.id);

      // Student S2 — foreign / never linked to anyone (J3 probe target).
      const studentS2 = await createTestUser(tx, {
        role: "student",
        locale: LOCALE_EN,
        fullName: `${RUN_PREFIX} student S2`,
      });
      const studentS2Row = await createTestStudent(tx, studentS2.id, { balanceTrial: 0 });
      tracked.register(users, studentS2.id);
      tracked.register(students, studentS2Row.id);

      // Student S3 — linked to P2; books σ3.
      const studentS3 = await createTestUser(tx, {
        role: "student",
        locale: LOCALE_EN,
        fullName: `${RUN_PREFIX} student S3`,
      });
      const studentS3Row = await createTestStudent(tx, studentS3.id, { balanceTrial: 1 });
      tracked.register(users, studentS3.id);
      tracked.register(students, studentS3Row.id);

      // Student S4 — linked to P2; books σ4.
      const studentS4 = await createTestUser(tx, {
        role: "student",
        locale: LOCALE_EN,
        fullName: `${RUN_PREFIX} student S4`,
      });
      const studentS4Row = await createTestStudent(tx, studentS4.id, { balanceTrial: 1 });
      tracked.register(users, studentS4.id);
      tracked.register(students, studentS4Row.id);

      // Link S1 → P, S3 → P2, S4 → P2 (emulates the shipped link-request
      // mutation's end state — committed writes inside the provisioning tx).
      await tx.update(students).set({ parentId: parentP.id }).where(eq(students.id, studentS1Row.id));
      await tx.update(students).set({ parentId: parentP2.id }).where(eq(students.id, studentS3Row.id));
      await tx.update(students).set({ parentId: parentP2.id }).where(eq(students.id, studentS4Row.id));

      // σ1, σ3, σ4 — completed through the REAL lifecycle path inside the
      // provisioning transaction (book → start → complete).
      const sigma1 = await provisionCompletedSession(studentS1.id, teacherT.id, KEY_SIGMA1, tx);
      tracked.register(session, sigma1.id);
      const sigma3 = await provisionCompletedSession(studentS3.id, teacherT.id, KEY_SIGMA3, tx);
      tracked.register(session, sigma3.id);
      const sigma4 = await provisionCompletedSession(studentS4.id, teacherT.id, KEY_SIGMA4, tx);
      tracked.register(session, sigma4.id);

      return { teacherT, parentP, parentP2, studentS1, studentS2, studentS3, studentS4, sigma1, sigma3, sigma4 };
    });

    cast = provisioned;

    // Register the idempotency claims the bookings spent (they live outside
    // the provisioning transaction's tracked set — fetched + registered now).
    await registerClaimRow(KEY_SIGMA1, "σ1 booking");
    await registerClaimRow(KEY_SIGMA3, "σ3 booking");
    await registerClaimRow(KEY_SIGMA4, "σ4 booking");

    // Cast grounding: σ1/σ3/σ4 are terminal; their teacher/student columns
    // match the cast; the link grants name the right parents.
    expect(provisioned.sigma1.status).toBe(SessionStatus.Completed);
    expect(provisioned.sigma1.teacherId).toBe(provisioned.teacherT.id);
    expect(provisioned.sigma1.studentId).toBe(provisioned.studentS1.id);
    expect(provisioned.sigma3.studentId).toBe(provisioned.studentS3.id);
    expect(provisioned.sigma4.studentId).toBe(provisioned.studentS4.id);
    expect(await studentParentId(provisioned.studentS1.id)).toBe(provisioned.parentP.id);
    expect(await studentParentId(provisioned.studentS3.id)).toBe(provisioned.parentP2.id);
    expect(await studentParentId(provisioned.studentS4.id)).toBe(provisioned.parentP2.id);
    expect(await studentParentId(provisioned.studentS2.id)).toBeNull();
  });

  // ----- J1 — Teacher completion becomes visible to the linked parent -----

  test("J1 step 1 — System: cast committed; σ1/σ3/σ4 completed via the real lifecycle path; baseline zero side effects", async () => {
    const c = requireCast();
    transportSpy.clear();
    expect(c.sigma1.status).toBe(SessionStatus.Completed);
    expect(c.sigma3.status).toBe(SessionStatus.Completed);
    expect(c.sigma4.status).toBe(SessionStatus.Completed);
    expect(c.sigma1.feeHeld).toBe(true);

    // Baseline: zero reports/homework/report-wave rows for any fixture
    // session/user. (The lifecycle's completion-prompt wave to each
    // student IS persisted during provisioning, but it is scoped out by
    // the report-ready title filter — this journey's scope is the
    // report-ready wave, not the completion-prompt handshake.)
    const sessionIds = [c.sigma1.id, c.sigma3.id, c.sigma4.id];
    expect(await db.$count(reports, inArray(reports.sessionId, sessionIds))).toBe(0);
    expect(await db.$count(homeWork, inArray(homeWork.sessionId, sessionIds))).toBe(0);
    const actorIds = [
      c.teacherT.id,
      c.parentP.id,
      c.parentP2.id,
      c.studentS1.id,
      c.studentS2.id,
      c.studentS3.id,
      c.studentS4.id,
    ];
    const reportWaveCount = await db.$count(
      notifications,
      and(
        inArray(notifications.userId, actorIds),
        inArray(notifications.title, [NOTIFS_EN.eventSessionReportReadyTitle, NOTIFS_AR.eventSessionReportReadyTitle])
      )
    );
    expect(reportWaveCount).toBe(0);
    expect(transportSpy.publishCount).toBe(0);
  });

  test("J1 step 2 — Teacher T submits σ1 report + homework: rows land; EXACTLY ONE parent-wave publish to P (en recipient locale)", async () => {
    const c = requireCast();
    transportSpy.clear();
    const logs = recordDomainLogs();
    try {
      const submits = await SessionReportService.submitSessionReport(
        c.teacherT.id,
        c.sigma1.id,
        {
          teacherNotes: VALID_NOTES,
          studentRatingByTeacher: 4,
          homework: { jadid: JADID_BLOCK_SIGMA1, madi: MADI_BLOCK_SIGMA1 },
        },
        LOCALE_EN,
        undefined,
        engineOptions()
      );
      expect(logs.records).toEqual([]);

      // The reports row: exact 6-column shape, server-mapped session linkage, verbatim notes.
      const reportRow = await reportRowBySessionId(c.sigma1.id);
      if (!reportRow) {
        throw new Error("journey: expected the σ1 report row to exist after the valid submit");
      }
      expect(reportRow.sessionId).toBe(c.sigma1.id);
      expect(submits.sessionId).toBe(c.sigma1.id);
      tracked.register(reports, reportRow.id);

      // The home_work row: both tracks mapped, grades structurally NULL (assigned but ungraded).
      const homeworkRow = await homeworkRowBySessionId(c.sigma1.id);
      if (!homeworkRow) {
        throw new Error("journey: expected the σ1 home_work row to exist after the valid submit");
      }
      expect(homeworkRow.sessionId).toBe(c.sigma1.id);
      tracked.register(homeWork, homeworkRow.id);

      // EXACTLY ONE report-wave row for the student AND ONE for the linked
      // parent — composed in EACH recipient's persisted locale (en for both
      // S1 and P here). Each publish addresses exactly one recipient.
      const studentWaves = await completionRowsFor(c.studentS1.id, c.sigma1.id);
      const parentWaves = await completionRowsFor(c.parentP.id, c.sigma1.id);
      expect(studentWaves).toHaveLength(1);
      expect(parentWaves).toHaveLength(1);
      const studentWave = studentWaves[0];
      const parentWave = parentWaves[0];
      if (!studentWave || !parentWave) {
        throw new Error("journey: expected one student wave and one parent wave for σ1");
      }
      tracked.register(notifications, studentWave.id);
      tracked.register(notifications, parentWave.id);

      // Recipient-locale composition: both rows carry the polymorphic
      // session pointer (RELATED_ENTITY_TYPE + σ1's id) and the report-wave
      // title in the RECIPIENT's persisted locale (en for both here). The
      // parent-wave body carries the counterparty names only.
      expect(studentWave.relatedEntityType).toBe(RELATED_ENTITY_TYPE);
      expect(studentWave.relatedEntityId).toBe(c.sigma1.id);
      expect(studentWave.title).toBe(NOTIFS_EN.eventSessionReportReadyTitle);
      expect(studentWave.body).toBe(NOTIFS_EN.eventSessionReportReadyBody(c.teacherT.fullName));
      expect(parentWave.relatedEntityType).toBe(RELATED_ENTITY_TYPE);
      expect(parentWave.relatedEntityId).toBe(c.sigma1.id);
      expect(parentWave.title).toBe(NOTIFS_EN.eventSessionReportReadyTitle);
      expect(parentWave.body).toBe(
        NOTIFS_EN.eventSessionReportReadyParentBody(c.studentS1.fullName, c.teacherT.fullName)
      );

      // EXACTLY 2 publishes: one envelope per recipient (student first,
      // then parent — the engine's deterministic emission order).
      expect(transportSpy.publishCount).toBe(2);
      const newPublishes = transportSpy.calls.slice(0, 2);
      expect(
        newPublishes.map(publish => JSON.stringify(publish.userIds)).toSorted((a, b) => a.localeCompare(b))
      ).toEqual([c.parentP.id, c.studentS1.id].map(id => JSON.stringify([id])).toSorted((a, b) => a.localeCompare(b)));

      // The engine claim keys are the deterministic per-recipient report keys.
      const expectedKeys = new Set([
        buildEmitClaimKey(
          [c.studentS1.id],
          NotificationType.SessionCompletion,
          `session:${String(c.sigma1.id)}:report`
        ),
        buildEmitClaimKey([c.parentP.id], NotificationType.SessionCompletion, `session:${String(c.sigma1.id)}:report`),
      ]);
      expect(new Set(claimCache.claimedKeys)).toEqual(expectedKeys);

      // Isolation: P2 (foreign to S1) holds zero report-wave rows for σ1.
      expect(await completionRowsFor(c.parentP2.id, c.sigma1.id)).toHaveLength(0);
      expect(await completionRowsFor(c.studentS3.id, c.sigma1.id)).toHaveLength(0);
    } finally {
      logs.stop();
    }
  });

  test("J1 step 3 — Parent P reads σ1 surfaces: list contains S1; reports/homework/progress/sessions each return σ1's row", async () => {
    const c = requireCast();
    transportSpy.clear();

    // The portal list contains S1 (the linked child).
    const children = await ParentMonitoringService.listLinkedChildren(c.parentP.id, LOCALE_EN);
    expect(children).toHaveLength(1);
    const child = children[0];
    if (!child) {
      throw new Error("journey: expected the linked-children list to contain S1");
    }
    expect(child.id).toBe(c.studentS1.id);
    expect(child.fullName).toBe(c.studentS1.fullName);

    // Reports: exactly one row for σ1, carrying the submitted notes + rating.
    const reportPage: ParentReportPageReturnType = await ParentMonitoringService.listChildReports(
      c.parentP.id,
      c.studentS1.id,
      undefined,
      LOCALE_EN
    );
    expect(reportPage.totalCount).toBe(1);
    expect(reportPage.items).toHaveLength(1);
    const reportEntry = reportPage.items[0];
    if (!reportEntry) {
      throw new Error("journey: expected one report entry for σ1");
    }
    expect(reportEntry.sessionId).toBe(c.sigma1.id);
    expect(reportEntry.sessionStatus).toBe(SessionStatus.Completed);
    expect(reportEntry.teacherNotes).toBe(VALID_NOTES);
    expect(reportEntry.studentRatingByTeacher).toBe(4);

    // Homework: exactly one row for σ1, with both Jadid + Madi tracks mapped.
    const homeworkPage: ParentHomeworkPageReturnType = await ParentMonitoringService.listChildHomework(
      c.parentP.id,
      c.studentS1.id,
      undefined,
      LOCALE_EN
    );
    expect(homeworkPage.totalCount).toBe(1);
    expect(homeworkPage.items).toHaveLength(1);
    const homeworkEntry = homeworkPage.items[0];
    if (!homeworkEntry) {
      throw new Error("journey: expected one homework entry for σ1");
    }
    expect(homeworkEntry.sessionId).toBe(c.sigma1.id);
    if (!homeworkEntry.jadid) {
      throw new Error("journey: expected the σ1 homework Jadid track to be present");
    }
    expect(homeworkEntry.jadid.surahJuz).toBe(JADID_BLOCK_SIGMA1.surahJuz);
    expect(homeworkEntry.jadid.fromAyah).toBe(JADID_BLOCK_SIGMA1.fromAyah);
    expect(homeworkEntry.jadid.toAyah).toBe(JADID_BLOCK_SIGMA1.toAyah);
    expect(homeworkEntry.jadid.grade).toBeNull();
    if (!homeworkEntry.madi) {
      throw new Error("journey: expected the σ1 homework Madi track to be present");
    }
    expect(homeworkEntry.madi.surahJuz).toBe(MADI_BLOCK_SIGMA1.surahJuz);
    expect(homeworkEntry.madi.fromAyah).toBe(MADI_BLOCK_SIGMA1.fromAyah);
    expect(homeworkEntry.madi.toAyah).toBe(MADI_BLOCK_SIGMA1.toAyah);
    expect(homeworkEntry.madi.grade).toBeNull();

    // Progress: zero progress rows (the progress table has no writers); the
    // latest positions echo σ1's homework tracks (Jadid + Madi).
    const progress: ParentChildProgressReturnType = await ParentMonitoringService.getChildProgress(
      c.parentP.id,
      c.studentS1.id,
      LOCALE_EN
    );
    expect(progress.child.id).toBe(c.studentS1.id);
    expect(progress.child.fullName).toBe(c.studentS1.fullName);
    expect(progress.progressRowCount).toBe(0);
    if (!progress.latestJadidPosition) {
      throw new Error("journey: expected the σ1 progress latest Jadid position to be present");
    }
    expect(progress.latestJadidPosition.surahJuz).toBe(JADID_BLOCK_SIGMA1.surahJuz);
    expect(progress.latestJadidPosition.fromAyah).toBe(JADID_BLOCK_SIGMA1.fromAyah);
    expect(progress.latestJadidPosition.toAyah).toBe(JADID_BLOCK_SIGMA1.toAyah);
    if (!progress.latestMadiPosition) {
      throw new Error("journey: expected the σ1 progress latest Madi position to be present");
    }
    expect(progress.latestMadiPosition.surahJuz).toBe(MADI_BLOCK_SIGMA1.surahJuz);

    // Sessions: exactly one row for σ1, terminal, with started/ended stamps.
    const sessionsPage: ParentAttendancePageReturnType = await ParentMonitoringService.listChildSessions(
      c.parentP.id,
      c.studentS1.id,
      undefined,
      LOCALE_EN
    );
    expect(sessionsPage.totalCount).toBe(1);
    expect(sessionsPage.items).toHaveLength(1);
    const sessionEntry = sessionsPage.items[0];
    if (!sessionEntry) {
      throw new Error("journey: expected one attendance entry for σ1");
    }
    expect(sessionEntry.id).toBe(c.sigma1.id);
    expect(sessionEntry.status).toBe(SessionStatus.Completed);
    expect(sessionEntry.startedAt).not.toBeNull();
    expect(sessionEntry.endedAt).not.toBeNull();

    // Reads never publish.
    expect(transportSpy.publishCount).toBe(0);
  });

  test("J1 step 4 — Deep-link: parentChildReports(S1).items contains a row whose sessionId === σ1.id (the deep-link target)", async () => {
    const c = requireCast();
    transportSpy.clear();
    const reportPage = await ParentMonitoringService.listChildReports(
      c.parentP.id,
      c.studentS1.id,
      undefined,
      LOCALE_EN
    );
    // The deep-link contract: the reports list contains a row whose
    // sessionId is the deep-link target. The frontend resolves `?session=X`
    // by filtering/scrolling to that row — the service layer guarantees the
    // row is in the list (or, if the link is severed, the entire list is
    // unreadable and a 403 fires).
    const deepLinkedRow = reportPage.items.find(item => item.sessionId === c.sigma1.id);
    expect(deepLinkedRow).toBeDefined();
    if (!deepLinkedRow) {
      throw new Error("journey: expected the σ1 deep-link target row to be in the reports list");
    }
    expect(deepLinkedRow.teacherNotes).toBe(VALID_NOTES);
    expect(deepLinkedRow.studentRatingByTeacher).toBe(4);
  });

  test("J1 step 5 — DENIAL: P2 (never linked to S1) reads S1 → constant 403, zero data", async () => {
    const c = requireCast();
    transportSpy.clear();
    const logs = recordDomainLogs();
    try {
      // P2 is a real parent (linked to S3/S4) — but never linked to S1.
      // Every per-student portal read of S1 must deny through the real
      // `requireLinkedChild` gate (the foreign-parent arm).
      const fingerprints = new Set<string>();
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.getChildProgress(c.parentP2.id, c.studentS1.id, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.listChildSessions(c.parentP2.id, c.studentS1.id, undefined, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.listChildReports(c.parentP2.id, c.studentS1.id, undefined, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.listChildHomework(c.parentP2.id, c.studentS1.id, undefined, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );

      // Constant-shape oracle: every per-student denial is byte-identical.
      expect(fingerprints.size).toBe(1);

      // P2's listLinkedChildren is unaffected — it returns P2's own children
      // (S3, S4), NOT S1 (P2 is foreign to S1).
      const p2Children = await ParentMonitoringService.listLinkedChildren(c.parentP2.id, LOCALE_EN);
      const p2ChildIds = p2Children.map((child: ParentLinkedChildReturnType) => child.id);
      expect(p2ChildIds).not.toContain(c.studentS1.id);
      expect(p2ChildIds).toContain(c.studentS3.id);
      expect(p2ChildIds).toContain(c.studentS4.id);

      // Exactly one bounded log per denial (the constant-shape logging contract).
      expect(logs.records).toHaveLength(4);
      for (const record of logs.records) {
        expect(record.code).toBe("FORBIDDEN");
      }

      // Zero side effects: P2's read denials publish nothing.
      expect(transportSpy.publishCount).toBe(0);
    } finally {
      logs.stop();
    }
  });

  // ----- J2 — Severed link revokes access immediately -----

  test("J2 step 1 — Sever (clear parentId): P's list EXCLUDES S1; EVERY portal read of S1 immediately 403s (constant shape)", async () => {
    const c = requireCast();
    transportSpy.clear();
    const logs = recordDomainLogs();
    try {
      // Pre-severance: P can still read S1 (the link is in force).
      expect(await studentParentId(c.studentS1.id)).toBe(c.parentP.id);
      const beforeChildren = await ParentMonitoringService.listLinkedChildren(c.parentP.id, LOCALE_EN);
      expect(beforeChildren.map(child => child.id)).toContain(c.studentS1.id);

      // SEVER: clear `students.parent_id` for S1 (committed write —
      // emulates the severance flow that lives outside this ticket).
      await severLinkClearParentId(c.studentS1.id);
      expect(await studentParentId(c.studentS1.id)).toBeNull();

      // Post-severance: the children list EXCLUDES S1 (no cache may
      // extend visibility beyond DB truth — the list re-reads every call).
      const afterChildren = await ParentMonitoringService.listLinkedChildren(c.parentP.id, LOCALE_EN);
      expect(afterChildren.map(child => child.id)).not.toContain(c.studentS1.id);

      // EVERY per-student portal read of S1 immediately 403s — the
      // `requireLinkedChild` gate re-reads the grant inside the SAME
      // transaction as the data reads; a severed grant fails the gate
      // before any data row is returned.
      const fingerprints = new Set<string>();
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.getChildProgress(c.parentP.id, c.studentS1.id, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.listChildSessions(c.parentP.id, c.studentS1.id, undefined, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.listChildReports(c.parentP.id, c.studentS1.id, undefined, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.listChildHomework(c.parentP.id, c.studentS1.id, undefined, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );

      // Constant-shape oracle: every denial is byte-identical.
      expect(fingerprints.size).toBe(1);

      // The σ1 report/homework rows still exist (severance does not erase
      // history) — they are merely unreadable through the portal. P's
      // direct DB read confirms the row survives.
      const survivingReport = await reportRowBySessionId(c.sigma1.id);
      expect(survivingReport).not.toBeNull();
      const survivingHomework = await homeworkRowBySessionId(c.sigma1.id);
      expect(survivingHomework).not.toBeNull();

      // Exactly one bounded log per denial; zero publishes.
      expect(logs.records).toHaveLength(4);
      expect(transportSpy.publishCount).toBe(0);
    } finally {
      logs.stop();
    }
  });

  test("J2 step 2 — Sever (soft-delete): re-link + flip isDeleted → same constant denial shape; no branch disclosure", async () => {
    const c = requireCast();
    transportSpy.clear();
    const logs = recordDomainLogs();
    try {
      // Re-link S1 → P first (so the soft-delete arm is isolated from the
      // cleared-parentId arm of step 1).
      await restoreLink(c.studentS1.id, c.parentP.id);
      expect(await studentParentId(c.studentS1.id)).toBe(c.parentP.id);

      // Pre-severance: P can read S1 again (link is in force; soft-delete
      // not yet flipped).
      const beforeChildren = await ParentMonitoringService.listLinkedChildren(c.parentP.id, LOCALE_EN);
      expect(beforeChildren.map(child => child.id)).toContain(c.studentS1.id);

      // SEVER via soft-delete: flip `users.isDeleted = true` (the admin-
      // domain state change). The link row still names P, but the gate's
      // `users.isDeleted` re-check fails the grant.
      const governance = await setGovernanceFixture(c.studentS1.id, {
        isDeleted: true,
      });
      expect(governance.isDeleted).toBe(true);

      // Post-severance: the children list EXCLUDES S1 (the list predicate
      // joins `users` and filters `is_deleted = false`).
      const afterChildren = await ParentMonitoringService.listLinkedChildren(c.parentP.id, LOCALE_EN);
      expect(afterChildren.map(child => child.id)).not.toContain(c.studentS1.id);

      // EVERY per-student portal read of S1 immediately 403s — same
      // constant shape as the cleared-parentId arm (no branch disclosure
      // between the two severance paths).
      const fingerprints = new Set<string>();
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.getChildProgress(c.parentP.id, c.studentS1.id, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.listChildSessions(c.parentP.id, c.studentS1.id, undefined, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.listChildReports(c.parentP.id, c.studentS1.id, undefined, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.listChildHomework(c.parentP.id, c.studentS1.id, undefined, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );

      // Constant-shape oracle: every denial is byte-identical WITHIN this
      // arm AND across the two arms (cleared-parentId ≡ soft-delete).
      expect(fingerprints.size).toBe(1);

      // Exactly one bounded log per denial; zero publishes.
      expect(logs.records).toHaveLength(4);
      expect(transportSpy.publishCount).toBe(0);
    } finally {
      logs.stop();
    }
  });

  // ----- J3 — Unlinked parent probes foreign/nonexistent ids -----

  test("J3 step 1 — EN locale: foreign/nonexistent/malformed probes byte-identical constant 403", async () => {
    const c = requireCast();
    transportSpy.clear();
    const logs = recordDomainLogs();
    try {
      // P2 (linked to S3/S4 but never to S1/S2) probes four mismatch
      // causes in en: a foreign-severed id (S1 — soft-deleted AND
      // severed from P, but for P2 it is simply foreign), a
      // never-linked id (S2 — exists but was never linked to anyone),
      // a nonexistent id (ABSENT_STUDENT_ID — no row), and a malformed
      // id (MALFORMED_STUDENT_ID — non-positive).
      const fingerprints = new Set<string>();
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.getChildProgress(c.parentP2.id, c.studentS1.id, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.getChildProgress(c.parentP2.id, c.studentS2.id, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.getChildProgress(c.parentP2.id, ABSENT_STUDENT_ID, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.getChildProgress(c.parentP2.id, MALFORMED_STUDENT_ID, LOCALE_EN),
          ERRORS_EN.forbidden
        )
      );

      // Constant-shape oracle: every cause is byte-identical (code + message).
      expect(fingerprints.size).toBe(1);

      // Abuse-repeat arm: re-probing the same foreign id yields the SAME
      // fingerprint — no state drift across repeats.
      const repeatFingerprint = await expectForbiddenFingerprint(
        () => ParentMonitoringService.getChildProgress(c.parentP2.id, c.studentS1.id, LOCALE_EN),
        ERRORS_EN.forbidden
      );
      expect(repeatFingerprint).toBe([...fingerprints][0] ?? "");

      // The list read stays unaffected — P2's own children are unchanged.
      const p2Children = await ParentMonitoringService.listLinkedChildren(c.parentP2.id, LOCALE_EN);
      expect(p2Children.map(child => child.id).toSorted((a, b) => a - b)).toEqual(
        [c.studentS3.id, c.studentS4.id].toSorted((a, b) => a - b)
      );

      // Exactly one bounded log per denial (the constant-shape logging contract).
      expect(logs.records).toHaveLength(5);
      expect(transportSpy.publishCount).toBe(0);
    } finally {
      logs.stop();
    }
  });

  test("J3 step 2 — AR locale: same probes byte-identical constant 403 (localized copy per locale)", async () => {
    const c = requireCast();
    transportSpy.clear();
    const logs = recordDomainLogs();
    try {
      // The same probe set in ar — the `code` is `FORBIDDEN` in both
      // locales; the message is locale-composed copy (different per locale).
      const fingerprints = new Set<string>();
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.getChildProgress(c.parentP2.id, c.studentS1.id, LOCALE_AR),
          ERRORS_AR.forbidden
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.getChildProgress(c.parentP2.id, c.studentS2.id, LOCALE_AR),
          ERRORS_AR.forbidden
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.getChildProgress(c.parentP2.id, ABSENT_STUDENT_ID, LOCALE_AR),
          ERRORS_AR.forbidden
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(
          () => ParentMonitoringService.getChildProgress(c.parentP2.id, MALFORMED_STUDENT_ID, LOCALE_AR),
          ERRORS_AR.forbidden
        )
      );

      // Constant-shape oracle WITHIN ar: every cause is byte-identical.
      expect(fingerprints.size).toBe(1);

      expect(logs.records).toHaveLength(4);
      expect(transportSpy.publishCount).toBe(0);
    } finally {
      logs.stop();
    }
  });

  test("J3 step 3 — Cross-locale: code = FORBIDDEN in both en and ar; copy differs (locale-composed)", async () => {
    const c = requireCast();
    transportSpy.clear();
    const logs = recordDomainLogs();
    try {
      // Capture the en-locale and ar-locale denial errors for the SAME
      // foreign id (S1, probed by P2).
      const enError = await catchJourneyError(() =>
        ParentMonitoringService.getChildProgress(c.parentP2.id, c.studentS1.id, LOCALE_EN)
      );
      const arError = await catchJourneyError(() =>
        ParentMonitoringService.getChildProgress(c.parentP2.id, c.studentS1.id, LOCALE_AR)
      );
      expect(enError).toBeInstanceOf(ForbiddenError);
      expect(arError).toBeInstanceOf(ForbiddenError);
      if (!(enError instanceof DomainError) || !(arError instanceof DomainError)) {
        throw new Error("journey: expected both denial errors to be DomainError instances");
      }

      // The `code` is `FORBIDDEN` in BOTH locales (the wire `extensions.code`).
      expect(enError.code).toBe("FORBIDDEN");
      expect(arError.code).toBe("FORBIDDEN");
      expect(enError.code).toBe(arError.code);

      // The message DIFFERS across locales (locale-composed copy —
      // observer-safe in both directions, never a fixed English string).
      expect(enError.message).toContain(ERRORS_EN.forbidden);
      expect(arError.message).toContain(ERRORS_AR.forbidden);
      expect(enError.message).not.toBe(arError.message);
    } finally {
      logs.stop();
    }
  });

  // ----- J4 — Multi-child parent switches views -----

  test("J4 step 1 — Teacher T submits σ3 + σ4 reports/homework: each submission publishes ONE parent-wave to P2 (ar recipient locale)", async () => {
    const c = requireCast();
    transportSpy.clear();
    const logs = recordDomainLogs();
    try {
      // σ3 submission: report + Madi-only homework (distinct from σ1/σ4).
      await SessionReportService.submitSessionReport(
        c.teacherT.id,
        c.sigma3.id,
        {
          teacherNotes: VALID_NOTES,
          studentRatingByTeacher: 5,
          homework: { jadid: JADID_BLOCK_SIGMA3, madi: MADI_BLOCK_SIGMA3 },
        },
        LOCALE_EN,
        undefined,
        engineOptions()
      );
      const sigma3Report = await reportRowBySessionId(c.sigma3.id);
      if (!sigma3Report) {
        throw new Error("journey: expected the σ3 report row");
      }
      tracked.register(reports, sigma3Report.id);
      const sigma3Homework = await homeworkRowBySessionId(c.sigma3.id);
      if (!sigma3Homework) {
        throw new Error("journey: expected the σ3 home_work row");
      }
      tracked.register(homeWork, sigma3Homework.id);
      const sigma3StudentWaves = await completionRowsFor(c.studentS3.id, c.sigma3.id);
      const sigma3ParentWaves = await completionRowsFor(c.parentP2.id, c.sigma3.id);
      expect(sigma3StudentWaves).toHaveLength(1);
      expect(sigma3ParentWaves).toHaveLength(1);
      const sigma3StudentWave = sigma3StudentWaves[0];
      const sigma3ParentWave = sigma3ParentWaves[0];
      if (!sigma3StudentWave || !sigma3ParentWave) {
        throw new Error("journey: expected one student wave and one parent wave for σ3");
      }
      tracked.register(notifications, sigma3StudentWave.id);
      tracked.register(notifications, sigma3ParentWave.id);

      // Recipient-locale composition: S3's wave composes in en (S3's
      // persisted locale); P2's wave composes in ar (P2's persisted locale).
      expect(sigma3StudentWave.title).toBe(NOTIFS_EN.eventSessionReportReadyTitle);
      expect(sigma3StudentWave.body).toBe(NOTIFS_EN.eventSessionReportReadyBody(c.teacherT.fullName));
      expect(sigma3ParentWave.title).toBe(NOTIFS_AR.eventSessionReportReadyTitle);
      expect(sigma3ParentWave.body).toBe(
        NOTIFS_AR.eventSessionReportReadyParentBody(c.studentS3.fullName, c.teacherT.fullName)
      );
      expect(sigma3ParentWave.relatedEntityType).toBe(RELATED_ENTITY_TYPE);
      expect(sigma3ParentWave.relatedEntityId).toBe(c.sigma3.id);

      // σ3 publishes: one envelope to S3 (en recipient locale), one to P2 (ar recipient locale).
      expect(transportSpy.publishCount).toBe(2);
      const sigma3Publishes = transportSpy.calls.slice(0, 2);
      expect(sigma3Publishes.map(p => JSON.stringify(p.userIds)).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [c.parentP2.id, c.studentS3.id].map(id => JSON.stringify([id])).toSorted((a, b) => a.localeCompare(b))
      );

      transportSpy.clear();

      // σ4 submission: report + both homework tracks (distinct from σ3).
      await SessionReportService.submitSessionReport(
        c.teacherT.id,
        c.sigma4.id,
        {
          teacherNotes: VALID_NOTES,
          studentRatingByTeacher: 3,
          homework: { jadid: JADID_BLOCK_SIGMA4, madi: MADI_BLOCK_SIGMA4 },
        },
        LOCALE_EN,
        undefined,
        engineOptions()
      );
      const sigma4Report = await reportRowBySessionId(c.sigma4.id);
      if (!sigma4Report) {
        throw new Error("journey: expected the σ4 report row");
      }
      tracked.register(reports, sigma4Report.id);
      const sigma4Homework = await homeworkRowBySessionId(c.sigma4.id);
      if (!sigma4Homework) {
        throw new Error("journey: expected the σ4 home_work row");
      }
      tracked.register(homeWork, sigma4Homework.id);
      const sigma4StudentWaves = await completionRowsFor(c.studentS4.id, c.sigma4.id);
      const sigma4ParentWaves = await completionRowsFor(c.parentP2.id, c.sigma4.id);
      expect(sigma4StudentWaves).toHaveLength(1);
      expect(sigma4ParentWaves).toHaveLength(1);
      const sigma4StudentWave = sigma4StudentWaves[0];
      const sigma4ParentWave = sigma4ParentWaves[0];
      if (!sigma4StudentWave || !sigma4ParentWave) {
        throw new Error("journey: expected one student wave and one parent wave for σ4");
      }
      tracked.register(notifications, sigma4StudentWave.id);
      tracked.register(notifications, sigma4ParentWave.id);

      // Recipient-locale composition: S4's wave in en; P2's wave in ar
      // (same persisted-locale contract as σ3 — the recipient's locale,
      // never the actor's locale argument).
      expect(sigma4StudentWave.title).toBe(NOTIFS_EN.eventSessionReportReadyTitle);
      expect(sigma4ParentWave.title).toBe(NOTIFS_AR.eventSessionReportReadyTitle);
      expect(sigma4ParentWave.body).toBe(
        NOTIFS_AR.eventSessionReportReadyParentBody(c.studentS4.fullName, c.teacherT.fullName)
      );
      expect(sigma4ParentWave.relatedEntityType).toBe(RELATED_ENTITY_TYPE);
      expect(sigma4ParentWave.relatedEntityId).toBe(c.sigma4.id);

      // σ4 publishes: one envelope to S4 (en), one to P2 (ar).
      expect(transportSpy.publishCount).toBe(2);
      const sigma4Publishes = transportSpy.calls.slice(0, 2);
      expect(sigma4Publishes.map(p => JSON.stringify(p.userIds)).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [c.parentP2.id, c.studentS4.id].map(id => JSON.stringify([id])).toSorted((a, b) => a.localeCompare(b))
      );

      expect(logs.records).toEqual([]);
    } finally {
      logs.stop();
    }
  });

  test("J4 step 2 — P2 listLinkedChildren returns [S3, S4] in stable createdAt-ASC order (list correctness)", async () => {
    const c = requireCast();
    transportSpy.clear();
    const children = await ParentMonitoringService.listLinkedChildren(c.parentP2.id, LOCALE_EN);

    // The list contains EXACTLY P2's two confirmed-linked children —
    // nothing else (S1/S2 are excluded; they are not P2's children).
    expect(children).toHaveLength(2);
    const childIds = children.map(child => child.id);
    expect(childIds).toContain(c.studentS3.id);
    expect(childIds).toContain(c.studentS4.id);

    // Stable oldest-first order (createdAt ASC, id ASC tiebreak) — the
    // repo pins this ordering; the switcher's first-child auto-select
    // depends on it.
    const orderedIds = children.map(child => child.id);
    const sortedIds = [...orderedIds].toSorted((a, b) => a - b);
    expect(orderedIds).toEqual(sortedIds);

    // Each child's full name is shown unmasked (masking applies only to
    // pre-confirmation discovery surfaces — confirmed children's names
    // are visible to their own parent).
    for (const child of children) {
      expect(child.fullName).toContain(RUN_PREFIX);
    }
  });

  test("J4 step 3 — P2 per-child reads return ONLY that child's rows (no cross-contamination between S3 and S4)", async () => {
    const c = requireCast();
    transportSpy.clear();

    // S3's reports: exactly σ3's row, NOT σ4's.
    const s3Reports = await ParentMonitoringService.listChildReports(
      c.parentP2.id,
      c.studentS3.id,
      undefined,
      LOCALE_EN
    );
    expect(s3Reports.totalCount).toBe(1);
    expect(s3Reports.items).toHaveLength(1);
    const s3Report = s3Reports.items[0];
    if (!s3Report) {
      throw new Error("journey: expected one report for S3");
    }
    expect(s3Report.sessionId).toBe(c.sigma3.id);
    expect(s3Report.studentRatingByTeacher).toBe(5);

    // S4's reports: exactly σ4's row, NOT σ3's.
    const s4Reports = await ParentMonitoringService.listChildReports(
      c.parentP2.id,
      c.studentS4.id,
      undefined,
      LOCALE_EN
    );
    expect(s4Reports.totalCount).toBe(1);
    expect(s4Reports.items).toHaveLength(1);
    const s4Report = s4Reports.items[0];
    if (!s4Report) {
      throw new Error("journey: expected one report for S4");
    }
    expect(s4Report.sessionId).toBe(c.sigma4.id);
    expect(s4Report.studentRatingByTeacher).toBe(3);

    // S3's homework: Jadid surah is SurahAlBaqarah (σ3's); Madi is Juz2.
    const s3Homework = await ParentMonitoringService.listChildHomework(
      c.parentP2.id,
      c.studentS3.id,
      undefined,
      LOCALE_EN
    );
    expect(s3Homework.totalCount).toBe(1);
    const s3HwEntry = s3Homework.items[0];
    if (!s3HwEntry?.jadid || !s3HwEntry.madi) {
      throw new Error("journey: expected σ3's homework with both tracks");
    }
    expect(s3HwEntry.sessionId).toBe(c.sigma3.id);
    expect(s3HwEntry.jadid.surahJuz).toBe(JADID_BLOCK_SIGMA3.surahJuz);
    expect(s3HwEntry.madi.surahJuz).toBe(MADI_BLOCK_SIGMA3.surahJuz);

    // S4's homework: Jadid surah is SurahAalImran (σ4's); Madi is Juz3.
    // NOT σ3's tracks — re-keying on studentId prevents cross-contamination.
    const s4Homework = await ParentMonitoringService.listChildHomework(
      c.parentP2.id,
      c.studentS4.id,
      undefined,
      LOCALE_EN
    );
    expect(s4Homework.totalCount).toBe(1);
    const s4HwEntry = s4Homework.items[0];
    if (!s4HwEntry?.jadid || !s4HwEntry.madi) {
      throw new Error("journey: expected σ4's homework with both tracks");
    }
    expect(s4HwEntry.sessionId).toBe(c.sigma4.id);
    expect(s4HwEntry.jadid.surahJuz).toBe(JADID_BLOCK_SIGMA4.surahJuz);
    expect(s4HwEntry.madi.surahJuz).toBe(MADI_BLOCK_SIGMA4.surahJuz);
    expect(s4HwEntry.jadid.surahJuz).not.toBe(JADID_BLOCK_SIGMA3.surahJuz);

    // Progress: each child's latest position echoes that child's newest
    // homework tracks — NOT the sibling's.
    const s3Progress = await ParentMonitoringService.getChildProgress(c.parentP2.id, c.studentS3.id, LOCALE_EN);
    expect(s3Progress.child.id).toBe(c.studentS3.id);
    if (!s3Progress.latestJadidPosition) {
      throw new Error("journey: expected S3's latest Jadid position");
    }
    expect(s3Progress.latestJadidPosition.surahJuz).toBe(JADID_BLOCK_SIGMA3.surahJuz);
    if (!s3Progress.latestMadiPosition) {
      throw new Error("journey: expected S3's latest Madi position");
    }
    expect(s3Progress.latestMadiPosition.surahJuz).toBe(MADI_BLOCK_SIGMA3.surahJuz);

    const s4Progress = await ParentMonitoringService.getChildProgress(c.parentP2.id, c.studentS4.id, LOCALE_EN);
    expect(s4Progress.child.id).toBe(c.studentS4.id);
    if (!s4Progress.latestJadidPosition) {
      throw new Error("journey: expected S4's latest Jadid position");
    }
    expect(s4Progress.latestJadidPosition.surahJuz).toBe(JADID_BLOCK_SIGMA4.surahJuz);
    if (!s4Progress.latestMadiPosition) {
      throw new Error("journey: expected S4's latest Madi position");
    }
    expect(s4Progress.latestMadiPosition.surahJuz).toBe(MADI_BLOCK_SIGMA4.surahJuz);

    // Sessions: each child sees only their own sessions (σ3 for S3, σ4 for S4).
    const s3Sessions = await ParentMonitoringService.listChildSessions(
      c.parentP2.id,
      c.studentS3.id,
      undefined,
      LOCALE_EN
    );
    expect(s3Sessions.totalCount).toBe(1);
    expect(s3Sessions.items[0]?.id).toBe(c.sigma3.id);

    const s4Sessions = await ParentMonitoringService.listChildSessions(
      c.parentP2.id,
      c.studentS4.id,
      undefined,
      LOCALE_EN
    );
    expect(s4Sessions.totalCount).toBe(1);
    expect(s4Sessions.items[0]?.id).toBe(c.sigma4.id);

    // Reads never publish.
    expect(transportSpy.publishCount).toBe(0);
  });

  afterAll(async () => {
    // Tracked teardown — deletes run in REVERSE registration order, so the
    // notification + report + homework rows go FIRST, then the session +
    // idempotency rows, then the role-child rows, then the users rows
    // (the RESTRICT foreign keys of session + reports). The try/finally
    // guarantees the cleanup runs EVEN IF a step assertion failed — the
    // suite MUST leave zero residue regardless of where it stopped.
    try {
      await tracked.cleanup();
    } finally {
      // Mandatory zero-residue re-probes after teardown — by tracked id set
      // AND by the per-run prefix (nothing with this run's identity remains).
      const c = cast;
      if (c !== null) {
        const ids = [
          c.teacherT.id,
          c.parentP.id,
          c.parentP2.id,
          c.studentS1.id,
          c.studentS2.id,
          c.studentS3.id,
          c.studentS4.id,
        ];
        const sessionIds = [c.sigma1.id, c.sigma3.id, c.sigma4.id];
        const [
          userResidue,
          studentResidue,
          parentResidue,
          teacherResidue,
          sessionResidue,
          reportResidue,
          homeworkResidue,
          notificationResidue,
          prefixResidue,
        ] = await Promise.all([
          db.$count(users, inArray(users.id, ids)),
          db.$count(students, inArray(students.id, ids)),
          db.$count(parents, inArray(parents.id, ids)),
          db.$count(teacher, inArray(teacher.id, ids)),
          db.$count(session, inArray(session.id, sessionIds)),
          db.$count(reports, inArray(reports.sessionId, sessionIds)),
          db.$count(homeWork, inArray(homeWork.sessionId, sessionIds)),
          db.$count(notifications, inArray(notifications.userId, ids)),
          db.$count(users, like(users.email, `${RUN_PREFIX}%`)),
        ]);
        expect(userResidue).toBe(0);
        expect(studentResidue).toBe(0);
        expect(parentResidue).toBe(0);
        expect(teacherResidue).toBe(0);
        expect(sessionResidue).toBe(0);
        expect(reportResidue).toBe(0);
        expect(homeworkResidue).toBe(0);
        expect(notificationResidue).toBe(0);
        expect(prefixResidue).toBe(0);
      }
    }
  });
});
