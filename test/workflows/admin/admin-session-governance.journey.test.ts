/**
 * Cross-actor admin session-governance journeys — the admin directory/
 * detail reads and the operator mutations exercised END-TO-END through
 * the REAL `SessionAdminGovernanceService` (production transaction path)
 * on the real test database, every step attributed to a real actor from
 * one committed fixture cast (real `users.role` values + real role-child
 * rows; authorization and ownership resolve through the same row-side
 * predicates production uses — never monkey-patched).
 *
 * Journeys:
 *  - W-1 — admin discovery → status filter → detail read → cancel with
 *    the same-lane hold release → participant waves → the student sees
 *    the cancelled row → the admin re-filters under the new status.
 *  - W-2 — teacher reassignment through the certification gate: the row
 *    swaps teachers, the student observes the new teacher, all three
 *    participants receive localized waves, and an unapproved candidate
 *    is refused with the row byte-identical.
 *  - W-3 — join-as-observer: EXACTLY ONE audit row on a started row and
 *    zero audit rows with a localized conflict on a scheduled row.
 *  - W-4 — the role-denial matrix: every persisted non-admin role and
 *    the anonymous caller against all six governance operations, each
 *    denial byte-identical to the shared admin-gate reference split,
 *    with zero writes anywhere.
 *
 * Layer contract (`test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md`):
 *  - NO `runInRollback` — fixtures commit in `beforeAll`; every row
 *    (fixtures AND service-created sessions/claims) is registered in a
 *    `SessionFixtureRegistry` and hard-deleted FK-safely in `afterAll`
 *    (the governance audit rows first, under the suspended-trigger
 *    helper — `audit_logs` is append-only and RESTRICT-deletes into
 *    `users`).
 *  - Per-run `jrn_<domain>_<8hex>` prefix on labels and idempotency keys
 *    — repeated or parallel runs never collide.
 *  - Negative steps fail through the REAL service denials, asserted by
 *    `DomainError.code` + the exact translated message (try/catch helper
 *    — never `expect(...).rejects.toThrow()`).
 *  - External effects are SPIED, never sent: the notification fan-out
 *    transport and the emit claim cache install through the service's
 *    `NotificationEngineCallOptions` seam, so publish-after-commit is
 *    observable in-process (which userIds were pushed, in wave order)
 *    while nothing reaches a real channel.
 *  - Run: bun run test/scripts/run-test.ts
 *    test/workflows/admin/admin-session-governance.journey.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ConflictError, DomainError, ForbiddenError } from "@/backend/lib/errors";
import { SessionAdminGovernanceService } from "@/backend/services/classes/session-admin-governance";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import type { NotificationEngineCallOptions } from "@/backend/services/notifications";
import type { NotificationIdempotencyClaimCache } from "@/backend/services/notifications/emit-idempotency";
import type {
  DBTransaction,
  NotificationReturnType,
  SessionInsertType,
  SessionReturnType,
  SessionSelectType,
} from "@/backend/types";
import { SESSION_FEE_HIFZ } from "@/shared/constants/session-fees.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  buildSessionJourneyCast,
  countNotificationsForUser,
  createSessionFixtureRegistry,
  journeyPrefix,
  type SessionJourneyCast,
  SpiedFanoutTransport,
} from "@/test/workflows/helpers";

/**
 * The journey runs on the default test locale throughout (the ACTING
 * admin's locale); each RECIPIENT's wave copy resolves from that
 * recipient's own persisted locale, so the cast pins mixed locales to
 * prove per-recipient localization.
 */
const LOCALE = "en";

/** The audit row's entity label for this surface (the service's constant). */
const SESSION_ENTITY_TYPE = "session";

/** Per-run journey prefix (AGENTS.md rule 3) — labels, emails, keys. */
const JOURNEY_PREFIX = journeyPrefix("admin-sessions");

/** The fixture registry — the hard-delete worklist drained by `afterAll`. */
const registry = createSessionFixtureRegistry();

/** The committed actor cast (assigned once by `beforeAll`). */
let cast: SessionJourneyCast;

/**
 * A teacher-role user whose `teacher` row holds `is_approved = false` —
 * the honest certification-denial target (a real row failing the real
 * strict-true check, never a stub).
 */
let unapprovedTeacherUserId = 0;

/** W-1's session — scheduled with a recorded TRIAL hold lane. */
let w1Session: SessionReturnType;

/** W-2's session — scheduled on the SAME provenance lane; T1 → T2 target. */
let w2Session: SessionReturnType;

/** W-3's session — booked scheduled, started by its teacher inside W-3. */
let w3Session: SessionReturnType;

/**
 * The attention-badge fixture — a scheduled row whose confirmation
 * deadline has lapsed, so the derived badge flag must be TRUE next to
 * W-1's fresh scheduled row (flag FALSE). Booking it directly keeps the
 * lapsed deadline deterministic (no clock travel).
 */
let badgeSessionId = 0;

/** Every session row this suite created — the audit-sweep + residue ids. */
const fixtureSessionIds: number[] = [];

/** Every idempotency claim key this suite spent — tracked for cleanup. */
const bookingKeys: string[] = [];

/** Localized error copy for denial assertions (translated strings). */
function notificationTexts(locale: string): ReturnType<typeof getServerTranslations>["notificationsTranslations"] {
  return getServerTranslations(locale).notificationsTranslations;
}

/** Localized error copy for the denial probes (translated strings, en). */
const T_ERRORS = getServerTranslations(LOCALE).errorsTranslations;

/**
 * Try/catch rejection helper (journey-layer pattern —
 * `expect(...).rejects.toThrow()` is prohibited). Returns the caught
 * `DomainError`; fails the test when the call resolves successfully or
 * throws a non-`DomainError`.
 */
async function expectJourneyError(fn: () => Promise<unknown>): Promise<DomainError> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  if (caught === null) {
    throw new Error("expectJourneyError: expected the call to throw, but it resolved successfully");
  }
  if (caught instanceof DomainError) {
    return caught;
  }
  const message = caught instanceof Error ? caught.message : JSON.stringify(caught);
  throw new Error(`expectJourneyError: caught non-DomainError: ${message}`);
}

/**
 * Byte-identity oracle for the W-4 denial matrix: the denial must carry
 * the SAME error class, the SAME `extensions.code`, and the SAME
 * localized message as the reference denial captured from the shared
 * admin gate (the specs' 7th operation, `resolveSessionDispute`).
 */
function expectDenialByteIdentical(denial: DomainError, reference: DomainError): void {
  expect(denial.constructor).toBe(reference.constructor);
  expect(denial.code).toBe(reference.code);
  expect(denial.message).toBe(reference.message);
}

/**
 * Fresh notification-engine options per mutation call: a spied transport
 * (records instead of delivering) plus an isolated in-memory claim cache
 * — the service's documented injection seam, so the production
 * publish-after-commit path runs without Redis or a socket.
 */
function emitSpyOptions(transport: SpiedFanoutTransport): NotificationEngineCallOptions {
  return { transport, cache: new MemoryEmitClaimCache() };
}

/**
 * An emit-claim cache with SET-NX semantics over an in-memory map —
 * keeps the production emit path off the env-resolved Redis cache while
 * remaining a real dependency of the engine.
 */
class MemoryEmitClaimCache implements NotificationIdempotencyClaimCache {
  private readonly entries = new Map<string, string>();

  async claim(key: string, _ttlSeconds: number): Promise<boolean> {
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

/** Independent read-back oracle: the FULL session row (not via the service). */
async function readSessionRow(sessionId: number): Promise<SessionSelectType> {
  const [row] = await db.select().from(session).where(eq(session.id, sessionId));
  if (!row) {
    throw new Error(`journey: session row ${String(sessionId)} vanished (fixture integrity failure)`);
  }
  return row;
}

/** Independent read-back oracle: the student's escrow-lane balances. */
async function readLaneBalances(
  studentId: number
): Promise<{ trial: number; hifz: number | null; tajweed: number | null }> {
  const [row] = await db
    .select({ trial: students.balanceTrial, hifz: students.balanceHifz, tajweed: students.balanceTajweed })
    .from(students)
    .where(eq(students.id, studentId));
  if (!row) {
    throw Error(`journey: students row ${String(studentId)} vanished (fixture integrity failure)`);
  }
  return row;
}

/** Inbox rows for ONE recipient — full rows for per-locale copy assertions. */
async function readInboxFor(userId: number): Promise<NotificationReturnType[]> {
  return db.select().from(notifications).where(eq(notifications.userId, userId));
}

/** Audit rows ABOUT one session entity (the exactly-once oracle). */
async function readAuditsForSession(sessionId: number) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, SESSION_ENTITY_TYPE), eq(auditLogs.entityId, sessionId)));
}

/** Audit rows WRITTEN BY one actor (the zero-write denial oracle). */
async function countAuditsForActor(actorId: number): Promise<number> {
  return db.$count(auditLogs, eq(auditLogs.actorId, actorId));
}

/** Idempotency claims owned by one user (the zero-claim denial oracle). */
/** Registers one service-created idempotency claim (by key) for cleanup. */
async function trackIdempotencyClaim(key: string, label: string): Promise<void> {
  const [claim] = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  if (!claim) {
    throw new Error(`journey: idempotency claim for ${label} not found (fixture tracking failure)`);
  }
  registry.track("session_request_idempotency", claim.id);
}

/** Finds one listed session by id (list order is not part of any contract). */
function listedItemById<T extends { readonly id: number }>(items: readonly T[], id: number): T | undefined {
  return items.find(item => item.id === id);
}

/** Floors a timestamp to whole seconds (the whole-second column convention). */
function secondAlignedInstant(value: Date): Date {
  return new Date(Math.floor(value.getTime() / 1000) * 1000);
}

/**
 * Projects a session row onto its comparable shape: every Date field is
 * floored to whole seconds, so rows read through different executors (a
 * guarded UPDATE `.returning()` vs the queryDb read path) compare equal —
 * the stored column values are identical; only driver timestamp precision
 * differs.
 */
function comparableSessionRow(row: object): Record<string, string | number | boolean | null> {
  const projection: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(row)) {
    projection[key] = value instanceof Date ? secondAlignedInstant(value).toISOString() : (value ?? null);
  }
  return projection;
}

/**
 * The audit-details payload shape a governance mutation serializes:
 * `{action, reason?}` for the cancel, `{action, from:{teacherId},
 * to:{teacherId}}` for the reassignment, `{action}` for the observation.
 */
interface GovernanceAuditDetails {
  readonly action?: string;
  readonly reason?: string | null;
  readonly from?: { readonly teacherId?: number };
  readonly to?: { readonly teacherId?: number };
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
 * Direct session-row insert for fixture preconditions that need column
 * control beyond the booking flow (a lapsed confirmation deadline for
 * the badge arm, a pristine held row for the denial matrix). The
 * notification wave resolver fails closed on a corrupt/absent intent, so
 * every fixture carries a real one.
 */
async function insertSessionRow(tx: DBTransaction, overrides: Partial<SessionInsertType>): Promise<SessionSelectType> {
  const [row] = await tx
    .insert(session)
    .values({
      teacherId: cast.teacher.userId,
      studentId: cast.primaryStudent.student.id,
      status: SessionStatus.Scheduled,
      sessionType: SessionType.StudentSession,
      intent: SessionIntent.Hifz,
      fee: SESSION_FEE_HIFZ,
      feeHeld: true,
      heldBalanceLane: HeldBalanceLane.Trial,
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("insertSessionRow: insert returned no rows");
  }
  return row;
}

beforeAll(async () => {
  // 1. The committed cast — funded student (3 trial units fund all three
  //    held bookings on the SAME provenance lane), certified teacher pair,
  //    applicant, parent, admin — plus the unapproved certification target
  //    and the per-recipient wave locales, all inside ONE commit-or-nothing
  //    transaction.
  await db.transaction(async tx => {
    cast = await buildSessionJourneyCast(tx, registry, {
      prefix: JOURNEY_PREFIX,
      primaryStudent: { trial: 3 },
    });

    const unapprovedUser = await createTestUser(tx, {
      role: "teacher",
      fullName: `${JOURNEY_PREFIX} unapproved teacher`,
    });
    const [unapprovedTeacher] = await tx
      .insert(teacher)
      .values({ id: unapprovedUser.id, isApproved: false })
      .returning();
    if (!unapprovedTeacher) {
      throw new Error("journey: unapproved teacher row insert returned no rows");
    }
    unapprovedTeacherUserId = unapprovedUser.id;
    registry.track("users", unapprovedUser.id);
    registry.track("teacher", unapprovedTeacher.id);

    // Per-recipient wave locales: the student and the incoming teacher read
    // English, the outgoing teacher reads Arabic — the cancel and reassign
    // waves must land in EACH recipient's own persisted locale.
    await tx.update(users).set({ locale: "en" }).where(eq(users.id, cast.primaryStudent.userId));
    await tx.update(users).set({ locale: "ar" }).where(eq(users.id, cast.teacher.userId));
    await tx.update(users).set({ locale: "en" }).where(eq(users.id, cast.secondTeacher.userId));
  });

  // 2. W-1's held row — booked through the REAL booking flow, so the hold
  //    lane, provenance, fee, and claim are production-shaped.
  const w1Key = `${JOURNEY_PREFIX}-w1-hold`;
  bookingKeys.push(w1Key);
  w1Session = await SessionLifecycleService.createSession(
    cast.primaryStudent.userId,
    { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz },
    w1Key,
    LOCALE
  );
  registry.track("session", w1Session.id);
  await trackIdempotencyClaim(w1Key, "the W-1 hold");

  // 3. W-2's held row — booked through the REAL booking flow on the same
  //    provenance lane (the reassignment journey's scheduled target).
  const w2Key = `${JOURNEY_PREFIX}-w2-hold`;
  bookingKeys.push(w2Key);
  w2Session = await SessionLifecycleService.createSession(
    cast.primaryStudent.userId,
    { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz },
    w2Key,
    LOCALE
  );
  registry.track("session", w2Session.id);
  fixtureSessionIds.push(w2Session.id);
  await trackIdempotencyClaim(w2Key, "the W-2 hold");

  // 4. W-3's held row — booked scheduled on the same lane; its owning
  //    teacher starts it inside the journey (the join happy target).
  const w3Key = `${JOURNEY_PREFIX}-w3-hold`;
  bookingKeys.push(w3Key);
  w3Session = await SessionLifecycleService.createSession(
    cast.primaryStudent.userId,
    { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz },
    w3Key,
    LOCALE
  );
  registry.track("session", w3Session.id);
  fixtureSessionIds.push(w3Session.id);
  await trackIdempotencyClaim(w3Key, "the W-3 hold");

  // 5. The badge fixture — scheduled with a LAPSED confirmation deadline
  //    (the derived attention flag must fire for it, and only for it).
  //    It stays scheduled for the whole run and is the W-3 join-denial
  //    and W-4 denial-matrix target (denials write nothing).
  const badgeRow = await db.transaction(async tx =>
    insertSessionRow(tx, { confirmationDeadline: new Date(Date.now() - 60_000) })
  );
  badgeSessionId = badgeRow.id;
  fixtureSessionIds.push(badgeSessionId);
  registry.track("session", badgeSessionId);

  // W-1's row joins the audit-sweep + residue id list too (its cancel
  // audit row is swept by actor; the entity sweep is belt-and-braces).
  fixtureSessionIds.push(w1Session.id);
});

afterAll(async () => {
  // The governance mutations append append-only audit rows (actor-RESTRICT
  // into users) — sweep them FIRST under the suspended-trigger helper,
  // then hard-delete the tracked fixtures FK-safely.
  if (cast) {
    await withAuditDeleteTriggersSuspended(async () => {
      await db.delete(auditLogs).where(eq(auditLogs.actorId, cast.admin.userId));
      if (fixtureSessionIds.length > 0) {
        await db
          .delete(auditLogs)
          .where(and(eq(auditLogs.entityType, SESSION_ENTITY_TYPE), inArray(auditLogs.entityId, fixtureSessionIds)));
      }
    });
  }
  await registry.cleanup();

  // Mandatory zero-residue proof: nothing this suite created may survive.
  if (cast) {
    const castUserIds = [
      cast.primaryStudent.userId,
      cast.secondStudent.userId,
      cast.teacher.userId,
      cast.secondTeacher.userId,
      cast.applicant.userId,
      cast.parent.userId,
      cast.admin.userId,
      unapprovedTeacherUserId,
    ].filter(id => id > 0);
    expect(await db.$count(users, inArray(users.id, castUserIds))).toBe(0);
    if (fixtureSessionIds.length > 0) {
      expect(await db.$count(session, inArray(session.id, fixtureSessionIds))).toBe(0);
    }
    const claimCounts = await Promise.all(
      bookingKeys.map(key => db.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.idempotencyKey, key)))
    );
    for (const count of claimCounts) {
      expect(count).toBe(0);
    }
  }
});

describe("Journey W-1 — admin discovery, cancel with same-lane refund, cross-actor visibility", () => {
  test("step 1 — the admin directory filter (status=scheduled) shows the held row with its badge, and the lapsed-deadline row alone is flagged", async () => {
    const page = await SessionAdminGovernanceService.listAll(
      cast.admin.userId,
      { status: SessionStatus.Scheduled },
      1,
      50,
      LOCALE
    );

    const heldRow = listedItemById(page.items, w1Session.id);
    expect(heldRow).toBeDefined();
    expect(heldRow?.status).toBe(SessionStatus.Scheduled);
    expect(heldRow?.feeHeld).toBe(true);
    expect(heldRow?.heldBalanceLane).toBe(HeldBalanceLane.Trial);
    // A fresh scheduled row with a live confirmation deadline is NOT flagged.
    expect(heldRow?.needsAttention).toBe(false);

    // The lapsed-deadline fixture IS flagged — the badge derives
    // server-side from the row, presentation-only.
    const flaggedRow = listedItemById(page.items, badgeSessionId);
    expect(flaggedRow).toBeDefined();
    expect(flaggedRow?.needsAttention).toBe(true);
  });

  test("step 2 — the admin detail read returns the full row and performs ZERO side effects", async () => {
    const notificationsBefore = await countNotificationsForUser(cast.primaryStudent.userId);
    const auditsBefore = await countAuditsForActor(cast.admin.userId);

    const detail = await SessionAdminGovernanceService.getDetail(cast.admin.userId, w1Session.id, LOCALE);

    expect(detail).not.toBeNull();
    expect(detail?.id).toBe(w1Session.id);
    expect(detail?.status).toBe(SessionStatus.Scheduled);
    expect(detail?.teacherId).toBe(cast.teacher.userId);
    expect(detail?.studentId).toBe(cast.primaryStudent.student.id);
    expect(detail?.feeHeld).toBe(true);

    // Reads produce zero rows: no notifications, no audit trail entries.
    expect(await countNotificationsForUser(cast.primaryStudent.userId)).toBe(notificationsBefore);
    expect(await countAuditsForActor(cast.admin.userId)).toBe(auditsBefore);
  });

  test("step 3 — the admin cancel commits the flip, the SAME-lane refund, exactly ONE audit row, and the post-commit participant waves", async () => {
    const inboxStudentBefore = await countNotificationsForUser(cast.primaryStudent.userId);
    const inboxTeacherBefore = await countNotificationsForUser(cast.teacher.userId);
    const lanesBefore = await readLaneBalances(cast.primaryStudent.student.id);
    // The hold is live on the recorded provenance lane (see step 1) and no
    // audit row exists yet.
    expect(w1Session.heldBalanceLane).toBe(HeldBalanceLane.Trial);
    expect(await readAuditsForSession(w1Session.id)).toHaveLength(0);

    const transport = new SpiedFanoutTransport();
    const cancelled = await SessionAdminGovernanceService.cancel(
      cast.admin.userId,
      { sessionId: w1Session.id, reason: "  Operational override  " },
      LOCALE,
      null,
      undefined,
      emitSpyOptions(transport)
    );

    // The mutation returns the flipped row with the hold marker ALREADY
    // CLEARED — the admin guard's guarded statement rewrites fee_held
    // itself (no fee_held=true terminal row survives), while the hold
    // lane's release is the same-tx refund's composition below.
    expect(cancelled.status).toBe(SessionStatus.Cancelled);
    expect(cancelled.feeHeld).toBe(false);
    expect((await readSessionRow(w1Session.id)).status).toBe(SessionStatus.Cancelled);

    // The refund lands on the SAME recorded provenance lane — exactly one
    // unit back to the trial lane, every other lane untouched.
    const lanesAfter = await readLaneBalances(cast.primaryStudent.student.id);
    expect(lanesAfter.trial).toBe(lanesBefore.trial + 1);
    expect(lanesAfter.hifz).toBe(lanesBefore.hifz);
    expect(lanesAfter.tajweed).toBe(lanesBefore.tajweed);

    // EXACTLY ONE audit row: Override action, session entity, the trimmed
    // cancel reason as metadata.
    const auditRows = await readAuditsForSession(w1Session.id);
    expect(auditRows).toHaveLength(1);
    const auditRow = auditRows[0];
    if (!auditRow) {
      throw new Error("journey: expected exactly one audit row for the cancel");
    }
    expect(auditRow.actionType).toBe(AuditActionType.Override);
    expect(auditRow.actorId).toBe(cast.admin.userId);
    expect(auditRow.entityType).toBe(SESSION_ENTITY_TYPE);
    expect(auditRow.entityId).toBe(w1Session.id);
    const details = parseAuditDetails(auditRow.details);
    expect(details.action).toBe("cancel");
    expect(details.reason).toBe("Operational override");

    // Post-commit waves: one fan-out PER delivery receipt (the engine's
    // per-receipt publish contract), student first, then teacher — spied,
    // never delivered.
    expect(transport.publishCount).toBe(2);
    expect(transport.publishedUserIds).toEqual([cast.primaryStudent.userId, cast.teacher.userId]);

    // Each recipient's persisted inbox row carries the cancellation wave
    // copy composed in the RECIPIENT's own locale (student en, teacher ar).
    expect(await countNotificationsForUser(cast.primaryStudent.userId)).toBe(inboxStudentBefore + 1);
    expect(await countNotificationsForUser(cast.teacher.userId)).toBe(inboxTeacherBefore + 1);
    const studentInbox = await readInboxFor(cast.primaryStudent.userId);
    const studentWave = studentInbox.find(row => row.relatedEntityId === w1Session.id);
    expect(studentWave).toBeDefined();
    expect(studentWave?.type).toBe(NotificationType.SessionCancellation);
    expect(studentWave?.relatedEntityType).toBe(SESSION_ENTITY_TYPE);
    expect(studentWave?.title).toBe(notificationTexts("en").eventSessionGovernanceCancelledTitle);
    expect(studentWave?.body).toBe(notificationTexts("en").eventSessionGovernanceCancelledBody);
    const teacherInbox = await readInboxFor(cast.teacher.userId);
    const teacherWave = teacherInbox.find(row => row.relatedEntityId === w1Session.id);
    expect(teacherWave).toBeDefined();
    expect(teacherWave?.type).toBe(NotificationType.SessionCancellation);
    expect(teacherWave?.title).toBe(notificationTexts("ar").eventSessionGovernanceCancelledTitle);
    expect(teacherWave?.body).toBe(notificationTexts("ar").eventSessionGovernanceCancelledBody);
  });

  test("step 4 — the student's own list shows the cancelled session next to the cancellation notification", async () => {
    const cancelledPage = await SessionLifecycleService.listMyStudentSessions(
      cast.primaryStudent.userId,
      { status: SessionStatus.Cancelled },
      1,
      25
    );
    expect(cancelledPage.totalCount).toBe(1);
    const ownRow = listedItemById(cancelledPage.items, w1Session.id);
    expect(ownRow).toBeDefined();
    expect(ownRow?.status).toBe(SessionStatus.Cancelled);
    expect(ownRow?.teacherId).toBe(cast.teacher.userId);

    // The wave from step 3 is in the student's inbox (exactly one row so
    // far — the reassignment journey adds the next one).
    expect(await countNotificationsForUser(cast.primaryStudent.userId)).toBe(1);
  });

  test("step 5 — the admin re-filter under status=cancelled shows the same row, and it left the scheduled filter", async () => {
    const cancelledPage = await SessionAdminGovernanceService.listAll(
      cast.admin.userId,
      { status: SessionStatus.Cancelled },
      1,
      50,
      LOCALE
    );
    const cancelledRow = listedItemById(cancelledPage.items, w1Session.id);
    expect(cancelledRow).toBeDefined();
    expect(cancelledRow?.status).toBe(SessionStatus.Cancelled);
    expect(cancelledRow?.needsAttention).toBe(false);

    const scheduledPage = await SessionAdminGovernanceService.listAll(
      cast.admin.userId,
      { status: SessionStatus.Scheduled },
      1,
      50,
      LOCALE
    );
    expect(listedItemById(scheduledPage.items, w1Session.id)).toBeUndefined();

    // The detail read answers the new state honestly.
    const detail = await SessionAdminGovernanceService.getDetail(cast.admin.userId, w1Session.id, LOCALE);
    expect(detail?.status).toBe(SessionStatus.Cancelled);
  });
});

describe("Journey W-2 — teacher reassignment through the certification gate", () => {
  test("step 1 — the admin reassigns T1 → T2: the row swaps, exactly ONE audit row records the swap, and all three participants receive localized waves", async () => {
    const rowBefore = await readSessionRow(w2Session.id);
    expect(rowBefore.teacherId).toBe(cast.teacher.userId);
    expect(rowBefore.status).toBe(SessionStatus.Scheduled);
    expect(await readAuditsForSession(w2Session.id)).toHaveLength(0);
    const inboxStudentBefore = await countNotificationsForUser(cast.primaryStudent.userId);
    const inboxOutgoingBefore = await countNotificationsForUser(cast.teacher.userId);
    const inboxIncomingBefore = await countNotificationsForUser(cast.secondTeacher.userId);

    const transport = new SpiedFanoutTransport();
    const reassigned = await SessionAdminGovernanceService.reassignTeacher(
      cast.admin.userId,
      { sessionId: w2Session.id, newTeacherUserId: cast.secondTeacher.userId },
      LOCALE,
      undefined,
      emitSpyOptions(transport)
    );

    // The mutation returns and commits the teacher swap; the row stays
    // scheduled (reassignment is not a lifecycle transition).
    expect(reassigned.teacherId).toBe(cast.secondTeacher.userId);
    expect(reassigned.status).toBe(SessionStatus.Scheduled);
    expect((await readSessionRow(w2Session.id)).teacherId).toBe(cast.secondTeacher.userId);

    // EXACTLY ONE audit row: Override action, outgoing/incoming metadata.
    const auditRows = await readAuditsForSession(w2Session.id);
    expect(auditRows).toHaveLength(1);
    const auditRow = auditRows[0];
    if (!auditRow) {
      throw new Error("journey: expected exactly one audit row for the reassignment");
    }
    expect(auditRow.actionType).toBe(AuditActionType.Override);
    expect(auditRow.actorId).toBe(cast.admin.userId);
    expect(auditRow.entityType).toBe(SESSION_ENTITY_TYPE);
    expect(auditRow.entityId).toBe(w2Session.id);
    const details = parseAuditDetails(auditRow.details);
    expect(details.action).toBe("reassign");
    expect(details.from?.teacherId).toBe(cast.teacher.userId);
    expect(details.to?.teacherId).toBe(cast.secondTeacher.userId);

    // Post-commit waves: one fan-out PER delivery receipt (the engine
    // publish contract) — student, outgoing teacher, incoming teacher, in
    // wave order — spied, never delivered.
    expect(transport.publishCount).toBe(3);
    expect(transport.publishedUserIds).toEqual([
      cast.primaryStudent.userId,
      cast.teacher.userId,
      cast.secondTeacher.userId,
    ]);

    // Each recipient inbox row carries the reassignment wave copy composed
    // in the RECIPIENT own persisted locale (student en, outgoing ar,
    // incoming en).
    expect(await countNotificationsForUser(cast.primaryStudent.userId)).toBe(inboxStudentBefore + 1);
    expect(await countNotificationsForUser(cast.teacher.userId)).toBe(inboxOutgoingBefore + 1);
    expect(await countNotificationsForUser(cast.secondTeacher.userId)).toBe(inboxIncomingBefore + 1);
    const studentInbox = await readInboxFor(cast.primaryStudent.userId);
    const studentWave = studentInbox.find(
      row =>
        row.relatedEntityId === w2Session.id &&
        row.title === notificationTexts("en").eventSessionGovernanceTeacherReassignedTitle
    );
    expect(studentWave).toBeDefined();
    expect(studentWave?.type).toBe(NotificationType.SessionRequest);
    expect(studentWave?.body).toBe(notificationTexts("en").eventSessionGovernanceTeacherReassignedBody);
    const outgoingInbox = await readInboxFor(cast.teacher.userId);
    const outgoingWave = outgoingInbox.find(
      row =>
        row.relatedEntityId === w2Session.id &&
        row.title === notificationTexts("ar").eventSessionGovernanceTeacherReassignedTitle
    );
    expect(outgoingWave).toBeDefined();
    expect(outgoingWave?.body).toBe(notificationTexts("ar").eventSessionGovernanceTeacherReassignedBody);
    const incomingInbox = await readInboxFor(cast.secondTeacher.userId);
    const incomingWave = incomingInbox.find(
      row =>
        row.relatedEntityId === w2Session.id &&
        row.title === notificationTexts("en").eventSessionGovernanceTeacherReassignedTitle
    );
    expect(incomingWave).toBeDefined();
    expect(incomingWave?.body).toBe(notificationTexts("en").eventSessionGovernanceTeacherReassignedBody);

    // No accidental fan-out: every non-participant inbox stays empty.
    expect(await countNotificationsForUser(cast.secondStudent.userId)).toBe(0);
    expect(await countNotificationsForUser(cast.applicant.userId)).toBe(0);
    expect(await countNotificationsForUser(cast.parent.userId)).toBe(0);
  });

  test("step 2 — the student own read shows the NEW teacher; the outgoing teacher read lost the row and the incoming teacher read gained it", async () => {
    const studentPage = await SessionLifecycleService.listMyStudentSessions(
      cast.primaryStudent.userId,
      { status: SessionStatus.Scheduled },
      1,
      25
    );
    const ownRow = listedItemById(studentPage.items, w2Session.id);
    expect(ownRow).toBeDefined();
    expect(ownRow?.teacherId).toBe(cast.secondTeacher.userId);

    const outgoingPage = await SessionLifecycleService.listMyTeacherSessions(
      cast.teacher.userId,
      { status: SessionStatus.Scheduled },
      1,
      25
    );
    expect(listedItemById(outgoingPage.items, w2Session.id)).toBeUndefined();

    const incomingPage = await SessionLifecycleService.listMyTeacherSessions(
      cast.secondTeacher.userId,
      { status: SessionStatus.Scheduled },
      1,
      25
    );
    expect(listedItemById(incomingPage.items, w2Session.id)).toBeDefined();
  });

  test("step 3 — the certification gate: an unapproved candidate is refused with the localized conflict, the row byte-identical, and zero writes", async () => {
    const rowBefore = await readSessionRow(w2Session.id);
    const auditsBefore = await readAuditsForSession(w2Session.id);
    const inboxStudentBefore = await countNotificationsForUser(cast.primaryStudent.userId);
    const inboxOutgoingBefore = await countNotificationsForUser(cast.teacher.userId);
    const inboxIncomingBefore = await countNotificationsForUser(cast.secondTeacher.userId);

    const transport = new SpiedFanoutTransport();
    const denial = await expectJourneyError(() =>
      SessionAdminGovernanceService.reassignTeacher(
        cast.admin.userId,
        { sessionId: w2Session.id, newTeacherUserId: unapprovedTeacherUserId },
        LOCALE,
        undefined,
        emitSpyOptions(transport)
      )
    );

    expect(denial).toBeInstanceOf(ConflictError);
    expect(denial.code).toBe("TEACHER_NOT_CERTIFIED");
    expect(denial.message).toBe(T_ERRORS.teacherNotCertified);

    // The row is byte-identical to its pre-call state, and nothing else
    // moved: no audit row, no wave, no fan-out.
    expect(await readSessionRow(w2Session.id)).toEqual(rowBefore);
    expect(await readAuditsForSession(w2Session.id)).toEqual(auditsBefore);
    expect(await countNotificationsForUser(cast.primaryStudent.userId)).toBe(inboxStudentBefore);
    expect(await countNotificationsForUser(cast.teacher.userId)).toBe(inboxOutgoingBefore);
    expect(await countNotificationsForUser(cast.secondTeacher.userId)).toBe(inboxIncomingBefore);
    expect(transport.publishCount).toBe(0);
  });
});

describe("Journey W-3 — join as observer: exactly-once audit on a live row, zero on a scheduled row", () => {
  test("step 1 — the owning teacher starts the booked session (the live precondition, attributed to the teacher actor)", async () => {
    expect(w3Session.status).toBe(SessionStatus.Scheduled);
    const started = await SessionLifecycleService.startSession(cast.teacher.userId, w3Session.id, LOCALE);
    expect(started.status).toBe(SessionStatus.Started);
    expect((await readSessionRow(w3Session.id)).status).toBe(SessionStatus.Started);

    // The start transition writes no audit row — the join journey owns
    // the whole audit delta for this session.
    expect(await readAuditsForSession(w3Session.id)).toHaveLength(0);
  });

  test("step 2 — the admin joins the STARTED session: exactly ONE join_observe audit row, the participant-equivalent row, no wave", async () => {
    const rowBefore = await readSessionRow(w3Session.id);
    const inboxStudentBefore = await countNotificationsForUser(cast.primaryStudent.userId);
    const inboxTeacherBefore = await countNotificationsForUser(cast.teacher.userId);

    const joined = await SessionAdminGovernanceService.join(cast.admin.userId, { sessionId: w3Session.id }, LOCALE);

    // EXACTLY ONE audit row — the observation contract.
    const auditRows = await readAuditsForSession(w3Session.id);
    expect(auditRows).toHaveLength(1);
    const auditRow = auditRows[0];
    if (!auditRow) {
      throw new Error("journey: expected exactly one audit row for the observation");
    }
    expect(auditRow.actionType).toBe(AuditActionType.Override);
    expect(auditRow.actorId).toBe(cast.admin.userId);
    expect(auditRow.entityType).toBe(SESSION_ENTITY_TYPE);
    expect(auditRow.entityId).toBe(w3Session.id);
    expect(parseAuditDetails(auditRow.details).action).toBe("join_observe");

    // The returned row is the same canonical shape the read paths return
    // (the admin UI renders the read-only live view from it) and the row
    // itself carries ZERO column changes — audit-only operation. Rows read
    // through different executors are compared second-aligned (see the
    // projection helper).
    expect(joined.id).toBe(w3Session.id);
    const detail = await SessionAdminGovernanceService.getDetail(cast.admin.userId, w3Session.id, LOCALE);
    expect(detail).not.toBeNull();
    if (detail) {
      expect(comparableSessionRow(joined)).toEqual(comparableSessionRow(detail));
    }
    expect(await readSessionRow(w3Session.id)).toEqual(rowBefore);

    // Join-as-observer emits NO wave: both participant inboxes unchanged.
    expect(await countNotificationsForUser(cast.primaryStudent.userId)).toBe(inboxStudentBefore);
    expect(await countNotificationsForUser(cast.teacher.userId)).toBe(inboxTeacherBefore);
  });

  test("step 3 — the admin joins a SCHEDULED session: the localized state conflict, zero audit rows, row byte-identical", async () => {
    const rowBefore = await readSessionRow(badgeSessionId);
    expect(rowBefore.status).toBe(SessionStatus.Scheduled);

    const denial = await expectJourneyError(() =>
      SessionAdminGovernanceService.join(cast.admin.userId, { sessionId: badgeSessionId }, LOCALE)
    );

    expect(denial).toBeInstanceOf(ConflictError);
    expect(denial.code).toBe("SESSION_INVALID_TRANSITION");
    expect(denial.message).toBe(T_ERRORS.sessionInvalidTransition);

    // ZERO audit rows for the denied join; the row is untouched.
    expect(await readAuditsForSession(badgeSessionId)).toHaveLength(0);
    expect(await readSessionRow(badgeSessionId)).toEqual(rowBefore);
  });
});

describe("Journey W-4 — the role-denial matrix: every persisted non-admin role and the anonymous caller against every governance operation", () => {
  // Operation-count reconciliation (specs actor table vs the implemented
  // surface): the specs Tier-4/actor-table wording counts SEVEN operations —
  // the six admin-governance operations PLUS resolveSessionDispute, the
  // pre-existing shared admin-gate mutation on the session domain. The
  // implemented governance surface is the SIX functions below; the seventh
  // is used HERE as the byte-identity REFERENCE denial (same gate, same
  // localized copy), not as an extra matrix row.
  const GOVERNANCE_OPERATIONS: readonly {
    readonly name: string;
    readonly call: (actorId: number) => Promise<unknown>;
  }[] = [
    {
      name: "adminSessions",
      call: actorId => SessionAdminGovernanceService.listAll(actorId, {}, 1, 50, LOCALE),
    },
    {
      name: "adminSession",
      call: actorId => SessionAdminGovernanceService.getDetail(actorId, badgeSessionId, LOCALE),
    },
    {
      name: "adminRescheduleSession",
      call: actorId =>
        SessionAdminGovernanceService.reschedule(
          actorId,
          {
            sessionId: badgeSessionId,
            startedAt: new Date(Date.now() + 3_600_000),
            endedAt: new Date(Date.now() + 7_200_000),
          },
          LOCALE
        ),
    },
    {
      name: "adminCancelSession",
      call: actorId => SessionAdminGovernanceService.cancel(actorId, { sessionId: badgeSessionId }, LOCALE, null),
    },
    {
      name: "adminReassignTeacher",
      call: actorId =>
        SessionAdminGovernanceService.reassignTeacher(
          actorId,
          { sessionId: badgeSessionId, newTeacherUserId: cast.secondTeacher.userId },
          LOCALE
        ),
    },
    {
      name: "adminJoinSession",
      call: actorId => SessionAdminGovernanceService.join(actorId, { sessionId: badgeSessionId }, LOCALE),
    },
  ];

  /**
   * The persisted non-admin role vocabulary (`users.role` = {admin,
   * teacher, student, parent}) — three matrix rows. The specs actor table
   * also lists supervisor, which is NOT a persistable user role (it exists
   * only as a permission-group concept; see the 3.1 outcome ledger row),
   * so this matrix is maximal over the real data.
   */
  const nonAdminActors = (): readonly { readonly role: string; readonly userId: number }[] => [
    { role: "teacher", userId: cast.teacher.userId },
    { role: "student", userId: cast.primaryStudent.userId },
    { role: "parent", userId: cast.parent.userId },
  ];

  /** Every cast user id (+ the unapproved teacher) — the inbox oracle. */
  const castInboxUserIds = (): number[] =>
    [
      cast.primaryStudent.userId,
      cast.secondStudent.userId,
      cast.teacher.userId,
      cast.secondTeacher.userId,
      cast.applicant.userId,
      cast.parent.userId,
      cast.admin.userId,
      unapprovedTeacherUserId,
    ].filter(id => id > 0);

  test("step 1 — every persisted non-admin role is denied all six operations, byte-identical to the resolveSessionDispute reference 403", async () => {
    const badgeBefore = await readSessionRow(badgeSessionId);
    const w2Before = await readSessionRow(w2Session.id);
    const auditBaselines = await Promise.all(nonAdminActors().map(actor => countAuditsForActor(actor.userId)));
    const inboxBaselines = await Promise.all(castInboxUserIds().map(id => countNotificationsForUser(id)));

    // The `.map(async ...)` + outer `Promise.all` flattens the entire
    // 3×6 denial matrix into a single top-level `await` (no `await`
    // inside `for` loops). Every call here is a gate denial — the BFLA
    // check runs before any read past the gate and before any write —
    // so the denials are side-effect-free and safe to evaluate together.
    const matrix = await Promise.all(
      nonAdminActors().map(async actor => ({
        actor,
        reference: await expectJourneyError(() =>
          SessionLifecycleService.resolveSessionDispute(
            actor.userId,
            badgeSessionId,
            DisputeResolution.Cancel,
            null,
            LOCALE
          )
        ),
        denials: await Promise.all(
          GOVERNANCE_OPERATIONS.map(async operation => ({
            operation: operation.name,
            error: await expectJourneyError(() => operation.call(actor.userId)),
          }))
        ),
      }))
    );

    expect(matrix.map(entry => entry.actor.role)).toEqual(["teacher", "student", "parent"]);
    for (const { reference, denials } of matrix) {
      // The reference IS the canonical 403: the localized FORBIDDEN copy
      // through the shared admin gate, with zero writes.
      expect(reference).toBeInstanceOf(ForbiddenError);
      expect(reference.code).toBe("FORBIDDEN");
      expect(reference.message).toBe(T_ERRORS.forbidden);

      expect(denials.map(entry => entry.operation)).toEqual(GOVERNANCE_OPERATIONS.map(operation => operation.name));
      for (const { error } of denials) {
        expectDenialByteIdentical(error, reference);
        expect(error.message).toBe(T_ERRORS.forbidden);
      }
    }

    // Zero writes anywhere: both mutation-target rows byte-identical, no
    // audit rows by ANY denied actor, and no inbox movement anywhere in
    // the cast.
    expect(await readSessionRow(badgeSessionId)).toEqual(badgeBefore);
    expect(await readSessionRow(w2Session.id)).toEqual(w2Before);
    const auditsAfter = await Promise.all(nonAdminActors().map(actor => countAuditsForActor(actor.userId)));
    expect(auditsAfter).toEqual(auditBaselines);
    expect(auditsAfter.every(count => count === 0)).toBe(true);
    const inboxesAfter = await Promise.all(castInboxUserIds().map(id => countNotificationsForUser(id)));
    expect(inboxesAfter).toEqual(inboxBaselines);
  });

  test("step 2 — the anonymous caller is denied all six operations with the byte-identical fail-closed denial and zero writes", async () => {
    const badgeBefore = await readSessionRow(badgeSessionId);
    const inboxBaselines = await Promise.all(castInboxUserIds().map(id => countNotificationsForUser(id)));

    // The anonymous reference: actorId 0 — the gate resolves the actor ROW
    // and fails closed FORBIDDEN when it does not exist (the user row is
    // the authority, never a token claim). The wire tier's anonymous 401
    // is the GraphQL scope gate's, ahead of the service; at the service
    // level every anonymous call earns the SAME localized 403 the
    // reference arbitration op's gate applies to a missing row.
    const reference = await expectJourneyError(() => SessionAdminGovernanceService.listAll(0, {}, 1, 50, LOCALE));
    expect(reference).toBeInstanceOf(ForbiddenError);
    expect(reference.code).toBe("FORBIDDEN");
    expect(reference.message).toBe(T_ERRORS.forbidden);

    // The remaining five operations (adminSessions IS the reference) must
    // deny byte-identically.
    const denials = await Promise.all(
      GOVERNANCE_OPERATIONS.slice(1).map(async operation => ({
        operation: operation.name,
        error: await expectJourneyError(() => operation.call(0)),
      }))
    );
    expect(denials.map(entry => entry.operation)).toEqual(
      GOVERNANCE_OPERATIONS.slice(1).map(operation => operation.name)
    );
    for (const { error } of denials) {
      expectDenialByteIdentical(error, reference);
    }

    // Zero writes: the matrix target row untouched, no inbox movement.
    expect(await readSessionRow(badgeSessionId)).toEqual(badgeBefore);
    const inboxesAfter = await Promise.all(castInboxUserIds().map(id => countNotificationsForUser(id)));
    expect(inboxesAfter).toEqual(inboxBaselines);
  });
});
