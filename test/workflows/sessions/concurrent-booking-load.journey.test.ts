/**
 * Cross-actor journey — concurrent booking under load.
 *
 * One hundred funded students book sessions against a shared pool of five
 * online certified hot teachers in a single `Promise.allSettled` wave, plus
 * one deliberately unfunded probe student riding the same wave. Every step
 * runs through the real `SessionLifecycleService` / `TeacherMatchingService`
 * on the real test database (production transaction path — no outer tx), and
 * the wave's outcome accounting is the core oracle: ALL 100 funded bookings
 * must be created — with fully-funded members, per-run unique idempotency
 * keys, and per-run certified targets, a funded-leg domain rejection is
 * itself a bug (including the INV-B4 phantom double-debit class), so the
 * rejection bin must stay empty — with zero unexplained outcomes and zero
 * PostgreSQL deadlock (40P01) aborts: the booking flow's uniform
 * teacher-row-first lock order must hold under real contention.
 *
 * Oracles:
 *  - INV-B4 — no student's escrow balance ever goes negative and trial-lane
 *    holds correspond 1:1 to created sessions (the unfunded probe proves the
 *    negative direction through the real debit ladder).
 *  - INV-S6 — the hot teacher that starts one of the shared scheduled
 *    sessions goes `is_online=false` in the same transaction.
 *  - INV-A3 — a second student's browse excludes that teacher afterwards
 *    (while every other hot teacher stays visible).
 *
 * Layer contract (`test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md`):
 *  - NO `runInRollback` — fixtures commit in ONE `beforeAll` transaction
 *    (commit-or-nothing); every row (fixtures AND service-created sessions,
 *    idempotency claims, notification rows) is registered in a
 *    `TrackedFixtures` registry and hard-deleted in `afterAll`, which
 *    re-probes every registered row — a leaking teardown fails the suite.
 *  - Per-run `jrn_sessions_<8hex>` prefix on user labels and idempotency
 *    keys — repeated or parallel runs never collide (double-run green is
 *    the idempotent-teardown proof).
 *  - Honest roles only: every actor is a real `users` row with its real
 *    role-child row; denials resolve through the genuine
 *    authorization/ownership predicates — nothing monkey-patched.
 *  - The notification publish boundary is SPIED (`spyOn` on
 *    `NotificationEngine.publishReceipts` — the booking flow owns its
 *    publish call, so the engine's publish contract is the injection seam):
 *    no realtime channel is ever touched, and each recorded receipt asserts
 *    WHICH user ids it targeted. Teacher-targeted dispatches must match the
 *    created sessions exactly; every student inbox stays untouched.
 *  - Negative steps use a try/catch helper and assert translated messages
 *    from `getServerTranslations("en").errorsTranslations` — never
 *    `expect(...).rejects.toThrow()`, never hardcoded English.
 *  - The unfunded probe must land as a business rejection (INSUFFICIENT_BALANCE)
 *    with zero row side effects, and no student can read or mutate another
 *    student's session (foreign read collapses to null, foreign cancel dies
 *    as SESSION_NOT_FOUND with the owner's row byte-identical).
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/sessions/concurrent-booking-load.journey.test.ts
 *   bun run test/scripts/run-test.ts test/workflows
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestTeacherRow, createTestUser } from "@/backend/db/test/entity-setup";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { TeacherMatchingSort } from "@/backend/enum/teachers/teacher-matching-sort.enum";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications";
import { TeacherMatchingService } from "@/backend/services/teachers/teacher-matching.service";
import type {
  DBTransaction,
  NotificationDeliveryReceipt,
  SessionReturnType,
  TeacherMatchingPageReturnType,
  TeacherMatchingSubmitInput,
} from "@/backend/types";
import { RecitationReading } from "@/shared/constants/recitation-reading.enum";
import { SESSION_FEE_HIFZ } from "@/shared/constants/session-fees.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  countNotificationsForUser,
  countTeacherTransactionsForTeacher,
  countWalletsForTeacher,
  journeyPrefix,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/** The journey runs on the default test locale throughout. */
const LOCALE = "en";

/** Per-run prefix — unique names and idempotency keys across runs. */
const JOURNEY_PREFIX = journeyPrefix("sessions");

/** The funded booker cast size (the concurrent wave's funded leg). */
const FUNDED_STUDENT_COUNT = 100;

/** The shared hot-teacher pool every funded booking targets (round-robin). */
const HOT_TEACHER_COUNT = 5;

/** The PostgreSQL deadlock-detector code — zero occurrences tolerated. */
const PG_DEADLOCK_CODE = "40P01";

/** The recitation token every hot teacher is certified for. */
const HAFS = RecitationReading.HAFS_AN_ASIM;

/** The booking intent (and directory subject token) the wave uses. */
const BOOKING_INTENT = SessionIntent.Hifz;

/** Default page bounds the browse restores for explicit `null` inputs. */
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;

/** The fixture registry — the hard-delete worklist drained by `afterAll`. */
const tracked = new TrackedFixtures();

/** One funded (or probe) student member of the wave cast. */
interface LoadStudentMember {
  /** Real `users.id` (shared PK with `students.id`) — the service caller id. */
  readonly userId: number;
  /** Hot-teacher pool slot this member books against. */
  readonly teacherIndex: number;
  /** Per-run unique idempotency key for this member's booking. */
  readonly idempotencyKey: string;
  /** Whether the member was provisioned with one trial unit (the probe is not). */
  readonly funded: boolean;
}

/** One hot-teacher member of the wave cast. */
interface HotTeacherMember {
  readonly userId: number;
  /** Fixture-unique full name (carries the per-run prefix) — the browse-scope token. */
  readonly label: string;
}

/** The committed cast (assigned once by `beforeAll`). */
const fundedCast: LoadStudentMember[] = [];
const studentUserIds: number[] = [];
const hotTeacherMembers: HotTeacherMember[] = [];
const teacherUserIds: number[] = [];
let probeMember: LoadStudentMember;

/** Created sessions from the concurrent wave (assigned by step 2). */
const createdSessions: SessionReturnType[] = [];
const sessionByStudentId = new Map<number, SessionReturnType>();

/** The session the hot teacher starts in step 5 (and its owner student). */
let startedSession: SessionReturnType;
let startedSessionOwnerId = 0;

/** The exact translated denial messages for the default test locale. */
function errorTexts() {
  return getServerTranslations(LOCALE).errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code`. */
function denialCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Walks the error cause chain hunting a PostgreSQL driver error code — under
 * contention Postgres may abort a waiter, and Drizzle masks driver errors
 * behind its generic message, so the code lives on the cause-chain pg error.
 */
function hasPgCode(error: unknown, pgCode: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === pgCode) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
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
 * Installs a recording no-op over the engine's publish contract: no realtime
 * channel is ever touched, and each dispatch is recorded together with its
 * receipts (and their recipient ids) so a step can assert both THAT a
 * publish happened and WHICH users it targeted. Installed once in
 * `beforeAll`, restored in `afterAll`.
 */
function spyPublication(): { calls: NotificationDeliveryReceipt[][]; stop: () => void } {
  const calls: NotificationDeliveryReceipt[][] = [];
  const spy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async receipts => {
    calls.push([...receipts]);
  });
  return { calls, stop: () => spy.mockRestore() };
}

let publication: ReturnType<typeof spyPublication> | undefined;

/** The cast's pre-wave side-effect snapshot (captured once by `beforeAll`). */
let preWaveSnapshot: WaveSideEffectSnapshot;

/** Every recipient id the spy has recorded so far, in publish order. */
function publishedUserIds(): number[] {
  return (publication?.calls ?? []).flatMap(receipts => receipts.flatMap(receipt => receipt.recipientUserIds));
}

/** How many publish dispatches the spy has recorded so far. */
function publicationCount(): number {
  return publication?.calls.length ?? 0;
}

/** The canonical Hafs + Hifz browse every visibility probe uses. */
const HAFS_HIFZ_BROWSE: TeacherMatchingSubmitInput = {
  recitation: HAFS,
  intent: BOOKING_INTENT,
  page: null,
  pageSize: null,
  search: null,
  minRating: null,
  sort: TeacherMatchingSort.RatingDesc,
};

/** Runs the student browse through the real service (no tx — a pure read). */
async function browseAs(studentUserId: number): Promise<TeacherMatchingPageReturnType> {
  return TeacherMatchingService.browseAvailableTeachers(studentUserId, HAFS_HIFZ_BROWSE, LOCALE);
}

/**
 * Fixture-scoped visibility probe: the SAME real matcher browse (eligibility
 * chain, in-session NOT EXISTS, country tier, pagination) narrowed by the
 * teacher's per-run-unique fixture name — only this run's row can match the
 * prefix-unique search token, so sibling suites' rated teachers can never
 * push a fixture off the probed page. The visibility oracle becomes
 * structurally deterministic instead of page-1 luck.
 */
async function browseFixtureTeacherAs(
  studentUserId: number,
  member: HotTeacherMember
): Promise<TeacherMatchingPageReturnType> {
  return TeacherMatchingService.browseAvailableTeachers(
    studentUserId,
    { ...HAFS_HIFZ_BROWSE, search: member.label },
    LOCALE
  );
}

/** Ordered id projection of a browse page (the visibility assertion shape). */
function visibleTeacherIds(page: TeacherMatchingPageReturnType): number[] {
  return page.items.map(item => item.id);
}

/**
 * Independent read-back oracle — the persisted `teacher.is_online` value for
 * one teacher id (direct Drizzle select on the global `db`, NOT via any
 * service).
 */
async function readTeacherIsOnline(teacherUserId: number): Promise<boolean | null> {
  const [row] = await db.select({ isOnline: teacher.isOnline }).from(teacher).where(eq(teacher.id, teacherUserId));
  return row?.isOnline ?? null;
}

/** Counts occurrences of each value in a list (multiset comparison form). */
function countByValue<T>(values: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/**
 * Row-count snapshot of every external-effect surface the booking wave
 * could touch: cast notification rows (students vs hot teachers), audit
 * rows acted by any cast member, and the hot teachers' wallet + ledger
 * rows. All counters are scoped to fixture ids so pre-existing shared-DB
 * rows can never satisfy or break a delta.
 */
interface WaveSideEffectSnapshot {
  readonly studentNotificationRows: number;
  readonly teacherNotificationRows: number;
  readonly castAuditRows: number;
  readonly teacherWalletRows: number;
  readonly teacherLedgerRows: number;
}

/** Captures the side-effect snapshot for the current cast. */
async function waveSideEffectSnapshot(): Promise<WaveSideEffectSnapshot> {
  const allUserIds = [...studentUserIds, ...teacherUserIds];
  const walletRows = await Promise.all(teacherUserIds.map(id => countWalletsForTeacher(id)));
  const ledgerRows = await Promise.all(teacherUserIds.map(id => countTeacherTransactionsForTeacher(id)));
  return {
    studentNotificationRows: await db.$count(notifications, inArray(notifications.userId, studentUserIds)),
    teacherNotificationRows: await db.$count(notifications, inArray(notifications.userId, teacherUserIds)),
    castAuditRows: await db.$count(auditLogs, inArray(auditLogs.actorId, allUserIds)),
    teacherWalletRows: walletRows.reduce((left, right) => left + right, 0),
    teacherLedgerRows: ledgerRows.reduce((left, right) => left + right, 0),
  };
}

/** Asserts a step produced ZERO deltas on every side-effect counter. */
function expectZeroSideEffectDeltas(before: WaveSideEffectSnapshot, after: WaveSideEffectSnapshot): void {
  expect(after.studentNotificationRows).toBe(before.studentNotificationRows);
  expect(after.teacherNotificationRows).toBe(before.teacherNotificationRows);
  expect(after.castAuditRows).toBe(before.castAuditRows);
  expect(after.teacherWalletRows).toBe(before.teacherWalletRows);
  expect(after.teacherLedgerRows).toBe(before.teacherLedgerRows);
}

/** Narrows a nullable read to a row, failing loudly when null. */
function requiredSessionRow(value: SessionReturnType | null, label: string): SessionReturnType {
  if (value === null) {
    throw new Error(`journey: expected a visible session row for ${label}`);
  }
  return value;
}

/** Resolves one hot-teacher pool slot to its user id, failing loudly when empty. */
function hotTeacherIdAt(index: number): number {
  const id = teacherUserIds.at(index);
  if (id === undefined) {
    throw new Error(`journey: hot teacher slot ${String(index)} is empty (fixture integrity failure)`);
  }
  return id;
}

/** Every cast member's id (students + hot teachers), for audit scoping. */
function allCastUserIds(): number[] {
  return [...studentUserIds, ...teacherUserIds];
}

/**
 * The wave's outcome accounting over the funded leg: every settled outcome
 * is classified as a created session, a translated domain rejection, or an
 * unexplained failure (driver/transport errors — including PostgreSQL
 * deadlock aborts, which are additionally collected for the zero-40P01
 * gate). The funded-booking contract: all 100 outcomes are created sessions
 * — the domain-rejection bin exists so a funded-leg rejection fails the
 * accounting loudly (it is a bug class under these fixtures, never a
 * tolerated "explained" outcome), and the unexplained and deadlock bins
 * stay empty.
 */
interface WaveOutcomeAccounting {
  readonly created: SessionReturnType[];
  readonly domainRejections: { code: string; message: string }[];
  readonly unexplained: unknown[];
  readonly deadlockRejections: unknown[];
}

/** Classifies the funded leg's settled outcomes into the accounting bins. */
function classifyWaveOutcomes(settled: readonly PromiseSettledResult<SessionReturnType>[]): WaveOutcomeAccounting {
  const created: SessionReturnType[] = [];
  const domainRejections: { code: string; message: string }[] = [];
  const unexplained: unknown[] = [];
  const deadlockRejections: unknown[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      created.push(outcome.value);
      continue;
    }
    const reason: unknown = outcome.reason;
    if (hasPgCode(reason, PG_DEADLOCK_CODE)) {
      deadlockRejections.push(reason);
    }
    if (reason instanceof DomainError) {
      domainRejections.push({ code: reason.code, message: reason.message });
      continue;
    }
    unexplained.push(reason);
  }
  return { created, domainRejections, unexplained, deadlockRejections };
}

/**
 * Asserts the unfunded probe's outcome: a translated business rejection
 * through the real debit ladder — never an unexplained transport/driver
 * error.
 */
function expectProbeRejectedWithInsufficientBalance(
  outcome: PromiseSettledResult<SessionReturnType> | undefined
): void {
  if (outcome?.status !== "rejected") {
    throw new Error("journey: expected the unfunded probe booking to be rejected");
  }
  const probeReason: unknown = outcome.reason;
  expect(probeReason).toBeInstanceOf(ValidationError);
  expect(denialCode(probeReason)).toBe("INSUFFICIENT_BALANCE");
  if (probeReason instanceof Error) {
    expect(probeReason.message).toContain(errorTexts().insufficientBalance);
  }
  expect(hasPgCode(probeReason, PG_DEADLOCK_CODE)).toBe(false);
}

/**
 * Asserts the server-owned booking shape of every created session: the
 * assigned hot teacher, `scheduled` status, the platform fee carried
 * verbatim, a live trial-lane escrow hold, and the 24h confirmation
 * window opened (lifecycle stamps still unwritten).
 */
function expectCreatedSessionsHoldBookingShape(created: readonly SessionReturnType[]): void {
  for (const row of created) {
    const member = fundedCast.find(candidate => candidate.userId === row.studentId);
    if (!member) {
      throw new Error(`journey: created session ${String(row.id)} belongs to a non-fixture student`);
    }
    expect(row.teacherId).toBe(hotTeacherIdAt(member.teacherIndex));
    expect(row.status).toBe(SessionStatus.Scheduled);
    expect(row.sessionType).toBe(SessionType.StudentSession);
    expect(row.intent).toBe(BOOKING_INTENT);
    expect(row.fee).toBe(SESSION_FEE_HIFZ);
    expect(row.feeHeld).toBe(true);
    expect(row.heldBalanceLane).toBe(HeldBalanceLane.Trial);
    expect(row.startedAt).toBeNull();
    expect(row.endedAt).toBeNull();
    expect(row.confirmationDeadline).not.toBeNull();
  }
}

/**
 * Registers EVERY service-created side-effect row scoped to the cast
 * (sessions, idempotency claims, teacher-targeted notification rows) — the
 * registry is the afterAll hard-delete worklist, and a mid-test failure can
 * never strand restrict-FK children. The per-table counts must equal the
 * created-session count exactly: one row of each kind per created booking,
 * nothing for any rejected one.
 */
async function registerWaveSideEffectRows(expectedCreatedCount: number): Promise<void> {
  const castSessionRows = await db
    .select({ id: session.id })
    .from(session)
    .where(or(inArray(session.studentId, studentUserIds), inArray(session.teacherId, teacherUserIds)));
  expect(castSessionRows).toHaveLength(expectedCreatedCount);
  for (const row of castSessionRows) {
    tracked.register(session, row.id);
  }
  const castClaimRows = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(inArray(sessionRequestIdempotency.userId, studentUserIds));
  expect(castClaimRows).toHaveLength(expectedCreatedCount);
  for (const row of castClaimRows) {
    tracked.register(sessionRequestIdempotency, row.id);
  }
  const castNotificationRows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(inArray(notifications.userId, teacherUserIds));
  expect(castNotificationRows).toHaveLength(expectedCreatedCount);
  for (const row of castNotificationRows) {
    tracked.register(notifications, row.id);
  }
}

/**
 * DB-side session oracle: exactly one session row exists per created
 * booking, zero rows for any rejected student and for the probe — the row
 * ledger matches the promise outcomes one to one.
 */
async function expectOneSessionRowPerOutcome(): Promise<void> {
  const sessionCountRows = await db
    .select({ studentId: session.studentId, count: sql<number>`count(*)`.mapWith(Number) })
    .from(session)
    .where(inArray(session.studentId, studentUserIds))
    .groupBy(session.studentId);
  const sessionCountByStudent = new Map(sessionCountRows.map(row => [row.studentId, row.count]));
  for (const member of fundedCast) {
    const expected = sessionByStudentId.has(member.userId) ? 1 : 0;
    expect(sessionCountByStudent.get(member.userId) ?? 0).toBe(expected);
  }
  expect(sessionCountByStudent.get(probeMember.userId) ?? 0).toBe(0);
}

/**
 * Provisions one student member inside the suite's committing `beforeAll`
 * transaction: a real `users` row with `role="student"` plus its real
 * `students` role-child row. Funded members carry exactly one trial unit
 * (the INV-B4 booking precondition); the probe member carries none. Both
 * rows are registered for `afterAll` hard-delete cleanup (users row first,
 * role-child row second — reverse-deletion is FK-safe).
 */
async function provisionStudentMember(tx: DBTransaction, index: number, funded: boolean): Promise<LoadStudentMember> {
  const label = funded ? `${JOURNEY_PREFIX}-student-${index}` : `${JOURNEY_PREFIX}-probe-student`;
  const user = await createTestUser(tx, { role: "student", fullName: label });
  const student = await createTestStudent(tx, user.id, {
    balanceTrial: funded ? 1 : 0,
    primaryLanguage: "arabic",
    ...(funded ? { trialGrantedAt: new Date() } : {}),
  });
  tracked.register(users, user.id);
  tracked.register(students, student.id);
  return {
    userId: user.id,
    teacherIndex: index % HOT_TEACHER_COUNT,
    idempotencyKey: `${JOURNEY_PREFIX}-student-${index}-k1`,
    funded,
  };
}

/**
 * Provisions one hot teacher inside the suite's committing `beforeAll`
 * transaction: a real `users` row with `role="teacher"` plus a real
 * certified `teacher` row that satisfies the directory browse predicates
 * (online, approved, Hafs-certified, Hifz subject) so the visibility
 * oracles observe this exact teacher. Both rows are registered for
 * cleanup.
 */
async function provisionHotTeacher(tx: DBTransaction, index: number): Promise<HotTeacherMember> {
  const label = `${JOURNEY_PREFIX}-teacher-${index}`;
  const user = await createTestUser(tx, { role: "teacher", fullName: label });
  const teacherRow = await createTestTeacherRow(tx, user.id, {
    recitations: JSON.stringify([HAFS]),
    subjects: JSON.stringify([BOOKING_INTENT]),
    languages: null,
    averageRating: "4.50",
    isOnline: true,
    isApproved: true,
  });
  tracked.register(users, user.id);
  tracked.register(teacher, teacherRow.id);
  return { userId: user.id, label };
}

beforeAll(async () => {
  // ONE committing transaction: provisioning is commit-or-nothing — a
  // throwing setup rolls back and leaves nothing behind. Registration order
  // is FK-safe by construction (users row first, role-child row second),
  // so the registry's reverse-deletion sweep deletes children BEFORE their
  // parents.
  await db.transaction(async tx => {
    // Recursive provisioning walks — sequential by design: registration
    // order IS the FK-safe deletion order, and every insert must finish
    // before the next inside the one committing transaction (recursion
    // keeps the awaits explicit without tripping the await-in-loop rule).
    const provisionNextStudent = async (index: number): Promise<void> => {
      if (index >= FUNDED_STUDENT_COUNT) {
        return;
      }
      const member = await provisionStudentMember(tx, index, true);
      fundedCast.push(member);
      studentUserIds.push(member.userId);
      await provisionNextStudent(index + 1);
    };
    await provisionNextStudent(0);

    probeMember = await provisionStudentMember(tx, FUNDED_STUDENT_COUNT, false);
    studentUserIds.push(probeMember.userId);

    const provisionNextTeacher = async (index: number): Promise<void> => {
      if (index >= HOT_TEACHER_COUNT) {
        return;
      }
      const member = await provisionHotTeacher(tx, index);
      hotTeacherMembers.push(member);
      teacherUserIds.push(member.userId);
      await provisionNextTeacher(index + 1);
    };
    await provisionNextTeacher(0);
  });

  // The pre-wave baseline: the freshly committed cast owns zero
  // external-effect rows, so every post-wave delta is attributable to the
  // journey's own steps (scoped to fixture ids — shared-DB noise can never
  // satisfy or break a delta).
  preWaveSnapshot = await waveSideEffectSnapshot();

  // No realtime delivery for the whole suite: every publish is recorded.
  publication = spyPublication();
});

afterAll(async () => {
  publication?.stop();

  // Hard-deletes every tracked fixture AND service-created row (sessions,
  // idempotency claims, notification rows) in reverse registration order,
  // then re-probes every registered row — zero residue or the suite fails.
  await tracked.cleanup();
});

describe("Journey — concurrent booking under load (cross-actor, real services)", () => {
  test("step 1 — cast commits: 100 funded students, one unfunded probe, five online certified hot teachers", async () => {
    expect(fundedCast).toHaveLength(FUNDED_STUDENT_COUNT);
    expect(studentUserIds).toHaveLength(FUNDED_STUDENT_COUNT + 1);
    expect(hotTeacherMembers).toHaveLength(HOT_TEACHER_COUNT);
    expect(probeMember.funded).toBe(false);

    // Fixture rows: every member registered BOTH rows (users + role child).
    expect(tracked.records.filter(record => record.key === "users")).toHaveLength(
      FUNDED_STUDENT_COUNT + 1 + HOT_TEACHER_COUNT
    );
    expect(tracked.records.filter(record => record.key === "students")).toHaveLength(FUNDED_STUDENT_COUNT + 1);
    expect(tracked.records.filter(record => record.key === "teacher")).toHaveLength(HOT_TEACHER_COUNT);

    // Every hot teacher is browse-eligible by construction: online,
    // certified, Hafs + Hifz tokens on the row.
    const teacherRows = await db
      .select({
        id: teacher.id,
        isOnline: teacher.isOnline,
        isApproved: teacher.isApproved,
        recitations: teacher.recitations,
        subjects: teacher.subjects,
      })
      .from(teacher)
      .where(inArray(teacher.id, teacherUserIds));
    expect(teacherRows).toHaveLength(HOT_TEACHER_COUNT);
    for (const row of teacherRows) {
      expect(row.isOnline).toBe(true);
      expect(row.isApproved).toBe(true);
      expect(row.recitations).toContain(`"${HAFS}"`);
      expect(row.subjects).toContain(`"${BOOKING_INTENT}"`);
    }

    // Funded members hold exactly one trial unit; the probe holds none.
    const laneRows = await db
      .select({ id: students.id, trial: students.balanceTrial })
      .from(students)
      .where(inArray(students.id, studentUserIds));
    expect(laneRows).toHaveLength(FUNDED_STUDENT_COUNT + 1);
    const trialById = new Map(laneRows.map(row => [row.id, row.trial]));
    for (const member of fundedCast) {
      expect(trialById.get(member.userId)).toBe(1);
    }
    expect(trialById.get(probeMember.userId)).toBe(0);

    // Baseline: the fresh cast owns zero external-effect rows.
    expect(preWaveSnapshot.studentNotificationRows).toBe(0);
    expect(preWaveSnapshot.teacherNotificationRows).toBe(0);
    expect(preWaveSnapshot.castAuditRows).toBe(0);
    expect(preWaveSnapshot.teacherWalletRows).toBe(0);
    expect(preWaveSnapshot.teacherLedgerRows).toBe(0);
  });

  test("step 2 — the concurrent wave: all 100 funded bookings created (zero rejections, zero unexplained, zero 40P01); the unfunded probe dies as INSUFFICIENT_BALANCE", async () => {
    // The wave: 100 funded bookings plus the unfunded probe riding the same
    // Promise.allSettled — true N-way simultaneity against the shared hot
    // pool (the bookings queue on the pg pool and on each hot teacher's
    // certification row lock; both queues are part of the system under
    // test, never bypassed).
    const requests = fundedCast.map(member =>
      SessionLifecycleService.createSession(
        member.userId,
        { teacherId: hotTeacherIdAt(member.teacherIndex), intent: BOOKING_INTENT },
        member.idempotencyKey,
        LOCALE
      )
    );
    requests.push(
      SessionLifecycleService.createSession(
        probeMember.userId,
        { teacherId: hotTeacherIdAt(0), intent: BOOKING_INTENT },
        probeMember.idempotencyKey,
        LOCALE
      )
    );
    const settled = await Promise.allSettled(requests);

    // Outcome accounting over the FUNDED leg (the first 100 promises): the
    // core concurrency oracle.
    const accounting = classifyWaveOutcomes(settled.slice(0, FUNDED_STUDENT_COUNT));
    for (const created of accounting.created) {
      createdSessions.push(created);
      sessionByStudentId.set(created.studentId, created);
    }
    // Fully-funded members, per-run unique idempotency keys, per-run
    // certified targets: a funded-leg domain rejection is constructively
    // impossible, so the bin must be EMPTY — any DomainError here
    // (including the INV-B4 phantom double-debit class) is a bug the
    // accounting fails on, never a tolerated "explained" outcome.
    expect(accounting.created).toHaveLength(FUNDED_STUDENT_COUNT);
    expect(accounting.domainRejections).toHaveLength(0);
    expect(accounting.unexplained).toHaveLength(0);
    expect(accounting.deadlockRejections).toHaveLength(0);

    expectProbeRejectedWithInsufficientBalance(settled.at(FUNDED_STUDENT_COUNT));
    expectCreatedSessionsHoldBookingShape(accounting.created);
    await registerWaveSideEffectRows(accounting.created.length);
    await expectOneSessionRowPerOutcome();
  });

  test("step 3 — escrow oracle: trial-lane holds correspond 1:1 to created sessions, no balance ever went negative", async () => {
    const laneRows = await db
      .select({
        id: students.id,
        trial: students.balanceTrial,
        hifz: students.balanceHifz,
        tajweed: students.balanceTajweed,
      })
      .from(students)
      .where(inArray(students.id, studentUserIds));
    expect(laneRows).toHaveLength(FUNDED_STUDENT_COUNT + 1);
    const lanesById = new Map(laneRows.map(row => [row.id, row]));

    let totalHolds = 0;
    for (const member of fundedCast) {
      const lanes = lanesById.get(member.userId);
      if (!lanes) {
        throw new Error(`journey: students row ${String(member.userId)} vanished (fixture integrity failure)`);
      }
      const created = sessionByStudentId.has(member.userId);
      // The funded member started with exactly one trial unit: a created
      // booking consumed it (1 -> 0); a rejected booking rolled its debit
      // back (stays 1). No lane may ever go negative.
      expect(lanes.trial).toBe(created ? 0 : 1);
      expect(lanes.trial).toBeGreaterThanOrEqual(0);
      expect(lanes.hifz).toBeGreaterThanOrEqual(0);
      expect(lanes.tajweed).toBeGreaterThanOrEqual(0);
      if (created) {
        totalHolds += 1;
      }
    }
    expect(totalHolds).toBe(createdSessions.length);

    // The probe kept a zero balance everywhere (INV-B4 negative direction).
    const probeLanes = lanesById.get(probeMember.userId);
    if (!probeLanes) {
      throw new Error("journey: probe students row vanished (fixture integrity failure)");
    }
    expect(probeLanes.trial).toBe(0);
    expect(probeLanes.hifz).toBeGreaterThanOrEqual(0);
    expect(probeLanes.tajweed).toBeGreaterThanOrEqual(0);

    // Holds map 1:1 to created sessions: every created row carries a live
    // trial-lane hold, and the session count equals the consumed-unit count.
    const heldRows = await db
      .select({ id: session.id, held: session.feeHeld, lane: session.heldBalanceLane })
      .from(session)
      .where(
        inArray(
          session.id,
          createdSessions.map(row => row.id)
        )
      );
    expect(heldRows).toHaveLength(createdSessions.length);
    for (const row of heldRows) {
      expect(row.held).toBe(true);
      expect(row.lane).toBe(HeldBalanceLane.Trial);
    }
  });

  test("step 4 — notification oracle: teacher-targeted dispatches match the created sessions exactly; every student inbox stays untouched", async () => {
    // Persist-first: every created session left exactly one session-request
    // notification row in its teacher's inbox (and only the teachers').
    const teacherNotificationRows = await db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        type: notifications.type,
        relatedEntityType: notifications.relatedEntityType,
        relatedEntityId: notifications.relatedEntityId,
      })
      .from(notifications)
      .where(inArray(notifications.userId, teacherUserIds));
    expect(teacherNotificationRows).toHaveLength(createdSessions.length);

    // Session ids created per teacher — the expected inbox partition.
    const sessionIdsByTeacher = new Map<number, Set<number>>();
    for (const created of createdSessions) {
      const bucket = sessionIdsByTeacher.get(created.teacherId) ?? new Set<number>();
      bucket.add(created.id);
      sessionIdsByTeacher.set(created.teacherId, bucket);
    }
    const notificationCountByTeacher = countByValue(teacherNotificationRows.map(row => row.userId));
    for (const teacherUserId of teacherUserIds) {
      const expectedSessions = sessionIdsByTeacher.get(teacherUserId) ?? new Set<number>();
      expect(notificationCountByTeacher.get(teacherUserId) ?? 0).toBe(expectedSessions.size);
    }
    for (const row of teacherNotificationRows) {
      expect(row.type).toBe(NotificationType.SessionRequest);
      expect(row.relatedEntityType).toBe("session");
      const teacherSessions = sessionIdsByTeacher.get(row.userId);
      expect(teacherSessions?.has(row.relatedEntityId ?? -1)).toBe(true);
    }

    // The spied publish boundary: one dispatch per created booking, each
    // targeting exactly the session's teacher — no student, no foreign id.
    const publishes = publication?.calls ?? [];
    expect(publishes).toHaveLength(createdSessions.length);
    const publishTargets = publishedUserIds();
    expect(publishTargets).toHaveLength(createdSessions.length);
    const publishCountByTeacher = countByValue(publishTargets);
    for (const [teacherUserId, expectedSessions] of sessionIdsByTeacher) {
      expect(publishCountByTeacher.get(teacherUserId) ?? 0).toBe(expectedSessions.size);
    }
    expect(publishTargets.every(id => teacherUserIds.includes(id))).toBe(true);
    for (const receipts of publishes) {
      const receipt = receipts[0];
      if (!receipt) {
        throw new Error("journey: expected every publish to carry one delivery receipt");
      }
      expect(receipt.recipientUserIds).toHaveLength(1);
      expect(teacherUserIds.includes(receipt.recipientUserIds[0] ?? -1)).toBe(true);
      expect(receipt.notifications[0]?.userId).toBe(receipt.recipientUserIds[0]);
    }

    // Foreign-inbox zero-delta: students received nothing, and no wallet,
    // ledger, or audit rows appeared anywhere in the cast.
    const after = await waveSideEffectSnapshot();
    expect(after.studentNotificationRows).toBe(preWaveSnapshot.studentNotificationRows);
    expect(after.studentNotificationRows).toBe(0);
    expect(after.teacherNotificationRows).toBe(preWaveSnapshot.teacherNotificationRows + createdSessions.length);
    expect(after.castAuditRows).toBe(preWaveSnapshot.castAuditRows);
    expect(after.teacherWalletRows).toBe(preWaveSnapshot.teacherWalletRows);
    expect(after.teacherLedgerRows).toBe(preWaveSnapshot.teacherLedgerRows);
  });

  test("step 5 — hot teacher starts one shared session: INV-S6 goes offline, INV-A3 excludes the teacher from a second student's browse", async () => {
    const teacherZeroId = hotTeacherIdAt(0);
    const teacherZeroSessions = createdSessions.filter(row => row.teacherId === teacherZeroId);
    expect(teacherZeroSessions.length).toBeGreaterThan(0);
    const target = teacherZeroSessions[0];
    if (!target) {
      throw new Error("journey: expected at least one scheduled session for the first hot teacher");
    }

    // A second student (one who booked a DIFFERENT hot teacher) observes the
    // directory before the start. The envelope shape is asserted on the
    // plain browse; every visibility containment is asserted through
    // fixture-scoped probes (per-teacher, name-scoped by the per-run
    // prefix) so the oracle holds for ALL hot teachers and is immune to
    // shared-database noise — no page-1 luck against sibling suites'
    // rated teachers.
    const observer = fundedCast[1];
    if (!observer) {
      throw new Error("journey: observer student missing (fixture integrity failure)");
    }
    const beforePage = await browseAs(observer.userId);
    expect(beforePage.page).toBe(DEFAULT_PAGE);
    expect(beforePage.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(beforePage.pageCount).toBe(Math.ceil(beforePage.total / DEFAULT_PAGE_SIZE));
    const beforeScopedProbes = await Promise.all(
      hotTeacherMembers.map(async member => ({ member, page: await browseFixtureTeacherAs(observer.userId, member) }))
    );
    for (const { member, page } of beforeScopedProbes) {
      expect(page.total).toBe(1);
      expect(visibleTeacherIds(page)).toEqual([member.userId]);
    }

    // The start transition is teacher-owned: the hot teacher starts one of
    // the shared scheduled sessions through the real service.
    const publishCountBeforeStart = publicationCount();
    const started = await SessionLifecycleService.startSession(teacherZeroId, target.id, LOCALE);
    expect(started.id).toBe(target.id);
    expect(started.status).toBe(SessionStatus.Started);
    expect(started.startedAt).not.toBeNull();
    expect(started.endedAt).toBeNull();
    expect(publicationCount()).toBe(publishCountBeforeStart);

    // INV-S6 — the in-session lock drove the teacher offline.
    expect(await readTeacherIsOnline(teacherZeroId)).toBe(false);

    // INV-A3 — the observer's browse now excludes the started teacher while
    // EVERY other hot teacher stays visible (each probe fixture-scoped, so
    // the oracle is deterministic under shared-database noise).
    const afterScopedProbes = await Promise.all(
      hotTeacherMembers.map(async member => ({ member, page: await browseFixtureTeacherAs(observer.userId, member) }))
    );
    for (const { member, page } of afterScopedProbes) {
      if (member.userId === teacherZeroId) {
        expect(page.total).toBe(0);
        expect(visibleTeacherIds(page)).toEqual([]);
      } else {
        expect(page.total).toBe(1);
        expect(visibleTeacherIds(page)).toEqual([member.userId]);
      }
    }

    // The teacher's other scheduled sessions were not disturbed — many
    // concurrent bookings may share one teacher at `scheduled`.
    const remainingScheduled = await db.$count(
      session,
      and(eq(session.teacherId, teacherZeroId), eq(session.status, SessionStatus.Scheduled))
    );
    expect(remainingScheduled).toBe(teacherZeroSessions.length - 1);

    // No duplicate start: replaying the start transition denies through the
    // real state machine, the row stays byte-identical, and nothing is
    // dispatched.
    startedSession = started;
    startedSessionOwnerId = started.studentId;
    const snapshotBefore = await waveSideEffectSnapshot();
    const rowBefore = requiredSessionRow(
      await SessionLifecycleService.getSessionById(startedSessionOwnerId, started.id),
      "the owner reading the started session before the replay probe"
    );
    const caught = await catchDenial(() => SessionLifecycleService.startSession(teacherZeroId, started.id, LOCALE));
    expect(caught).toBeInstanceOf(ConflictError);
    expect(denialCode(caught)).toBe("SESSION_INVALID_TRANSITION");
    expect(caught.message).toContain(errorTexts().sessionInvalidTransition);
    const rowAfter = requiredSessionRow(
      await SessionLifecycleService.getSessionById(startedSessionOwnerId, started.id),
      "the owner reading the started session after the replay probe"
    );
    expect(rowAfter).toEqual(rowBefore);
    expect(publicationCount()).toBe(publishCountBeforeStart);
    expectZeroSideEffectDeltas(snapshotBefore, await waveSideEffectSnapshot());

    // The teacher's inbox still holds the persisted request notifications
    // from the wave (the start added nothing).
    expect(await countNotificationsForUser(teacherZeroId)).toBe(teacherZeroSessions.length);
  });

  test("step 6 — abuse probes: no student can read or mutate another student's session; the unfunded probe left zero rows", async () => {
    // The attacker: a funded student whose own booking was created and who
    // is NOT the started session's owner.
    const attacker = fundedCast.find(
      member => sessionByStudentId.has(member.userId) && member.userId !== startedSessionOwnerId
    );
    if (!attacker) {
      throw new Error("journey: expected at least one non-owner student with a created session");
    }
    const attackerSession = sessionByStudentId.get(attacker.userId);
    if (!attackerSession) {
      throw new Error("journey: attacker session missing (fixture integrity failure)");
    }

    // Foreign read collapses to null (oracle-safe: indistinguishable from
    // nonexistent) and the attacker's own list holds exactly his own row.
    expect(await SessionLifecycleService.getSessionById(attacker.userId, startedSession.id)).toBeNull();
    const attackerList = await SessionLifecycleService.listMyStudentSessions(attacker.userId, {}, 1, 25);
    expect(attackerList.totalCount).toBe(1);
    expect(attackerList.items).toHaveLength(1);
    expect(attackerList.items[0]?.id).toBe(attackerSession.id);

    // Foreign cancel dies as SESSION_NOT_FOUND with the owner's row
    // byte-identical and zero side effects anywhere.
    const snapshotBefore = await waveSideEffectSnapshot();
    const rowBefore = requiredSessionRow(
      await SessionLifecycleService.getSessionById(startedSessionOwnerId, startedSession.id),
      "the owner reading the started session before the foreign-cancel probe"
    );
    const caught = await catchDenial(() =>
      SessionLifecycleService.cancelSession(attacker.userId, startedSession.id, null, LOCALE)
    );
    expect(caught).toBeInstanceOf(NotFoundError);
    expect(denialCode(caught)).toBe("SESSION_NOT_FOUND");
    expect(caught.message).toContain(errorTexts().sessionNotFound);
    const rowAfter = requiredSessionRow(
      await SessionLifecycleService.getSessionById(startedSessionOwnerId, startedSession.id),
      "the owner reading the started session after the foreign-cancel probe"
    );
    expect(rowAfter).toEqual(rowBefore);
    expectZeroSideEffectDeltas(snapshotBefore, await waveSideEffectSnapshot());

    // The unfunded probe's rejection left ZERO rows anywhere: no session,
    // no idempotency claim (a failed booking never burns its key), no
    // notification, and the balance stayed empty.
    expect(await db.$count(session, eq(session.studentId, probeMember.userId))).toBe(0);
    expect(await db.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.userId, probeMember.userId))).toBe(
      0
    );
    expect(await countNotificationsForUser(probeMember.userId)).toBe(0);
    expect(await db.$count(auditLogs, inArray(auditLogs.actorId, allCastUserIds()))).toBe(0);
  });

  test("step 7 — teardown worklist is complete: every fixture and service-created row is tracked for the afterAll hard-delete", () => {
    const fixtureRowCount = (FUNDED_STUDENT_COUNT + 1 + HOT_TEACHER_COUNT) * 2;
    expect(tracked.size).toBe(fixtureRowCount + createdSessions.length * 3);
    expect(tracked.records.filter(record => record.key === "users")).toHaveLength(
      FUNDED_STUDENT_COUNT + 1 + HOT_TEACHER_COUNT
    );
    expect(tracked.records.filter(record => record.key === "students")).toHaveLength(FUNDED_STUDENT_COUNT + 1);
    expect(tracked.records.filter(record => record.key === "teacher")).toHaveLength(HOT_TEACHER_COUNT);
    expect(tracked.records.filter(record => record.key === "session")).toHaveLength(createdSessions.length);
    expect(tracked.records.filter(record => record.key === "session_request_idempotency")).toHaveLength(
      createdSessions.length
    );
    expect(tracked.records.filter(record => record.key === "notifications")).toHaveLength(createdSessions.length);
  });
});
