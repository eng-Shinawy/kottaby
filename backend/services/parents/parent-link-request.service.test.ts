/**
 * ParentLinkRequestService tests — the five service operations against the
 * live PostgreSQL instance.
 *
 * Per `backend/services/AGENTS.md` (service tests live next to the code) and
 * the `student-handshake.service.test.ts` precedent:
 *  - 4-Tier mixed suite. Caller-tx cases run inside `runInRollback` with `tx`
 *    passed as the service's `outerTx` (savepoint semantics: a failing inner
 *    unit rolls back to the savepoint and leaves the outer tx usable for
 *    residue probes). Own-commit cases (the service opens its own top-level
 *    transaction and publishes after it) run against ONE committed `beforeAll`
 *    cast that is hard-deleted in `afterAll` with tracked ids + residue probes
 *    (the committed-fixture hygiene rule) — the service's own commit cannot be
 *    folded into `runInRollback`.
 *  - Entities ONLY via `entity-setup.ts` helpers (randomized emails/codes);
 *    governance variants via `createTestUser` overrides. Fixture identity
 *    fields carry the per-run `svc_plink_<uuid8>` prefix so residue is
 *    greppable and parallel runs never collide.
 *  - All rejection assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` appears nowhere.
 *  - Translated-message assertions use literals computed in-file through
 *    `getServerTranslations` — never hardcoded copy.
 *  - The fan-out boundary is SPIED through the engine's `options.transport`
 *    seam with a module-private recording transport — nothing reaches a real
 *    channel (no Redis pub/sub, no WebSocket frames).
 *  - Clock boundaries use `setSystemTime` from `bun:test` (the sanctioned
 *    runner clock control — collaborators are NEVER monkey-patched for
 *    resolution; the only `spyOn` uses below FORCE failures or silence logs,
 *    never fake a successful path).
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): requestLink ordered pipeline (normalize pre-DB,
 *    actor re-check, discovery null-collapse, already-linked, already-pending
 *    pre-check + the partial-unique 23505 arbiter, recipient-locale copy at
 *    the emitter incl. the `defaultLocale` fallback, in-tx emit, publish
 *    discriminant own-commit vs caller-tx); respondToLinkRequest accept and
 *    reject branches (link write, sibling expiry vs children-choose-parents,
 *    accepted/rejected copy to the parent); cancelLinkRequest silent
 *    withdrawal; self-scoped lists with closed wire shapes; classified denials
 *    (NOT_FOUND foreign ≡ nonexistent, ALREADY_RESOLVED, EXPIRED).
 *  - Tier 2 (boundary): claim/liveness at `expiresAt` exactly now, now−1ms,
 *    now+1ms (strict `>` proven; the materialized expiry survives the denial);
 *    render-time expiry on the lists at the same instants WITHOUT any write;
 *    one-captured-`now` determinism under a frozen clock.
 *  - Tier 3 (chaos): forced repository failure propagates unmasked (never
 *    swallowed into a domain shape); post-claim zero-row link collapse rolls
 *    the ENTIRE unit back (claim + expiry + notification — zero residual rows
 *    across `parent_link_requests`/`students`/`notifications`); post-claim
 *    engine failure rolls back the same way.
 *  - Tier 4 (security): the REAL actor re-check on every op (anonymous,
 *    missing id, cross-role); governed-actor denial with a PRE-ISSUED-token
 *    simulation (actor row flipped governed between issue and call) with the
 *    SAME constant denial copy as the role arm (no branch disclosure);
 *    zero-write probes on EVERY denial arm across
 *    `parent_link_requests`/`students`/`notifications`/`audit_logs` (the
 *    expiry fold is the EXPIRED arm's only sanctioned write);
 *    log-pressure discipline (exactly ONE bounded `logDomainError` per denial,
 *    NEVER a name/email/handshake code, happy paths emit NOTHING).
 */

import { afterAll, beforeAll, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import {
  ParentLinkRequestReminderRepository,
  ParentLinkRequestRepository,
  StudentRepository,
  UserRepository,
} from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parentLinkRequests } from "@/backend/db/schema/parents/parent-link-requests";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { LinkStatus } from "@/backend/enum/shared/link-status.enum";
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  NotificationEngine,
  type NotificationEngineCallOptions,
} from "@/backend/services/notifications/notification-engine.service";
import type { NotificationFanoutTransport } from "@/backend/services/notifications/realtime/fanout-transport";
import { PARENT_LINK_RELATED_ENTITY_TYPE } from "@/backend/services/parents/parent-link-request.helpers";
import { ParentLinkRequestService } from "@/backend/services/parents/parent-link-request.service";
import type { DBTransaction, RealtimeNotificationPayload, StudentSelectType, UserSelectType } from "@/backend/types";
import { isHandshakeCode, normalizeHandshakeCode } from "@/shared/constants/handshake-code.constants";
import { PARENT_LINK_REQUEST_MS } from "@/shared/constants/parent-link-request.constants";
import { isolateBidi } from "@/shared/lib/isolate-bidi";
import { maskFullName } from "@/shared/lib/mask-full-name";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const LOCALE_EN = "en";
const LOCALE_AR = "ar";
const HOUR_MS = 60 * 60 * 1000;

/** Production "no session" actor id — the anonymous sentinel. */
const ANONYMOUS_ACTOR_ID = 0;

/** Per-run identity prefix — `svc_plink_<uuid8>` on every fixture identity field. */
const RUN_PREFIX = `svc_plink_${crypto.randomUUID().slice(0, 8)}`;

/** English translated literals — the message-comparison source of truth. */
const enErrors = getServerTranslations(LOCALE_EN).errorsTranslations;

/** LIKE patterns for the zero-residue probes (hoisted out of `sql` nesting). */
const RUN_PREFIX_SUFFIX_LIKE = `${RUN_PREFIX}%`;
const RUN_PREFIX_CONTAINS_LIKE = `%${RUN_PREFIX}%`;

/** Closed outgoing wire shape (the parent never sees raw student identity). */
const OUTGOING_KEYS = ["createdAt", "expiresAt", "id", "respondedAt", "status", "studentMaskedName"];

/** Closed incoming wire shape (the student sees the parent's FULL name). */
const INCOMING_KEYS = ["createdAt", "expiresAt", "id", "parentFullName", "respondedAt", "status"];

type NotificationRow = typeof notifications.$inferSelect;
type ParentLinkRequestRow = typeof parentLinkRequests.$inferSelect;

/** Locale-stable comparator for sorted key-set assertions. */
function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Byte fingerprint of a denial — the constant-shape oracle (code + message). */
function errorFingerprint(error: DomainError): string {
  return JSON.stringify({ code: error.code, message: error.message });
}

/** Installs a recording stub over `logger.logDomainError` (silences + counts). */
function silenceDomainLog() {
  return spyOn(logger, "logDomainError").mockImplementation(() => {});
}

/** Narrow a caught error to a DomainError or fail the test with context. */
function requireDomainError(error: Error): DomainError {
  expect(error).toBeInstanceOf(DomainError);
  if (!(error instanceof DomainError)) {
    throw new Error("expected a DomainError instance");
  }
  return error;
}

/** Denial oracle for typed-conflict arms: pins class, exact code, translated copy. */
async function expectConflict(
  fn: () => Promise<unknown>,
  code: string,
  translatedCopy: string
): Promise<ConflictError> {
  const error = await expectRepoError(fn);
  if (!(error instanceof ConflictError)) {
    throw new Error(`expected a ConflictError with code ${code}`);
  }
  expect(error.code).toBe(code);
  expect(error.message).toBe(translatedCopy);
  return error;
}

/** Denial oracle for the actor re-check arms (REAL resolution — never patched). */
async function expectRecheckDenial(
  fn: () => Promise<unknown>,
  errorClass: typeof UnauthorizedError | typeof ForbiddenError,
  code: string,
  translatedCopy: string
): Promise<DomainError> {
  const error = await expectRepoError(fn);
  expect(error).toBeInstanceOf(errorClass);
  const domain = requireDomainError(error);
  expect(domain.code).toBe(code);
  expect(domain.message).toBe(translatedCopy);
  return domain;
}

/** Captures the constant-shape NOT_FOUND fingerprint of a denial and pins its copy. */
async function expectNotFoundShape(fn: () => Promise<unknown>): Promise<string> {
  const error = await expectRepoError(fn);
  if (!(error instanceof NotFoundError)) {
    throw new Error("expected a NotFoundError from the constant-shape denial");
  }
  expect(error.code).toBe("PARENT_LINK_REQUEST_NOT_FOUND");
  expect(error.message).toBe(enErrors.parentLinkRequestNotFound);
  return errorFingerprint(error);
}

/** Closed-shape assertion for an outgoing payload row. */
function expectOutgoingShape(row: object): void {
  expect(Object.keys(row).toSorted(compareStrings)).toEqual(OUTGOING_KEYS);
}

/** Closed-shape assertion for an incoming payload row. */
function expectIncomingShape(row: object): void {
  expect(Object.keys(row).toSorted(compareStrings)).toEqual(INCOMING_KEYS);
}

interface RecordedPublish {
  readonly userIds: readonly number[];
  readonly payload: RealtimeNotificationPayload;
}

/** Module-private recording fan-out transport — the spied publish boundary. */
class RecordingFanoutTransport implements NotificationFanoutTransport {
  private readonly published: RecordedPublish[] = [];

  async publishFanout(userIds: readonly number[], payload: RealtimeNotificationPayload): Promise<void> {
    this.published.push({ userIds: [...userIds], payload });
  }

  get publishCount(): number {
    return this.published.length;
  }

  get lastPublish(): RecordedPublish | null {
    return this.published.at(-1) ?? null;
  }

  clear(): void {
    this.published.length = 0;
  }
}

/**
 * Publish oracle: EXACTLY ONE publish since the last re-arm, addressed to
 * `targetUserId` alone, carrying the parent-link related-entity binding.
 */
function expectSinglePublish(transport: RecordingFanoutTransport, targetUserId: number, relatedEntityId: number): void {
  expect(transport.publishCount).toBe(1);
  const call = transport.lastPublish;
  if (call === null) {
    throw new Error("expected one recorded publish");
  }
  expect(call.userIds).toEqual([targetUserId]);
  expect(call.payload.data.relatedEntityType).toBe("parent_link_request");
  expect(call.payload.data.relatedEntityId).toBe(relatedEntityId);
}

/** The engine call options every notify-boundary service call passes. */
function callOptions(transport: RecordingFanoutTransport): NotificationEngineCallOptions {
  return { transport };
}

/** Persisted parent-link inbox rows of one user, read through the given executor. */
async function linkInboxRowsFor(executor: DBTransaction | typeof db, userId: number): Promise<NotificationRow[]> {
  return executor.select().from(notifications).where(eq(notifications.userId, userId));
}

/** All live pending requests for one student, read through the given executor. */
async function pendingCountForStudent(executor: DBTransaction | typeof db, studentId: number): Promise<number> {
  return executor.$count(
    parentLinkRequests,
    sql`(${parentLinkRequests.studentId} = ${studentId} AND ${parentLinkRequests.status} = 'pending')`
  );
}

/** Fresh read of one request row by id through the given executor (null when absent). */
async function requestRowById(executor: DBTransaction | typeof db, id: number): Promise<ParentLinkRequestRow | null> {
  const rows = await executor.select().from(parentLinkRequests).where(eq(parentLinkRequests.id, id));
  return rows.at(0) ?? null;
}

/** Fresh read of `students.parent_id` for one student through the given executor. */
async function studentParentId(executor: DBTransaction | typeof db, studentId: number): Promise<number | null> {
  const rows = await executor.select({ parentId: students.parentId }).from(students).where(eq(students.id, studentId));
  return rows.at(0)?.parentId ?? null;
}

/** Valid-format code derived to match NO students row (the nonexistent-code channel). */
function deriveAbsentHandshakeCode(existing: string): string {
  const lastChar = existing.slice(-1);
  const replacement = lastChar === "0" ? "1" : "0";
  return `${existing.slice(0, -1)}${replacement}`;
}

/** The committed cast provisioned once in `beforeAll` (own-commit paths). */
interface CommittedCastType {
  readonly parentA: UserSelectType;
  readonly parentB: UserSelectType;
  readonly studentEn: { user: UserSelectType; student: StudentSelectType };
  readonly studentAr: { user: UserSelectType; student: StudentSelectType };
  readonly studentNullLocale: { user: UserSelectType; student: StudentSelectType };
  readonly studentLinked: { user: UserSelectType; student: StudentSelectType };
  readonly studentGov: { user: UserSelectType; student: StudentSelectType };
  /** Clean at provision time — flipped governed AFTER (pre-issued-token simulation). */
  readonly parentGov: UserSelectType;
  /** Valid-format code matching no students row. */
  readonly absentCode: string;
  /** Definitely-absent user id (far above the committed id space). */
  readonly absentUserId: number;
}

let cast: CommittedCastType | null = null;

/** Tracked committed-fixture ids — module scope so `afterAll` can hard-delete unconditionally. */
const trackedUserIds: number[] = [];
const trackedStudentIds: number[] = [];
const trackedRequestIds: number[] = [];

function requireCast(): CommittedCastType {
  if (cast === null) {
    throw new Error("committed cast missing: beforeAll fixture was not provisioned");
  }
  return cast;
}

/** Creates a committed student fixture (user + students row) with prefixed identity. */
async function createStudentFixture(
  tx: DBTransaction,
  userOverrides: Partial<UserSelectType>,
  label: string
): Promise<{ user: UserSelectType; student: StudentSelectType }> {
  const user = await createTestUser(tx, {
    fullName: `${RUN_PREFIX} ${label}`,
    email: `${RUN_PREFIX}.${label}@service.test`,
    ...userOverrides,
  });
  trackedUserIds.push(user.id);
  const student = await createTestStudent(tx, user.id);
  trackedStudentIds.push(student.id);
  return { user, student };
}

// ─── Committed cast provisioning + tracked teardown ─────────────────────

beforeAll(async () => {
  const provisioned = await db.transaction(async (tx: DBTransaction): Promise<CommittedCastType> => {
    const parentA = await createTestUser(tx, {
      role: "parent",
      fullName: `${RUN_PREFIX} Parent A`,
      email: `${RUN_PREFIX}.parent-a@service.test`,
      locale: LOCALE_EN,
    });
    trackedUserIds.push(parentA.id);
    const parentB = await createTestUser(tx, {
      role: "parent",
      fullName: `${RUN_PREFIX} Parent B`,
      email: `${RUN_PREFIX}.parent-b@service.test`,
      locale: LOCALE_EN,
    });
    trackedUserIds.push(parentB.id);

    const studentEn = await createStudentFixture(tx, { locale: LOCALE_EN }, "student-en");
    const studentAr = await createStudentFixture(tx, { locale: LOCALE_AR }, "student-ar");
    const studentNullLocale = await createStudentFixture(tx, { locale: null }, "student-null-locale");
    const studentLinked = await createStudentFixture(tx, { locale: LOCALE_EN }, "student-linked");
    const studentGov = await createStudentFixture(
      tx,
      {
        locale: LOCALE_EN,
        suspended: true,
        suspendedAt: new Date(Date.now() - HOUR_MS),
        suspendedPeriodDays: 30,
      },
      "student-gov"
    );
    // Linked target pre-state: the ONLY parent_id writer is the guarded
    // repository method, applied directly as honest fixture control.
    await tx.update(students).set({ parentId: parentA.id }).where(eq(students.id, studentLinked.user.id));

    const parentGov = await createTestUser(tx, {
      role: "parent",
      fullName: `${RUN_PREFIX} Parent Gov`,
      email: `${RUN_PREFIX}.parent-gov@service.test`,
      locale: LOCALE_EN,
    });
    trackedUserIds.push(parentGov.id);

    // Valid-format probe code that matches no committed students row.
    const absentCode = deriveAbsentHandshakeCode(studentEn.student.handshakeCode);
    const probeHit = await StudentRepository.findLinkTargetByHandshakeCode(absentCode, tx);
    if (probeHit !== null) {
      throw new Error("derived absent probe code unexpectedly matches a students row");
    }

    return {
      parentA,
      parentB,
      studentEn,
      studentAr,
      studentNullLocale,
      studentLinked,
      studentGov,
      parentGov,
      absentCode,
      absentUserId: 0,
    };
  });

  // Definitely-absent user id — computed post-commit from the live id space.
  const [maxRow] = await db.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
  cast = { ...provisioned, absentUserId: (maxRow?.maxId ?? 0) + 1_000_000 };

  // PRE-ISSUED-TOKEN simulation: parentGov's session identity was issued while
  // the row was clean; governance flips AFTER issue, BEFORE the calls under test.
  const flipped = await db
    .update(users)
    .set({ suspended: true, suspendedAt: new Date(Date.now() - HOUR_MS), suspendedPeriodDays: 30 })
    .where(eq(users.id, provisioned.parentGov.id))
    .returning({ id: users.id });
  expect(flipped).toHaveLength(1);
});

afterAll(async () => {
  // Unconditional teardown from the module-scope registries — a failed
  // beforeAll must never leave committed rows behind. FK-safe order:
  // notifications → requests → students → users (RESTRICT references).
  await db.transaction(async (tx: DBTransaction) => {
    const allUserIds = [...trackedUserIds];
    if (allUserIds.length > 0) {
      await tx.delete(notifications).where(inArray(notifications.userId, allUserIds));
    }
    if (trackedRequestIds.length > 0) {
      await tx.delete(parentLinkRequests).where(inArray(parentLinkRequests.id, trackedRequestIds));
    }
    if (allUserIds.length > 0) {
      // Any request row created by the service for cast members but not yet
      // tracked (a crash between commit and tracking) still blocks user
      // deletion — sweep by parent/student membership as the belt-and-braces.
      await tx
        .delete(parentLinkRequests)
        .where(or(inArray(parentLinkRequests.parentId, allUserIds), inArray(parentLinkRequests.studentId, allUserIds)));
      await tx.delete(students).where(inArray(students.id, allUserIds));
      await tx.delete(users).where(inArray(users.id, allUserIds));
    }
  });

  // Mandatory zero-residue probes — nothing with this run's identity remains.
  const [userResidue, studentResidue, requestResidue, notificationResidue, prefixResidue] = await Promise.all([
    db.$count(users, sql`${users.email} LIKE ${RUN_PREFIX_SUFFIX_LIKE}`),
    db.$count(students, inArray(students.id, trackedStudentIds)),
    db.$count(parentLinkRequests, inArray(parentLinkRequests.id, trackedRequestIds)),
    db.$count(notifications, sql`${notifications.title} LIKE ${RUN_PREFIX_CONTAINS_LIKE}`),
    db.$count(users, sql`${users.fullName} LIKE ${RUN_PREFIX_SUFFIX_LIKE}`),
  ]);
  expect(userResidue).toBe(0);
  expect(studentResidue).toBe(0);
  expect(requestResidue).toBe(0);
  expect(notificationResidue).toBe(0);
  expect(prefixResidue).toBe(0);
});

// ─── ParentLinkRequestService.requestLink ───────────────────────────────

describe("ParentLinkRequestService.requestLink", () => {
  test("Tier 1 — own-commit creates ONE pending row, ONE inbox row, EXACTLY ONE publish, silent log", async () => {
    const c = requireCast();
    const transport = new RecordingFanoutTransport();
    // A dedicated committed student for THIS creation test — the shared cast
    // student stays pristine (code-only) for later zero-write probes.
    const createCast = await db.transaction(async (tx: DBTransaction) =>
      createStudentFixture(tx, { locale: LOCALE_EN }, "student-create")
    );
    const logSpy = silenceDomainLog();
    let created: Awaited<ReturnType<typeof ParentLinkRequestService.requestLink>> | null;
    try {
      created = await ParentLinkRequestService.requestLink(
        createCast.student.handshakeCode,
        c.parentA.id,
        LOCALE_EN,
        undefined,
        callOptions(transport)
      );
    } finally {
      logSpy.mockRestore();
    }
    if (created === null) {
      throw new Error("expected a creation payload for the live unlinked target");
    }
    trackedRequestIds.push(created.id);

    expectOutgoingShape(created);
    expect(created.status).toBe(LinkStatus.Pending);
    expect(created.respondedAt).toBeNull();
    const windowMs = created.expiresAt.getTime() - created.createdAt.getTime();
    expect(Math.abs(windowMs - PARENT_LINK_REQUEST_MS) < 1000).toBe(true);

    // The student appears ONLY through the deterministic mask.
    const masked = maskFullName(createCast.user.fullName);
    expect(created.studentMaskedName).toBe(masked);
    expect(created.studentMaskedName).not.toBe(createCast.user.fullName);

    // Exactly ONE persisted request row for the (A, en) pair.
    expect(await db.$count(parentLinkRequests, eq(parentLinkRequests.id, created.id))).toBe(1);

    // The recipient's inbox carries exactly ONE parent-link row bound to the request.
    const inbox = await linkInboxRowsFor(db, createCast.user.id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.relatedEntityType).toBe("parent_link_request");
    expect(inbox[0]?.relatedEntityId).toBe(created.id);

    // EXACTLY ONE post-commit publish, addressed to the student alone.
    expectSinglePublish(transport, createCast.user.id, created.id);

    // Log hygiene: the happy path emits NOTHING to the domain log.
    expect(logSpy).toHaveBeenCalledTimes(0);
  });

  test("Tier 1 — recipient locale at the EMITTER: persisted copy resolves per student, `defaultLocale` when unset", async () => {
    const c = requireCast();
    const transport = new RecordingFanoutTransport();
    const enCopy = getServerTranslations(LOCALE_EN).notificationsTranslations;
    const arCopy = getServerTranslations(LOCALE_AR).notificationsTranslations;

    // Explicit ar recipient.
    const forAr = await ParentLinkRequestService.requestLink(
      c.studentAr.student.handshakeCode,
      c.parentA.id,
      LOCALE_EN,
      undefined,
      callOptions(transport)
    );
    if (forAr === null) {
      throw new Error("expected a creation payload for the ar-locale target");
    }
    trackedRequestIds.push(forAr.id);
    expectSinglePublish(transport, c.studentAr.user.id, forAr.id);
    transport.clear();

    // Unset recipient locale → the `defaultLocale` fallback (never the caller's).
    const forNull = await ParentLinkRequestService.requestLink(
      c.studentNullLocale.student.handshakeCode,
      c.parentA.id,
      LOCALE_EN,
      undefined,
      callOptions(transport)
    );
    if (forNull === null) {
      throw new Error("expected a creation payload for the unset-locale target");
    }
    trackedRequestIds.push(forNull.id);
    expectSinglePublish(transport, c.studentNullLocale.user.id, forNull.id);
    transport.clear();

    const [arInbox, nullInbox] = await Promise.all([
      linkInboxRowsFor(db, c.studentAr.user.id),
      linkInboxRowsFor(db, c.studentNullLocale.user.id),
    ]);
    expect(arInbox).toHaveLength(1);
    expect(nullInbox).toHaveLength(1);
    expect(arInbox[0]?.title).toBe(arCopy.eventParentLinkRequestTitle);
    expect(arInbox[0]?.body).toBe(arCopy.eventParentLinkRequestBody(c.parentA.fullName));
    expect(nullInbox[0]?.title).toBe(
      getServerTranslations(defaultLocale).notificationsTranslations.eventParentLinkRequestTitle
    );
    expect(nullInbox[0]?.body).toBe(
      getServerTranslations(defaultLocale).notificationsTranslations.eventParentLinkRequestBody(c.parentA.fullName)
    );
    // The copy is the EMITTER-resolved locale — never the en caller locale.
    expect(nullInbox[0]?.title).not.toBe(enCopy.eventParentLinkRequestTitle);
  });

  test("Tier 1 — caller-tx NEVER publishes: the row + inbox land inside the caller's transaction", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      requireCast();
      const transport = new RecordingFanoutTransport();
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent Tx`,
        email: `${RUN_PREFIX}.parent-tx@service.test`,
      });
      const student = await createTestStudent(tx, user.id);
      const logSpy = silenceDomainLog();
      let created: Awaited<ReturnType<typeof ParentLinkRequestService.requestLink>> | null;
      try {
        created = await ParentLinkRequestService.requestLink(
          student.handshakeCode,
          user.id,
          LOCALE_EN,
          tx,
          callOptions(transport)
        );
      } finally {
        logSpy.mockRestore();
      }
      if (created === null) {
        throw new Error("expected a creation payload inside the caller's transaction");
      }

      expectOutgoingShape(created);
      expect(created.status).toBe(LinkStatus.Pending);

      // The inbox row IS written in-tx (single-writer rule), visible to the caller.
      const inbox = await linkInboxRowsFor(tx, student.id);
      expect(inbox).toHaveLength(1);
      expect(inbox[0]?.relatedEntityId).toBe(created.id);

      // THE publish discriminant: a caller-owned transaction NEVER publishes —
      // the caller owns the commit boundary.
      expect(transport.publishCount).toBe(0);
      expect(logSpy).toHaveBeenCalledTimes(0);
    });
  });

  test("Tier 1 — null-collapse: missing code ≡ governed child, byte-equal, zero side effects", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const c = requireCast();
      const transport = new RecordingFanoutTransport();
      const governedCode = c.studentGov.student.handshakeCode;
      const miss = await ParentLinkRequestService.requestLink(
        c.absentCode,
        c.parentA.id,
        LOCALE_EN,
        tx,
        callOptions(transport)
      );
      const governed = await ParentLinkRequestService.requestLink(
        governedCode,
        c.parentA.id,
        LOCALE_EN,
        tx,
        callOptions(transport)
      );
      expect(miss).toBeNull();
      expect(governed).toBeNull();
      // Byte-equality: both arms collapse to the identical no-oracle answer.
      expect(JSON.stringify(miss)).toBe(JSON.stringify(governed));

      // Zero rows, zero inbox rows, zero publishes on BOTH silent arms.
      expect(await pendingCountForStudent(tx, c.studentGov.user.id)).toBe(0);
      expect(await linkInboxRowsFor(tx, c.studentGov.user.id)).toHaveLength(0);
      expect(transport.publishCount).toBe(0);
    });
  });

  test("Tier 1 — already-linked target: conflict with ZERO inbox rows and ZERO publishes", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const c = requireCast();
      const transport = new RecordingFanoutTransport();
      const logSpy = silenceDomainLog();
      try {
        const error = await expectConflict(
          () =>
            ParentLinkRequestService.requestLink(
              c.studentLinked.student.handshakeCode,
              c.parentB.id,
              LOCALE_EN,
              tx,
              callOptions(transport)
            ),
          "PARENT_LINK_TARGET_ALREADY_LINKED",
          enErrors.parentLinkTargetAlreadyLinked
        );
        expect(error).toBeInstanceOf(ConflictError);

        // Exactly ONE bounded log for the denial.
        expect(logSpy).toHaveBeenCalledTimes(1);
        const ctx = logSpy.mock.calls[0]?.[1];
        expect(ctx).toMatchObject({
          code: "PARENT_LINK_TARGET_ALREADY_LINKED",
          entity: "students",
          locale: LOCALE_EN,
        });
      } finally {
        logSpy.mockRestore();
      }

      // Zero side effects: no request row, no inbox row, no publish.
      expect(await pendingCountForStudent(tx, c.studentLinked.user.id)).toBe(0);
      expect(await linkInboxRowsFor(tx, c.studentLinked.user.id)).toHaveLength(0);
      expect(transport.publishCount).toBe(0);
    });
  });

  test("Tier 1 — duplicate pending (pre-check): same conflict, inbox stays at ONE, zero publishes", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      requireCast();
      const transport = new RecordingFanoutTransport();
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent Dup`,
        email: `${RUN_PREFIX}.parent-dup@service.test`,
      });
      const student = await createTestStudent(tx, user.id);

      const first = await ParentLinkRequestService.requestLink(
        student.handshakeCode,
        user.id,
        LOCALE_EN,
        tx,
        callOptions(transport)
      );
      if (first === null) {
        throw new Error("expected the first request to be created");
      }
      transport.clear();

      await expectConflict(
        () =>
          ParentLinkRequestService.requestLink(student.handshakeCode, user.id, LOCALE_EN, tx, callOptions(transport)),
        "PARENT_LINK_ALREADY_PENDING",
        enErrors.parentLinkAlreadyPending
      );

      expect(await pendingCountForStudent(tx, student.id)).toBe(1);
      expect(await linkInboxRowsFor(tx, student.id)).toHaveLength(1);
      expect(transport.publishCount).toBe(0);
    });
  });

  test("Tier 1 — the partial-unique 23505 arbiter maps to the SAME PARENT_LINK_ALREADY_PENDING conflict", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      requireCast();
      const transport = new RecordingFanoutTransport();
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent Race`,
        email: `${RUN_PREFIX}.parent-race@service.test`,
      });
      const student = await createTestStudent(tx, user.id);

      // Force the pre-check to MISS while a live pending row exists in the
      // unit: the losing insert hits the REAL partial unique index and the
      // raw 23505 must traverse the cause chain (isUniqueViolation) into the
      // SAME domain conflict as the pre-check. The spy only forces the race
      // WINDOW — the violation itself is fully real.
      const precheckSpy = spyOn(ParentLinkRequestRepository, "findPendingByPair").mockImplementation(async () => null);
      const logSpy = silenceDomainLog();
      try {
        await ParentLinkRequestRepository.create(
          { parentId: user.id, studentId: student.id, expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS) },
          tx
        );
        const error = await expectRepoError(() =>
          ParentLinkRequestService.requestLink(student.handshakeCode, user.id, LOCALE_EN, tx, callOptions(transport))
        );
        const domain = requireDomainError(error);
        expect(domain).toBeInstanceOf(ConflictError);
        if (!(domain instanceof ConflictError)) {
          throw new Error("expected the 23505 arbiter to raise the pending conflict");
        }
        expect(domain.code).toBe("PARENT_LINK_ALREADY_PENDING");
        expect(domain.message).toBe(enErrors.parentLinkAlreadyPending);
        expect(logSpy).toHaveBeenCalledTimes(1);
        const ctx = logSpy.mock.calls[0]?.[1];
        expect(ctx).toMatchObject({
          code: "PARENT_LINK_ALREADY_PENDING",
          entity: "parent_link_requests",
          locale: LOCALE_EN,
        });
      } finally {
        precheckSpy.mockRestore();
        logSpy.mockRestore();
      }
      expect(transport.publishCount).toBe(0);
    });
  });
});

// ─── ParentLinkRequestService.respondToLinkRequest ──────────────────────

describe("ParentLinkRequestService.respondToLinkRequest", () => {
  test("Tier 1 — own-commit accept: winner link, accepted copy to the parent, sibling pendings EXPIRED", async () => {
    const c = requireCast();
    const transport = new RecordingFanoutTransport();
    // A dedicated committed student for the accept path — the shared cast
    // student stays pristine (code-only) for later zero-write probes.
    const acceptCast = await db.transaction(async (tx: DBTransaction) =>
      createStudentFixture(tx, { locale: LOCALE_EN }, "student-accept")
    );

    // Two contender parents request the same unlinked student (own-commit).
    const requestA = await ParentLinkRequestService.requestLink(
      acceptCast.student.handshakeCode,
      c.parentA.id,
      LOCALE_EN,
      undefined,
      callOptions(transport)
    );
    if (requestA === null) {
      throw new Error("expected Parent A's request to be created");
    }
    trackedRequestIds.push(requestA.id);
    const requestB = await ParentLinkRequestService.requestLink(
      acceptCast.student.handshakeCode,
      c.parentB.id,
      LOCALE_EN,
      undefined,
      callOptions(transport)
    );
    if (requestB === null) {
      throw new Error("expected Parent B's contention request to be created");
    }
    trackedRequestIds.push(requestB.id);
    expect(await pendingCountForStudent(db, acceptCast.user.id)).toBe(2);
    transport.clear();

    const confirmed = await ParentLinkRequestService.respondToLinkRequest(
      requestA.id,
      true,
      acceptCast.user.id,
      LOCALE_EN,
      undefined,
      callOptions(transport)
    );

    // Closed incoming shape; confirmed; stamped; Parent A's FULL name.
    expectIncomingShape(confirmed);
    expect(confirmed.id).toBe(requestA.id);
    expect(confirmed.status).toBe(LinkStatus.Confirmed);
    expect(confirmed.respondedAt).not.toBeNull();
    expect(confirmed.parentFullName).toBe(c.parentA.fullName);

    // The winner write: the student's link field is Parent A's id.
    expect(await studentParentId(db, acceptCast.user.id)).toBe(c.parentA.id);

    // The parent's notification: accepted copy bound to the request row.
    const parentAInbox = await linkInboxRowsFor(db, c.parentA.id);
    expect(parentAInbox).toHaveLength(1);
    expect(parentAInbox[0]?.relatedEntityType).toBe("parent_link_request");
    expect(parentAInbox[0]?.relatedEntityId).toBe(requestA.id);
    const arCopy = getServerTranslations(LOCALE_AR).notificationsTranslations;
    const enCopy = getServerTranslations(LOCALE_EN).notificationsTranslations;
    expect(parentAInbox[0]?.title).toBe(enCopy.eventParentLinkAcceptedTitle);
    expect(parentAInbox[0]?.body).toBe(enCopy.eventParentLinkAcceptedBody(acceptCast.user.fullName));
    // The deciding student's inbox gained NOTHING from the respond.
    expect(await linkInboxRowsFor(db, acceptCast.user.id)).toHaveLength(2);

    // EXACTLY ONE publish, to the winner parent alone.
    expectSinglePublish(transport, c.parentA.id, requestA.id);

    // Sibling pendings of the winner's student are terminal, seen
    // by BOTH parents from their own lists.
    expect(await requestRowById(db, requestB.id)).toMatchObject({ status: LinkStatus.Expired });
    const bOutgoing = await ParentLinkRequestService.listMyOutgoing(c.parentB.id, LOCALE_EN);
    expect(bOutgoing.find(row => row.id === requestB.id)?.status).toBe(LinkStatus.Expired);
    const aOutgoing = await ParentLinkRequestService.listMyOutgoing(c.parentA.id, LOCALE_EN);
    expect(aOutgoing.find(row => row.id === requestA.id)?.status).toBe(LinkStatus.Confirmed);
    expect(await pendingCountForStudent(db, acceptCast.user.id)).toBe(0);
    // The ar locale copy constants stay referenced for the parity oracle below.
    expect(arCopy.eventParentLinkAcceptedTitle).not.toBe(enCopy.eventParentLinkAcceptedTitle);
  });

  test("Tier 1 — own-commit reject: rejected copy, NO students write, sibling pendings stay live", async () => {
    await runInRollback(async () => {
      // Committed-cast exclusive (own-commit), executed inside a rollback tx
      // only for the pre-state reads; the calls below run own-commit.
    });
    const c = requireCast();
    const transport = new RecordingFanoutTransport();

    // A dedicated committed student for the reject path.
    const rejectCast = await db.transaction(async (tx: DBTransaction) => {
      const created = await createStudentFixture(tx, { locale: LOCALE_EN }, "student-reject");
      return created;
    });
    const requestA = await ParentLinkRequestService.requestLink(
      rejectCast.student.handshakeCode,
      c.parentA.id,
      LOCALE_EN,
      undefined,
      callOptions(transport)
    );
    if (requestA === null) {
      throw new Error("expected Parent A's request to be created");
    }
    trackedRequestIds.push(requestA.id);
    const requestB = await ParentLinkRequestService.requestLink(
      rejectCast.student.handshakeCode,
      c.parentB.id,
      LOCALE_EN,
      undefined,
      callOptions(transport)
    );
    if (requestB === null) {
      throw new Error("expected Parent B's sibling request to be created");
    }
    trackedRequestIds.push(requestB.id);
    transport.clear();
    // parentA's committed inbox grows across suites — pin the DELTA, not an
    // absolute count (the accepted copy from the accept suite is present).
    const parentAInboxBefore = (await linkInboxRowsFor(db, c.parentA.id)).length;

    const rejected = await ParentLinkRequestService.respondToLinkRequest(
      requestA.id,
      false,
      rejectCast.user.id,
      LOCALE_EN,
      undefined,
      callOptions(transport)
    );

    expectIncomingShape(rejected);
    expect(rejected.status).toBe(LinkStatus.Rejected);
    expect(rejected.respondedAt).not.toBeNull();

    // Rejection never links ("children choose parents"): the link field stays
    // NULL and the sibling pending stays LIVE.
    expect(await studentParentId(db, rejectCast.user.id)).toBeNull();
    expect(await pendingCountForStudent(db, rejectCast.user.id)).toBe(1);
    const sibling = await requestRowById(db, requestB.id);
    expect(sibling).toMatchObject({ status: LinkStatus.Pending });

    // ONE rejected notification to the parent; ONE publish to the parent.
    const parentAInbox = await linkInboxRowsFor(db, c.parentA.id);
    expect(parentAInbox).toHaveLength(parentAInboxBefore + 1);
    const rejectedRow = parentAInbox.find(row => row.relatedEntityId === requestA.id);
    const enCopy = getServerTranslations(LOCALE_EN).notificationsTranslations;
    expect(rejectedRow?.title).toBe(enCopy.eventParentLinkRejectedTitle);
    expect(rejectedRow?.body).toBe(enCopy.eventParentLinkRejectedBody(rejectCast.user.fullName));
    expectSinglePublish(transport, c.parentA.id, requestA.id);
  });

  test("Tier 1 — caller-tx accept NEVER publishes: claim + link + notify + sibling expiry all in-tx", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      requireCast();
      const transport = new RecordingFanoutTransport();
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent Resp`,
        email: `${RUN_PREFIX}.parent-resp@service.test`,
      });
      const rival = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent Rival`,
        email: `${RUN_PREFIX}.parent-rival@service.test`,
      });
      // The deciding student must be a STUDENT-role user (the REAL actor
      // re-check denies a parent id on the student-only op).
      const studentUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Student Resp`,
        email: `${RUN_PREFIX}.student-resp@service.test`,
      });
      const student = await createTestStudent(tx, studentUser.id);
      const request = await ParentLinkRequestRepository.create(
        { parentId: user.id, studentId: student.id, expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS) },
        tx
      );
      const sibling = await ParentLinkRequestRepository.create(
        { parentId: rival.id, studentId: student.id, expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS) },
        tx
      );

      const confirmed = await ParentLinkRequestService.respondToLinkRequest(
        request.id,
        true,
        student.id,
        LOCALE_EN,
        tx,
        callOptions(transport)
      );
      expect(confirmed.status).toBe(LinkStatus.Confirmed);
      expect(confirmed.parentFullName).toBe(user.fullName);

      // Link + sibling expiry + notification are all visible INSIDE the tx…
      expect(await studentParentId(tx, student.id)).toBe(user.id);
      expect(await requestRowById(tx, sibling.id)).toMatchObject({ status: LinkStatus.Expired });
      expect(await linkInboxRowsFor(tx, user.id)).toHaveLength(1);

      // …and the caller-owned transaction NEVER publishes.
      expect(transport.publishCount).toBe(0);
    });
  });

  test("Tier 1 — constant NOT_FOUND from BOTH directions: foreign ≡ nonexistent, byte-equal", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const c = requireCast();
      const transport = new RecordingFanoutTransport();
      const NONEXISTENT_ID = 999_999_999;
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent Oracle`,
        email: `${RUN_PREFIX}.parent-oracle@service.test`,
      });
      // Student-role actor for the student-direction probes (the re-check is
      // real — a parent id would deny FORBIDDEN before the classifier runs).
      const studentUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Student Oracle`,
        email: `${RUN_PREFIX}.student-oracle@service.test`,
      });
      const student = await createTestStudent(tx, studentUser.id);
      const request = await ParentLinkRequestRepository.create(
        { parentId: user.id, studentId: student.id, expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS) },
        tx
      );

      // Student direction: another student's request id, and a nonexistent id.
      const foreignStudent = await expectNotFoundShape(() =>
        ParentLinkRequestService.respondToLinkRequest(
          request.id,
          true,
          c.studentEn.user.id,
          LOCALE_EN,
          tx,
          callOptions(transport)
        )
      );
      const missingStudent = await expectNotFoundShape(() =>
        ParentLinkRequestService.respondToLinkRequest(
          NONEXISTENT_ID,
          true,
          student.id,
          LOCALE_EN,
          tx,
          callOptions(transport)
        )
      );

      // Parent direction: another parent's request id, and a nonexistent id.
      const foreignParent = await expectNotFoundShape(() =>
        ParentLinkRequestService.cancelLinkRequest(request.id, c.parentB.id, LOCALE_EN, tx)
      );
      const missingParent = await expectNotFoundShape(() =>
        ParentLinkRequestService.cancelLinkRequest(NONEXISTENT_ID, user.id, LOCALE_EN, tx)
      );

      // ALL four denials are the SAME constant shape — byte-equal surface.
      const fingerprints = [foreignStudent, missingStudent, foreignParent, missingParent];
      for (const fingerprint of fingerprints) {
        expect(fingerprint).toBe(foreignStudent);
      }

      // Zero writes: the request row is untouched and still pending.
      expect(await requestRowById(tx, request.id)).toMatchObject({ status: LinkStatus.Pending });
      expect(transport.publishCount).toBe(0);
    });
  });

  test("Tier 1 — ALREADY_RESOLVED: re-respond and cancel-of-folded answer the constant conflict", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      requireCast();
      const transport = new RecordingFanoutTransport();
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent Resolved`,
        email: `${RUN_PREFIX}.parent-resolved@service.test`,
      });
      const studentUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Student Resolved`,
        email: `${RUN_PREFIX}.student-resolved@service.test`,
      });
      const student = await createTestStudent(tx, studentUser.id);
      const request = await ParentLinkRequestRepository.create(
        { parentId: user.id, studentId: student.id, expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS) },
        tx
      );
      await ParentLinkRequestRepository.respondToPendingForStudent(
        request.id,
        student.id,
        LinkStatus.Rejected,
        new Date(),
        tx
      );

      await expectConflict(
        () =>
          ParentLinkRequestService.respondToLinkRequest(
            request.id,
            true,
            student.id,
            LOCALE_EN,
            tx,
            callOptions(transport)
          ),
        "PARENT_LINK_REQUEST_ALREADY_RESOLVED",
        enErrors.parentLinkRequestAlreadyResolved
      );
      await expectConflict(
        () => ParentLinkRequestService.cancelLinkRequest(request.id, user.id, LOCALE_EN, tx),
        "PARENT_LINK_REQUEST_ALREADY_RESOLVED",
        enErrors.parentLinkRequestAlreadyResolved
      );
      expect(transport.publishCount).toBe(0);
    });
  });
});

// ─── ParentLinkRequestService.cancelLinkRequest ─────────────────────────

describe("ParentLinkRequestService.cancelLinkRequest", () => {
  test("Tier 1 — own-commit withdrawal folds to rejected and is SILENT", async () => {
    const c = requireCast();
    const transport = new RecordingFanoutTransport();

    // A dedicated committed student for the withdrawal path.
    const cancelCast = await db.transaction(async (tx: DBTransaction) =>
      createStudentFixture(tx, { locale: LOCALE_EN }, "student-cancel")
    );
    const request = await ParentLinkRequestService.requestLink(
      cancelCast.student.handshakeCode,
      c.parentA.id,
      LOCALE_EN,
      undefined,
      callOptions(transport)
    );
    if (request === null) {
      throw new Error("expected the request to be created");
    }
    trackedRequestIds.push(request.id);
    const inboxBefore = await linkInboxRowsFor(db, cancelCast.user.id);
    expect(inboxBefore).toHaveLength(1);
    transport.clear();

    const withdrawn = await ParentLinkRequestService.cancelLinkRequest(request.id, c.parentA.id, LOCALE_EN);

    expectOutgoingShape(withdrawn);
    expect(withdrawn.id).toBe(request.id);
    expect(withdrawn.status).toBe(LinkStatus.Rejected);
    expect(withdrawn.respondedAt).not.toBeNull();

    // SILENT: no inbox growth for the student, no publish to anyone.
    expect(await linkInboxRowsFor(db, cancelCast.user.id)).toHaveLength(inboxBefore.length);
    expect(transport.publishCount).toBe(0);

    // The folded row persists forever as request history.
    expect(await requestRowById(db, request.id)).toMatchObject({ status: LinkStatus.Rejected });
    const outgoing = await ParentLinkRequestService.listMyOutgoing(c.parentA.id, LOCALE_EN);
    expect(outgoing.find(row => row.id === request.id)?.status).toBe(LinkStatus.Rejected);
  });

  test("Tier 1 — caller-tx withdrawal is silent and folds inside the caller's transaction", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      requireCast();
      const transport = new RecordingFanoutTransport();
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent Cancel`,
        email: `${RUN_PREFIX}.parent-cancel@service.test`,
      });
      const student = await createTestStudent(tx, user.id);
      const request = await ParentLinkRequestRepository.create(
        { parentId: user.id, studentId: student.id, expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS) },
        tx
      );

      const withdrawn = await ParentLinkRequestService.cancelLinkRequest(request.id, user.id, LOCALE_EN, tx);
      expect(withdrawn.status).toBe(LinkStatus.Rejected);
      expect(await requestRowById(tx, request.id)).toMatchObject({ status: LinkStatus.Rejected });
      expect(await linkInboxRowsFor(tx, student.id)).toHaveLength(0);
      expect(transport.publishCount).toBe(0);
    });
  });
});

// ─── D1 sweep primitive — system-scope, silent, idempotent ──────────────

describe("ParentLinkRequestService.sweepExpiredRequests", () => {
  test("Tier 1 — own-commit sweep materializes ONLY lapsed pendings and is SILENT (no inbox, no publish, no audit)", async () => {
    const transport = new RecordingFanoutTransport();

    // Delta probe BEFORE fixtures (the sweep is TABLE-WIDE — pre-existing
    // lapsed residue committed by earlier runs is swept too; the probe must
    // not see our own rows, which commit below).
    const residue = await db
      .select({ id: parentLinkRequests.id })
      .from(parentLinkRequests)
      .where(and(eq(parentLinkRequests.status, LinkStatus.Pending), lte(parentLinkRequests.expiresAt, new Date())));
    const auditBefore = await db.select({ id: auditLogs.id }).from(auditLogs);

    // Committed fixtures (own-commit sweep runs on its OWN connection — a
    // rollback-tx fixture would be invisible to it).
    const sweepCast = await db.transaction(async (tx: DBTransaction) => {
      const parentUser = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Sweep Parent`,
        email: `${RUN_PREFIX}.sweep-parent@service.test`,
      });
      trackedUserIds.push(parentUser.id);
      const studentA = await createStudentFixture(tx, {}, "sweep-student-a");
      const studentB = await createStudentFixture(tx, {}, "sweep-student-b");
      const lapsed = await ParentLinkRequestRepository.create(
        { parentId: parentUser.id, studentId: studentA.student.id, expiresAt: new Date(Date.now() - HOUR_MS) },
        tx
      );
      const live = await ParentLinkRequestRepository.create(
        {
          parentId: parentUser.id,
          studentId: studentB.student.id,
          expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS),
        },
        tx
      );
      trackedRequestIds.push(lapsed.id, live.id);
      return {
        parentUserId: parentUser.id,
        studentAUserId: studentA.user.id,
        studentBUserId: studentB.user.id,
        lapsedId: lapsed.id,
        liveId: live.id,
      };
    });

    const swept = await ParentLinkRequestService.sweepExpiredRequests();

    expect(swept).toBe(residue.length + 1); // the residue + exactly our one lapsed fixture
    expect(await requestRowById(db, sweepCast.lapsedId)).toMatchObject({ status: LinkStatus.Expired });
    // The swept row keeps respondedAt NULL (expiry is not a participant response).
    expect((await requestRowById(db, sweepCast.lapsedId))?.respondedAt).toBeNull();
    // The live pending row is untouched.
    expect(await requestRowById(db, sweepCast.liveId)).toMatchObject({ status: LinkStatus.Pending });

    // SILENCE: no publish, no inbox growth for anyone.
    expect(transport.publishCount).toBe(0);
    expect(await linkInboxRowsFor(db, sweepCast.studentAUserId)).toHaveLength(0);
    expect(await linkInboxRowsFor(db, sweepCast.studentBUserId)).toHaveLength(0);
    expect(await linkInboxRowsFor(db, sweepCast.parentUserId)).toHaveLength(0);
    // ZERO audit rows (the sweep writes none; the probe is pollution-tolerant).
    const auditAfter = await db.select({ id: auditLogs.id }).from(auditLogs);
    expect(auditAfter).toHaveLength(auditBefore.length);

    // Idempotent: an immediate re-run matches zero rows.
    expect(await ParentLinkRequestService.sweepExpiredRequests()).toBe(0);
  });

  test("Tier 1 — the sweep lifts the silent-expiry re-request lockout: findPendingByPair collapses to null", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const parentUser = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Unlock Parent`,
        email: `${RUN_PREFIX}.unlock-parent@service.test`,
      });
      const studentUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Unlock Student`,
        email: `${RUN_PREFIX}.unlock-student@service.test`,
      });
      const studentRow = await createTestStudent(tx, studentUser.id);
      await ParentLinkRequestRepository.create(
        { parentId: parentUser.id, studentId: studentRow.id, expiresAt: new Date(Date.now() - HOUR_MS) },
        tx
      );

      // Pre-sweep: the lapsed-but-unmaterialized pending STILL answers the
      // pair pre-check (the D9b lockout contract, pinned at chaos tier).
      expect(await ParentLinkRequestRepository.findPendingByPair(parentUser.id, studentRow.id, tx)).not.toBeNull();

      await ParentLinkRequestService.sweepExpiredRequests(tx);

      // Post-sweep: the pair's pending answer collapses — a fresh requestLink
      // would now succeed (the canonical doc §5 unlock promise).
      expect(await ParentLinkRequestRepository.findPendingByPair(parentUser.id, studentRow.id, tx)).toBeNull();
    });
  });

  test("Tier 2 — frozen clock: a row expiring EXACTLY at the sweep instant IS materialized (strict-`>` expiry side)", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const parentUser = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Boundary Parent`,
        email: `${RUN_PREFIX}.boundary-parent@service.test`,
      });
      const studentUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Boundary Student`,
        email: `${RUN_PREFIX}.boundary-student@service.test`,
      });
      const studentRow = await createTestStudent(tx, studentUser.id);
      // Delta probe BEFORE the fixture (must not count our own row).
      const boundary = new Date(Date.now() + 10_000);
      const residue = await tx
        .select({ id: parentLinkRequests.id })
        .from(parentLinkRequests)
        .where(and(eq(parentLinkRequests.status, LinkStatus.Pending), lte(parentLinkRequests.expiresAt, boundary)));
      const request = await ParentLinkRequestRepository.create(
        { parentId: parentUser.id, studentId: studentRow.id, expiresAt: boundary },
        tx
      );

      setSystemTime(boundary.getTime());
      try {
        const swept = await ParentLinkRequestService.sweepExpiredRequests(tx);
        expect(swept).toBe(residue.length + 1);
        expect(await requestRowById(tx, request.id)).toMatchObject({ status: LinkStatus.Expired });
      } finally {
        setSystemTime(); // restore the real clock for the remaining tiers
      }
    });
  });
});

describe("ParentLinkRequestService.sendExpiryReminders", () => {
  test("Tier 1 — own-commit reminder: ONE masked-name locale-respecting inbox row per in-window pending, marker set, re-run deduped, publish-free, student silent", async () => {
    const transport = new RecordingFanoutTransport();

    // Delta probe BEFORE fixtures (the claim is window-wide — committed
    // unmarked in-window pendings from earlier/parallel runs get reminders
    // too; the probe must not count our own rows, which commit below).
    const windowStart = new Date();
    const windowEnd = new Date(windowStart.getTime() + 24 * HOUR_MS);
    const residue = await db
      .select({ id: parentLinkRequests.id })
      .from(parentLinkRequests)
      .where(
        and(
          eq(parentLinkRequests.status, LinkStatus.Pending),
          gt(parentLinkRequests.expiresAt, windowStart),
          lte(parentLinkRequests.expiresAt, windowEnd),
          isNull(parentLinkRequests.reminderSentAt)
        )
      );
    const auditBefore = await db.select({ id: auditLogs.id }).from(auditLogs);

    // Committed fixtures (own-commit run sees only committed rows). The
    // parent's PERSISTED locale is EN — proving the copy reads the persisted
    // preference (the fallback is `ar`, so an EN body cannot be the fallback).
    const reminderCast = await db.transaction(async (tx: DBTransaction) => {
      const parentUser = await createTestUser(tx, {
        role: "parent",
        locale: LOCALE_EN,
        fullName: `${RUN_PREFIX} Reminder Parent`,
        email: `${RUN_PREFIX}.reminder-parent@service.test`,
      });
      trackedUserIds.push(parentUser.id);
      const studentA = await createStudentFixture(tx, {}, "reminder-student-a");
      const studentB = await createStudentFixture(tx, {}, "reminder-student-b");
      const inWindow = await ParentLinkRequestRepository.create(
        { parentId: parentUser.id, studentId: studentA.student.id, expiresAt: new Date(Date.now() + HOUR_MS) },
        tx
      );
      const beyond = await ParentLinkRequestRepository.create(
        { parentId: parentUser.id, studentId: studentB.student.id, expiresAt: new Date(Date.now() + 48 * HOUR_MS) },
        tx
      );
      trackedRequestIds.push(inWindow.id, beyond.id);
      return {
        parentUserId: parentUser.id,
        studentAName: studentA.user.fullName,
        studentAUserId: studentA.user.id,
        studentBUserId: studentB.user.id,
        inWindowId: inWindow.id,
        beyondId: beyond.id,
      };
    });

    const enCopy = getServerTranslations(LOCALE_EN).notificationsTranslations;
    const reminded = await ParentLinkRequestService.sendExpiryReminders({ options: { transport } });

    // Exactly our one in-window fixture PLUS any committed in-window residue.
    expect(reminded).toBe(residue.length + 1);

    // The reminder: parent-bound, request-linked, MASKED name, EN copy.
    const inbox = await linkInboxRowsFor(db, reminderCast.parentUserId);
    const reminderRows = inbox.filter(row => row.relatedEntityId === reminderCast.inWindowId);
    expect(reminderRows).toHaveLength(1);
    const reminder = reminderRows[0];
    expect(reminder?.title).toBe(enCopy.eventParentLinkExpiringTitle);
    expect(reminder?.body).toBe(
      enCopy.eventParentLinkExpiringBody(isolateBidi(maskFullName(reminderCast.studentAName)))
    );
    expect(reminder?.relatedEntityType).toBe(PARENT_LINK_RELATED_ENTITY_TYPE);

    // The out-of-window pending got NO reminder.
    expect(inbox.filter(row => row.relatedEntityId === reminderCast.beyondId)).toHaveLength(0);
    // The student side is SILENT — the reminder chases the requester only.
    expect(await linkInboxRowsFor(db, reminderCast.studentAUserId)).toHaveLength(0);
    expect(await linkInboxRowsFor(db, reminderCast.studentBUserId)).toHaveLength(0);

    // The claim marker is materialized on the reminded row, absent on the
    // out-of-window row (the claim is NOT a lifecycle write).
    expect((await requestRowById(db, reminderCast.inWindowId))?.reminderSentAt).not.toBeNull();
    expect((await requestRowById(db, reminderCast.beyondId))?.reminderSentAt).toBeNull();

    // In-tx emit discipline: the receipt is never published on this path.
    expect(transport.publishCount).toBe(0);
    // ZERO audit rows (the probe is pollution-tolerant).
    const auditAfter = await db.select({ id: auditLogs.id }).from(auditLogs);
    expect(auditAfter).toHaveLength(auditBefore.length);

    // Idempotent by claim: an immediate re-run reminds nobody.
    expect(await ParentLinkRequestService.sendExpiryReminders()).toBe(0);
  });

  test("Tier 2 — frozen clock: a row expiring EXACTLY at the horizon IS reminded (inclusive edge); EXACTLY at now is NOT (strict-`>` liveness)", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const transport = new RecordingFanoutTransport();
      const parentUser = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Reminder Boundary Parent`,
        email: `${RUN_PREFIX}.reminder-boundary-parent@service.test`,
      });
      const studentAUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Reminder Boundary A`,
        email: `${RUN_PREFIX}.reminder-boundary-a@service.test`,
      });
      const studentBUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Reminder Boundary B`,
        email: `${RUN_PREFIX}.reminder-boundary-b@service.test`,
      });
      const studentA = await createTestStudent(tx, studentAUser.id);
      const studentB = await createTestStudent(tx, studentBUser.id);
      const frozenNow = new Date(Date.now() + 60_000);
      const frozenHorizon = new Date(frozenNow.getTime() + 24 * HOUR_MS);

      setSystemTime(frozenNow.getTime());
      try {
        // Delta probe under the FROZEN clock (must not count our own rows).
        const residue = await tx
          .select({ id: parentLinkRequests.id })
          .from(parentLinkRequests)
          .where(
            and(
              eq(parentLinkRequests.status, LinkStatus.Pending),
              gt(parentLinkRequests.expiresAt, frozenNow),
              lte(parentLinkRequests.expiresAt, frozenHorizon),
              isNull(parentLinkRequests.reminderSentAt)
            )
          );
        const atHorizon = await ParentLinkRequestRepository.create(
          { parentId: parentUser.id, studentId: studentA.id, expiresAt: frozenHorizon }, // == horizon → claimed
          tx
        );
        const atNow = await ParentLinkRequestRepository.create(
          { parentId: parentUser.id, studentId: studentB.id, expiresAt: frozenNow }, // == now → lapsed side
          tx
        );

        const reminded = await ParentLinkRequestService.sendExpiryReminders({
          outerTx: tx,
          options: { transport },
        });
        expect(reminded).toBe(residue.length + 1);

        // The inclusive horizon edge: the at-horizon row was reminded with
        // the DEFAULT-locale copy (parent locale NULL → `ar` fallback).
        const arCopy = getServerTranslations(defaultLocale).notificationsTranslations;
        const inbox = await linkInboxRowsFor(tx, parentUser.id);
        const reminderRows = inbox.filter(row => row.relatedEntityId === atHorizon.id);
        expect(reminderRows).toHaveLength(1);
        expect(reminderRows[0]?.body).toBe(
          arCopy.eventParentLinkExpiringBody(isolateBidi(maskFullName(studentAUser.fullName)))
        );
        // The at-now row is the SWEEP's business — never a reminder.
        expect(inbox.filter(row => row.relatedEntityId === atNow.id)).toHaveLength(0);
        expect((await requestRowById(tx, atHorizon.id))?.reminderSentAt).not.toBeNull();
        expect((await requestRowById(tx, atNow.id))?.reminderSentAt).toBeNull();
        expect((await requestRowById(tx, atNow.id))?.status).toBe(LinkStatus.Pending);
      } finally {
        setSystemTime(); // restore the real clock for the remaining tiers
      }
    });
  });

  test("Tier 3 — hostile horizon values reject with ValidationError BEFORE any claim (repo spy: zero calls)", async () => {
    const repoSpy = spyOn(ParentLinkRequestReminderRepository, "claimPendingForExpiryReminder");
    try {
      // All five hostile horizons reject pre-DB (schema guard — zero DB
      // state), so the batch runs in parallel; each error is asserted below.
      const errors = await Promise.all(
        [0, -1, 0.5, 169, Number.NaN].map(bad =>
          expectRepoError(() => ParentLinkRequestService.sendExpiryReminders({ horizonHours: bad }))
        )
      );
      expect(errors).toHaveLength(5);
      for (const error of errors) {
        expect(error).toBeInstanceOf(ValidationError);
      }
      expect(repoSpy.mock.calls).toHaveLength(0);
    } finally {
      repoSpy.mockRestore();
    }
  });
});

// ─── Tier 2 — strict liveness + render boundaries (frozen clock) ────────

describe("ParentLinkRequestService boundary tier (frozen clock)", () => {
  test("Tier 2 — claim at expiresAt = now+1ms succeeds: strict `>` holds, one-captured-now stamp", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      requireCast();
      const transport = new RecordingFanoutTransport();
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent T2a`,
        email: `${RUN_PREFIX}.parent-t2a@service.test`,
      });
      const studentUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Student T2a`,
        email: `${RUN_PREFIX}.student-t2a@service.test`,
      });
      const student = await createTestStudent(tx, studentUser.id);
      const T0 = Date.now();
      setSystemTime(T0);
      try {
        const request = await ParentLinkRequestRepository.create(
          { parentId: user.id, studentId: student.id, expiresAt: new Date(T0 + 1) },
          tx
        );
        const confirmed = await ParentLinkRequestService.respondToLinkRequest(
          request.id,
          true,
          student.id,
          LOCALE_EN,
          tx,
          callOptions(transport)
        );
        expect(confirmed.status).toBe(LinkStatus.Confirmed);
        // ONE captured instant: the claim stamp is EXACTLY the frozen now.
        expect(confirmed.respondedAt?.getTime()).toBe(T0);
        expect(await studentParentId(tx, student.id)).toBe(user.id);
      } finally {
        setSystemTime();
      }
    });
  });

  test("Tier 2 — claim at expiresAt EXACTLY now and now−1ms fails: expiry MATERIALIZED, denial survives", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      requireCast();
      const transport = new RecordingFanoutTransport();
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent T2b`,
        email: `${RUN_PREFIX}.parent-t2b@service.test`,
      });
      const studentUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Student T2b`,
        email: `${RUN_PREFIX}.student-t2b@service.test`,
      });
      const student = await createTestStudent(tx, studentUser.id);
      const T0 = Date.now();
      setSystemTime(T0);
      try {
        const atNow = await ParentLinkRequestRepository.create(
          { parentId: user.id, studentId: student.id, expiresAt: new Date(T0) },
          tx
        );
        await expectConflict(
          () =>
            ParentLinkRequestService.respondToLinkRequest(
              atNow.id,
              true,
              student.id,
              LOCALE_EN,
              tx,
              callOptions(transport)
            ),
          "PARENT_LINK_REQUEST_EXPIRED",
          enErrors.parentLinkRequestExpired
        );
        // The row persists as `expired` INSIDE the caller's unit,
        // with respondedAt intentionally left NULL (expiry is not a response).
        expect(await requestRowById(tx, atNow.id)).toMatchObject({ status: LinkStatus.Expired });

        const oneMsBefore = await ParentLinkRequestRepository.create(
          { parentId: user.id, studentId: student.id, expiresAt: new Date(T0 - 1) },
          tx
        );
        await expectConflict(
          () =>
            ParentLinkRequestService.respondToLinkRequest(
              oneMsBefore.id,
              true,
              student.id,
              LOCALE_EN,
              tx,
              callOptions(transport)
            ),
          "PARENT_LINK_REQUEST_EXPIRED",
          enErrors.parentLinkRequestExpired
        );
        expect(await requestRowById(tx, oneMsBefore.id)).toMatchObject({ status: LinkStatus.Expired });

        // The whole path was silent: zero link, zero notifications, zero publishes.
        expect(await studentParentId(tx, student.id)).toBeNull();
        expect(await linkInboxRowsFor(tx, user.id)).toHaveLength(0);
        expect(transport.publishCount).toBe(0);
      } finally {
        setSystemTime();
      }
    });
  });

  test("Tier 2 — cancel liveness boundary mirrors the claim boundary", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      requireCast();
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent T2c`,
        email: `${RUN_PREFIX}.parent-t2c@service.test`,
      });
      const student = await createTestStudent(tx, user.id);
      const T0 = Date.now();
      setSystemTime(T0);
      try {
        const live = await ParentLinkRequestRepository.create(
          { parentId: user.id, studentId: student.id, expiresAt: new Date(T0 + 1) },
          tx
        );
        const withdrawn = await ParentLinkRequestService.cancelLinkRequest(live.id, user.id, LOCALE_EN, tx);
        expect(withdrawn.status).toBe(LinkStatus.Rejected);
        // ONE captured instant: the fold stamp is EXACTLY the frozen now.
        expect(withdrawn.respondedAt?.getTime()).toBe(T0);

        const stale = await ParentLinkRequestRepository.create(
          { parentId: user.id, studentId: student.id, expiresAt: new Date(T0) },
          tx
        );
        await expectConflict(
          () => ParentLinkRequestService.cancelLinkRequest(stale.id, user.id, LOCALE_EN, tx),
          "PARENT_LINK_REQUEST_EXPIRED",
          enErrors.parentLinkRequestExpired
        );
        expect(await requestRowById(tx, stale.id)).toMatchObject({ status: LinkStatus.Expired });
      } finally {
        setSystemTime();
      }
    });
    // The cast reference keeps the governed fixture visible for parity probes.
    expect(requireCast().studentGov.student.id).toBeGreaterThan(0);
  });

  test("Tier 2 — lists render Expired at `expiresAt <= now` WITHOUT writing; +1ms stays Pending", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent T2d`,
        email: `${RUN_PREFIX}.parent-t2d@service.test`,
      });
      // TWO students under the SAME parent: the partial unique index (D4)
      // forbids two LIVE pendings for one (parent, student) pair, so the
      // boundary pair is expressed as one request per student.
      const studentAUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Student T2d A`,
        email: `${RUN_PREFIX}.student-t2d-a@service.test`,
      });
      const studentBUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Student T2d B`,
        email: `${RUN_PREFIX}.student-t2d-b@service.test`,
      });
      const studentA = await createTestStudent(tx, studentAUser.id);
      const studentB = await createTestStudent(tx, studentBUser.id);
      const T0 = Date.now();
      setSystemTime(T0);
      try {
        const exactlyNow = await ParentLinkRequestRepository.create(
          { parentId: user.id, studentId: studentA.id, expiresAt: new Date(T0) },
          tx
        );
        const oneMsAfter = await ParentLinkRequestRepository.create(
          { parentId: user.id, studentId: studentB.id, expiresAt: new Date(T0 + 1) },
          tx
        );

        const outgoing = await ParentLinkRequestService.listMyOutgoing(user.id, LOCALE_EN, tx);
        expect(outgoing.find(row => row.id === exactlyNow.id)?.status).toBe(LinkStatus.Expired);
        expect(outgoing.find(row => row.id === oneMsAfter.id)?.status).toBe(LinkStatus.Pending);

        const incomingA = await ParentLinkRequestService.listMyIncoming(studentA.id, LOCALE_EN, tx);
        expect(incomingA.find(row => row.id === exactlyNow.id)?.status).toBe(LinkStatus.Expired);
        const incomingB = await ParentLinkRequestService.listMyIncoming(studentB.id, LOCALE_EN, tx);
        expect(incomingB.find(row => row.id === oneMsAfter.id)?.status).toBe(LinkStatus.Pending);

        // READ PURITY: the render-time mapping wrote NOTHING —
        // both rows are still stored `pending`.
        expect(await requestRowById(tx, exactlyNow.id)).toMatchObject({ status: LinkStatus.Pending });
        expect(await requestRowById(tx, oneMsAfter.id)).toMatchObject({ status: LinkStatus.Pending });
      } finally {
        setSystemTime();
      }
    });
  });
});

// ─── Tier 3 — chaos: forced failures unmask, rollbacks leave zero residue ──

describe("ParentLinkRequestService chaos tier", () => {
  test("Tier 3 — forced repository failure propagates UNMASKED (never a domain shape)", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const c = requireCast();
      const transport = new RecordingFanoutTransport();
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent Chaos`,
        email: `${RUN_PREFIX}.parent-chaos@service.test`,
      });
      const student = await createTestStudent(tx, user.id);
      const createSpy = spyOn(ParentLinkRequestRepository, "create").mockImplementation(async () => {
        throw new Error("forced repository failure");
      });
      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ParentLinkRequestService.requestLink(student.handshakeCode, user.id, LOCALE_EN, tx, callOptions(transport))
        );
        // The raw failure is NOT swallowed into a domain conflict.
        expect(error.message).toBe("forced repository failure");
        expect(error).not.toBeInstanceOf(DomainError);
        expect(logSpy).toHaveBeenCalledTimes(0);
        expect(await pendingCountForStudent(tx, student.id)).toBe(0);
        expect(await linkInboxRowsFor(tx, student.id)).toHaveLength(0);
        expect(transport.publishCount).toBe(0);
        // The cast reference keeps the repository surface honest.
        expect(c.absentUserId).toBeGreaterThan(0);
      } finally {
        createSpy.mockRestore();
        logSpy.mockRestore();
      }
    });
  });

  test("Tier 3 — post-claim zero-row link collapse rolls back the ENTIRE unit (zero residual rows)", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const c = requireCast();
      const transport = new RecordingFanoutTransport();
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent Rollback`,
        email: `${RUN_PREFIX}.parent-rollback@service.test`,
      });
      // The student is ALREADY linked (honest fixture control — the guarded
      // repository writer's pre-state), so the claim will succeed and the
      // guarded link write will collapse to zero rows.
      const studentUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Student Rollback`,
        email: `${RUN_PREFIX}.student-rollback@service.test`,
      });
      const student = await createTestStudent(tx, studentUser.id, { parentId: c.parentA.id });
      const request = await ParentLinkRequestRepository.create(
        { parentId: user.id, studentId: student.id, expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS) },
        tx
      );
      // parentA is a COMMITTED cast member — earlier own-commit suites left
      // accepted/rejected copies in his inbox. Pin the DELTA (the in-file
      // convention for cast-member inboxes), not an absolute zero.
      const parentAInboxBefore = (await linkInboxRowsFor(tx, c.parentA.id)).length;
      const logSpy = silenceDomainLog();
      try {
        await expectConflict(
          () =>
            ParentLinkRequestService.respondToLinkRequest(
              request.id,
              true,
              student.id,
              LOCALE_EN,
              tx,
              callOptions(transport)
            ),
          "PARENT_LINK_TARGET_ALREADY_LINKED",
          enErrors.parentLinkTargetAlreadyLinked
        );
      } finally {
        logSpy.mockRestore();
      }

      // Rollback proof — the savepoint left ZERO residual rows: the claim is
      // undone (still pending), the pre-state link holds, and no notification
      // row exists for either party.
      expect(await requestRowById(tx, request.id)).toMatchObject({ status: LinkStatus.Pending });
      expect(await studentParentId(tx, student.id)).toBe(c.parentA.id);
      expect(await linkInboxRowsFor(tx, user.id)).toHaveLength(0);
      expect(await linkInboxRowsFor(tx, c.parentA.id)).toHaveLength(parentAInboxBefore);
      expect(transport.publishCount).toBe(0);
    });
  });

  test("Tier 3 — post-claim engine failure rolls back claim + link + notification alike", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const transport = new RecordingFanoutTransport();
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent EngineFail`,
        email: `${RUN_PREFIX}.parent-enginefail@service.test`,
      });
      const studentUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Student EngineFail`,
        email: `${RUN_PREFIX}.student-enginefail@service.test`,
      });
      const student = await createTestStudent(tx, studentUser.id);
      const request = await ParentLinkRequestRepository.create(
        { parentId: user.id, studentId: student.id, expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS) },
        tx
      );
      const emitSpy = spyOn(NotificationEngine, "emitForUser").mockImplementation(async () => {
        throw new Error("forced engine failure");
      });
      try {
        const error = await expectRepoError(() =>
          ParentLinkRequestService.respondToLinkRequest(
            request.id,
            true,
            student.id,
            LOCALE_EN,
            tx,
            callOptions(transport)
          )
        );
        expect(error.message).toBe("forced engine failure");
      } finally {
        emitSpy.mockRestore();
      }

      // Zero residual rows across all three tables after the rollback.
      expect(await requestRowById(tx, request.id)).toMatchObject({ status: LinkStatus.Pending });
      expect(await studentParentId(tx, student.id)).toBeNull();
      expect(await linkInboxRowsFor(tx, user.id)).toHaveLength(0);
      expect(transport.publishCount).toBe(0);
    });
  });
});

// ─── Tier 4 — security: real re-check, governed denial, zero-write parity ──

describe("ParentLinkRequestService security tier", () => {
  test("Tier 4 — anonymous / missing id / cross-role denied by the REAL actor re-check on every op", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const c = requireCast();
      const transport = new RecordingFanoutTransport();
      const svc = ParentLinkRequestService;

      // Anonymous (no session sentinel) — all five ops.
      await expectRecheckDenial(
        () =>
          svc.requestLink(c.studentEn.student.handshakeCode, ANONYMOUS_ACTOR_ID, LOCALE_EN, tx, callOptions(transport)),
        UnauthorizedError,
        "UNAUTHORIZED",
        enErrors.unauthorized
      );
      await expectRecheckDenial(
        () => svc.respondToLinkRequest(1, true, ANONYMOUS_ACTOR_ID, LOCALE_EN, tx, callOptions(transport)),
        UnauthorizedError,
        "UNAUTHORIZED",
        enErrors.unauthorized
      );
      await expectRecheckDenial(
        () => svc.cancelLinkRequest(1, ANONYMOUS_ACTOR_ID, LOCALE_EN, tx),
        UnauthorizedError,
        "UNAUTHORIZED",
        enErrors.unauthorized
      );
      await expectRecheckDenial(
        () => svc.listMyOutgoing(ANONYMOUS_ACTOR_ID, LOCALE_EN, tx),
        UnauthorizedError,
        "UNAUTHORIZED",
        enErrors.unauthorized
      );
      await expectRecheckDenial(
        () => svc.listMyIncoming(ANONYMOUS_ACTOR_ID, LOCALE_EN, tx),
        UnauthorizedError,
        "UNAUTHORIZED",
        enErrors.unauthorized
      );

      // Missing actor row — same UNAUTHORIZED channel.
      await expectRecheckDenial(
        () => svc.requestLink(c.studentEn.student.handshakeCode, c.absentUserId, LOCALE_EN, tx, callOptions(transport)),
        UnauthorizedError,
        "UNAUTHORIZED",
        enErrors.unauthorized
      );

      // Cross-role: a student calling the parent-only op, a parent calling the
      // student-only op.
      await expectRecheckDenial(
        () =>
          svc.requestLink(
            c.studentEn.student.handshakeCode,
            c.studentEn.user.id,
            LOCALE_EN,
            tx,
            callOptions(transport)
          ),
        ForbiddenError,
        "FORBIDDEN",
        enErrors.forbidden
      );
      await expectRecheckDenial(
        () => svc.respondToLinkRequest(1, true, c.parentA.id, LOCALE_EN, tx, callOptions(transport)),
        ForbiddenError,
        "FORBIDDEN",
        enErrors.forbidden
      );

      // Zero writes, zero notifications, zero publishes across ALL denials.
      expect(await pendingCountForStudent(tx, c.studentEn.user.id)).toBe(0);
      expect(await linkInboxRowsFor(tx, c.studentEn.user.id)).toHaveLength(0);
      expect(transport.publishCount).toBe(0);
    });
  });

  test("Tier 4 — pre-issued-token governed denial: constant copy ≡ role arm, ZERO writes across ALL tables", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const c = requireCast();
      const transport = new RecordingFanoutTransport();
      // A FRESH student-role identity (no students row, no committed fixture
      // rows) — the role-mismatch arm's actor. The zero-write probe below pins
      // ABSOLUTE zeros, so every probed id must carry no pre-existing rows.
      const foreignStudentUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Student Foreign`,
        email: `${RUN_PREFIX}.student-foreign@service.test`,
      });
      const logSpy = silenceDomainLog();
      try {
        // The governed parent's "session" id was issued before the flip; every
        // mutation now denies through the REAL fresh re-read of the row.
        const governedRole = await expectRecheckDenial(
          () =>
            ParentLinkRequestService.requestLink(
              c.studentEn.student.handshakeCode,
              c.parentGov.id,
              LOCALE_EN,
              tx,
              callOptions(transport)
            ),
          ForbiddenError,
          "FORBIDDEN",
          enErrors.forbidden
        );

        // A plain cross-role denial for the byte-parity oracle.
        const roleMismatch = await expectRecheckDenial(
          () =>
            ParentLinkRequestService.requestLink(
              c.studentEn.student.handshakeCode,
              foreignStudentUser.id,
              LOCALE_EN,
              tx,
              callOptions(transport)
            ),
          ForbiddenError,
          "FORBIDDEN",
          enErrors.forbidden
        );

        // No branch disclosure: the governed arm is byte-identical to the
        // role-mismatch arm.
        expect(errorFingerprint(governedRole)).toBe(errorFingerprint(roleMismatch));

        // The lists stay RELAXED by design (self-scoped history survives
        // governance) — a governed parent still sees his own (empty) list.
        const ownHistory = await ParentLinkRequestService.listMyOutgoing(c.parentGov.id, LOCALE_EN, tx);
        expect(ownHistory).toEqual([]);
      } finally {
        logSpy.mockRestore();
      }

      // Zero-write counts pinned: the governed denials wrote ZERO rows across
      // parent_link_requests / students / notifications / audit_logs.
      const ids = [c.parentGov.id, foreignStudentUser.id];
      const [requestRows, studentRows, notificationRows, auditRows] = await Promise.all([
        tx.$count(
          parentLinkRequests,
          or(inArray(parentLinkRequests.parentId, [...ids]), inArray(parentLinkRequests.studentId, [...ids]))
        ),
        tx.$count(students, inArray(students.id, [...ids])),
        tx.$count(notifications, inArray(notifications.userId, [...ids])),
        tx.$count(auditLogs, or(inArray(auditLogs.actorId, [...ids]), inArray(auditLogs.entityId, [...ids]))),
      ]);
      expect(requestRows).toBe(0);
      expect(studentRows).toBe(0);
      expect(notificationRows).toBe(0);
      expect(auditRows).toBe(0);
      expect(transport.publishCount).toBe(0);
    });
  });

  test("Tier 4 — write-parity probe on EVERY denial arm (incl. audit_logs)", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const c = requireCast();
      const transport = new RecordingFanoutTransport();
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent Parity`,
        email: `${RUN_PREFIX}.parent-parity@service.test`,
      });
      const studentUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Student Parity`,
        email: `${RUN_PREFIX}.student-parity@service.test`,
      });
      // A foreign STUDENT actor for the student-direction NOT_FOUND arm — a
      // real student role, owning nothing (the re-check is real).
      const outsiderStudentUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Student Parity Outsider`,
        email: `${RUN_PREFIX}.student-parity-outsider@service.test`,
      });
      const student = await createTestStudent(tx, studentUser.id);
      const request = await ParentLinkRequestRepository.create(
        { parentId: user.id, studentId: student.id, expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS) },
        tx
      );
      await ParentLinkRequestRepository.respondToPendingForStudent(
        request.id,
        student.id,
        LinkStatus.Rejected,
        new Date(),
        tx
      );
      // The duplicate-pending arm needs a LIVE pending for the pair — the
      // resolved `request` alone would let requestLink SUCCEED (and write!).
      // Created BEFORE the `before` snapshot so the parity delta stays zero.
      await ParentLinkRequestRepository.create(
        { parentId: user.id, studentId: student.id, expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS) },
        tx
      );
      const foreignRequest = await ParentLinkRequestRepository.create(
        {
          parentId: c.parentB.id,
          studentId: student.id,
          expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS),
        },
        tx
      );

      const scopedCounts = async () => {
        const ids = [user.id, student.id, outsiderStudentUser.id];
        const [requestRows, studentRows, notificationRows, auditRows] = await Promise.all([
          tx.$count(
            parentLinkRequests,
            or(inArray(parentLinkRequests.parentId, [...ids]), inArray(parentLinkRequests.studentId, [...ids]))
          ),
          tx.$count(students, inArray(students.id, [...ids])),
          tx.$count(notifications, inArray(notifications.userId, [...ids])),
          tx.$count(auditLogs, or(inArray(auditLogs.actorId, [...ids]), inArray(auditLogs.entityId, [...ids]))),
        ]);
        return { requestRows, studentRows, notificationRows, auditRows };
      };
      const before = await scopedCounts();

      // Every denial arm EXCEPT the EXPIRED arm (whose expiry fold is
      // the one sanctioned write) — zero deltas pinned across all tables.
      await expectRepoError(() =>
        ParentLinkRequestService.requestLink(
          c.studentLinked.student.handshakeCode,
          user.id,
          LOCALE_EN,
          tx,
          callOptions(transport)
        )
      );
      await expectRepoError(() =>
        ParentLinkRequestService.requestLink(student.handshakeCode, user.id, LOCALE_EN, tx, callOptions(transport))
      );
      await expectRepoError(() =>
        ParentLinkRequestService.respondToLinkRequest(
          request.id,
          true,
          student.id,
          LOCALE_EN,
          tx,
          callOptions(transport)
        )
      );
      await expectRepoError(() =>
        ParentLinkRequestService.cancelLinkRequest(foreignRequest.id, user.id, LOCALE_EN, tx)
      );
      await expectRepoError(() => ParentLinkRequestService.cancelLinkRequest(999_999_998, user.id, LOCALE_EN, tx));
      await expectRepoError(() =>
        ParentLinkRequestService.respondToLinkRequest(
          foreignRequest.id,
          true,
          outsiderStudentUser.id,
          LOCALE_EN,
          tx,
          callOptions(transport)
        )
      );

      const after = await scopedCounts();
      expect(after.requestRows).toBe(before.requestRows);
      expect(after.studentRows).toBe(before.studentRows);
      expect(after.notificationRows).toBe(before.notificationRows);
      expect(after.auditRows).toBe(before.auditRows);
      expect(transport.publishCount).toBe(0);
    });
  });

  test("Tier 4 — denial logs are ONE, bounded, and NEVER carry names, emails, or handshake codes", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const c = requireCast();
      const transport = new RecordingFanoutTransport();
      const secrets = [
        c.studentEn.user.fullName,
        c.studentEn.user.email,
        c.studentEn.student.handshakeCode,
        c.absentCode,
      ];
      const probes = (async () => {
        const logSpy = silenceDomainLog();
        try {
          await expectRepoError(() =>
            ParentLinkRequestService.requestLink(
              c.studentEn.student.handshakeCode,
              ANONYMOUS_ACTOR_ID,
              LOCALE_EN,
              tx,
              callOptions(transport)
            )
          );
          await expectRepoError(() =>
            ParentLinkRequestService.requestLink(
              c.studentEn.student.handshakeCode,
              c.studentEn.user.id,
              LOCALE_EN,
              tx,
              callOptions(transport)
            )
          );
          await expectRepoError(() =>
            ParentLinkRequestService.requestLink(
              c.studentLinked.student.handshakeCode,
              c.parentB.id,
              LOCALE_EN,
              tx,
              callOptions(transport)
            )
          );
          await expectRepoError(() =>
            ParentLinkRequestService.respondToLinkRequest(
              999_999_997,
              true,
              c.studentEn.user.id,
              LOCALE_EN,
              tx,
              callOptions(transport)
            )
          );
          const calls = logSpy.mock.calls;
          expect(calls).toHaveLength(4);
          const loggedPayload = JSON.stringify(calls);
          for (const secret of secrets) {
            expect(loggedPayload.includes(secret)).toBe(false);
          }
          for (const call of calls) {
            const ctx = call?.[1];
            const keys = Object.keys(ctx ?? {}).toSorted(compareStrings);
            expect(keys.every(key => ["code", "entity", "entityId", "locale"].includes(key))).toBe(true);
          }
          return calls.length;
        } finally {
          logSpy.mockRestore();
        }
      })();
      expect(await probes).toBe(4);
    });
  });

  test("Tier 4 — happy paths and silent arms emit NOTHING to the domain log", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const c = requireCast();
      const transport = new RecordingFanoutTransport();
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent Silence`,
        email: `${RUN_PREFIX}.parent-silence@service.test`,
      });
      // Student-role target so the student-only read (listMyIncoming) passes
      // the REAL actor re-check.
      const studentUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Student Silence`,
        email: `${RUN_PREFIX}.student-silence@service.test`,
      });
      const student = await createTestStudent(tx, studentUser.id);
      const logSpy = silenceDomainLog();
      try {
        const created = await ParentLinkRequestService.requestLink(
          student.handshakeCode,
          user.id,
          LOCALE_EN,
          tx,
          callOptions(transport)
        );
        if (created === null) {
          throw new Error("expected the request to be created");
        }
        await ParentLinkRequestService.cancelLinkRequest(created.id, user.id, LOCALE_EN, tx);
        await ParentLinkRequestService.listMyOutgoing(user.id, LOCALE_EN, tx);
        await ParentLinkRequestService.listMyIncoming(student.id, LOCALE_EN, tx);
        await ParentLinkRequestService.requestLink(c.absentCode, user.id, LOCALE_EN, tx, callOptions(transport));
        await ParentLinkRequestService.requestLink(
          c.studentGov.student.handshakeCode,
          user.id,
          LOCALE_EN,
          tx,
          callOptions(transport)
        );
        expect(logSpy).toHaveBeenCalledTimes(0);
      } finally {
        logSpy.mockRestore();
      }
    });
  });
});

// ─── Self-scoped reads + normalization guards ───────────────────────────

describe("ParentLinkRequestService reads and pre-DB validation", () => {
  test("Tier 1 — lists are self-scoped on the VERIFIED actor id with closed shapes", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const transport = new RecordingFanoutTransport();
      const user = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent Scope`,
        email: `${RUN_PREFIX}.parent-scope@service.test`,
      });
      const rival = await createTestUser(tx, {
        role: "parent",
        fullName: `${RUN_PREFIX} Parent Rival Scope`,
        email: `${RUN_PREFIX}.parent-rival-scope@service.test`,
      });
      // Distinct STUDENT-role users: the students rows must key onto student
      // users, or the student-only list read denies FORBIDDEN on the re-check.
      const studentUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Student Scope`,
        email: `${RUN_PREFIX}.student-scope@service.test`,
      });
      const outsiderStudentUser = await createTestUser(tx, {
        fullName: `${RUN_PREFIX} Student Outsider Scope`,
        email: `${RUN_PREFIX}.student-outsider-scope@service.test`,
      });
      const student = await createTestStudent(tx, studentUser.id);
      const outsiderStudent = await createTestStudent(tx, outsiderStudentUser.id);
      const request = await ParentLinkRequestRepository.create(
        { parentId: user.id, studentId: student.id, expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS) },
        tx
      );

      const outgoing = await ParentLinkRequestService.listMyOutgoing(user.id, LOCALE_EN, tx);
      expect(outgoing).toHaveLength(1);
      expectOutgoingShape(outgoing[0] ?? {});
      expect(outgoing[0]?.id).toBe(request.id);
      expect(outgoing[0]?.studentMaskedName).toBe(maskFullName(studentUser.fullName));

      // Foreign lists stay empty — self-scoping is the ownership predicate.
      expect(await ParentLinkRequestService.listMyOutgoing(rival.id, LOCALE_EN, tx)).toEqual([]);
      expect(await ParentLinkRequestService.listMyIncoming(outsiderStudent.id, LOCALE_EN, tx)).toEqual([]);

      const incoming = await ParentLinkRequestService.listMyIncoming(student.id, LOCALE_EN, tx);
      expect(incoming).toHaveLength(1);
      expectIncomingShape(incoming[0] ?? {});
      expect(incoming[0]?.parentFullName).toBe(user.fullName);

      // Reads never publish and never log.
      expect(transport.publishCount).toBe(0);
    });
  });

  test("Tier 1/3 — malformed codes reject PRE-DB with the EXISTING localized key (repo spy: zero calls)", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const c = requireCast();
      const transport = new RecordingFanoutTransport();
      const malformed = ["KSB-", "KSB-ABCD123", "ksb-abcd123g", "", "   ", "KSB-AB_D1234", "رمز-دخول"];
      const repoSpy = spyOn(StudentRepository, "findLinkTargetByHandshakeCode");
      const logSpy = silenceDomainLog();
      try {
        const errors = await Promise.all(
          malformed.map(probe =>
            expectRepoError(() =>
              ParentLinkRequestService.requestLink(probe, c.parentA.id, LOCALE_EN, tx, callOptions(transport))
            )
          )
        );
        for (const error of errors) {
          expect(error).toBeInstanceOf(DomainError);
          const domain = requireDomainError(error);
          expect(domain.code).toBe("VALIDATION");
          expect(domain.message).toBe(enErrors.handshakeCodeInvalid);
        }
        // Normalize-then-validate happens BEFORE any database read — the
        // discovery repository method never executed for ANY malformed probe.
        expect(repoSpy).toHaveBeenCalledTimes(0);
      } finally {
        repoSpy.mockRestore();
        logSpy.mockRestore();
      }
      expect(transport.publishCount).toBe(0);
      // The canonical guard holds for every accepted code shape.
      expect(isHandshakeCode(normalizeHandshakeCode(`  ${c.studentEn.student.handshakeCode}  `))).toBe(true);
    });
  });

  test("Tier 1 — findLocalesByIds substrate: the emitter reads the persisted recipient preference", async () => {
    await runInRollback(async (tx: DBTransaction) => {
      const c = requireCast();
      const locales = await UserRepository.findLocalesByIds([c.studentAr.user.id, c.studentNullLocale.user.id], tx);
      expect(locales.get(c.studentAr.user.id)).toBe(LOCALE_AR);
      expect(locales.get(c.studentNullLocale.user.id)).toBeNull();
    });
  });
});
