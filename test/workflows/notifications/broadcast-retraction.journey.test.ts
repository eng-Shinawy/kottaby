/**
 * Journey — Admin broadcast retraction cross-actor workflow (history entry,
 * detail live stats, one-way stop with recipient retraction, stop audit
 * trail).
 *
 * Cross-actor journey through the REAL service layer against the real test
 * database: Admin A sends a broadcast to the teacher cohort, observes it in
 * the broadcast history (status active, honest recipient count) and in the
 * detail view (live delivered/read aggregates), a recipient observes the row
 * unread in his own inbox, non-admin and anonymous callers are denied with
 * zero state, the admin stops the broadcast (engine-mediated retraction),
 * the recipient's row disappears and his unread count self-corrects, re-stop
 * and unknown-id probes hit the honest conflict/not-found contracts, and the
 * audit trail carries exactly ONE Suspend row naming the broadcast.
 *
 * The lifecycle steps (history, detail, stop) exercise the service's real
 * read/stop surface directly on the REAL service export — the same
 * admin-gated, transaction-disciplined entry points the GraphQL layer
 * dispatches through:
 *
 *   listBroadcasts(
 *     filters: AdminBroadcastListFilters,   // closed filter surface
 *     page: number,                         // 1-based
 *     pageSize: number,                     // clamped by the service
 *     actorId: number,                      // real `users.id` (0 = anonymous)
 *     locale: string,                       // actor locale ("en")
 *   ): Promise<AdminBroadcastPageReturnType>
 *
 *   broadcastDetail(
 *     broadcastId: number,                  // the history entry id
 *     actorId: number,
 *     locale: string,
 *   ): Promise<AdminBroadcastDetailReturnType>  // entry + live aggregates
 *
 *   stopBroadcast(
 *     broadcastId: number,
 *     actorId: number,
 *     locale: string,
 *   ): Promise<number>                      // retracted row count
 *
 * Step map (ordered steps 1–10 — binding 1:1):
 *   0. System: committed fixture cast (A/T/N/Pa); every inbox empty
 *   1. Admin A sends → history entry (status active, honest recipientCount,
 *      sentByName via the SQL join) + N notification rows linked to the
 *      header + ONE Create audit row (entityId = header id, metadata only)
 *   2. Recipient opens his inbox → the broadcast row, unread, linked to the
 *      header (relatedEntityType/Id set)
 *   3. Admin opens detail → live delivered/read counts reflect actual reads
 *      (the recipient marks the row read engine-side first)
 *   4. Non-admin list/detail/stop → FORBIDDEN, zero state; anonymous →
 *      UNAUTHORIZED (denial oracle; no existence leak pre-gate)
 *   5. Admin stops → retracted count returned, rows retracted
 *      engine-mediated; recipient row gone, unread count self-corrects
 *   6. Re-stop the same broadcast → conflict (broadcastAlreadyStopped),
 *      zero writes
 *   7. Unknown broadcast id → not found (broadcastNotFound) on stop and
 *      detail, zero state
 *   8. Audit trail: exactly ONE Suspend row, entityId = header id, metadata
 *      only ({recipientCount, retractedCount} — never copy text)
 *   9. History lists the stopped broadcast (Stopped badge, stop metadata,
 *      run-unique title + status filter) and the recipient feed stays clean
 *
 * Journey rules (test/workflows/AGENTS.md) honored:
 * - fixtures COMMITTED in `beforeAll` inside one committing transaction
 *   (commit-or-nothing) and hard-deleted in `afterAll` via `TrackedFixtures`
 *   with post-teardown existence checks; never `runInRollback`;
 * - `audit_logs` rows are trigger-immutable and never registered in
 *   `TrackedFixtures` — they are deleted by id under
 *   `withAuditDeleteTriggersSuspended` and proven absent afterwards;
 * - actors provisioned by the actor-context factory — REAL `users` rows plus
 *   REAL role-child rows, so every denial resolves through the genuine
 *   authorization path (never monkey-patched permission resolution);
 * - the fan-out transport is SPIED at the service's injection seam
 *   (`SpiedFanoutTransport` as `options.transport`) and the idempotency
 *   claim cache is the shared in-memory stand-in injected as `options.cache`
 *   — no Redis, no WebSocket frames, no email/SMS/push, ever;
 * - sequential actor-attributed steps in declaration order; every service
 *   call carries the acting user's real id;
 * - cross-actor visibility asserted both ways: the recipient observes the
 *   send AND the retraction, every other cast member's inbox stays
 *   byte-identical, and denial probes fail oracle-safely through the real
 *   authorization path.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { broadcasts } from "@/backend/db/schema/notifications/broadcasts";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { users } from "@/backend/db/schema/users/users";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { BroadcastStatus } from "@/backend/enum/notifications/broadcast-status.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "@/backend/lib/errors";
import { AdminBroadcastService } from "@/backend/services/notifications/admin-broadcast.service";
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import type {
  AdminBroadcastPageReturnType,
  BroadcastNotificationSubmitInput,
  NotificationListFilterInput,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
// Deep import (same rationale as journey-cleanup — the test/helpers barrel
// pulls the Apollo test client into backend-only graphs).
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  InMemoryClaimCache,
  type JourneyActor,
  provisionAdminActor,
  provisionCertifiedTeacherActor,
  provisionParentActor,
  provisionStudentActor,
  SpiedFanoutTransport,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/** Per-run unique prefix so repeated or parallel runs never collide. */
const runPrefix = `jrn_broadcast_retract_${randomUUID().slice(0, 8)}`;

/**
 * Broadcast copy — the title embeds the run prefix, so the fired broadcast
 * is uniquely identifiable in the shared database (other suites and seeded
 * rows can never collide with it) and the DB serves as the row-level oracle
 * for "exactly the rows this broadcast created".
 */
const BROADCAST_TITLE = `${runPrefix}: Exam-week announcement pending retraction`;
const BROADCAST_BODY = `${runPrefix}: This announcement is stopped and retracted from every recipient during the journey.`;

/** The audit entityType the service writes for every accepted broadcast. */
const AUDIT_ENTITY_TYPE = "notification_broadcast";

/** The related-entity type linking every emitted notification row to its header. */
const BROADCAST_RELATED_ENTITY_TYPE = "broadcast";

/** Shared inbox window — every recipient list read uses the same first page. */
const INBOX_PAGE: NotificationListFilterInput = { limit: 50, offset: 0 };

/** English translated copy — denial assertions pin translated substrings, never hardcoded English. */
const EN_ERRORS = getServerTranslations("en").errorsTranslations;

/** Idempotency key — UUID v4 per compose-session, mirroring the gateway header. */
const BROADCAST_KEY = randomUUID();

/** A broadcast id that cannot exist (header id far beyond any sequence). */
const NONEXISTENT_BROADCAST_ID = 2_000_000_000;

/** One persisted broadcast audit row, as the journey reads it back. */
interface BroadcastAuditRow {
  readonly id: number;
  readonly actorId: number;
  readonly actionType: string;
  readonly entityType: string;
  readonly entityId: number | null;
  readonly details: string | null;
}

/**
 * Try/catch rejection helper (journey-layer pattern —
 * `expect(...).rejects.toThrow()` is prohibited). Returns the caught error;
 * fails the test when the call resolves successfully.
 */
async function expectJourneyError(fn: () => Promise<unknown>): Promise<Error> {
  let errorCaught: unknown = null;
  try {
    await fn();
  } catch (error) {
    errorCaught = error;
  }
  if (errorCaught === null) {
    throw new Error("expected the call to throw, but it resolved successfully");
  }
  if (errorCaught instanceof Error) {
    return errorCaught;
  }
  return new Error(`[non-Error throw: ${typeof errorCaught}]`);
}

/**
 * Assertion + type-guard in one step: narrows `value` to the constructor's
 * instance type after the bun:test instanceof check (type-guard discipline
 * per docs/quality/linting-rules.md — no unsafe `as` narrowing).
 */
function expectInstanceOf<T extends abstract new (...args: never) => object>(
  value: unknown,
  ctor: T
): asserts value is InstanceType<T> {
  expect(value).toBeInstanceOf(ctor);
}

/** JSON-object guard (docs/quality/linting-rules.md — no-unsafe-type-assertion). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses one audit row's JSON details into its metadata object. */
function parseAuditDetails(details: string | null): Record<string, unknown> {
  const parsed: unknown = JSON.parse(details ?? "{}");
  if (!isRecord(parsed)) {
    throw new Error("audit details must be a JSON object");
  }
  return parsed;
}

/** Direct repo-less inbox row count for one recipient. */
async function inboxRowCount(userId: number): Promise<number> {
  return db.$count(notifications, eq(notifications.userId, userId));
}

/** The persisted broadcast rows (id + recipient) created under one run-unique title. */
async function broadcastRowsByTitle(title: string): Promise<readonly { id: number; userId: number }[]> {
  return db
    .select({ id: notifications.id, userId: notifications.userId })
    .from(notifications)
    .where(eq(notifications.title, title));
}

/**
 * The notification rows still linked to one header through the related-
 * entity pair — the DB oracle for "exactly the rows this broadcast created"
 * and for the retraction's completeness.
 */
async function linkedRowCount(headerId: number): Promise<number> {
  return db.$count(
    notifications,
    and(eq(notifications.relatedEntityType, BROADCAST_RELATED_ENTITY_TYPE), eq(notifications.relatedEntityId, headerId))
  );
}

/**
 * The audit rows written so far for broadcast-entity actions by one actor.
 * Callers keep a known-id set and treat only the diff as "new" — robust
 * against any pre-existing broadcast audit rows in the shared test database.
 */
async function broadcastAuditRows(actorId: number): Promise<readonly BroadcastAuditRow[]> {
  return db
    .select({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actionType: auditLogs.actionType,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      details: auditLogs.details,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.actorId, actorId), eq(auditLogs.entityType, AUDIT_ENTITY_TYPE)));
}

describe("Journey — Admin broadcast retraction cross-actor workflow (history → detail → stop → audit)", () => {
  const tracked = new TrackedFixtures();
  const transportSpy = new SpiedFanoutTransport();
  const claimCache = new InMemoryClaimCache();

  /** Injection seam installed on every broadcast send call in this journey. */
  const callOptions = { transport: transportSpy, cache: claimCache };

  /** Audit row ids already attributed to this journey (baseline + captured). */
  const knownAuditIds = new Set<number>();

  let adminA: JourneyActor;
  let teacherR: JourneyActor;
  let studentN: JourneyActor;
  let parentN2: JourneyActor;
  let adminAName = "";

  /** Recipient count returned by the send (the stop must retract exactly it). */
  let broadcastRecipientCount = 0;

  /** The broadcast header id, captured from the history listing. */
  let broadcastId: number | undefined;

  /** The recipient's notification row id, captured from his inbox listing. */
  let recipientRowId: number | undefined;

  /**
   * Journey-state guard: the broadcast's header id is captured from the
   * history listing in an earlier step; a later step failing before that
   * capture reports it instead of dispatching a garbage id.
   */
  function requireBroadcastId(): number {
    if (broadcastId === undefined) {
      throw new Error("journey state missing: the broadcast header id was never captured (an earlier step failed)");
    }
    return broadcastId;
  }

  /**
   * Journey-state guard: the recipient's notification row id is captured
   * from his inbox listing in an earlier step; same failure honesty as
   * `requireBroadcastId`.
   */
  function requireRecipientRowId(): number {
    if (recipientRowId === undefined) {
      throw new Error(
        "journey state missing: the recipient notification row id was never captured (an earlier step failed)"
      );
    }
    return recipientRowId;
  }

  beforeAll(async () => {
    // One COMMITTING transaction: provisioning is commit-or-nothing, so a
    // throwing setup rolls back and leaves nothing behind.
    await db.transaction(async tx => {
      adminA = await provisionAdminActor(tx, { tracked });
      teacherR = await provisionCertifiedTeacherActor(tx, { tracked });
      studentN = await provisionStudentActor(tx, { tracked });
      parentN2 = await provisionParentActor(tx, { tracked });

      // The sender's display name is captured for the history/detail
      // join assertions (sentByName/stoppedByName resolve CURRENT
      // users.full_name — never a snapshot).
      const [senderRow] = await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, adminA.userId));
      if (!senderRow) {
        throw new Error("fixture: the sender's users row is missing after provisioning");
      }
      adminAName = senderRow.fullName;
    });
  });

  afterAll(async () => {
    // Audit-row deletes run under the trigger-suspension wrapper (migrate-
    // provisioned databases install an append-only immutability trigger on
    // audit_logs); the wrapper restores every trigger's exact prior state.
    // audit_logs is trigger-immutable and never registered in TrackedFixtures
    // — the journey's audit rows are deleted by id here, then proven absent.
    await withAuditDeleteTriggersSuspended(async () => {
      if (knownAuditIds.size > 0) {
        await db.delete(auditLogs).where(inArray(auditLogs.id, [...knownAuditIds]));
        const auditResidue = await db.$count(auditLogs, inArray(auditLogs.id, [...knownAuditIds]));
        expect(auditResidue).toBe(0);
      }

      // TrackedFixtures hard-deletes in REVERSE registration order — the
      // notification rows first, role-children → users last (FK-safe by
      // construction) — and re-probes EVERY registered row so zero residue
      // is load-bearing, not advisory.
      const registered = [...tracked.records];
      const report = await tracked.cleanup();
      expect(report.deletedCount).toBe(registered.length);
      expect(report.verifiedAbsentCount).toBe(registered.length);
      const stillPresent = await Promise.all(registered.map(record => tracked.exists(record)));
      expect(stillPresent.every(present => !present)).toBe(true);
    });
  });

  /** Registers every notification row created under `title` for teardown. */
  async function trackBroadcastRows(title: string): Promise<void> {
    const rows = await broadcastRowsByTitle(title);
    for (const row of rows) {
      tracked.register(notifications, row.id);
    }
  }

  /**
   * Captures the audit rows the service just wrote (diff against the
   * known-id baseline) and registers them for the teardown sweep.
   */
  async function captureNewAuditRows(): Promise<readonly BroadcastAuditRow[]> {
    const rows = await broadcastAuditRows(adminA.userId);
    const fresh = rows.filter(row => !knownAuditIds.has(row.id));
    for (const row of fresh) {
      knownAuditIds.add(row.id);
    }
    return fresh;
  }

  /**
   * The admin's history read for this journey's broadcasts — the run-unique
   * title filter keeps the page deterministic in the shared database.
   */
  async function listJourneyBroadcasts(actorId: number, locale: string): Promise<AdminBroadcastPageReturnType> {
    return AdminBroadcastService.listBroadcasts({ titleSearch: runPrefix }, 1, 25, actorId, locale);
  }

  /** Asserts the per-actor inbox row counts in one parallel sweep. */
  async function expectInboxCounts(expectations: readonly (readonly [JourneyActor, number])[]): Promise<void> {
    const counts = await Promise.all(expectations.map(([actor]) => inboxRowCount(actor.userId)));
    expectations.forEach(([, expected], index) => {
      expect(counts[index]).toBe(expected);
    });
  }

  test("step 0 — System: committed fixture cast; every inbox empty", async () => {
    // 4 actors × (users row + role-child row).
    expect(tracked.size).toBe(8);
    await expectInboxCounts([
      [adminA, 0],
      [teacherR, 0],
      [studentN, 0],
      [parentN2, 0],
    ]);
    expect(transportSpy.publishCount).toBe(0);
  });

  test("step 1 — Admin sends: history entry (active, honest recipient count) + linked rows + ONE Create audit row", async () => {
    const input: BroadcastNotificationSubmitInput = {
      title: BROADCAST_TITLE,
      body: BROADCAST_BODY,
      audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher },
    };

    const count = await AdminBroadcastService.broadcast(
      input,
      adminA.userId,
      adminA.locale,
      BROADCAST_KEY,
      callOptions
    );
    await trackBroadcastRows(BROADCAST_TITLE);
    const sendAudit = await captureNewAuditRows();

    // DB oracle: the returned count is the persisted recipient count —
    // exactly the rows the broadcast created (run-unique title), at least
    // the journey's teacher recipient.
    const rows = await broadcastRowsByTitle(BROADCAST_TITLE);
    broadcastRecipientCount = rows.length;
    expect(count).toBe(rows.length);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some(row => row.userId === teacherR.userId)).toBe(true);

    const page = await listJourneyBroadcasts(adminA.userId, adminA.locale);
    expect(page.totalCount).toBe(1);
    const entry = page.items.find(item => item.title === BROADCAST_TITLE);
    if (!entry) {
      throw new Error("expected the history to list the fresh broadcast");
    }
    broadcastId = entry.id;
    // The header row is a send side effect; registering it keeps teardown
    // FK-safe (broadcasts.sent_by_id restricts on user deletion).
    tracked.register(broadcasts, entry.id);
    expect(entry.status).toBe(BroadcastStatus.Active);
    expect(entry.recipientCount).toBe(broadcastRecipientCount);
    expect(entry.sentById).toBe(adminA.userId);
    expect(entry.sentByName).toBe(adminAName);
    expect(entry.stoppedById).toBeNull();
    expect(entry.stoppedByName).toBeNull();
    expect(entry.stoppedAt).toBeNull();

    // Every emitted row is linked to its header through the existing
    // polymorphic related-entity pair.
    expect(await linkedRowCount(requireBroadcastId())).toBe(broadcastRecipientCount);

    // The send audit row: exactly ONE, Create action, entityId = the header
    // id, metadata only (scope + role + recipient count — never copy text).
    expect(sendAudit).toHaveLength(1);
    const auditRow = sendAudit[0];
    if (!auditRow) {
      throw new Error("expected exactly one send audit row for the fresh broadcast");
    }
    const expectedActionType: string = AuditActionType.Create;
    expect(auditRow.actionType).toBe(expectedActionType);
    expect(auditRow.actorId).toBe(adminA.userId);
    expect(auditRow.entityId).toBe(requireBroadcastId());
    const metadata = parseAuditDetails(auditRow.details);
    expect(metadata.scope).toBe(BroadcastAudienceType.Role);
    expect(metadata.recipientCount).toBe(broadcastRecipientCount);
    expect(metadata.role).toBe(UserRole.Teacher);
    expect(JSON.stringify(metadata)).not.toContain(BROADCAST_TITLE);

    // Exactly ONE spied fan-out envelope carrying the FULL recipient list.
    expect(transportSpy.publishCount).toBe(1);
    const publish = transportSpy.lastCall;
    if (!publish) {
      throw new Error("expected the spied transport to record the broadcast publish");
    }
    expect([...publish.userIds].toSorted((a, b) => a - b)).toEqual(
      rows.map(row => row.userId).toSorted((a, b) => a - b)
    );
    expect(publish.payload.data.type).toBe(NotificationType.SystemBroadcast);
    expect(publish.payload.data.title).toBe(BROADCAST_TITLE);
    expect(publish.payload.data.relatedEntityType).toBe(BROADCAST_RELATED_ENTITY_TYPE);
    expect(publish.payload.data.relatedEntityId).toBe(requireBroadcastId());
  });

  test("step 2 — Recipient observes the broadcast row unread in his own inbox, linked to the header", async () => {
    const page = await NotificationEngine.listMyNotifications(teacherR.userId, INBOX_PAGE, teacherR.locale);
    const item = page.items.find(row => row.title === BROADCAST_TITLE);
    if (!item) {
      throw new Error("expected the recipient's inbox to contain the broadcast row");
    }
    recipientRowId = item.id;
    expect(page.totalCount).toBe(1);
    expect(page.hasMore).toBe(false);
    expect(item.type).toBe(NotificationType.SystemBroadcast);
    expect(item.body).toBe(BROADCAST_BODY);
    expect(item.isRead).toBe(false);
    // The recipient-side view of the linkage pair: the row is linked to its
    // broadcast header.
    expect(item.relatedEntityType).toBe(BROADCAST_RELATED_ENTITY_TYPE);
    expect(item.relatedEntityId).toBe(requireBroadcastId());
    // The recipient's unread count is derived from the live row set.
    expect(await NotificationEngine.getMyUnreadCount(teacherR.userId, teacherR.locale)).toBe(1);
  });

  test("step 3 — Admin opens detail: live delivered/read stats reflect actual reads", async () => {
    // The recipient reads his own broadcast row engine-side (the engine owns
    // the is-read flip — the single-writer invariant holds in the journey
    // too).
    await NotificationEngine.markRead(teacherR.userId, requireRecipientRowId(), teacherR.locale);

    const detail = await AdminBroadcastService.broadcastDetail(requireBroadcastId(), adminA.userId, adminA.locale);
    const rows = await broadcastRowsByTitle(BROADCAST_TITLE);
    expect(detail.entry.id).toBe(requireBroadcastId());
    expect(detail.entry.status).toBe(BroadcastStatus.Active);
    // LIVE aggregates over the CURRENT linked rows: every row is still
    // linked and exactly the journey's recipient has read it.
    expect(detail.liveDeliveredCount).toBe(broadcastRecipientCount);
    expect(detail.liveDeliveredCount).toBe(rows.length);
    expect(detail.liveReadCount).toBe(1);
    expect(detail.entry.recipientCount).toBe(broadcastRecipientCount);
  });

  test("step 4 — Non-admin list/detail/stop: FORBIDDEN zero state; anonymous: UNAUTHORIZED", async () => {
    const rowsBefore = await broadcastRowsByTitle(BROADCAST_TITLE);
    const auditBefore = (await broadcastAuditRows(adminA.userId)).length;
    const publishCountBefore = transportSpy.publishCount;

    // Non-admin probes flow through the REAL authorization path (the
    // service's admin gate resolves the actor's real users row — never
    // monkey-patched) and deny pre-transaction with the honest FORBIDDEN
    // contract. Stop is probed with BOTH the real broadcast id and an
    // unknown id: a gate that leaked existence would differentiate them.
    const denialProbes: readonly (() => Promise<unknown>)[] = [
      () => AdminBroadcastService.listBroadcasts({ titleSearch: runPrefix }, 1, 25, teacherR.userId, teacherR.locale),
      () => AdminBroadcastService.listBroadcasts({}, 1, 25, studentN.userId, studentN.locale),
      () => AdminBroadcastService.broadcastDetail(requireBroadcastId(), parentN2.userId, parentN2.locale),
      () => AdminBroadcastService.stopBroadcast(requireBroadcastId(), studentN.userId, studentN.locale),
      () => AdminBroadcastService.stopBroadcast(NONEXISTENT_BROADCAST_ID, parentN2.userId, parentN2.locale),
    ];
    const denials = await Promise.all(denialProbes.map(probe => expectJourneyError(probe)));
    for (const error of denials) {
      expectInstanceOf(error, ForbiddenError);
      expect(error.code).toBe("FORBIDDEN");
      expect(error.message).toContain(EN_ERRORS.forbidden);
    }

    // Anonymous probes (actorId=0): UNAUTHORIZED, same pre-resolver wall.
    const anonymousProbes: readonly (() => Promise<unknown>)[] = [
      () => AdminBroadcastService.listBroadcasts({}, 1, 25, 0, "en"),
      () => AdminBroadcastService.broadcastDetail(requireBroadcastId(), 0, "en"),
      () => AdminBroadcastService.stopBroadcast(requireBroadcastId(), 0, "en"),
    ];
    const anonymous = await Promise.all(anonymousProbes.map(probe => expectJourneyError(probe)));
    for (const error of anonymous) {
      expectInstanceOf(error, UnauthorizedError);
      expect(error.code).toBe("UNAUTHORIZED");
      expect(error.message).toContain(EN_ERRORS.unauthorized);
    }

    // Zero state: no rows, no audit, no publish, and every cast member's
    // inbox byte-identical after the denials (no cross-actor leakage).
    expect(await broadcastRowsByTitle(BROADCAST_TITLE)).toHaveLength(rowsBefore.length);
    expect(await broadcastAuditRows(adminA.userId)).toHaveLength(auditBefore);
    expect(transportSpy.publishCount).toBe(publishCountBefore);
    await expectInboxCounts([
      [adminA, 0],
      [teacherR, 1],
      [studentN, 0],
      [parentN2, 0],
    ]);
  });

  test("step 5 — Admin stops: retracted count returned, rows retracted, unread self-corrects", async () => {
    const rowsBefore = await broadcastRowsByTitle(BROADCAST_TITLE);
    const retracted = await AdminBroadcastService.stopBroadcast(requireBroadcastId(), adminA.userId, adminA.locale);

    // The retracted count is exactly the row count the stop deleted.
    expect(retracted).toBe(broadcastRecipientCount);
    expect(retracted).toBe(rowsBefore.length);

    // Every linked row is gone (engine-mediated retraction; the DB is the
    // oracle) — the recipient's row no longer exists.
    expect(await broadcastRowsByTitle(BROADCAST_TITLE)).toHaveLength(0);
    expect(await linkedRowCount(requireBroadcastId())).toBe(0);

    // The recipient's unread count self-corrects from the live row set — no
    // counter patching.
    expect(await NotificationEngine.getMyUnreadCount(teacherR.userId, teacherR.locale)).toBe(0);

    // The stop is DB-level: no realtime retraction push (already-delivered
    // envelopes are not un-published).
    expect(transportSpy.publishCount).toBe(1);
  });

  test("step 6 — Re-stop the same broadcast: conflict, zero writes", async () => {
    const auditBefore = (await broadcastAuditRows(adminA.userId)).length;
    const publishCountBefore = transportSpy.publishCount;

    const error = await expectJourneyError(() =>
      AdminBroadcastService.stopBroadcast(requireBroadcastId(), adminA.userId, adminA.locale)
    );
    expectInstanceOf(error, ConflictError);
    expect(error.code).toBe("BROADCAST_ALREADY_STOPPED");

    // Zero writes: no second audit row, no row deletion attempt, no publish.
    expect(await broadcastAuditRows(adminA.userId)).toHaveLength(auditBefore);
    expect(await linkedRowCount(requireBroadcastId())).toBe(0);
    expect(transportSpy.publishCount).toBe(publishCountBefore);
  });

  test("step 7 — Unknown broadcast id: not found on stop and detail, zero state", async () => {
    const auditBefore = (await broadcastAuditRows(adminA.userId)).length;
    const publishCountBefore = transportSpy.publishCount;

    const stopError = await expectJourneyError(() =>
      AdminBroadcastService.stopBroadcast(NONEXISTENT_BROADCAST_ID, adminA.userId, adminA.locale)
    );
    expectInstanceOf(stopError, NotFoundError);
    expect(stopError.code).toBe("BROADCAST_NOT_FOUND");

    const detailError = await expectJourneyError(() =>
      AdminBroadcastService.broadcastDetail(NONEXISTENT_BROADCAST_ID, adminA.userId, adminA.locale)
    );
    expectInstanceOf(detailError, NotFoundError);
    expect(detailError.code).toBe("BROADCAST_NOT_FOUND");

    // Zero state: denials write nothing and expose no partial state.
    expect(await broadcastAuditRows(adminA.userId)).toHaveLength(auditBefore);
    expect(transportSpy.publishCount).toBe(publishCountBefore);
  });

  test("step 8 — Audit trail: exactly ONE Suspend row naming the broadcast, metadata only", async () => {
    const fresh = await captureNewAuditRows();
    expect(fresh).toHaveLength(1);
    const row = fresh[0];
    if (!row) {
      throw new Error("expected exactly one stop audit row for the journey's stop");
    }
    const expectedActionType: string = AuditActionType.Suspend;
    expect(row.actionType).toBe(expectedActionType);
    expect(row.actorId).toBe(adminA.userId);
    expect(row.entityType).toBe(AUDIT_ENTITY_TYPE);
    expect(row.entityId).toBe(requireBroadcastId());
    // Metadata only: recipient + retracted counts, NEVER copy text and never
    // recipient identifiers.
    const metadata = parseAuditDetails(row.details);
    expect(metadata.recipientCount).toBe(broadcastRecipientCount);
    expect(metadata.retractedCount).toBe(broadcastRecipientCount);
    expect(JSON.stringify(metadata)).not.toContain(BROADCAST_TITLE);
    expect(JSON.stringify(metadata)).not.toContain(BROADCAST_BODY);

    // Whole-journey audit ledger: exactly ONE Create (the send) + ONE
    // Suspend (the stop), nothing for denials.
    expect(knownAuditIds.size).toBe(2);
  });

  test("step 9 — History reflects the stopped lifecycle; the recipient feed stays clean", async () => {
    const page = await AdminBroadcastService.listBroadcasts(
      { titleSearch: runPrefix, status: BroadcastStatus.Stopped },
      1,
      25,
      adminA.userId,
      adminA.locale
    );
    expect(page.totalCount).toBe(1);
    const entry = page.items.find(item => item.title === BROADCAST_TITLE);
    if (!entry) {
      throw new Error("expected the history to list the stopped broadcast");
    }
    expect(entry.id).toBe(requireBroadcastId());
    expect(entry.status).toBe(BroadcastStatus.Stopped);
    expect(entry.stoppedById).toBe(adminA.userId);
    expect(entry.stoppedByName).toBe(adminAName);
    expect(entry.stoppedAt).not.toBeNull();
    expect(entry.recipientCount).toBe(broadcastRecipientCount);

    // The stopped broadcast's live stats are zero (rows retracted); the
    // recorded recipient count preserves the original reach.
    const detail = await AdminBroadcastService.broadcastDetail(requireBroadcastId(), adminA.userId, adminA.locale);
    expect(detail.liveDeliveredCount).toBe(0);
    expect(detail.liveReadCount).toBe(0);

    // The recipient's feed stays clean after the retraction.
    const inbox = await NotificationEngine.listMyNotifications(teacherR.userId, INBOX_PAGE, teacherR.locale);
    expect(inbox.totalCount).toBe(0);
    expect(inbox.items.some(item => item.title === BROADCAST_TITLE)).toBe(false);
  });
});
