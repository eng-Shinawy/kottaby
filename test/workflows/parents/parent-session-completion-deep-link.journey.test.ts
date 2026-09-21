/**
 * Cross-actor journey — the parent's session-completion notification deep
 * link, from the teacher's report submission to the portal landing.
 *
 * The notification row is deliberately minimal: it names the wire type and
 * carries the polymorphic (relatedEntityType, relatedEntityId) pointer —
 * for a session-family wave that pointer is the SESSION id, never a child
 * id. Turning the row into the portal's report view therefore takes a
 * server-side session→child resolution behind the parent's link gate, plus
 * a landing read that surfaces the session's report row.
 *
 * Step map (each step attributed to one actor; later steps observe the
 * shared state earlier steps committed):
 *  - Step 1 — Teacher: submits the completed session's report + homework.
 *    The completion wave prepares receipts for the student AND the linked
 *    parent; dispatch is SPIED at the injected fan-out transport seam and
 *    published strictly after the submission's own commit — nothing
 *    reaches a real channel.
 *  - Step 2 — System: the parent's inbox holds exactly one report-wave row
 *    for the session, carrying the drawer/feed-resolvable triple (wire
 *    type, relatedEntityType="session", relatedEntityId=<session id>).
 *  - Step 3 — Parent: the session-target read resolves the session id to
 *    the closed { sessionId, studentId } pair naming the LINKED child.
 *  - Step 4 — Parent: the resolved child's reports read contains the
 *    session's report row (sessionId, teacherNotes, studentRatingByTeacher),
 *    and the pinned portal landing URL
 *    /parent/children/<studentId>?tab=reports&session=<id> is
 *    constructible from the resolved pair alone.
 *  - Step 5 — Negative (unlinked child): the teacher submits the unlinked
 *    student's report — the student still receives their row, and the wave
 *    fails closed with NO parent emission (exactly one dispatch, addressed
 *    to the student only).
 *  - Step 6 — Negative (denial probes): a foreign parent probing the linked
 *    pair's session, the same parent probing a nonexistent session id, a
 *    teacher, and a student all hit the SAME constant localized
 *    ForbiddenError — byte-identical fingerprints across every cause
 *    (existence non-disclosure), zero data, zero publishes.
 *
 * Cast (real users rows + real role-child rows; en persisted locale):
 *  - Teacher T  — certified; produces both sessions and both reports.
 *  - Parent P   — linked to student S1 (the deep-link consumer).
 *  - Parent PF  — never linked to S1/S2 (the foreign-parent probe).
 *  - Student S1 — linked to P; owns the linked session σ1.
 *  - Student S2 — unlinked (the fail-closed emission arm); owns σ2.
 *
 * Harness (shared helpers at `test/workflows/helpers/`):
 *  - `TrackedFixtures` — the committed-fixture registry; `afterAll`
 *    hard-deletes every registered row in reverse-registration order
 *    (FK-safe) and re-probes the DB for zero residue (a leak fails the
 *    suite loudly).
 *  - `SpiedFanoutTransport` — the in-process fan-out transport spy
 *    installed at the engine's `options.transport` injection seam; every
 *    publish is recorded (recipients + payload), none is delivered.
 *  - `catchJourneyError` — the try/catch denial-capture helper (never
 *    `expect(...).rejects.toThrow()`).
 *
 * Layer contract (`test/workflows/AGENTS.md`):
 *  - NO `runInRollback` anywhere in this file — services spawn their own
 *    top-level transactions; an outer rollback wrapper would deadlock or
 *    miss committed rows.
 *  - Committed fixtures in `beforeAll` inside ONE committing transaction
 *    (commit-or-nothing: a throwing setup leaves nothing behind).
 *  - Honest authorization only — denials fail through the real gates
 *    (the actor role arm and the linked-child grant arm); assertion copy
 *    comes from `getServerTranslations("en").errorsTranslations`.
 *  - Per-run `jrn_parents_<uuid8>` prefix on every fixture identity field.
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/parents/parent-session-completion-deep-link.journey.test.ts
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
  ParentReportPageReturnType,
  ParentSessionTargetReturnType,
  SessionReturnType,
  UserSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { catchJourneyError, SpiedFanoutTransport, TrackedFixtures } from "@/test/workflows/helpers";

/** Default journey locale (English) — every denial copy resolves through this. */
const LOCALE_EN = "en";

/** English translated error copy source — never hardcoded English expectation strings. */
const ERRORS_EN = getServerTranslations(LOCALE_EN).errorsTranslations;

/** English notification copy — the report-wave composition oracle for the en-locale cast. */
const NOTIFS_EN = getServerTranslations(LOCALE_EN).notificationsTranslations;

/** Per-run unique prefix embedded in every fixture identity field. */
const RUN_PREFIX = `jrn_parents_${randomUUID().slice(0, 8)}`;

/** Session id far beyond any identity sequence — guaranteed absent (nonexistent probe). */
const ABSENT_SESSION_ID = 2_000_000_000;

/** Polymorphic entity pointer every session-family wave row carries. */
const RELATED_ENTITY_TYPE = "session";

/** The pinned portal deep-link landing shape for a completion notification. */
const LANDING_URL_PREFIX = "/parent/children/";
const LANDING_URL_QUERY = "?tab=reports&session=";

/** Valid free-text notes reused by σ1's accepted report submission. */
const NOTES_SIGMA1 = "Steady memorization this session; the revision plan continues next lesson.";

/** Distinct valid notes for σ2's report so cross-session contamination is detectable. */
const NOTES_SIGMA2 = "Unlinked-arm notes: the assignment was accepted and the recitation was clean.";

/** Teacher rating for σ1's report. */
const RATING_SIGMA1 = 4;

/** Distinct teacher rating for σ2's report. */
const RATING_SIGMA2 = 3;

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

/** Jadid + Madi blocks for the σ2 homework assignment (distinct from σ1's). */
const JADID_BLOCK_SIGMA2: HomeWorkBlockInput = {
  fromAyah: 8,
  toAyah: 14,
  surahJuz: SurahJuzRef.SurahAlBaqarah,
};
const MADI_BLOCK_SIGMA2: HomeWorkBlockInput = {
  fromAyah: 6,
  toAyah: 11,
  surahJuz: SurahJuzRef.Juz2,
};

/** Per-run idempotency keys — one per booked session. */
const KEY_SIGMA1 = `${RUN_PREFIX}-k-sigma-1`;
const KEY_SIGMA2 = `${RUN_PREFIX}-k-sigma-2`;

/** Cast bundle — every actor row the journey creates in `beforeAll`. */
interface JourneyCast {
  readonly teacherT: UserSelectType;
  readonly parentP: UserSelectType;
  readonly parentPF: UserSelectType;
  readonly studentS1: UserSelectType;
  readonly studentS2: UserSelectType;
  readonly sigma1: SessionReturnType;
  readonly sigma2: SessionReturnType;
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

/** One recorded domain-log call (code only — copy is never asserted from logs). */
interface DomainLogRecord {
  readonly code: string;
}

/**
 * Installs a recording stub over `logger.logDomainError` so domain
 * rejections stay silent in test output AND become assertable (exactly one
 * bounded log per denial; none on success). Callers MUST `stop()` it
 * (use try/finally).
 */
function recordDomainLogs(): { records: DomainLogRecord[]; stop: () => void } {
  const records: DomainLogRecord[] = [];
  const spy = spyOn(logger, "logDomainError").mockImplementation((_message: string, ctx?: DomainErrorContext) => {
    records.push({ code: ctx?.code ?? "<missing>" });
  });
  return { records, stop: () => spy.mockRestore() };
}

/**
 * Captures the constant-shape ForbiddenError fingerprint of a denial and
 * pins its translated copy. The catchJourneyError helper is the rule-6
 * try/catch oracle — never `expect(...).rejects.toThrow()`.
 */
async function expectForbiddenFingerprint(fn: () => Promise<unknown>): Promise<string> {
  const error = await catchJourneyError(fn);
  expect(error).toBeInstanceOf(ForbiddenError);
  if (!(error instanceof DomainError)) {
    throw new Error(`journey: expected a FORBIDDEN domain denial (got ${error.name})`);
  }
  expect(error.code).toBe("FORBIDDEN");
  expect(error.message).toContain(ERRORS_EN.forbidden);
  return JSON.stringify({ code: error.code, message: error.message });
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

/** Persisted report-wave notification row shape — the inbox-composition oracle. */
interface ReportWaveRow {
  readonly id: number;
  readonly title: string | null;
  readonly body: string | null;
  readonly relatedEntityType: string | null;
  readonly relatedEntityId: number | null;
}

/**
 * Persisted report-wave notification rows for one user, scoped to one
 * session's wave. The dual-confirmation handshake's completion-prompt row
 * shares the SAME wire type and session pointer with the report-ready
 * wave, so the count is scoped to the wave's distinct `title` copy slot
 * in either recipient locale (a user only ever receives waves in their
 * own persisted locale; the prompt composes a different title).
 */
async function completionRowsFor(userId: number, sessionId: number): Promise<readonly ReportWaveRow[]> {
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
        inArray(notifications.title, [NOTIFS_EN.eventSessionReportReadyTitle])
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

/** Fresh read of `students.parent_id` for one student (grant grounding). */
async function studentParentId(studentId: number): Promise<number | null> {
  const rows = await db.select({ parentId: students.parentId }).from(students).where(eq(students.id, studentId));
  return rows.at(0)?.parentId ?? null;
}

describe("Journey — parent session-completion deep link", () => {
  beforeAll(async () => {
    // ONE committing transaction: commit-or-nothing fixture provisioning.
    // Every actor is a REAL users row + its REAL role-child row; every
    // session reaches `completed` through the REAL lifecycle path (never
    // raw status surgery); the link is a committed `students.parent_id`
    // write emulating the shipped link-request mutation's end state.
    const provisioned = await db.transaction(async (tx: DBTransaction): Promise<JourneyCast> => {
      // Teacher T — certified, en persisted locale.
      const teacherT = await createTestUser(tx, {
        role: "teacher",
        locale: LOCALE_EN,
        fullName: `${RUN_PREFIX} teacher T`,
        email: `${RUN_PREFIX}.teacher-t@journey.test`,
      });
      const teacherTRow = await createTestTeacherRow(tx, teacherT.id, { isApproved: true });
      tracked.register(users, teacherT.id);
      tracked.register(teacher, teacherTRow.id);

      // Parent P — en persisted locale, linked to S1 (the deep-link consumer).
      const parentP = await createTestUser(tx, {
        role: "parent",
        locale: LOCALE_EN,
        fullName: `${RUN_PREFIX} parent P`,
        email: `${RUN_PREFIX}.parent-p@journey.test`,
      });
      const parentPRow = await createTestParent(tx, parentP.id);
      tracked.register(users, parentP.id);
      tracked.register(parents, parentPRow.id);

      // Parent PF — en persisted locale, never linked (the foreign probe).
      const parentPF = await createTestUser(tx, {
        role: "parent",
        locale: LOCALE_EN,
        fullName: `${RUN_PREFIX} parent PF`,
        email: `${RUN_PREFIX}.parent-pf@journey.test`,
      });
      const parentPFRow = await createTestParent(tx, parentPF.id);
      tracked.register(users, parentPF.id);
      tracked.register(parents, parentPFRow.id);

      // Student S1 — linked to P; books σ1.
      const studentS1 = await createTestUser(tx, {
        role: "student",
        locale: LOCALE_EN,
        fullName: `${RUN_PREFIX} student S1`,
        email: `${RUN_PREFIX}.student-s1@journey.test`,
      });
      const studentS1Row = await createTestStudent(tx, studentS1.id, { balanceTrial: 1 });
      tracked.register(users, studentS1.id);
      tracked.register(students, studentS1Row.id);

      // Student S2 — unlinked; books σ2 (the fail-closed emission arm).
      const studentS2 = await createTestUser(tx, {
        role: "student",
        locale: LOCALE_EN,
        fullName: `${RUN_PREFIX} student S2`,
        email: `${RUN_PREFIX}.student-s2@journey.test`,
      });
      const studentS2Row = await createTestStudent(tx, studentS2.id, { balanceTrial: 1 });
      tracked.register(users, studentS2.id);
      tracked.register(students, studentS2Row.id);

      // Link S1 → P only. S2 stays unlinked by construction.
      await tx.update(students).set({ parentId: parentP.id }).where(eq(students.id, studentS1Row.id));

      // σ1 + σ2 — completed through the REAL lifecycle path inside the
      // provisioning transaction (book → start → complete).
      const sigma1 = await provisionCompletedSession(studentS1.id, teacherT.id, KEY_SIGMA1, tx);
      tracked.register(session, sigma1.id);
      const sigma2 = await provisionCompletedSession(studentS2.id, teacherT.id, KEY_SIGMA2, tx);
      tracked.register(session, sigma2.id);

      return { teacherT, parentP, parentPF, studentS1, studentS2, sigma1, sigma2 };
    });

    cast = provisioned;

    // Register the idempotency claims the bookings spent (they live outside
    // the provisioning transaction's tracked set — fetched + registered now).
    await registerClaimRow(KEY_SIGMA1, "σ1 booking");
    await registerClaimRow(KEY_SIGMA2, "σ2 booking");

    // Cast grounding: both sessions are terminal; their teacher/student
    // columns match the cast; only S1 carries the link grant.
    expect(provisioned.sigma1.status).toBe(SessionStatus.Completed);
    expect(provisioned.sigma2.status).toBe(SessionStatus.Completed);
    expect(provisioned.sigma1.teacherId).toBe(provisioned.teacherT.id);
    expect(provisioned.sigma1.studentId).toBe(provisioned.studentS1.id);
    expect(provisioned.sigma2.studentId).toBe(provisioned.studentS2.id);
    expect(await studentParentId(provisioned.studentS1.id)).toBe(provisioned.parentP.id);
    expect(await studentParentId(provisioned.studentS2.id)).toBeNull();
  });

  test("Step 1 — teacher submits the report: completion receipts prepared for the student AND the linked parent; dispatch spied, published post-commit", async () => {
    const c = requireCast();
    transportSpy.clear();
    const logs = recordDomainLogs();
    try {
      await SessionReportService.submitSessionReport(
        c.teacherT.id,
        c.sigma1.id,
        {
          teacherNotes: NOTES_SIGMA1,
          studentRatingByTeacher: RATING_SIGMA1,
          homework: { jadid: JADID_BLOCK_SIGMA1, madi: MADI_BLOCK_SIGMA1 },
        },
        LOCALE_EN,
        undefined,
        engineOptions()
      );
      expect(logs.records).toEqual([]);

      // The report row: server-mapped session linkage, verbatim notes.
      const reportRow = await reportRowBySessionId(c.sigma1.id);
      if (!reportRow) {
        throw new Error("journey: expected the σ1 report row to exist after the valid submit");
      }
      expect(reportRow.sessionId).toBe(c.sigma1.id);
      tracked.register(reports, reportRow.id);

      // The home_work row: both tracks mapped by the same submission.
      const homeworkRow = await homeworkRowBySessionId(c.sigma1.id);
      if (!homeworkRow) {
        throw new Error("journey: expected the σ1 home_work row to exist after the valid submit");
      }
      expect(homeworkRow.sessionId).toBe(c.sigma1.id);
      tracked.register(homeWork, homeworkRow.id);

      // EXACTLY ONE report-wave row for the student AND ONE for the linked
      // parent — the wave resolves its recipients server-side from the
      // session's stored link grant (a parent emission exists ONLY because
      // S1 is linked). Each persisted row is registered for teardown.
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
      expect(parentWave.title).toBe(NOTIFS_EN.eventSessionReportReadyTitle);
      expect(parentWave.body).toBe(
        NOTIFS_EN.eventSessionReportReadyParentBody(c.studentS1.fullName, c.teacherT.fullName)
      );

      // Dispatch boundary: EXACTLY 2 publishes after the submission's own
      // commit — one envelope per recipient (student first, then parent —
      // the engine's deterministic emission order). Nothing reached a real
      // channel: the transport spy recorded both.
      expect(transportSpy.publishCount).toBe(2);
      const publishes = transportSpy.calls.slice(0, 2);
      expect(publishes.map(publish => JSON.stringify(publish.userIds)).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [c.parentP.id, c.studentS1.id].map(id => JSON.stringify([id])).toSorted((a, b) => a.localeCompare(b))
      );

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
    } finally {
      logs.stop();
    }
  });

  test("Step 2 — parent inbox: the completion row carries the resolvable (wire type, entity pointer, session id) deep-link triple", async () => {
    const c = requireCast();
    transportSpy.clear();

    const parentWaves = await completionRowsFor(c.parentP.id, c.sigma1.id);
    const parentWave = parentWaves[0];
    if (!parentWave) {
      throw new Error("journey: expected the parent's report-wave row for σ1 to be persisted");
    }

    // The deep-link data contract on the persisted row: the wire type is
    // the completion member, the entity pointer names the session family,
    // and the pointer value is the SESSION id — non-null and numeric — so
    // the drawer/feed can resolve the row into the portal entry URL. The
    // row carries no child id anywhere: the child is resolved server-side.
    expect(parentWave.relatedEntityType).toBe(RELATED_ENTITY_TYPE);
    expect(parentWave.relatedEntityId).not.toBeNull();
    expect(parentWave.relatedEntityId).toBe(c.sigma1.id);

    // Isolation: nobody else's inbox holds a σ1 report-wave row — the
    // foreign parent and the unlinked student observe nothing.
    expect(await completionRowsFor(c.parentPF.id, c.sigma1.id)).toHaveLength(0);
    expect(await completionRowsFor(c.studentS2.id, c.sigma1.id)).toHaveLength(0);

    // Reads never publish.
    expect(transportSpy.publishCount).toBe(0);
  });

  test("Step 3 — parent resolves the session target: the read returns the closed id pair naming the linked child", async () => {
    const c = requireCast();
    transportSpy.clear();

    const target: ParentSessionTargetReturnType = await ParentMonitoringService.getSessionTarget(
      c.parentP.id,
      c.sigma1.id,
      LOCALE_EN
    );

    // The closed two-field projection — nothing else is exposed.
    expect(Object.keys(target).toSorted((a, b) => a.localeCompare(b))).toEqual(["sessionId", "studentId"]);

    // The resolved student is the LINKED child (not merely "a" student).
    expect(target.sessionId).toBe(c.sigma1.id);
    expect(target.studentId).toBe(c.studentS1.id);

    // Resolution is a pure read: no dispatch, no wave.
    expect(transportSpy.publishCount).toBe(0);
  });

  test("Step 4 — parent lands on the deep link: the resolved child's reports read contains the session's report row and the pinned landing URL is constructible", async () => {
    const c = requireCast();
    transportSpy.clear();

    // Hop 2 of the deep link: resolve the row's session pointer to the
    // linked child, then land on that child's reports read.
    const target: ParentSessionTargetReturnType = await ParentMonitoringService.getSessionTarget(
      c.parentP.id,
      c.sigma1.id,
      LOCALE_EN
    );
    expect(target.studentId).toBe(c.studentS1.id);

    const reportPage: ParentReportPageReturnType = await ParentMonitoringService.listChildReports(
      c.parentP.id,
      target.studentId,
      undefined,
      LOCALE_EN
    );
    expect(reportPage.totalCount).toBe(1);
    expect(reportPage.items).toHaveLength(1);

    // The landing row: the reports read contains the session's report row
    // (the frontend filters/highlights the row whose sessionId matches the
    // URL's ?session= param) — carrying the teacher's notes + rating.
    const deepLinkedRow = reportPage.items.find(item => item.sessionId === c.sigma1.id);
    expect(deepLinkedRow).toBeDefined();
    if (!deepLinkedRow) {
      throw new Error("journey: expected the σ1 report row to be in the resolved child's reports list");
    }
    expect(deepLinkedRow.teacherNotes).toBe(NOTES_SIGMA1);
    expect(deepLinkedRow.studentRatingByTeacher).toBe(RATING_SIGMA1);

    // The canonical landing URL is constructible from the resolved pair
    // alone — no other data source is needed to build it.
    const landingUrl = `${LANDING_URL_PREFIX}${target.studentId}${LANDING_URL_QUERY}${target.sessionId}`;
    expect(landingUrl).toBe(`${LANDING_URL_PREFIX}${c.studentS1.id}${LANDING_URL_QUERY}${c.sigma1.id}`);

    // The same URL's session id also resolves on the homework read (the
    // one-link content promise: assignment visible from the same landing).
    const homeworkPage = await ParentMonitoringService.listChildHomework(
      c.parentP.id,
      target.studentId,
      undefined,
      LOCALE_EN
    );
    expect(homeworkPage.items.find(item => item.sessionId === c.sigma1.id)).toBeDefined();

    // Reads never publish.
    expect(transportSpy.publishCount).toBe(0);
  });

  test("Step 5 — unlinked child's session: the wave fails closed — the student row exists, NO parent emission", async () => {
    const c = requireCast();
    transportSpy.clear();
    const logs = recordDomainLogs();
    const keysBefore = new Set(claimCache.claimedKeys);
    try {
      await SessionReportService.submitSessionReport(
        c.teacherT.id,
        c.sigma2.id,
        {
          teacherNotes: NOTES_SIGMA2,
          studentRatingByTeacher: RATING_SIGMA2,
          homework: { jadid: JADID_BLOCK_SIGMA2, madi: MADI_BLOCK_SIGMA2 },
        },
        LOCALE_EN,
        undefined,
        engineOptions()
      );
      expect(logs.records).toEqual([]);

      const reportRow = await reportRowBySessionId(c.sigma2.id);
      if (!reportRow) {
        throw new Error("journey: expected the σ2 report row to exist after the valid submit");
      }
      tracked.register(reports, reportRow.id);
      const homeworkRow = await homeworkRowBySessionId(c.sigma2.id);
      if (!homeworkRow) {
        throw new Error("journey: expected the σ2 home_work row to exist after the valid submit");
      }
      tracked.register(homeWork, homeworkRow.id);

      // The student ALWAYS receives their completion row — the wave ran.
      const studentWaves = await completionRowsFor(c.studentS2.id, c.sigma2.id);
      expect(studentWaves).toHaveLength(1);
      const studentWave = studentWaves[0];
      if (!studentWave) {
        throw new Error("journey: expected one student wave for σ2");
      }
      tracked.register(notifications, studentWave.id);
      expect(studentWave.relatedEntityType).toBe(RELATED_ENTITY_TYPE);
      expect(studentWave.relatedEntityId).toBe(c.sigma2.id);

      // Fail-closed parent leg: NO parent emission exists for the unlinked
      // child's session — neither the linked parent nor any other parent.
      expect(await completionRowsFor(c.parentP.id, c.sigma2.id)).toHaveLength(0);
      expect(await completionRowsFor(c.parentPF.id, c.sigma2.id)).toHaveLength(0);

      // Dispatch boundary: EXACTLY ONE publish for this submission, and it
      // targets the student only. One fresh claim — the student's key.
      expect(transportSpy.publishCount).toBe(1);
      const publish = transportSpy.lastCall;
      if (!publish) {
        throw new Error("journey: expected the unlinked-child wave's single dispatch to be recorded");
      }
      expect(publish.userIds).toEqual([c.studentS2.id]);
      const freshKeys = claimCache.claimedKeys.filter(key => !keysBefore.has(key));
      expect(new Set(freshKeys)).toEqual(
        new Set([
          buildEmitClaimKey(
            [c.studentS2.id],
            NotificationType.SessionCompletion,
            `session:${String(c.sigma2.id)}:report`
          ),
        ])
      );
    } finally {
      logs.stop();
    }
  });

  test("Step 6 — denial probes: foreign parent, nonexistent session, teacher, and student all hit the constant localized ForbiddenError", async () => {
    const c = requireCast();
    transportSpy.clear();
    const logs = recordDomainLogs();
    try {
      const fingerprints = new Set<string>();

      // Foreign-session arm: the session EXISTS but belongs to a family the
      // probing parent is not linked to.
      fingerprints.add(
        await expectForbiddenFingerprint(() =>
          ParentMonitoringService.getSessionTarget(c.parentPF.id, c.sigma1.id, LOCALE_EN)
        )
      );

      // Nonexistent-session arm: an id beyond any identity sequence. The
      // copy and code must be byte-identical to the foreign arm — a prober
      // cannot distinguish "not mine" from "not there".
      fingerprints.add(
        await expectForbiddenFingerprint(() =>
          ParentMonitoringService.getSessionTarget(c.parentPF.id, ABSENT_SESSION_ID, LOCALE_EN)
        )
      );

      // Wrong-role arms: a teacher and a student are denied through the
      // real actor gate — the read is parent-scoped by role, not by
      // convention (a teacher cannot resolve parents' sessions; a student
      // cannot resolve session targets).
      fingerprints.add(
        await expectForbiddenFingerprint(() =>
          ParentMonitoringService.getSessionTarget(c.teacherT.id, c.sigma1.id, LOCALE_EN)
        )
      );
      fingerprints.add(
        await expectForbiddenFingerprint(() =>
          ParentMonitoringService.getSessionTarget(c.studentS1.id, c.sigma1.id, LOCALE_EN)
        )
      );

      // Constant-shape oracle: every denial cause is byte-identical.
      expect(fingerprints.size).toBe(1);

      // Exactly one bounded log per denial; the log carries no row data.
      expect(logs.records).toHaveLength(4);
      for (const record of logs.records) {
        expect(record.code).toBe("FORBIDDEN");
      }

      // Denials publish nothing.
      expect(transportSpy.publishCount).toBe(0);
    } finally {
      logs.stop();
    }
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
        const ids = [c.teacherT.id, c.parentP.id, c.parentPF.id, c.studentS1.id, c.studentS2.id];
        const sessionIds = [c.sigma1.id, c.sigma2.id];
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
