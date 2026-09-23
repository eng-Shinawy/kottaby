/**
 * SessionAdminGovernanceService tests — the admin-only governance surface
 * (the directory read pair, the browse detail, and the four operator
 * mutations: reschedule, cancel with hold release, teacher reassignment,
 * join-as-observer) against the live PostgreSQL instance, on REAL
 * repositories, audit writer, refund primitive, and notification engine.
 *
 * Harness mirrors the sibling `session-lifecycle.service.test.ts` suite:
 *  - Every transactional case runs inside `runInRollback`; the rollback tx
 *    is handed to EVERY service call as its `outerTx`/`tx` argument (the
 *    service's documented test path — a SAVEPOINT on it) and to every
 *    direct Drizzle read-back oracle.
 *  - Entities are created ONLY via `entity-setup.ts` helpers plus the
 *    file-local shared-PK helpers — never seed data.
 *  - NO `expect(...).rejects.toThrow()` — every denial goes through
 *    `expectRepoError` (try/catch); typed denials are asserted through the
 *    `DomainError.code` contract plus the exact translated message.
 *  - Fan-out is spied (`SpiedFanoutTransport`) and the emit claim cache is
 *    an in-memory map injected through the service's `options` seam — no
 *    Redis, no WebSocket, no live network anywhere in the suite.
 *
 * Coverage map (4 tiers):
 *  - Tier 1 (branch/statement): every function's happy path and every
 *    conflict/validation arm — the directory filter matrix (absent members,
 *    unknown enum, bad page, inverted window) with the honest total; the
 *    null-not-error browse read incl. malformed ids; the reschedule
 *    eligibility matrix (scheduled + started succeed; completed / disputed
 *    / cancelled fail closed with zero writes) and both pre-read validation
 *    denials; the cancel paths (recorded lane refunded exactly once, no
 *    recorded lane refunds nothing, disputed refused, already-cancelled
 *    fail-closed, idempotent retry-doubles, replay denials for a foreign
 *    claim and a mis-pointed claim, the replay-arm claim-pointer invariant
 *    (a key spent on an already-cancelled session points at it — the same
 *    key on a DIFFERENT cancelled session is the mis-point conflict while
 *    the same session still replays), key-shape guards); the reassignment
 *    arms (certified candidate swaps the teacher, unapproved / DB-null
 *    candidate refuses byte-identically, missing candidate is the not-found
 *    denial, non-scheduled rows are transition conflicts); the join gate
 *    (started observes with exactly one audit row, every other state is a
 *    zero-audit conflict).
 *  - Tier 2 (boundary): cancel reason EXACTLY 330 chars accepted / 331
 *    rejected pre-DB (and control characters rejected — the serialized
 *    audit-envelope contract); page 1 with pageSize 1 and 50 bounds plus
 *    out-of-range normalization (page < 1 → 1, pageSize > 50 → 25); the
 *    empty filter object returning every row; the zero-width creation
 *    window (`dateFrom == dateTo`) answering empty with an honest zero
 *    total.
 *  - Tier 3 (chaos, committed fixtures + production tx path): the admin
 *    cancel ⚡ participant completion race serializes to ONE consistent
 *    outcome with zero partial writes; the concurrent double-cancel with
 *    ONE idempotency key claims exactly once (one audit row, one refund,
 *    one wave, one claim row — the loser resolves as the idempotent
 *    replay).
 *  - Tier 4 (security): the non-admin role matrix (student / teacher /
 *    parent — every non-admin role the `user_role` vocabulary can persist)
 *    against ALL six functions → `FORBIDDEN` each with ZERO writes (no
 *    audit rows, byte-identical session row, empty inboxes); the
 *    governance-clean admin gate mirroring the reference arbitration op —
 *    a deleted / blocked / suspended admin (and the anonymous sentinel 0,
 *    an unresolvable row) fails closed `FORBIDDEN` across all six.
 *
 * Clock discipline: the 5-minute past-grace boundary is proven with
 * `setSystemTime` from `bun:test` (the sanctioned frozen-clock seam) — the
 * instant EXACTLY one grace window old is accepted (inclusive edge), one
 * millisecond older is rejected, both deterministically.
 */

import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { SessionRequestIdempotencyRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ConflictError, DomainError, NotFoundError } from "@/backend/lib/errors";
import { SessionAdminGovernanceService } from "@/backend/services/classes/session-admin-governance";
import { joinObservationInTx } from "@/backend/services/classes/session-admin-governance.helpers";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import type { NotificationEngineCallOptions } from "@/backend/services/notifications";
import {
  buildEmitClaimKey,
  type NotificationIdempotencyClaimCache,
} from "@/backend/services/notifications/emit-idempotency";
import type {
  AdminSessionCancelInput,
  AdminSessionJoinInput,
  AdminSessionListFilterInput,
  AdminSessionReassignInput,
  AdminSessionRescheduleInput,
  DBTransaction,
  NotificationReturnType,
  SessionInsertType,
  SessionReturnType,
  SessionSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";
import { SpiedFanoutTransport } from "@/test/workflows/helpers";

/** The locale every service call in this suite is pinned to. */
const LOCALE = "en";

/**
 * Genuine cross-transaction contention (two independent production-path
 * flows racing for one row lock / one claim key) needs REAL multi-connection
 * PostgreSQL — under single-connection pglite the concurrent flows
 * interleave on the one session and corrupt each other (the same reason the
 * sibling suites skip their cross-transaction lock races here). These cases
 * are authored, run green in CI, and skip in this sandbox by design.
 */
const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

/** Localized error copy for denial assertions (translated strings, never keys). */
const ERRORS_EN = getServerTranslations(LOCALE).errorsTranslations;
/** English governance wave copy — recipients provisioned with locale `en`. */
const NOTIFS_EN = getServerTranslations("en").notificationsTranslations;
/** Arabic governance wave copy — recipients provisioned with locale `ar`. */
const NOTIFS_AR = getServerTranslations("ar").notificationsTranslations;

/**
 * How far into the past a replacement start may sit (the service's grace
 * window). Re-derived here rather than imported from the service's sibling
 * internals: the test pins the PUBLIC rule (5 minutes), not the private
 * constant's identity.
 */
const RESCHEDULE_GRACE_MS = 5 * 60 * 1000;

/**
 * The cancel-reason ceiling the boundary schema enforces — one half of the
 * serialized-length contract that keeps the cancel audit row's `details`
 * JSON inside the 2000-char column (the 31-char `{"action":"cancel",…}`
 * envelope rides around it). The other half is the schema's
 * control-character rejection: with Unicode Cc chars refused, the worst
 * JSON.stringify escape expansion is 2×, so the worst schema-legal reason
 * (330 backslashes) serializes to 31 + 660 = 691 chars — always fitting.
 * Mirrors the boundary constant in
 * `backend/types/classes/admin-session-governance.types.ts`.
 */
const MAX_CANCEL_REASON_LENGTH = 330;

/** The audit row's entity label for this surface (the service's constant). */
const SESSION_ENTITY_TYPE = "session";

/**
 * The cancelled lifecycle status, widened to plain string: the chaos-tier
 * winner probe compares a raw pg-enum string union against the enum member
 * (the same widening the governance internals use for probe comparisons).
 */
const CANCELLED_STATUS: string = SessionStatus.Cancelled;

/** The audit-details payload shape a governance mutation serializes. */
interface GovernanceAuditDetails {
  readonly action?: string;
  readonly reason?: string | null;
  readonly from?: {
    readonly startedAt?: string | null;
    readonly endedAt?: string | null;
    readonly teacherId?: number;
  };
  readonly to?: {
    readonly startedAt?: string;
    readonly endedAt?: string;
    readonly teacherId?: number;
  };
}

/** Type guard for the serialized audit metadata (never a raw cast). */
function isGovernanceAuditDetails(value: unknown): value is GovernanceAuditDetails {
  return typeof value === "object" && value !== null && "action" in value;
}

/** Parses one governance audit row's metadata through the type guard. */
function parseAuditDetails(raw: string | null): GovernanceAuditDetails {
  const parsed: unknown = JSON.parse(raw ?? "{}");
  if (!isGovernanceAuditDetails(parsed)) {
    throw new Error("parseAuditDetails: unexpected audit details payload");
  }
  return parsed;
}

/**
 * Injects a value the compile-time union forbids into a filter — the
 * out-of-vocabulary-status probe targets the RUNTIME schema guard, so the
 * foreign value enters post-construction (no assertion, no `any`).
 */
function filterWithForeignStatus(status: string): AdminSessionListFilterInput {
  const filter: AdminSessionListFilterInput = {};
  return Object.assign(filter, { status });
}

/**
 * Injects a non-Date into a reschedule payload — the malformed-shape probe
 * targets the RUNTIME schema guard, so the foreign value enters
 * post-construction (no assertion, no `any`).
 */
function rescheduleWithForeignStart(
  input: AdminSessionRescheduleInput,
  startedAt: unknown
): AdminSessionRescheduleInput {
  return Object.assign({ ...input }, { startedAt });
}

// ─── File-local fixtures (mirror the sibling suites' helpers) ───────────

/** Shared-PK ids for one session actor pair (session.teacher_id / student_id). */
interface SessionActors {
  readonly teacherUserId: number;
  readonly studentUserId: number;
}

/** Provisioned admin actor (a real `admin`-role user row). */
interface AdminActor {
  readonly adminId: number;
}

/** An idempotency emit-claim cache — in-memory map with SET-NX semantics. */
class MapBackedClaimCache implements NotificationIdempotencyClaimCache {
  private readonly entries = new Map<string, string>();

  /** Every raw (hashed) claim key the engine attempted, in attempt order. */
  readonly claimedKeys: string[] = [];

  async claim(key: string, _ttlSeconds: number): Promise<boolean> {
    this.claimedKeys.push(key);
    if (this.entries.has(key)) {
      return false;
    }
    this.entries.set(key, "");
    return true;
  }

  /** Clears the recorded claim attempts (between two wave occurrences). */
  reset(): void {
    this.claimedKeys.length = 0;
  }

  async store(key: string, value: string, _ttlSeconds: number): Promise<void> {
    this.entries.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }
}

/**
 * Fresh notification-engine options per call: a spied transport (records
 * instead of delivering) plus an isolated claim cache — the injection seam
 * the service exposes, so the suite never touches Redis or a socket.
 */
function governanceOptions(): NotificationEngineCallOptions {
  return { transport: new SpiedFanoutTransport(), cache: new MapBackedClaimCache() };
}

/**
 * A whole-second instant offset from real time — every round-trip-asserted
 * timestamp in this suite is second-aligned because the `timestamp` columns
 * store whole seconds (the sibling suites' aligned-instant discipline).
 */
function alignedInstant(offsetMs = 0): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000 + offsetMs);
}

/** Type-guard read of a caught rejection's `DomainError.code`. */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Asserts a caught error is a `DomainError` carrying EXACTLY the expected
 * `extensions.code` and the exact translated message (never the raw key).
 */
function expectDomainDenial(error: Error, code: string, message: string): void {
  expect(error).toBeInstanceOf(DomainError);
  expect(rejectionCode(error)).toBe(code);
  expect(error.message).toBe(message);
  expect(error.message).not.toContain(code);
}

/** Shared-PK `teacher` role-child row (`isApproved: null` pins the boundary). */
async function createTestTeacherRow(tx: DBTransaction, userId: number, isApproved: boolean | null): Promise<void> {
  await tx.insert(teacher).values({ id: userId, isApproved });
}

/** Creates one certified teacher + one student pair with shared-PK rows. */
async function createSessionActors(tx: DBTransaction): Promise<SessionActors> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id, true);
  const studentUser = await createTestUser(tx, { role: "student" });
  await createTestStudent(tx, studentUser.id);
  return { teacherUserId: teacherUser.id, studentUserId: studentUser.id };
}

/** Creates one `admin`-role user (the governance actor). */
async function createTestAdmin(tx: DBTransaction): Promise<AdminActor> {
  const admin = await createTestUser(tx, { role: "admin" });
  return { adminId: admin.id };
}

/** Sets the students row's escrow lane balances (test-local oracle setup). */
async function setLaneBalances(
  tx: DBTransaction,
  studentId: number,
  balances: { trial?: number; hifz?: number; tajweed?: number }
): Promise<void> {
  await tx
    .update(students)
    .set({
      balanceTrial: balances.trial ?? 0,
      balanceHifz: balances.hifz ?? 0,
      balanceTajweed: balances.tajweed ?? 0,
    })
    .where(eq(students.id, studentId));
}

/** Independent read-back oracle: the student row's lane balances. */
async function readLaneBalances(executor: DBTransaction | typeof db, studentId: number) {
  const [row] = await executor
    .select({ trial: students.balanceTrial, hifz: students.balanceHifz, tajweed: students.balanceTajweed })
    .from(students)
    .where(eq(students.id, studentId));
  if (!row) {
    throw new Error("readLaneBalances: student row vanished");
  }
  return row;
}

/** Independent read-back oracle: the full session row (NOT via the service). */
async function readSessionRow(
  executor: DBTransaction | typeof db,
  sessionId: number
): Promise<SessionSelectType | null> {
  const [row] = await executor.select().from(session).where(eq(session.id, sessionId));
  return row ?? null;
}

/** Audit rows ABOUT one session entity (tx- or db-scoped count oracle). */
async function countAuditsForSession(executor: DBTransaction | typeof db, sessionId: number): Promise<number> {
  const rows = await executor
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, SESSION_ENTITY_TYPE), eq(auditLogs.entityId, sessionId)));
  return rows.length;
}

/** Audit rows ABOUT one session entity — full rows for metadata assertions. */
async function readAuditsForSession(executor: DBTransaction | typeof db, sessionId: number) {
  return executor
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, SESSION_ENTITY_TYPE), eq(auditLogs.entityId, sessionId)));
}

/** Audit rows WRITTEN BY one actor (the pre-read denial zero-write oracle). */
async function countAuditsForActor(executor: DBTransaction | typeof db, actorId: number): Promise<number> {
  const rows = await executor.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.actorId, actorId));
  return rows.length;
}

/** Inbox rows for a recipient cohort (tx- or db-scoped count oracle). */
async function countNotificationsFor(executor: DBTransaction | typeof db, userIds: readonly number[]): Promise<number> {
  if (userIds.length === 0) {
    return 0;
  }
  const rows = await executor
    .select({ id: notifications.id })
    .from(notifications)
    .where(inArray(notifications.userId, [...userIds]));
  return rows.length;
}

/** Inbox rows for ONE recipient — full rows for per-locale copy assertions. */
async function readInboxFor(executor: DBTransaction | typeof db, userId: number): Promise<NotificationReturnType[]> {
  return executor.select().from(notifications).where(eq(notifications.userId, userId));
}

/** Claim rows spent by one user (the claim-table oracle). */
async function readClaimsForUser(executor: DBTransaction | typeof db, userId: number) {
  return executor.select().from(sessionRequestIdempotency).where(eq(sessionRequestIdempotency.userId, userId));
}

/**
 * Direct session-row insert for test preconditions (full column control —
 * non-scheduled lifecycle states, lane variants, timing pairs). `intent`
 * is set by default: the notification wave resolver fails closed on a
 * corrupt/absent intent, so every wave-emitting fixture carries a real one.
 */
async function insertSessionRow(
  tx: DBTransaction,
  actors: SessionActors,
  overrides: Partial<SessionInsertType> = {}
): Promise<SessionSelectType> {
  const [row] = await tx
    .insert(session)
    .values({
      teacherId: actors.teacherUserId,
      studentId: actors.studentUserId,
      status: SessionStatus.Scheduled,
      sessionType: SessionType.StudentSession,
      intent: SessionIntent.Hifz,
      fee: "10.00",
      feeHeld: true,
      heldBalanceLane: HeldBalanceLane.Hifz,
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("insertSessionRow: insert returned no rows");
  }
  return row;
}

/** An integer id that cannot exist as a `session` row during this transaction. */
async function absentSessionId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${session.id}), 0)::int` }).from(session);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** An integer id that cannot exist as a `users` row during this transaction. */
async function absentUserId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Asserts a run of shared-transaction denials SEQUENTIALLY (recursive form — no await-in-loop). */
async function assertDenialsSequentially(
  index: number,
  calls: readonly (() => Promise<unknown>)[],
  assertDenial: (error: Error) => void
): Promise<void> {
  if (index >= calls.length) {
    return;
  }
  const call = calls.at(index);
  if (call !== undefined) {
    const caught = await expectRepoError(call);
    assertDenial(caught);
    await assertDenialsSequentially(index + 1, calls, assertDenial);
  }
}

// ─── Service call wrappers (locale + tx pinned, mirrors the sibling suite) ───

function listAllVia(
  tx: DBTransaction,
  adminId: number,
  filter: AdminSessionListFilterInput,
  page: number,
  pageSize: number
): ReturnType<typeof SessionAdminGovernanceService.listAll> {
  return SessionAdminGovernanceService.listAll(adminId, filter, page, pageSize, LOCALE, tx);
}

function getDetailVia(
  tx: DBTransaction,
  adminId: number,
  sessionId: number
): ReturnType<typeof SessionAdminGovernanceService.getDetail> {
  return SessionAdminGovernanceService.getDetail(adminId, sessionId, LOCALE, tx);
}

function rescheduleVia(
  tx: DBTransaction,
  adminId: number,
  input: AdminSessionRescheduleInput
): Promise<SessionReturnType> {
  return SessionAdminGovernanceService.reschedule(adminId, input, LOCALE, tx, governanceOptions());
}

function cancelVia(
  tx: DBTransaction,
  adminId: number,
  input: AdminSessionCancelInput,
  idempotencyKey?: string | null
): Promise<SessionReturnType> {
  return SessionAdminGovernanceService.cancel(adminId, input, LOCALE, idempotencyKey, tx, governanceOptions());
}

function reassignVia(tx: DBTransaction, adminId: number, input: AdminSessionReassignInput): Promise<SessionReturnType> {
  return SessionAdminGovernanceService.reassignTeacher(adminId, input, LOCALE, tx, governanceOptions());
}

function joinVia(tx: DBTransaction, adminId: number, input: AdminSessionJoinInput): Promise<SessionReturnType> {
  return SessionAdminGovernanceService.join(adminId, input, LOCALE, tx);
}

// ─── Tier 1: the directory read pair ─────────────────────────────────────

describe("SessionAdminGovernanceService — directory reads (runInRollback)", () => {
  test("listAll: admin sees every row newest-first with the honest filtered total, the badge flag, and zero side effects", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const scheduledA = await insertSessionRow(tx, actors, {});
      const scheduledB = await insertSessionRow(tx, actors, {});
      await insertSessionRow(tx, actors, { status: SessionStatus.Completed });
      const disputed = await insertSessionRow(tx, actors, { status: SessionStatus.Disputed });

      const page = await listAllVia(
        tx,
        adminId,
        { teacherUserId: actors.teacherUserId, status: SessionStatus.Scheduled },
        1,
        25
      );

      expect(page.totalCount).toBe(2);
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(25);
      expect(page.items.map(row => row.id)).toEqual([scheduledB.id, scheduledA.id]);
      for (const row of page.items) {
        expect(row.status).toBe(SessionStatus.Scheduled);
        expect(row.needsAttention).toBe(false);
      }

      // The disputed row's badge flag is presentation-only (server-derived).
      // The participant filter keeps the exact total deterministic against
      // rows other parallel files commit alongside this transaction.
      const allRows = await listAllVia(tx, adminId, { teacherUserId: actors.teacherUserId }, 1, 25);
      const disputedRow = allRows.items.find(row => row.id === disputed.id);
      if (!disputedRow) {
        throw new Error("expected the disputed fixture row in the unfiltered directory");
      }
      expect(disputedRow.needsAttention).toBe(true);
      expect(allRows.totalCount).toBe(4);

      // Strictly read-only: the directory query must not mutate state —
      // no audit rows, no inbox rows.
      expect(await countAuditsForSession(tx, scheduledA.id)).toBe(0);
      expect(await countAuditsForSession(tx, disputed.id)).toBe(0);
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(0);
    });
  });

  test("listAll: the teacher filter narrows to that teacher's rows only", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const otherTeacher = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, otherTeacher.id, true);
      const { adminId } = await createTestAdmin(tx);
      await insertSessionRow(tx, actors, {});
      await insertSessionRow(tx, { teacherUserId: otherTeacher.id, studentUserId: actors.studentUserId }, {});

      const page = await listAllVia(tx, adminId, { teacherUserId: actors.teacherUserId }, 1, 25);

      expect(page.totalCount).toBe(1);
      expect(page.items[0]?.teacherId).toBe(actors.teacherUserId);
    });
  });

  test("listAll: non-admin callers are forbidden before any read", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await insertSessionRow(tx, actors, {});

      const caught = await expectRepoError(() => listAllVia(tx, actors.studentUserId, {}, 1, 25));
      expectDomainDenial(caught, "FORBIDDEN", ERRORS_EN.forbidden);
    });
  });

  test("listAll: an out-of-vocabulary status, a bad page, and an inverted window are pre-read validation denials", async () => {
    await runInRollback(async tx => {
      const { adminId } = await createTestAdmin(tx);
      const today = new Date();
      const yesterday = new Date(today.getTime() - 86_400_000);

      const invalidFilters: AdminSessionListFilterInput[] = [
        filterWithForeignStatus("archived"),
        { page: 0 },
        { dateFrom: today, dateTo: yesterday },
      ];
      await assertDenialsSequentially(
        0,
        invalidFilters.map(filter => () => listAllVia(tx, adminId, filter, 1, 25)),
        error => expectDomainDenial(error, "VALIDATION", ERRORS_EN.validation)
      );
    });
  });

  test("getDetail: returns the full row for ANY lifecycle state (disputed included) with zero side effects", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, { status: SessionStatus.Disputed });

      const detail = await getDetailVia(tx, adminId, row.id);

      if (detail === null) {
        throw new Error("expected the disputed row to be readable on the browse plane");
      }
      expect(detail.id).toBe(row.id);
      expect(detail.status).toBe(SessionStatus.Disputed);
      expect(await countAuditsForSession(tx, row.id)).toBe(0);
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(0);
    });
  });

  test("getDetail: a nonexistent id — and equally a malformed one — resolves to null, never to a thrown error", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      await insertSessionRow(tx, actors, {});
      const missingId = await absentSessionId(tx);

      expect(await getDetailVia(tx, adminId, missingId)).toBeNull();
      expect(await getDetailVia(tx, adminId, 0)).toBeNull();
      expect(await getDetailVia(tx, adminId, -5)).toBeNull();
      expect(await getDetailVia(tx, adminId, Number.NaN)).toBeNull();
      expect(await getDetailVia(tx, adminId, 1.5)).toBeNull();
    });
  });

  test("getDetail: non-admin callers are forbidden", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors, {});

      const caught = await expectRepoError(() => getDetailVia(tx, actors.teacherUserId, row.id));
      expectDomainDenial(caught, "FORBIDDEN", ERRORS_EN.forbidden);
    });
  });
});

// ─── Tier 1: reschedule ──────────────────────────────────────────────────

describe("SessionAdminGovernanceService — reschedule (runInRollback)", () => {
  test("scheduled row: the timing pair is rewritten, ONE audit row records from→to, and the wave reaches both participants in their own locale", async () => {
    await runInRollback(async tx => {
      const studentUser = await createTestUser(tx, { role: "student", locale: "en" });
      await createTestStudent(tx, studentUser.id);
      const teacherUser = await createTestUser(tx, { role: "teacher", locale: "ar" });
      await createTestTeacherRow(tx, teacherUser.id, true);
      const actors = { teacherUserId: teacherUser.id, studentUserId: studentUser.id };
      const { adminId } = await createTestAdmin(tx);
      const originalStart = alignedInstant(60 * 60_000);
      const originalEnd = alignedInstant(2 * 60 * 60_000);
      const row = await insertSessionRow(tx, actors, { startedAt: originalStart, endedAt: originalEnd });
      const newStart = alignedInstant(3 * 60 * 60_000);
      const newEnd = alignedInstant(4 * 60 * 60_000);

      const updated = await rescheduleVia(tx, adminId, { sessionId: row.id, startedAt: newStart, endedAt: newEnd });

      expect(updated.status).toBe(SessionStatus.Scheduled);
      expect(updated.startedAt?.getTime()).toBe(newStart.getTime());
      expect(updated.endedAt?.getTime()).toBe(newEnd.getTime());

      const stored = await readSessionRow(tx, row.id);
      expect(stored?.startedAt?.getTime()).toBe(newStart.getTime());
      expect(stored?.endedAt?.getTime()).toBe(newEnd.getTime());

      const auditRows = await readAuditsForSession(tx, row.id);
      expect(auditRows).toHaveLength(1);
      const auditRow = auditRows[0];
      if (!auditRow) {
        throw new Error("expected exactly one audit row for the reschedule");
      }
      expect(auditRow.actionType).toBe(AuditActionType.Override);
      expect(auditRow.actorId).toBe(adminId);
      const details = parseAuditDetails(auditRow.details);
      expect(details.action).toBe("reschedule");
      expect(details.from?.startedAt).toBe(originalStart.toISOString());
      expect(details.to?.startedAt).toBe(newStart.toISOString());
      expect(details.to?.endedAt).toBe(newEnd.toISOString());

      // The wave persists as inbox rows INSIDE the tx, one per recipient,
      // copy composed in the RECIPIENT's persisted locale.
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(2);
      const studentInbox = await readInboxFor(tx, actors.studentUserId);
      expect(studentInbox[0]?.title).toBe(NOTIFS_EN.eventSessionGovernanceRescheduledTitle);
      const teacherInbox = await readInboxFor(tx, actors.teacherUserId);
      expect(teacherInbox[0]?.title).toBe(NOTIFS_AR.eventSessionGovernanceRescheduledTitle);
    });
  });

  test("started row: still reschedulable (both live states own mutable timing)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, {
        status: SessionStatus.Started,
        startedAt: alignedInstant(-30 * 60_000),
      });
      const newStart = alignedInstant(2 * 60 * 60_000);
      const newEnd = alignedInstant(3 * 60 * 60_000);

      const updated = await rescheduleVia(tx, adminId, { sessionId: row.id, startedAt: newStart, endedAt: newEnd });

      expect(updated.status).toBe(SessionStatus.Started);
      expect(updated.startedAt?.getTime()).toBe(newStart.getTime());
      expect(await countAuditsForSession(tx, row.id)).toBe(1);
    });
  });

  test("recurring-wave claim keys fold the emit-time row occurrence: a second reschedule claims FRESH keys, never the first wave's", async () => {
    await runInRollback(async tx => {
      const studentUser = await createTestUser(tx, { role: "student", locale: "en" });
      await createTestStudent(tx, studentUser.id);
      const teacherUser = await createTestUser(tx, { role: "teacher", locale: "ar" });
      await createTestTeacherRow(tx, teacherUser.id, true);
      const actors = { teacherUserId: teacherUser.id, studentUserId: studentUser.id };
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, {});
      const options = governanceOptions();
      const cache = options.cache;
      if (!(cache instanceof MapBackedClaimCache)) {
        throw new Error("expected the in-memory claim cache to be installed");
      }

      // The two occurrences are frozen one second apart so the emit-time row
      // stamps are provably distinct even where timestamps truncate to whole
      // seconds (the pglite sandbox).
      const firstOccurrence = alignedInstant();
      setSystemTime(firstOccurrence.getTime());
      let first: SessionReturnType;
      try {
        first = await SessionAdminGovernanceService.reschedule(
          adminId,
          { sessionId: row.id, startedAt: alignedInstant(60 * 60_000), endedAt: alignedInstant(2 * 60 * 60_000) },
          LOCALE,
          tx,
          options
        );
      } finally {
        setSystemTime();
      }
      const firstDiscriminator = first.updatedAt?.toISOString() ?? "";
      expect([...cache.claimedKeys].toSorted((a, b) => a.localeCompare(b))).toEqual(
        [
          buildEmitClaimKey(
            [actors.studentUserId],
            NotificationType.SessionRequest,
            `session:${row.id}:sessionGovernance.rescheduled:${firstDiscriminator}`
          ),
          buildEmitClaimKey(
            [actors.teacherUserId],
            NotificationType.SessionRequest,
            `session:${row.id}:sessionGovernance.rescheduled:${firstDiscriminator}`
          ),
        ].toSorted((a, b) => a.localeCompare(b))
      );

      cache.reset();
      setSystemTime(firstOccurrence.getTime() + 1_100);
      let second: SessionReturnType;
      try {
        second = await SessionAdminGovernanceService.reschedule(
          adminId,
          { sessionId: row.id, startedAt: alignedInstant(3 * 60 * 60_000), endedAt: alignedInstant(4 * 60 * 60_000) },
          LOCALE,
          tx,
          options
        );
      } finally {
        setSystemTime();
      }

      // The discriminator is PER MUTATION: the second occurrence stamped a
      // new instant and claimed fresh keys — no cross-occurrence dedupe.
      const secondDiscriminator = second.updatedAt?.toISOString() ?? "";
      expect(secondDiscriminator).not.toBe(firstDiscriminator);
      expect([...cache.claimedKeys].toSorted((a, b) => a.localeCompare(b))).toEqual(
        [
          buildEmitClaimKey(
            [actors.studentUserId],
            NotificationType.SessionRequest,
            `session:${row.id}:sessionGovernance.rescheduled:${secondDiscriminator}`
          ),
          buildEmitClaimKey(
            [actors.teacherUserId],
            NotificationType.SessionRequest,
            `session:${row.id}:sessionGovernance.rescheduled:${secondDiscriminator}`
          ),
        ].toSorted((a, b) => a.localeCompare(b))
      );

      // The second occurrence fanned out afresh: all four inbox rows exist.
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(4);
    });
  });

  test("completed / disputed / cancelled rows: zero-row guard miss → localized conflict with ZERO writes", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const completed = await insertSessionRow(tx, actors, { status: SessionStatus.Completed });
      const disputed = await insertSessionRow(tx, actors, { status: SessionStatus.Disputed });
      const cancelled = await insertSessionRow(tx, actors, { status: SessionStatus.Cancelled });
      const newStart = alignedInstant(60 * 60_000);
      const newEnd = alignedInstant(2 * 60 * 60_000);
      const frozenRows = [completed, disputed, cancelled];

      await assertDenialsSequentially(
        0,
        frozenRows.map(
          frozen => () => rescheduleVia(tx, adminId, { sessionId: frozen.id, startedAt: newStart, endedAt: newEnd })
        ),
        error => expectDomainDenial(error, "SESSION_INVALID_TRANSITION", ERRORS_EN.sessionInvalidTransition)
      );

      await Promise.all(
        frozenRows.map(async frozen => {
          const stored = await readSessionRow(tx, frozen.id);
          expect(stored?.startedAt).toBe(frozen.startedAt);
          expect(stored?.endedAt).toBe(frozen.endedAt);
          expect(await countAuditsForSession(tx, frozen.id)).toBe(0);
        })
      );
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(0);
    });
  });

  test("inverted or zero-width timing pair: the window-invalid denial fires BEFORE any read (an unknown id never becomes not-found)", async () => {
    await runInRollback(async tx => {
      const { adminId } = await createTestAdmin(tx);
      const missingId = await absentSessionId(tx);
      const base = alignedInstant(60 * 60_000);

      const inverted = await expectRepoError(() =>
        rescheduleVia(tx, adminId, { sessionId: missingId, startedAt: base, endedAt: alignedInstant(30 * 60_000) })
      );
      expectDomainDenial(inverted, "SESSION_RESCHEDULE_WINDOW_INVALID", ERRORS_EN.sessionRescheduleWindowInvalid);

      const zeroWidth = await expectRepoError(() =>
        rescheduleVia(tx, adminId, { sessionId: missingId, startedAt: base, endedAt: base })
      );
      expectDomainDenial(zeroWidth, "SESSION_RESCHEDULE_WINDOW_INVALID", ERRORS_EN.sessionRescheduleWindowInvalid);

      const malformed = await expectRepoError(() =>
        rescheduleVia(
          tx,
          adminId,
          rescheduleWithForeignStart({ sessionId: missingId, startedAt: base, endedAt: base }, "not-a-date")
        )
      );
      expectDomainDenial(malformed, "VALIDATION", ERRORS_EN.validation);

      expect(await countAuditsForActor(tx, adminId)).toBe(0);
    });
  });

  test("a session id beyond the safe-integer pin: the generic VALIDATION denial, never the window-invalid copy (the id refine's own custom issue is path-rooted, not root-pathed)", async () => {
    await runInRollback(async tx => {
      const { adminId } = await createTestAdmin(tx);
      const beyondPin = Number.MAX_SAFE_INTEGER + 1; // 2^53 — an exact integer the id refine must reject

      const caught = await expectRepoError(() =>
        rescheduleVia(tx, adminId, {
          sessionId: beyondPin,
          startedAt: alignedInstant(60 * 60_000),
          endedAt: alignedInstant(2 * 60 * 60_000),
        })
      );
      expectDomainDenial(caught, "VALIDATION", ERRORS_EN.validation);
      expect(await countAuditsForActor(tx, adminId)).toBe(0);
    });
  });

  test("a replacement start further than the grace window into the past: the start-in-past denial fires before any read and writes nothing", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, {});
      const staleStart = alignedInstant(-RESCHEDULE_GRACE_MS - 60_000);
      const staleEnd = alignedInstant(60 * 60_000);

      const caught = await expectRepoError(() =>
        rescheduleVia(tx, adminId, { sessionId: row.id, startedAt: staleStart, endedAt: staleEnd })
      );
      expectDomainDenial(caught, "SESSION_RESCHEDULE_START_IN_PAST", ERRORS_EN.sessionRescheduleStartInPast);

      const stored = await readSessionRow(tx, row.id);
      expect(stored?.startedAt).toBe(row.startedAt);
      expect(stored?.endedAt).toBe(row.endedAt);
      expect(await countAuditsForSession(tx, row.id)).toBe(0);
      expect(await countAuditsForActor(tx, adminId)).toBe(0);
    });
  });

  test("grace edge (frozen clock): a start EXACTLY one grace window old is accepted; one millisecond older is rejected", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, {});
      const frozenNow = alignedInstant();
      const edgeStart = new Date(frozenNow.getTime() - RESCHEDULE_GRACE_MS);
      const edgeEnd = new Date(frozenNow.getTime() + 30 * 60_000);

      setSystemTime(frozenNow.getTime());
      try {
        const updated = await rescheduleVia(tx, adminId, { sessionId: row.id, startedAt: edgeStart, endedAt: edgeEnd });
        expect(updated.startedAt?.getTime()).toBe(edgeStart.getTime());
        expect(await countAuditsForSession(tx, row.id)).toBe(1);

        const tooOldStart = new Date(frozenNow.getTime() - RESCHEDULE_GRACE_MS - 1);
        const tooOld = await expectRepoError(() =>
          rescheduleVia(tx, adminId, { sessionId: row.id, startedAt: tooOldStart, endedAt: edgeEnd })
        );
        expectDomainDenial(tooOld, "SESSION_RESCHEDULE_START_IN_PAST", ERRORS_EN.sessionRescheduleStartInPast);
      } finally {
        setSystemTime();
      }
    });
  });

  test("caller-tx path: the reschedule wave persists inside the tx but NOTHING publishes inside the caller's transaction", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, {});
      const options = governanceOptions();

      await SessionAdminGovernanceService.reschedule(
        adminId,
        { sessionId: row.id, startedAt: alignedInstant(60 * 60_000), endedAt: alignedInstant(2 * 60 * 60_000) },
        LOCALE,
        tx,
        options
      );

      // The wave persists as inbox rows INSIDE the tx (the receipts are
      // unpublished) — one per participant.
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(2);

      // Publish-after-commit is the CALLER's job on the tx path — the
      // transport must record zero fan-outs inside the rollback (the same
      // boundary the cancel tier pins).
      const transport = options.transport;
      if (!(transport instanceof SpiedFanoutTransport)) {
        throw new Error("expected the spied transport to be installed");
      }
      expect(transport.publishCount).toBe(0);
    });
  });

  test("unknown session id: the zero-row miss classifies as the localized not-found denial", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const missingId = await absentSessionId(tx);

      const caught = await expectRepoError(() =>
        rescheduleVia(tx, adminId, {
          sessionId: missingId,
          startedAt: alignedInstant(60 * 60_000),
          endedAt: alignedInstant(2 * 60 * 60_000),
        })
      );
      expectDomainDenial(caught, "SESSION_NOT_FOUND", ERRORS_EN.sessionNotFound);
      expect(caught).toBeInstanceOf(NotFoundError);
      expect(await countAuditsForActor(tx, adminId)).toBe(0);
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(0);
    });
  });
});

// ─── Tier 1: cancel ──────────────────────────────────────────────────────

describe("SessionAdminGovernanceService — cancel (runInRollback)", () => {
  test("scheduled row with a recorded hold lane: cancelled + same-lane refund + ONE audit row + the wave; nothing publishes inside the caller tx", async () => {
    await runInRollback(async tx => {
      const studentUser = await createTestUser(tx, { role: "student", locale: "en" });
      await createTestStudent(tx, studentUser.id);
      const teacherUser = await createTestUser(tx, { role: "teacher", locale: "ar" });
      await createTestTeacherRow(tx, teacherUser.id, true);
      const actors = { teacherUserId: teacherUser.id, studentUserId: studentUser.id };
      const { adminId } = await createTestAdmin(tx);
      await setLaneBalances(tx, actors.studentUserId, { hifz: 0 });
      const row = await insertSessionRow(tx, actors, { feeHeld: true, heldBalanceLane: HeldBalanceLane.Hifz });
      const options = governanceOptions();

      const cancelled = await SessionAdminGovernanceService.cancel(
        adminId,
        { sessionId: row.id, reason: "  Operational override  " },
        LOCALE,
        null,
        tx,
        options
      );

      expect(cancelled.status).toBe(SessionStatus.Cancelled);
      // The admin cancel lands the SAME terminal shape as the participant
      // writer: the hold marker is cleared inside the guarded statement —
      // no fee_held=true terminal row survives — while the provenance lane
      // survives (the same-lane refund below reads it from the row).
      expect(cancelled.feeHeld).toBe(false);

      // The hold refunds to the SAME recorded lane — exactly one unit.
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.hifz).toBe(1);
      expect(balances.trial).toBe(0);
      expect(balances.tajweed).toBe(0);

      const auditRows = await readAuditsForSession(tx, row.id);
      expect(auditRows).toHaveLength(1);
      const auditRow = auditRows[0];
      if (!auditRow) {
        throw new Error("expected exactly one audit row for the cancel");
      }
      expect(auditRow.actionType).toBe(AuditActionType.Override);
      expect(auditRow.actorId).toBe(adminId);
      const details = parseAuditDetails(auditRow.details);
      expect(details.action).toBe("cancel");
      expect(details.reason).toBe("Operational override");

      // Both participants receive the cancellation wave in their own locale.
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(2);
      const studentInbox = await readInboxFor(tx, actors.studentUserId);
      expect(studentInbox[0]?.title).toBe(NOTIFS_EN.eventSessionGovernanceCancelledTitle);
      const teacherInbox = await readInboxFor(tx, actors.teacherUserId);
      expect(teacherInbox[0]?.title).toBe(NOTIFS_AR.eventSessionGovernanceCancelledTitle);

      // The cancel wave is ONE-SHOT: it claims the bare session:key shape
      // (no occurrence discriminator) — one claim per recipient cohort.
      const waveCache = options.cache;
      if (!(waveCache instanceof MapBackedClaimCache)) {
        throw new Error("expected the in-memory claim cache to be installed");
      }
      const cancelKey = `session:${row.id}:sessionGovernance.cancelled`;
      expect([...waveCache.claimedKeys].toSorted((a, b) => a.localeCompare(b))).toEqual(
        [
          buildEmitClaimKey([actors.studentUserId], NotificationType.SessionCancellation, cancelKey),
          buildEmitClaimKey([actors.teacherUserId], NotificationType.SessionCancellation, cancelKey),
        ].toSorted((a, b) => a.localeCompare(b))
      );

      // Publish-after-commit is the CALLER's job on the tx path — the
      // transport must record zero fan-outs inside the rollback.
      const transport = options.transport;
      if (!(transport instanceof SpiedFanoutTransport)) {
        throw new Error("expected the spied transport to be installed");
      }
      expect(transport.publishCount).toBe(0);

      // No key → no claim row for the admin.
      expect(await readClaimsForUser(tx, adminId)).toHaveLength(0);
    });
  });

  test("a whitespace-only reason collapses to NO reason: ONE audit row whose metadata records a null reason, not an empty string", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, {});

      const cancelled = await cancelVia(tx, adminId, { sessionId: row.id, reason: "   " });

      expect(cancelled.status).toBe(SessionStatus.Cancelled);
      const auditRows = await readAuditsForSession(tx, row.id);
      expect(auditRows).toHaveLength(1);
      const auditRow = auditRows[0];
      if (!auditRow) {
        throw new Error("expected exactly one audit row for the whitespace-only-reason cancel");
      }
      expect(auditRow.actionType).toBe(AuditActionType.Override);
      expect(auditRow.actorId).toBe(adminId);
      const details = parseAuditDetails(auditRow.details);
      expect(details.action).toBe("cancel");
      // The normalizer's whitespace-only arm: the trimmed value collapses
      // to no reason at all — the metadata carries `reason: null` (the
      // other arm of the trim behavior pinned by the test above).
      expect(details.reason).toBeNull();
    });
  });

  test("a row with NO recorded lane: the refund is a no-op but the cancel, audit row, and wave all still happen", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, { feeHeld: false, heldBalanceLane: null });

      const cancelled = await cancelVia(tx, adminId, { sessionId: row.id });

      expect(cancelled.status).toBe(SessionStatus.Cancelled);
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.hifz).toBe(0);
      expect(balances.trial).toBe(0);
      expect(balances.tajweed).toBe(0);
      expect(await countAuditsForSession(tx, row.id)).toBe(1);
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(2);
    });
  });

  test("disputed row: the arbitration surface owns it — the cancel is refused with zero writes", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, { status: SessionStatus.Disputed });

      const caught = await expectRepoError(() => cancelVia(tx, adminId, { sessionId: row.id, reason: "late" }));
      expectDomainDenial(caught, "SESSION_INVALID_TRANSITION", ERRORS_EN.sessionInvalidTransition);

      const stored = await readSessionRow(tx, row.id);
      expect(stored?.status).toBe(SessionStatus.Disputed);
      expect(await countAuditsForSession(tx, row.id)).toBe(0);
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(0);
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.hifz).toBe(0);
    });
  });

  test("already-cancelled row WITHOUT a claim: fail-closed conflict (the honest replay arm needs the caller's claim)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, { status: SessionStatus.Cancelled });

      const caught = await expectRepoError(() => cancelVia(tx, adminId, { sessionId: row.id }));
      expectDomainDenial(caught, "SESSION_INVALID_TRANSITION", ERRORS_EN.sessionInvalidTransition);
      expect(await countAuditsForSession(tx, row.id)).toBe(0);
    });
  });

  test("idempotent retry-doubles: the same key twice → the same cancelled row back, ONE audit row, the refund exactly once, one claim row", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      await setLaneBalances(tx, actors.studentUserId, { hifz: 0 });
      const row = await insertSessionRow(tx, actors, { feeHeld: true, heldBalanceLane: HeldBalanceLane.Hifz });
      const key = `gov-cancel-${randomUUID()}`;

      const first = await cancelVia(tx, adminId, { sessionId: row.id, reason: "duplicate probe" }, key);
      const second = await cancelVia(tx, adminId, { sessionId: row.id, reason: "duplicate probe" }, key);

      // Same idempotent response shape: the current cancelled row, untouched.
      expect(first.status).toBe(SessionStatus.Cancelled);
      expect(second.status).toBe(SessionStatus.Cancelled);
      expect(second.id).toBe(first.id);

      // Exactly one refund, one audit row, one wave pair, one claim row.
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.hifz).toBe(1);
      expect(await countAuditsForSession(tx, row.id)).toBe(1);
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(2);
      const claims = await readClaimsForUser(tx, adminId);
      expect(claims).toHaveLength(1);
      const claim = claims[0];
      if (!claim) {
        throw new Error("expected the idempotency claim row to exist");
      }
      expect(claim.idempotencyKey).toBe(key);
      expect(claim.sessionId).toBe(row.id);
    });
  });

  test("a claim spent by a DIFFERENT caller is oracle-safe: the replay is denied with the session-not-found error, zero writes", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const otherAdmin = await createTestUser(tx, { role: "admin" });
      const row = await insertSessionRow(tx, actors, { status: SessionStatus.Cancelled });
      const foreignKey = `foreign-${randomUUID()}`;
      const claim = await SessionRequestIdempotencyRepository.insertClaim(
        { idempotencyKey: foreignKey, userId: otherAdmin.id },
        tx
      );
      await SessionRequestIdempotencyRepository.updateClaimSessionId(claim.id, row.id, tx);

      const caught = await expectRepoError(() => cancelVia(tx, adminId, { sessionId: row.id }, foreignKey));
      expectDomainDenial(caught, "SESSION_NOT_FOUND", ERRORS_EN.sessionNotFound);
      expect(await countAuditsForSession(tx, row.id)).toBe(0);
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(0);
    });
  });

  test("a claim spent on a DIFFERENT session is the state conflict", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const cancelledA = await insertSessionRow(tx, actors, { status: SessionStatus.Cancelled });
      const cancelledB = await insertSessionRow(tx, actors, { status: SessionStatus.Cancelled });
      const mispointedKey = `mispointed-${randomUUID()}`;
      const claim = await SessionRequestIdempotencyRepository.insertClaim(
        { idempotencyKey: mispointedKey, userId: adminId },
        tx
      );
      await SessionRequestIdempotencyRepository.updateClaimSessionId(claim.id, cancelledA.id, tx);

      const caught = await expectRepoError(() => cancelVia(tx, adminId, { sessionId: cancelledB.id }, mispointedKey));
      expectDomainDenial(caught, "SESSION_INVALID_TRANSITION", ERRORS_EN.sessionInvalidTransition);
      expect(await countAuditsForSession(tx, cancelledB.id)).toBe(0);
    });
  });

  test("a replay-arm claim points at the session it replayed against: the same key on a DIFFERENT cancelled session is the mis-point conflict, the same session still replays", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      // Both rows are ALREADY cancelled before the admin arrives — A's
      // cancel was done by a participant, so the keyed cancel below can
      // only resolve through the replay arm (the guarded UPDATE can never
      // match a cancelled row and backfill the pointer on the success
      // path).
      const cancelledA = await insertSessionRow(tx, actors, { status: SessionStatus.Cancelled });
      const cancelledB = await insertSessionRow(tx, actors, { status: SessionStatus.Cancelled });
      const key = `gov-cancel-${randomUUID()}`;

      // First use: the keyed cancel against A resolves as the idempotent
      // replay — the current row comes back, untouched.
      const replayed = await cancelVia(tx, adminId, { sessionId: cancelledA.id, reason: "late" }, key);
      expect(replayed.id).toBe(cancelledA.id);
      expect(replayed.status).toBe(SessionStatus.Cancelled);

      // The invariant that closes the mis-point bypass: the committed
      // claim names the session it replayed against — never a null
      // pointer.
      const claims = await readClaimsForUser(tx, adminId);
      expect(claims).toHaveLength(1);
      const claim = claims[0];
      if (!claim) {
        throw new Error("expected the idempotency claim row to exist");
      }
      expect(claim.idempotencyKey).toBe(key);
      expect(claim.sessionId).toBe(cancelledA.id);

      // The same key against a DIFFERENT cancelled session is the
      // mis-point state conflict — zero writes against B.
      const caught = await expectRepoError(() =>
        cancelVia(tx, adminId, { sessionId: cancelledB.id, reason: "late" }, key)
      );
      expectDomainDenial(caught, "SESSION_INVALID_TRANSITION", ERRORS_EN.sessionInvalidTransition);
      expect(await countAuditsForSession(tx, cancelledB.id)).toBe(0);
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(0);

      // The same key against A STILL resolves as the honest replay — the
      // replay is write-free (no duplicate audit row, no wave).
      const again = await cancelVia(tx, adminId, { sessionId: cancelledA.id, reason: "late" }, key);
      expect(again.id).toBe(cancelledA.id);
      expect(await countAuditsForSession(tx, cancelledA.id)).toBe(0);
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(0);
    });
  });

  test("a present key must be non-empty and within the claim column width — both shape violations are pre-DB validation denials", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, {});

      const emptyKey = await expectRepoError(() => cancelVia(tx, adminId, { sessionId: row.id }, ""));
      expectDomainDenial(emptyKey, "VALIDATION", ERRORS_EN.idempotencyKeyRequired);

      const oversizedKey = await expectRepoError(() => cancelVia(tx, adminId, { sessionId: row.id }, "k".repeat(129)));
      expectDomainDenial(oversizedKey, "VALIDATION", ERRORS_EN.idempotencyKeyRequired);

      const stored = await readSessionRow(tx, row.id);
      expect(stored?.status).toBe(SessionStatus.Scheduled);
      expect(await countAuditsForSession(tx, row.id)).toBe(0);
      expect(await readClaimsForUser(tx, adminId)).toHaveLength(0);
    });
  });
});

// ─── Tier 1: reassignTeacher ─────────────────────────────────────────────

describe("SessionAdminGovernanceService — reassignTeacher (runInRollback)", () => {
  test("scheduled row + certified candidate: the teacher swaps, the audit row records old→new, and all three recipients get the wave", async () => {
    await runInRollback(async tx => {
      const studentUser = await createTestUser(tx, { role: "student", locale: "en" });
      await createTestStudent(tx, studentUser.id);
      const outgoingTeacher = await createTestUser(tx, { role: "teacher", locale: "ar" });
      await createTestTeacherRow(tx, outgoingTeacher.id, true);
      const actors = { teacherUserId: outgoingTeacher.id, studentUserId: studentUser.id };
      const incomingTeacher = await createTestUser(tx, { role: "teacher", locale: "en" });
      await createTestTeacherRow(tx, incomingTeacher.id, true);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, {});

      const updated = await reassignVia(tx, adminId, {
        sessionId: row.id,
        newTeacherUserId: incomingTeacher.id,
      });

      expect(updated.teacherId).toBe(incomingTeacher.id);
      expect(updated.status).toBe(SessionStatus.Scheduled);
      const stored = await readSessionRow(tx, row.id);
      expect(stored?.teacherId).toBe(incomingTeacher.id);

      const auditRows = await readAuditsForSession(tx, row.id);
      expect(auditRows).toHaveLength(1);
      const auditRow = auditRows[0];
      if (!auditRow) {
        throw new Error("expected exactly one audit row for the reassignment");
      }
      const details = parseAuditDetails(auditRow.details);
      expect(details.action).toBe("reassign");
      expect(details.from?.teacherId).toBe(outgoingTeacher.id);
      expect(details.to?.teacherId).toBe(incomingTeacher.id);

      // Three recipients: the student, the OUTGOING teacher (resolved by
      // id — the row no longer references them), and the incoming teacher.
      expect(await countNotificationsFor(tx, [studentUser.id, outgoingTeacher.id, incomingTeacher.id])).toBe(3);
      const studentInbox = await readInboxFor(tx, studentUser.id);
      expect(studentInbox[0]?.title).toBe(NOTIFS_EN.eventSessionGovernanceTeacherReassignedTitle);
      const outgoingInbox = await readInboxFor(tx, outgoingTeacher.id);
      expect(outgoingInbox[0]?.title).toBe(NOTIFS_AR.eventSessionGovernanceTeacherReassignedTitle);
      const incomingInbox = await readInboxFor(tx, incomingTeacher.id);
      expect(incomingInbox[0]?.title).toBe(NOTIFS_EN.eventSessionGovernanceTeacherReassignedTitle);
    });
  });

  test("an unapproved candidate: the certification conflict fires and the row is byte-identical to its pre-call state", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const unapproved = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, unapproved.id, false);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, {});

      const caught = await expectRepoError(() =>
        reassignVia(tx, adminId, { sessionId: row.id, newTeacherUserId: unapproved.id })
      );
      expectDomainDenial(caught, "TEACHER_NOT_CERTIFIED", ERRORS_EN.teacherNotCertified);
      expect(caught).toBeInstanceOf(ConflictError);

      const stored = await readSessionRow(tx, row.id);
      expect(stored).toEqual(row);
      expect(await countAuditsForSession(tx, row.id)).toBe(0);
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId, unapproved.id])).toBe(0);
    });
  });

  test("a candidate whose approval flag is DB-null counts as NOT certified (strict-true boundary)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const nullApproved = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, nullApproved.id, null);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, {});

      const caught = await expectRepoError(() =>
        reassignVia(tx, adminId, { sessionId: row.id, newTeacherUserId: nullApproved.id })
      );
      expectDomainDenial(caught, "TEACHER_NOT_CERTIFIED", ERRORS_EN.teacherNotCertified);
      const stored = await readSessionRow(tx, row.id);
      expect(stored).toEqual(row);
    });
  });

  test("a candidate that is not a teacher at all: the localized not-found denial", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, {});
      const missingTeacherId = await absentUserId(tx);

      const caught = await expectRepoError(() =>
        reassignVia(tx, adminId, { sessionId: row.id, newTeacherUserId: missingTeacherId })
      );
      expectDomainDenial(caught, "TEACHER_NOT_FOUND", ERRORS_EN.teacherNotFound);
      expect(caught).toBeInstanceOf(NotFoundError);
      const stored = await readSessionRow(tx, row.id);
      expect(stored).toEqual(row);
      expect(await countAuditsForSession(tx, row.id)).toBe(0);
    });
  });

  test("started / completed / disputed rows: the scheduled-only guard refuses them all as transition conflicts", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const candidate = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, candidate.id, true);
      const { adminId } = await createTestAdmin(tx);
      const started = await insertSessionRow(tx, actors, { status: SessionStatus.Started });
      const completed = await insertSessionRow(tx, actors, { status: SessionStatus.Completed });
      const disputed = await insertSessionRow(tx, actors, { status: SessionStatus.Disputed });
      const ineligible = [started, completed, disputed];

      await assertDenialsSequentially(
        0,
        ineligible.map(row => () => reassignVia(tx, adminId, { sessionId: row.id, newTeacherUserId: candidate.id })),
        error => expectDomainDenial(error, "SESSION_INVALID_TRANSITION", ERRORS_EN.sessionInvalidTransition)
      );

      await Promise.all(
        ineligible.map(async row => {
          const stored = await readSessionRow(tx, row.id);
          expect(stored?.teacherId).toBe(actors.teacherUserId);
          expect(await countAuditsForSession(tx, row.id)).toBe(0);
        })
      );
    });
  });

  test("a same-teacher reassignment: the guard's different-teacher fold denies it as the transition conflict with zero writes and zero waves", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, {});

      const caught = await expectRepoError(() =>
        reassignVia(tx, adminId, { sessionId: row.id, newTeacherUserId: actors.teacherUserId })
      );
      expectDomainDenial(caught, "SESSION_INVALID_TRANSITION", ERRORS_EN.sessionInvalidTransition);
      expect(caught).toBeInstanceOf(ConflictError);

      // The zero-row guard miss is a pure denial: the row is byte-identical
      // to its pre-call state, with no audit row and no notification wave
      // (the certification pre-assertion passed — the guard is the denial).
      const stored = await readSessionRow(tx, row.id);
      expect(stored).toEqual(row);
      expect(await countAuditsForSession(tx, row.id)).toBe(0);
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(0);
    });
  });
});

// ─── Tier 1: join ────────────────────────────────────────────────────────

describe("SessionAdminGovernanceService — join (runInRollback)", () => {
  test("started row: EXACTLY ONE audit row {action: join_observe}, no session column changes, and the participant-equivalent row comes back", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, {
        status: SessionStatus.Started,
        startedAt: alignedInstant(-10 * 60_000),
      });

      const joined = await joinVia(tx, adminId, { sessionId: row.id });

      // The returned row is the SAME canonical shape the participant read
      // paths return — byte-equivalent to the direct read-back.
      const stored = await readSessionRow(tx, row.id);
      if (!stored) {
        throw new Error("expected the started row to remain readable after the join");
      }
      expect(stored).toEqual(joined);
      expect(joined.status).toBe(SessionStatus.Started);

      const auditRows = await readAuditsForSession(tx, row.id);
      expect(auditRows).toHaveLength(1);
      const auditRow = auditRows[0];
      if (!auditRow) {
        throw new Error("expected exactly one audit row for the join");
      }
      expect(auditRow.actionType).toBe(AuditActionType.Override);
      expect(auditRow.actorId).toBe(adminId);
      expect(JSON.parse(auditRow.details ?? "{}")).toEqual({ action: "join_observe" });

      // Audit-only: no status flip, no notification wave.
      expect(stored?.status).toBe(SessionStatus.Started);
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(0);
    });
  });

  test("scheduled / completed / cancelled / disputed rows: localized conflict and ZERO audit rows on every arm", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const scheduled = await insertSessionRow(tx, actors, {});
      const completed = await insertSessionRow(tx, actors, { status: SessionStatus.Completed });
      const cancelled = await insertSessionRow(tx, actors, { status: SessionStatus.Cancelled });
      const disputed = await insertSessionRow(tx, actors, { status: SessionStatus.Disputed });
      const notStarted = [scheduled, completed, cancelled, disputed];

      await assertDenialsSequentially(
        0,
        notStarted.map(row => () => joinVia(tx, adminId, { sessionId: row.id })),
        error => expectDomainDenial(error, "SESSION_INVALID_TRANSITION", ERRORS_EN.sessionInvalidTransition)
      );

      await Promise.all(
        notStarted.map(async row => {
          expect(await countAuditsForSession(tx, row.id)).toBe(0);
        })
      );
      const stored = await readSessionRow(tx, scheduled.id);
      expect(stored).toEqual(scheduled);
    });
  });

  test("the folded gate: the transaction body's single INSERT..SELECT appends the audit row only while the row is still started — a scheduled row misses into the conflict and an unknown id into the not-found, zero audit rows on both arms", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const scheduled = await insertSessionRow(tx, actors, {});
      const missingId = await absentSessionId(tx);

      // The race arm the public method's pre-read cannot reach
      // deterministically: the row LEFT the eligible set (or never
      // existed) by the time the folded statement runs. The zero-row miss
      // is classified by the cold probe — conflict vs not-found — with
      // zero audit rows on both arms.
      const conflict = await expectRepoError(() => joinObservationInTx(adminId, scheduled.id, tx, ERRORS_EN));
      expectDomainDenial(conflict, "SESSION_INVALID_TRANSITION", ERRORS_EN.sessionInvalidTransition);
      const missing = await expectRepoError(() => joinObservationInTx(adminId, missingId, tx, ERRORS_EN));
      expectDomainDenial(missing, "SESSION_NOT_FOUND", ERRORS_EN.sessionNotFound);
      expect(await countAuditsForSession(tx, scheduled.id)).toBe(0);

      // The hit arm: one statement, EXACTLY ONE audit row, the canonical
      // row back, and no session column touched.
      const started = await insertSessionRow(tx, actors, {
        status: SessionStatus.Started,
        startedAt: alignedInstant(-10 * 60_000),
      });
      const joined = await joinObservationInTx(adminId, started.id, tx, ERRORS_EN);
      expect(joined.status).toBe(SessionStatus.Started);
      expect(await readSessionRow(tx, started.id)).toEqual(started);
      const auditRows = await readAuditsForSession(tx, started.id);
      expect(auditRows).toHaveLength(1);
      expect(JSON.parse(auditRows[0]?.details ?? "{}")).toEqual({ action: "join_observe" });
    });
  });
});

// ─── Tier 2: boundaries ──────────────────────────────────────────────────

describe("SessionAdminGovernanceService — boundaries", () => {
  test("cancel reason EXACTLY 330 chars is accepted; 331 is rejected pre-DB with zero writes", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const acceptedRow = await insertSessionRow(tx, actors, {});
      const rejectedRow = await insertSessionRow(tx, actors, {});

      const cancelled = await cancelVia(tx, adminId, {
        sessionId: acceptedRow.id,
        reason: "r".repeat(MAX_CANCEL_REASON_LENGTH),
      });
      expect(cancelled.status).toBe(SessionStatus.Cancelled);
      expect(await countAuditsForSession(tx, acceptedRow.id)).toBe(1);

      const caught = await expectRepoError(() =>
        cancelVia(tx, adminId, { sessionId: rejectedRow.id, reason: "r".repeat(MAX_CANCEL_REASON_LENGTH + 1) })
      );
      expectDomainDenial(caught, "VALIDATION", ERRORS_EN.validation);
      const stored = await readSessionRow(tx, rejectedRow.id);
      expect(stored?.status).toBe(SessionStatus.Scheduled);
      expect(await countAuditsForSession(tx, rejectedRow.id)).toBe(0);
    });
  });

  test("the WORST-case escape reason (330 backslashes) commits an audit row whose serialized details fit; control characters are rejected pre-DB", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const acceptedRow = await insertSessionRow(tx, actors, {});
      const controlRow = await insertSessionRow(tx, actors, {});

      // The escape-heaviest schema-legal payload: every character doubles
      // under JSON.stringify — and the serialized envelope still fits.
      const escapeReason = "\\".repeat(MAX_CANCEL_REASON_LENGTH);
      expect(escapeReason).toHaveLength(MAX_CANCEL_REASON_LENGTH);
      const serialized = JSON.stringify({ action: "cancel", reason: escapeReason });
      expect(serialized.length).toBeLessThanOrEqual(2000);

      const cancelled = await cancelVia(tx, adminId, {
        sessionId: acceptedRow.id,
        reason: escapeReason,
      });
      expect(cancelled.status).toBe(SessionStatus.Cancelled);
      const auditRows = await readAuditsForSession(tx, acceptedRow.id);
      expect(auditRows).toHaveLength(1);
      const auditRow = auditRows[0];
      if (!auditRow) {
        throw new Error("expected exactly one audit row for the escape-heavy-reason cancel");
      }
      expect(auditRow.details).not.toBeNull();
      expect(auditRow.details?.length).toBeLessThanOrEqual(2000);
      expect(parseAuditDetails(auditRow.details)).toEqual({ action: "cancel", reason: escapeReason });

      // Control characters never reach the database: the boundary schema's
      // charset refine turns them into the generic pre-DB VALIDATION denial.
      const caught = await expectRepoError(() =>
        cancelVia(tx, adminId, { sessionId: controlRow.id, reason: "bell\u0007and\u001Fsep" })
      );
      expectDomainDenial(caught, "VALIDATION", ERRORS_EN.validation);
      const untouched = await readSessionRow(tx, controlRow.id);
      expect(untouched?.status).toBe(SessionStatus.Scheduled);
      expect(await countAuditsForSession(tx, controlRow.id)).toBe(0);
    });
  });

  test("page/pageSize bounds: 1 and 50 are honored verbatim; out-of-range values normalize to 1 and 25 before any read", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      await insertSessionRow(tx, actors, {});
      await insertSessionRow(tx, actors, {});
      await insertSessionRow(tx, actors, {});

      // The participant filter keeps the exact totals deterministic against
      // rows other parallel files commit alongside this transaction.
      const filter = { teacherUserId: actors.teacherUserId };
      const first = await listAllVia(tx, adminId, filter, 1, 1);
      expect(first.page).toBe(1);
      expect(first.pageSize).toBe(1);
      expect(first.items).toHaveLength(1);
      expect(first.totalCount).toBe(3);

      const max = await listAllVia(tx, adminId, filter, 1, 50);
      expect(max.pageSize).toBe(50);
      expect(max.items).toHaveLength(3);

      const normalized = await listAllVia(tx, adminId, filter, 0, 100);
      expect(normalized.page).toBe(1);
      expect(normalized.pageSize).toBe(25);

      const negativePage = await listAllVia(tx, adminId, filter, -5, 25);
      expect(negativePage.page).toBe(1);
      expect(negativePage.items).toHaveLength(3);
    });
  });

  test("the empty filter object returns every row; the zero-width creation window answers empty with an honest zero total", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const { adminId } = await createTestAdmin(tx);
      const row = await insertSessionRow(tx, actors, {});

      // The empty filter returns rows from every owner — parallel files
      // commit sessions of their own, so membership (not an exact total)
      // is what stays deterministic here.
      const all = await listAllVia(tx, adminId, {}, 1, 25);
      expect(all.totalCount).toBeGreaterThanOrEqual(1);
      expect(all.items.some(item => item.id === row.id)).toBe(true);

      // Half-open window: the fixture's creation instant, second-aligned.
      // The zero-width window [W, W) is a legitimate empty result — data,
      // not an error — while a window straddling the instant includes it.
      // The participant filter keeps the ±2-second window free of rows
      // other parallel files commit inside the same seconds.
      const participant = { teacherUserId: actors.teacherUserId };
      const stored = await readSessionRow(tx, row.id);
      const createdAt = stored?.createdAt;
      if (!createdAt) {
        throw new Error("expected the fixture row to carry a creation instant");
      }
      const windowEdge = new Date(Math.floor(createdAt.getTime() / 1000) * 1000);
      const zeroWidth = await listAllVia(
        tx,
        adminId,
        { ...participant, dateFrom: windowEdge, dateTo: windowEdge },
        1,
        25
      );
      expect(zeroWidth.items).toHaveLength(0);
      expect(zeroWidth.totalCount).toBe(0);

      const spanning = await listAllVia(
        tx,
        adminId,
        {
          ...participant,
          dateFrom: new Date(windowEdge.getTime() - 1000),
          dateTo: new Date(windowEdge.getTime() + 2000),
        },
        1,
        25
      );
      expect(spanning.totalCount).toBe(1);
      expect(spanning.items[0]?.id).toBe(row.id);
    });
  });
});

// ─── Tier 3: chaos (committed fixtures, production tx path) ──────────────

describe("SessionAdminGovernanceService — chaos (production tx path, committed fixtures)", () => {
  let chaosAdminId = 0;
  let chaosTeacherId = 0;
  let chaosStudentId = 0;
  const chaosSessionIds: number[] = [];

  beforeAll(async () => {
    await db.transaction(async tx => {
      const actors = await createSessionActors(tx);
      chaosTeacherId = actors.teacherUserId;
      chaosStudentId = actors.studentUserId;
      const admin = await createTestUser(tx, { role: "admin" });
      chaosAdminId = admin.id;
      await tx
        .update(students)
        .set({ balanceTrial: 0, balanceHifz: 0, balanceTajweed: 0 })
        .where(eq(students.id, chaosStudentId));
    });
  });

  afterAll(async () => {
    // FK-safe hard delete: audit rows (suspended immutability trigger) →
    // claims → notifications → sessions → users (the users delete cascades
    // the role-child rows).
    await withAuditDeleteTriggersSuspended(async () => {
      await db.delete(auditLogs).where(inArray(auditLogs.actorId, [chaosAdminId]));
      if (chaosSessionIds.length > 0) {
        await db
          .delete(auditLogs)
          .where(and(eq(auditLogs.entityType, SESSION_ENTITY_TYPE), inArray(auditLogs.entityId, chaosSessionIds)));
      }
    });
    await db.delete(sessionRequestIdempotency).where(eq(sessionRequestIdempotency.userId, chaosAdminId));
    await db.delete(notifications).where(inArray(notifications.userId, [chaosStudentId, chaosTeacherId, chaosAdminId]));
    await db.delete(session).where(eq(session.studentId, chaosStudentId));
    await db.delete(users).where(inArray(users.id, [chaosAdminId, chaosTeacherId, chaosStudentId]));
  });

  /** Commits one STARTED held session for the chaos cast (production-path precondition). */
  async function commitStartedChaosSession(): Promise<SessionSelectType> {
    const row = await db.transaction(async tx =>
      tx
        .insert(session)
        .values({
          teacherId: chaosTeacherId,
          studentId: chaosStudentId,
          status: SessionStatus.Started,
          sessionType: SessionType.StudentSession,
          intent: SessionIntent.Hifz,
          fee: "10.00",
          feeHeld: true,
          heldBalanceLane: HeldBalanceLane.Hifz,
          startedAt: alignedInstant(-10 * 60_000),
        })
        .returning()
    );
    const created = row[0];
    if (!created) {
      throw new Error("commitStartedChaosSession: insert returned no rows");
    }
    chaosSessionIds.push(created.id);
    return created;
  }

  /** Commits one SCHEDULED session for the chaos cast (production-path precondition). */
  async function commitScheduledChaosSession(): Promise<SessionSelectType> {
    const row = await db.transaction(async tx =>
      tx
        .insert(session)
        .values({
          teacherId: chaosTeacherId,
          studentId: chaosStudentId,
          status: SessionStatus.Scheduled,
          sessionType: SessionType.StudentSession,
          intent: SessionIntent.Hifz,
          fee: "10.00",
        })
        .returning()
    );
    const created = row[0];
    if (!created) {
      throw new Error("commitScheduledChaosSession: insert returned no rows");
    }
    chaosSessionIds.push(created.id);
    return created;
  }

  /** Independent read-back oracle for the chaos block (db-scoped). */
  async function readChaosSessionRow(sessionId: number): Promise<SessionSelectType | null> {
    return readSessionRow(db, sessionId);
  }

  function chaosCancel(sessionId: number, idempotencyKey?: string | null): Promise<SessionReturnType> {
    // NO outerTx — the production path: the service opens its own
    // transaction, giving every concurrent call a real serialized turn.
    return SessionAdminGovernanceService.cancel(
      chaosAdminId,
      { sessionId },
      LOCALE,
      idempotencyKey,
      undefined,
      governanceOptions()
    );
  }

  test("own-commit production path: the cancel commits durably, refunds once, publishes the wave exactly once after commit, and a keyless re-cancel is the fail-closed conflict", async () => {
    const started = await commitStartedChaosSession();
    const transport = new SpiedFanoutTransport();

    const cancelled = await SessionAdminGovernanceService.cancel(
      chaosAdminId,
      { sessionId: started.id, reason: "own-commit probe" },
      LOCALE,
      null,
      undefined,
      { transport, cache: new MapBackedClaimCache() }
    );

    expect(cancelled.status).toBe(SessionStatus.Cancelled);
    const finalRow = await readChaosSessionRow(started.id);
    expect(finalRow?.status).toBe(SessionStatus.Cancelled);

    // Durable exactly-once writes on the committed path.
    const balances = await readLaneBalances(db, chaosStudentId);
    expect(balances.hifz).toBe(1);
    expect(await countAuditsForSession(db, started.id)).toBe(1);
    expect(await countNotificationsFor(db, [chaosStudentId, chaosTeacherId])).toBe(2);

    // Publish-after-commit: one fan-out PER delivery receipt (the engine's
    // per-receipt publish contract — each recipient is one receipt) —
    // spied, never delivered. Two receipts → two fan-outs covering the
    // same two recipients, in wave order (student first, then teacher).
    expect(transport.publishCount).toBe(2);
    expect(transport.publishedUserIds).toEqual([chaosStudentId, chaosTeacherId]);

    // A keyless re-cancel of the already-cancelled row is fail-closed.
    const replay = await expectRepoError(() => chaosCancel(started.id));
    expectDomainDenial(replay, "SESSION_INVALID_TRANSITION", ERRORS_EN.sessionInvalidTransition);
    expect(await countAuditsForSession(db, started.id)).toBe(1);
  });

  test("own-commit production path: the reschedule commits durably, appends ONE audit row, and publishes the wave exactly once after commit", async () => {
    const scheduled = await commitScheduledChaosSession();
    const inboxBefore = await countNotificationsFor(db, [chaosStudentId, chaosTeacherId]);
    const newStart = alignedInstant(60 * 60_000);
    const newEnd = alignedInstant(2 * 60 * 60_000);
    const transport = new SpiedFanoutTransport();

    const rescheduled = await SessionAdminGovernanceService.reschedule(
      chaosAdminId,
      { sessionId: scheduled.id, startedAt: newStart, endedAt: newEnd },
      LOCALE,
      undefined,
      { transport, cache: new MapBackedClaimCache() }
    );

    expect(rescheduled.status).toBe(SessionStatus.Scheduled);
    expect(rescheduled.startedAt?.getTime()).toBe(newStart.getTime());
    const finalRow = await readChaosSessionRow(scheduled.id);
    expect(finalRow?.startedAt?.getTime()).toBe(newStart.getTime());

    // Durable exactly-once writes on the committed path: ONE audit row
    // and one persisted inbox row per participant.
    expect(await countAuditsForSession(db, scheduled.id)).toBe(1);
    expect(await countNotificationsFor(db, [chaosStudentId, chaosTeacherId])).toBe(inboxBefore + 2);

    // Publish-after-commit: one fan-out PER delivery receipt (the engine's
    // per-receipt publish contract) — spied, never delivered. Two receipts
    // → two fan-outs covering the same two participants, in wave order
    // (student first, then teacher).
    expect(transport.publishCount).toBe(2);
    expect(transport.publishedUserIds).toEqual([chaosStudentId, chaosTeacherId]);
  });

  /**
   * Per-test isolation for the concurrent tiers: the chaos cast's student
   * row and inbox are SHARED across this describe's tests (zeroed once in
   * beforeAll), so a test that pins ABSOLUTE refund/inbox counts must first
   * reset them — the earlier committed-path cancel/reschedule tests in this
   * block have already credited +1 refund and +2 inbox rows per cast by the
   * time the postgres-only tiers execute.
   */
  async function resetChaosBalancesAndInbox(): Promise<void> {
    await db
      .update(students)
      .set({ balanceTrial: 0, balanceHifz: 0, balanceTajweed: 0 })
      .where(eq(students.id, chaosStudentId));
    await db.delete(notifications).where(inArray(notifications.userId, [chaosStudentId, chaosTeacherId]));
  }

  testOnRealPostgres(
    "admin cancel ⚡ participant complete on the SAME started session: exactly one survives, the loser is a transition conflict, zero partial writes",
    async () => {
      await resetChaosBalancesAndInbox();
      const started = await commitStartedChaosSession();

      const outcomes = await Promise.allSettled([
        chaosCancel(started.id),
        SessionLifecycleService.completeSession(chaosTeacherId, started.id, LOCALE),
      ]);

      const fulfillments = outcomes.flatMap(outcome => (outcome.status === "fulfilled" ? [outcome.value] : []));
      const rejections = outcomes.flatMap(outcome => (outcome.status === "rejected" ? [outcome.reason] : []));
      expect(fulfillments).toHaveLength(1);
      expect(rejections).toHaveLength(1);
      expect(rejections[0]).toBeInstanceOf(DomainError);
      expect(rejectionCode(rejections[0])).toBe("SESSION_INVALID_TRANSITION");

      // Either legal outcome may win the serialization (the cancel from the
      // pre-terminal pair, the completion from the started row); whichever
      // won, the row is in EXACTLY that winner's terminal shape and the
      // loser left zero partial writes.
      const finalRow = await readChaosSessionRow(started.id);
      const cancelWon = fulfillments[0]?.status === CANCELLED_STATUS;
      if (cancelWon) {
        expect(finalRow?.status).toBe(SessionStatus.Cancelled);
        expect(finalRow?.endedAt).toBeNull();
        // Refund exactly once to the recorded lane, ONE audit row, one wave pair.
        const balances = await readLaneBalances(db, chaosStudentId);
        expect(balances.hifz).toBe(1);
        expect(balances.trial).toBe(0);
        expect(balances.tajweed).toBe(0);
        expect(await countAuditsForSession(db, started.id)).toBe(1);
        expect(await countNotificationsFor(db, [chaosStudentId, chaosTeacherId])).toBe(2);
      } else {
        expect(finalRow?.status).toBe(SessionStatus.Completed);
        expect(finalRow?.endedAt).not.toBeNull();
        // The completion wrote no audit row, refunded nothing, waved nobody.
        expect(await countAuditsForSession(db, started.id)).toBe(0);
        const balances = await readLaneBalances(db, chaosStudentId);
        expect(balances.hifz).toBe(0);
        expect(await countNotificationsFor(db, [chaosStudentId, chaosTeacherId])).toBe(0);
      }
    }
  );

  testOnRealPostgres(
    "concurrent double-cancel with the SAME idempotency key: the claim is spent exactly once — one audit row, one refund, one wave pair, one claim row",
    async () => {
      await resetChaosBalancesAndInbox();
      const started = await commitStartedChaosSession();
      const sharedKey = `chaos-cancel-${randomUUID()}`;

      const outcomes = await Promise.allSettled([
        chaosCancel(started.id, sharedKey),
        chaosCancel(started.id, sharedKey),
      ]);

      // The claim table admits exactly one performer; the loser resolves as
      // the idempotent replay (or, if it lost the row lock differently, as
      // the transition conflict) — never a second performer.
      const fulfillments = outcomes.flatMap(outcome => (outcome.status === "fulfilled" ? [outcome.value] : []));
      const rejections = outcomes.flatMap(outcome => (outcome.status === "rejected" ? [outcome.reason] : []));
      expect(fulfillments.length).toBeGreaterThanOrEqual(1);
      for (const fulfilled of fulfillments) {
        expect(fulfilled.status).toBe(SessionStatus.Cancelled);
        expect(fulfilled.id).toBe(started.id);
      }
      for (const rejection of rejections) {
        expect(rejection).toBeInstanceOf(DomainError);
        expect(rejectionCode(rejection)).toBe("SESSION_INVALID_TRANSITION");
      }

      // Exactly-once everywhere: one claim row (backfilled), one audit row,
      // one refund unit, one wave pair.
      const finalRow = await readChaosSessionRow(started.id);
      expect(finalRow?.status).toBe(SessionStatus.Cancelled);
      const balances = await readLaneBalances(db, chaosStudentId);
      expect(balances.hifz).toBe(1);
      expect(await countAuditsForSession(db, started.id)).toBe(1);
      expect(await countNotificationsFor(db, [chaosStudentId, chaosTeacherId])).toBe(2);
      const claims = await db
        .select()
        .from(sessionRequestIdempotency)
        .where(eq(sessionRequestIdempotency.idempotencyKey, sharedKey));
      expect(claims).toHaveLength(1);
      const claim = claims[0];
      if (!claim) {
        throw new Error("expected the shared-key claim row to exist");
      }
      expect(claim.sessionId).toBe(started.id);
      expect(claim.userId).toBe(chaosAdminId);
    }
  );
});

// ─── Tier 4: security (BFLA role matrix) ─────────────────────────────────

describe("SessionAdminGovernanceService — non-admin role matrix (runInRollback)", () => {
  /**
   * The six service calls one denied actor (a non-admin role, or an admin
   * whose account is governed) makes against one target session — the
   * payload the sequential denial walker consumes.
   */
  function sixDeniedCalls(
    tx: DBTransaction,
    actorId: number,
    sessionId: number,
    teacherId: number
  ): Array<() => Promise<unknown>> {
    const newStart = alignedInstant(60 * 60_000);
    const newEnd = alignedInstant(2 * 60 * 60_000);
    return [
      () => listAllVia(tx, actorId, {}, 1, 25),
      () => getDetailVia(tx, actorId, sessionId),
      () => rescheduleVia(tx, actorId, { sessionId, startedAt: newStart, endedAt: newEnd }),
      () => cancelVia(tx, actorId, { sessionId, reason: "denied" }),
      () => reassignVia(tx, actorId, { sessionId, newTeacherUserId: teacherId }),
      () => joinVia(tx, actorId, { sessionId }),
    ];
  }

  /**
   * Drives ALL six functions as one denied actor (a non-admin role, or an
   * admin whose account is governed) and asserts every call is denied
   * `FORBIDDEN` with zero writes (sequential recursive walk on the shared
   * rollback transaction).
   */
  async function expectSixForbiddenDenials(
    tx: DBTransaction,
    actorId: number,
    sessionId: number,
    teacherId: number
  ): Promise<void> {
    await assertDenialsSequentially(0, sixDeniedCalls(tx, actorId, sessionId, teacherId), error =>
      expectDomainDenial(error, "FORBIDDEN", ERRORS_EN.forbidden)
    );
  }

  for (const role of ["student", "teacher", "parent"] as const) {
    test(`role ${role}: all six functions are forbidden with ZERO writes`, async () => {
      await runInRollback(async tx => {
        const actors = await createSessionActors(tx);
        const row = await insertSessionRow(tx, actors, {});
        const actor = await createTestUser(tx, { role });

        await expectSixForbiddenDenials(tx, actor.id, row.id, actors.teacherUserId);

        const stored = await readSessionRow(tx, row.id);
        expect(stored).toEqual(row);
        expect(await countAuditsForSession(tx, row.id)).toBe(0);
        expect(await countAuditsForActor(tx, actor.id)).toBe(0);
        expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(0);
        expect(await readClaimsForUser(tx, actor.id)).toHaveLength(0);
      });
    });
  }

  test("governed admins (deleted / blocked / suspended) fail closed FORBIDDEN across all six functions with ZERO writes", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors, {});

      // The DB row is the authority, never a still-valid token: an admin
      // whose account was deleted, blocked, or suspended after login fails
      // the governance leg of the gate exactly like the reference
      // arbitration op's — FORBIDDEN, zero reads past the gate, zero
      // writes.
      const deletedAdmin = await createTestUser(tx, { role: "admin", isDeleted: true });
      const blockedAdmin = await createTestUser(tx, { role: "admin", isBlocked: true });
      const suspendedAdmin = await createTestUser(tx, { role: "admin", suspended: true });
      const governedAdmins = [deletedAdmin, blockedAdmin, suspendedAdmin];

      // Each governed admin is denied at the gate on every function — the
      // eighteen denials run sequentially on the shared rollback
      // transaction (each is independent and leaves the row untouched).
      await assertDenialsSequentially(
        0,
        governedAdmins.flatMap(governed => sixDeniedCalls(tx, governed.id, row.id, actors.teacherUserId)),
        error => expectDomainDenial(error, "FORBIDDEN", ERRORS_EN.forbidden)
      );

      // Zero writes anywhere: byte-identical row, no audit rows for the
      // session or by any governed actor, empty inboxes, zero claim rows.
      await Promise.all(
        governedAdmins.map(async governed => {
          expect(await readSessionRow(tx, row.id)).toEqual(row);
          expect(await countAuditsForSession(tx, row.id)).toBe(0);
          expect(await countAuditsForActor(tx, governed.id)).toBe(0);
          expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(0);
          expect(await readClaimsForUser(tx, governed.id)).toHaveLength(0);
        })
      );
    });
  });

  test("anonymous sentinel: an unresolvable actor id fails closed FORBIDDEN across all six functions — the user row is the authority", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors, {});
      const anonymousId = 0;
      const newStart = alignedInstant(60 * 60_000);
      const newEnd = alignedInstant(2 * 60 * 60_000);
      const calls: Array<() => Promise<unknown>> = [
        () => listAllVia(tx, anonymousId, {}, 1, 25),
        () => getDetailVia(tx, anonymousId, row.id),
        () => rescheduleVia(tx, anonymousId, { sessionId: row.id, startedAt: newStart, endedAt: newEnd }),
        () => cancelVia(tx, anonymousId, { sessionId: row.id }),
        () => reassignVia(tx, anonymousId, { sessionId: row.id, newTeacherUserId: actors.teacherUserId }),
        () => joinVia(tx, anonymousId, { sessionId: row.id }),
      ];

      // The gate resolves the actor row and fails closed when it does not
      // exist — the same fail-closed semantics the reference arbitration
      // op's gate applies to a missing row (the wire-level anonymous 401 is
      // the GraphQL scope gate's, ahead of the service).
      await assertDenialsSequentially(0, calls, error => expectDomainDenial(error, "FORBIDDEN", ERRORS_EN.forbidden));

      const stored = await readSessionRow(tx, row.id);
      expect(stored).toEqual(row);
      expect(await countAuditsForSession(tx, row.id)).toBe(0);
      expect(await countNotificationsFor(tx, [actors.studentUserId, actors.teacherUserId])).toBe(0);
    });
  });
});
