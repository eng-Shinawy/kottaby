/**
 * AdminBroadcastLifecycleService — service behavior matrix for the read/stop
 * broadcast surface (`listBroadcasts` / `broadcastDetail` / `stopBroadcast`).
 *
 * Every case exercises the REAL lifecycle module against the real test
 * database through the sibling send-path suite's harness discipline:
 *  - every case runs inside `runInRollback` and passes the outer `tx` as the
 *    service's `outerTx` seam — reads and writes participate in the SAME
 *    rolled-back transaction, and the stop's write unit opens a SAVEPOINT
 *    on it;
 *  - header fixtures come from either the send path itself (a real send:
 *    header row + linked notification rows + ONE Create audit row) or
 *    `BroadcastRepository.create` (history-only rows with scripted status /
 *    audience snapshots / sentAt stamps) — never seed data;
 *  - all rejection assertions use `expectRepoError` (try/catch) and pin the
 *    error CONTRACT (class + `extensions.code`) — never translated message
 *    copy, so this suite holds no translation dependency;
 *  - `logger.logDomainError` is silenced-and-recorded per test (tracked spy
 *    registry + file-level `afterEach` restore — bun reuses ONE mock per
 *    object+method pair), so happy paths prove they log NOTHING and every
 *    rejection logs exactly ONE bounded entry;
 *  - every send-path fixture installs the `SpiedFanoutTransport` and the
 *    in-memory claim cache through the service's options seam — no Redis,
 *    no WebSocket frames, ever.
 *
 * Coverage map:
 *  - listBroadcasts: AND-wise status / audienceType / titleSearch filters
 *    (wildcard-shaped search probes stay literal), newest-first ordering
 *    with the id DESC tiebreak, the house page envelope, the honest
 *    out-of-range page, and the FORBIDDEN zero-state for non-admin actors;
 *  - broadcastDetail: known id (header entry + live delivered/read
 *    aggregates of the linked row set), unknown id (BROADCAST_NOT_FOUND),
 *    non-admin (FORBIDDEN — the header read is never consulted);
 *  - stopBroadcast: the one-way active → stopped unit (CAS wins, engine
 *    retract invoked, retracted count returned, header flipped with stopper
 *    + stamp, exactly ONE metadata-only Suspend audit row naming the
 *    header), already-stopped (BROADCAST_ALREADY_STOPPED, zero writes),
 *    unknown id (BROADCAST_NOT_FOUND, zero writes), non-admin (FORBIDDEN,
 *    zero state);
 *  - Tier 3: overlapping stop attempts — exactly one transition lands,
 *    every other attempt observes the Conflict contract, and the header +
 *    audit state stay consistent afterwards.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { BroadcastRepository, NotificationRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { broadcasts } from "@/backend/db/schema/notifications/broadcasts";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { createTestPlan, createTestSubscription, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { BroadcastStatus } from "@/backend/enum/notifications/broadcast-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "@/backend/lib/errors";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import { toAuditActionType } from "@/backend/services/admin/admin-gate.helpers";
import { AdminBroadcastService } from "@/backend/services/notifications/admin-broadcast.service";
import { AdminBroadcastLifecycleService } from "@/backend/services/notifications/admin-broadcast-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import type {
  AdminBroadcastListFilters,
  AdminBroadcastPageReturnType,
  DBTransaction,
  UserSelectType,
} from "@/backend/types";
import { InMemoryClaimCache, SpiedFanoutTransport } from "@/test/workflows/helpers";

const LOCALE = "en";

/** The audit entityType every broadcast lifecycle write carries. */
const AUDIT_ENTITY_TYPE = "notification_broadcast";

/** The related-entity type linking emitted notification rows to their header. */
const BROADCAST_RELATED_ENTITY_TYPE = "broadcast";

/** A user id that cannot exist in the test database. */
const NONEXISTENT_USER_ID = 2_000_000_000;

/** A broadcast header id that cannot exist (identity far beyond any sequence). */
const NONEXISTENT_BROADCAST_ID = 2_000_000_000;

/** The body copy shared by every history-only header fixture. */
const FIXTURE_BODY = "history fixture body copy";

/** Live subscribers provisioned per send-path fixture — the resolved cohort size. */
const FIXTURE_SUBSCRIBER_COUNT = 3;

/** The four-user cast every case provisions (roles only — the gate reads `users.role`). */
interface BroadcastCast {
  readonly admin: UserSelectType;
  readonly teacher: UserSelectType;
  readonly student: UserSelectType;
  readonly parent: UserSelectType;
}

/** One filtered listing probe: the filter surface plus its expected window. */
interface ListProbeCase {
  readonly filters: AdminBroadcastListFilters;
  readonly expectedTitles: readonly string[];
  readonly page: number;
  readonly pageSize: number;
}

type DomainLogSpy = ReturnType<typeof spyOn>;

/**
 * Registry of every spy created during the currently running test. bun's
 * `spyOn` reuses ONE mock per object+method pair until it is restored, so
 * an unrestored mock keeps accumulating `mock.calls` across tests and
 * poisons later call-count assertions — every spy is registered here and
 * restored by the file-level `afterEach`.
 */
const trackedSpies: DomainLogSpy[] = [];

/** Registers a spy for automatic restoration after the current test. */
function trackSpy<T extends DomainLogSpy>(spy: T): T {
  trackedSpies.push(spy);
  return spy;
}

afterEach(() => {
  while (trackedSpies.length > 0) {
    trackedSpies.pop()?.mockRestore();
  }
});

/**
 * Installs a recording stub over `logger.logDomainError`: domain logs never
 * reach test stdout AND every call's code/entity pair becomes assertable.
 * Registered with the tracked-spy registry (restored by `afterEach`).
 */
function recordDomainLogs(): { spy: DomainLogSpy; entries: Array<{ code?: string; entity?: string }> } {
  const entries: Array<{ code?: string; entity?: string }> = [];
  const spy = spyOn(logger, "logDomainError").mockImplementation((_message: string, ctx?: DomainErrorContext) => {
    entries.push({ code: ctx?.code, entity: ctx?.entity });
  });
  trackSpy(spy);
  return { spy, entries };
}

/** Provisions the four-user cast (admin + the three non-admin roles). */
async function provisionCast(tx: DBTransaction): Promise<BroadcastCast> {
  const admin = await createTestUser(tx, { role: "admin" });
  const teacher = await createTestUser(tx, { role: "teacher" });
  const student = await createTestUser(tx, { role: "student" });
  const parent = await createTestUser(tx, { role: "parent" });
  return { admin, teacher, student, parent };
}

/** Calls the listing surface with the suite's locale and the caller's outer tx. */
function callList(
  tx: DBTransaction,
  filters: AdminBroadcastListFilters,
  page: number,
  pageSize: number,
  actorId: number
): Promise<AdminBroadcastPageReturnType> {
  return AdminBroadcastLifecycleService.listBroadcasts(filters, page, pageSize, actorId, LOCALE, tx);
}

/** Calls the detail surface with the suite's locale and the caller's outer tx. */
function callDetail(tx: DBTransaction, broadcastId: number, actorId: number) {
  return AdminBroadcastLifecycleService.broadcastDetail(broadcastId, actorId, LOCALE, tx);
}

/** Calls the stop surface with the suite's locale and the caller's outer tx. */
function callStop(tx: DBTransaction, broadcastId: number, actorId: number) {
  return AdminBroadcastLifecycleService.stopBroadcast(broadcastId, actorId, LOCALE, tx);
}

/** The persisted broadcast header row under one exact title. */
async function headerByTitle(tx: DBTransaction, title: string) {
  const [header] = await tx.select().from(broadcasts).where(eq(broadcasts.title, title));
  if (!header) {
    throw new Error(`expected a broadcasts header row under title ${title}`);
  }
  return header;
}

/** The persisted broadcast header row under one id (the DB oracle). */
async function headerRow(tx: DBTransaction, id: number) {
  const [header] = await tx.select().from(broadcasts).where(eq(broadcasts.id, id));
  if (!header) {
    throw new Error(`expected a broadcasts header row under id ${id}`);
  }
  return header;
}

/** The notification rows still linked to one broadcast header. */
async function linkedRows(tx: DBTransaction, headerId: number) {
  return tx
    .select({ id: notifications.id, userId: notifications.userId, isRead: notifications.isRead })
    .from(notifications)
    .where(
      and(
        eq(notifications.relatedEntityType, BROADCAST_RELATED_ENTITY_TYPE),
        eq(notifications.relatedEntityId, headerId)
      )
    );
}

/**
 * Sends one real broadcast through the send path and returns its header row
 * plus the persisted recipient count — the header fixture for the lifecycle
 * surfaces (the linked notification rows and the send's Create audit row
 * come along with it).
 *
 * The cohort is fixture-scoped: a run-unique plan whose live subscribers are
 * users this test created inside its own rollback transaction. A role-scoped
 * cohort would sweep every live teacher in the shared test database — users
 * owned by concurrently running suites, whose deletion between the audience
 * read and the notification insert would break the recipients' foreign key.
 * The plan cohort resolves to exactly the fixture subscribers, so the
 * recipient count is deterministic and immune to parallel-suite churn.
 */
async function sendBroadcastFixture(tx: DBTransaction, adminId: number, title: string) {
  const plan = await createTestPlan(tx);
  const firstSubscriber = await createTestUser(tx, { role: "student" });
  const secondSubscriber = await createTestUser(tx, { role: "student" });
  const thirdSubscriber = await createTestUser(tx, { role: "student" });
  const startedAt = new Date(Date.now() - 60_000);
  await createTestSubscription(tx, firstSubscriber.id, plan.id, { startDate: startedAt });
  await createTestSubscription(tx, secondSubscriber.id, plan.id, { startDate: startedAt });
  await createTestSubscription(tx, thirdSubscriber.id, plan.id, { startDate: startedAt });

  const recipientCount = await AdminBroadcastService.broadcast(
    { title, body: null, audience: { type: BroadcastAudienceType.Plan, planId: plan.id } },
    adminId,
    LOCALE,
    randomUUID(),
    { transport: new SpiedFanoutTransport(), cache: new InMemoryClaimCache() },
    tx
  );
  expect(recipientCount).toBe(FIXTURE_SUBSCRIBER_COUNT);
  return { header: await headerByTitle(tx, title), recipientCount };
}

/** The broadcast audit rows attributed to one actor (fresh fixtures → zero baseline). */
async function broadcastAuditRowsFor(tx: DBTransaction, actorId: number) {
  return tx
    .select({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actionType: auditLogs.actionType,
      entityId: auditLogs.entityId,
      details: auditLogs.details,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.actorId, actorId), eq(auditLogs.entityType, AUDIT_ENTITY_TYPE)));
}

/** The broadcast audit rows naming one header (the append-only trail oracle). */
async function broadcastAuditRowsForEntity(tx: DBTransaction, entityId: number) {
  return tx
    .select({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actionType: auditLogs.actionType,
      entityId: auditLogs.entityId,
      details: auditLogs.details,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, AUDIT_ENTITY_TYPE), eq(auditLogs.entityId, entityId)));
}

/** Asserts a caught error is a `DomainError` carrying the expected `code`. */
function assertDomainCode(error: Error, expectedCode: string): void {
  expect(error).toBeInstanceOf(DomainError);
  if (!(error instanceof DomainError)) {
    throw new Error("expected a DomainError instance");
  }
  expect(error.code).toBe(expectedCode);
}

/**
 * Recursively probes the filtered listing matrix without await-in-loop:
 * every case must return the house page envelope with exactly its expected
 * window and an honest `totalCount`.
 */
async function probeListCases(
  tx: DBTransaction,
  actorId: number,
  cases: readonly ListProbeCase[],
  index: number
): Promise<void> {
  if (index >= cases.length) {
    return;
  }
  const probeCase = cases[index];
  if (!probeCase) {
    throw new Error(`listing probe case ${index} is missing`);
  }
  const page = await callList(tx, probeCase.filters, probeCase.page, probeCase.pageSize, actorId);
  expect(page.items.map(item => item.title).toSorted((a, b) => a.localeCompare(b))).toEqual(
    probeCase.expectedTitles.toSorted((a, b) => a.localeCompare(b))
  );
  expect(page.totalCount).toBe(probeCase.expectedTitles.length);
  expect(page.page).toBe(probeCase.page);
  expect(page.pageSize).toBe(probeCase.pageSize);
  await probeListCases(tx, actorId, cases, index + 1);
}

describe("AdminBroadcastLifecycleService — list/detail/stop behavior matrix", () => {
  test("listBroadcasts — status / audienceType / titleSearch filters compose AND-wise; wildcard-shaped probes stay literal", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const logs = recordDomainLogs();
      const prefix = `svc_lc_${randomUUID()}`;
      const activeAll = await BroadcastRepository.create(
        {
          title: `${prefix}_all_active`,
          body: FIXTURE_BODY,
          audienceType: BroadcastAudienceType.All,
          recipientCount: 4,
          sentById: cast.admin.id,
        },
        tx
      );
      const activeRole = await BroadcastRepository.create(
        {
          title: `${prefix}_role_active`,
          body: FIXTURE_BODY,
          audienceType: BroadcastAudienceType.Role,
          audienceRole: UserRole.Teacher,
          recipientCount: 2,
          sentById: cast.admin.id,
        },
        tx
      );
      const stoppedCountry = await BroadcastRepository.create(
        {
          title: `${prefix}_country_stopped`,
          body: FIXTURE_BODY,
          audienceType: BroadcastAudienceType.Country,
          audienceCountry: "EG",
          status: BroadcastStatus.Stopped,
          recipientCount: 7,
          sentById: cast.admin.id,
          stoppedById: cast.admin.id,
          stoppedAt: new Date(Date.now() - 60_000),
        },
        tx
      );
      const stoppedAll = await BroadcastRepository.create(
        {
          title: `${prefix}_all_stopped`,
          body: FIXTURE_BODY,
          audienceType: BroadcastAudienceType.All,
          status: BroadcastStatus.Stopped,
          recipientCount: 5,
          sentById: cast.admin.id,
          stoppedById: cast.admin.id,
          stoppedAt: new Date(Date.now() - 30_000),
        },
        tx
      );
      // A literal-percent title and an underscore decoy: if the service ever
      // stopped escaping LIKE wildcards, the `%` probe would sweep the whole
      // fixture set and the `_` probe would also match the decoy.
      const percentTitle = await BroadcastRepository.create(
        {
          title: `${prefix}%wild`,
          body: FIXTURE_BODY,
          audienceType: BroadcastAudienceType.Role,
          audienceRole: UserRole.Teacher,
          recipientCount: 1,
          sentById: cast.admin.id,
        },
        tx
      );
      const underscoreDecoy = await BroadcastRepository.create(
        {
          title: `${prefix}XroleXactive`,
          body: FIXTURE_BODY,
          audienceType: BroadcastAudienceType.Role,
          audienceRole: UserRole.Teacher,
          recipientCount: 3,
          sentById: cast.admin.id,
        },
        tx
      );
      const everything = [activeAll, activeRole, stoppedCountry, stoppedAll, percentTitle, underscoreDecoy].map(
        row => row.title
      );

      const cases: readonly ListProbeCase[] = [
        { filters: { titleSearch: prefix }, page: 1, pageSize: 25, expectedTitles: everything },
        {
          filters: { titleSearch: prefix, status: BroadcastStatus.Active },
          page: 1,
          pageSize: 25,
          expectedTitles: [activeAll.title, activeRole.title, percentTitle.title, underscoreDecoy.title],
        },
        {
          filters: { titleSearch: prefix, status: BroadcastStatus.Stopped },
          page: 1,
          pageSize: 25,
          expectedTitles: [stoppedCountry.title, stoppedAll.title],
        },
        {
          filters: { titleSearch: prefix, audienceType: BroadcastAudienceType.All },
          page: 1,
          pageSize: 25,
          expectedTitles: [activeAll.title, stoppedAll.title],
        },
        {
          filters: { titleSearch: prefix, audienceType: BroadcastAudienceType.Role },
          page: 1,
          pageSize: 25,
          expectedTitles: [activeRole.title, percentTitle.title, underscoreDecoy.title],
        },
        {
          filters: { titleSearch: prefix, status: BroadcastStatus.Stopped, audienceType: BroadcastAudienceType.All },
          page: 1,
          pageSize: 25,
          expectedTitles: [stoppedAll.title],
        },
        {
          filters: { titleSearch: `${prefix}_role` },
          page: 1,
          pageSize: 25,
          expectedTitles: [activeRole.title],
        },
        {
          filters: { titleSearch: `${prefix}%` },
          page: 1,
          pageSize: 25,
          expectedTitles: [percentTitle.title],
        },
      ];
      await probeListCases(tx, cast.admin.id, cases, 0);

      expect(logs.entries).toEqual([]);
      logs.spy.mockRestore();
    });
  });

  test("listBroadcasts — newest-first ordering with the id DESC tiebreak on equal sentAt stamps", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const prefix = `svc_ord_${randomUUID()}`;
      const spec = { body: FIXTURE_BODY, recipientCount: 1, sentById: cast.admin.id };
      const oldest = await BroadcastRepository.create(
        { ...spec, title: `${prefix}_oldest`, sentAt: new Date(Date.now() - 3 * 3_600_000) },
        tx
      );
      const tieStamp = new Date(Date.now() - 2 * 3_600_000);
      const tieLow = await BroadcastRepository.create({ ...spec, title: `${prefix}_tie_low`, sentAt: tieStamp }, tx);
      const tieHigh = await BroadcastRepository.create({ ...spec, title: `${prefix}_tie_high`, sentAt: tieStamp }, tx);
      const newest = await BroadcastRepository.create({ ...spec, title: `${prefix}_newest`, sentAt: new Date() }, tx);

      const page = await callList(tx, { titleSearch: prefix }, 1, 10, cast.admin.id);

      expect(page.totalCount).toBe(4);
      expect(page.items.map(item => item.id)).toEqual([newest.id, tieHigh.id, tieLow.id, oldest.id]);
    });
  });

  test("listBroadcasts — page windows slice newest-first; an out-of-range page is empty with the honest totalCount", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const prefix = `svc_page_${randomUUID()}`;
      const spec = { body: FIXTURE_BODY, recipientCount: 1, sentById: cast.admin.id };
      const oldest = await BroadcastRepository.create(
        { ...spec, title: `${prefix}_oldest`, sentAt: new Date(Date.now() - 2 * 3_600_000) },
        tx
      );
      const middle = await BroadcastRepository.create(
        { ...spec, title: `${prefix}_middle`, sentAt: new Date(Date.now() - 3_600_000) },
        tx
      );
      const newest = await BroadcastRepository.create({ ...spec, title: `${prefix}_newest`, sentAt: new Date() }, tx);

      const firstPage = await callList(tx, { titleSearch: prefix }, 1, 2, cast.admin.id);
      expect(firstPage.page).toBe(1);
      expect(firstPage.pageSize).toBe(2);
      expect(firstPage.totalCount).toBe(3);
      expect(firstPage.items.map(item => item.id)).toEqual([newest.id, middle.id]);

      const secondPage = await callList(tx, { titleSearch: prefix }, 2, 2, cast.admin.id);
      expect(secondPage.page).toBe(2);
      expect(secondPage.totalCount).toBe(3);
      expect(secondPage.items.map(item => item.id)).toEqual([oldest.id]);

      const farPage = await callList(tx, { titleSearch: prefix }, 99, 2, cast.admin.id);
      expect(farPage.items).toEqual([]);
      expect(farPage.totalCount).toBe(3);
      expect(farPage.page).toBe(99);
      expect(farPage.pageSize).toBe(2);
    });
  });

  test("listBroadcasts — non-admin and unknown actors → FORBIDDEN with the listing query never consulted", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const fixture = await BroadcastRepository.create(
        { title: `svc_denied_${randomUUID()}`, body: FIXTURE_BODY, recipientCount: 1, sentById: cast.admin.id },
        tx
      );
      const logs = recordDomainLogs();
      const listSpy = trackSpy(spyOn(BroadcastRepository, "list"));
      const countSpy = trackSpy(spyOn(BroadcastRepository, "count"));
      const auditBefore = await broadcastAuditRowsFor(tx, cast.admin.id);
      const filters: AdminBroadcastListFilters = { titleSearch: `svc_denied_probe_${randomUUID()}` };

      const teacherError = await expectRepoError(() => callList(tx, filters, 1, 25, cast.teacher.id));
      expect(teacherError).toBeInstanceOf(ForbiddenError);
      assertDomainCode(teacherError, "FORBIDDEN");
      const studentError = await expectRepoError(() => callList(tx, filters, 1, 25, cast.student.id));
      expect(studentError).toBeInstanceOf(ForbiddenError);
      assertDomainCode(studentError, "FORBIDDEN");
      const parentError = await expectRepoError(() => callList(tx, filters, 1, 25, cast.parent.id));
      expect(parentError).toBeInstanceOf(ForbiddenError);
      assertDomainCode(parentError, "FORBIDDEN");
      const missingError = await expectRepoError(() => callList(tx, filters, 1, 25, NONEXISTENT_USER_ID));
      expect(missingError).toBeInstanceOf(ForbiddenError);
      assertDomainCode(missingError, "FORBIDDEN");

      expect(listSpy).not.toHaveBeenCalled();
      expect(countSpy).not.toHaveBeenCalled();
      expect(await broadcastAuditRowsFor(tx, cast.admin.id)).toEqual(auditBefore);
      const header = await headerRow(tx, fixture.id);
      expect(header.status).toBe(BroadcastStatus.Active);
      expect(logs.entries).toEqual([
        { code: "FORBIDDEN", entity: "user" },
        { code: "FORBIDDEN", entity: "user" },
        { code: "FORBIDDEN", entity: "user" },
        { code: "FORBIDDEN", entity: "user" },
      ]);
      logs.spy.mockRestore();
    });
  });

  test("broadcastDetail — known id: the header entry plus the live delivered/read aggregates of the linked row set", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const logs = recordDomainLogs();
      const title = `svc_detail_${randomUUID()}`;
      const fixture = await sendBroadcastFixture(tx, cast.admin.id, title);
      const rows = await linkedRows(tx, fixture.header.id);
      expect(rows).toHaveLength(fixture.recipientCount);
      expect(rows.length).toBeGreaterThan(0);
      const readRow = rows[0];
      if (!readRow) {
        throw new Error("fixture: expected at least one linked notification row");
      }
      expect(await NotificationRepository.markReadOnce(readRow.id, readRow.userId, tx)).not.toBeNull();

      const detail = await callDetail(tx, fixture.header.id, cast.admin.id);

      expect(detail.entry.id).toBe(fixture.header.id);
      expect(detail.entry.title).toBe(title);
      expect(detail.entry.status).toBe(BroadcastStatus.Active);
      expect(detail.entry.recipientCount).toBe(fixture.recipientCount);
      expect(detail.entry.audienceType).toBe(BroadcastAudienceType.Plan);
      expect(detail.entry.sentById).toBe(cast.admin.id);
      expect(detail.entry.sentByName).toBe(cast.admin.fullName);
      expect(detail.entry.stoppedById).toBeNull();
      expect(detail.entry.stoppedByName).toBeNull();
      expect(detail.entry.stoppedAt).toBeNull();
      expect(detail.liveDeliveredCount).toBe(rows.length);
      expect(detail.liveReadCount).toBe(1);
      expect(logs.entries).toEqual([]);
      logs.spy.mockRestore();
    });
  });

  test("broadcastDetail — unknown id → the NotFound contract; non-admin actors → FORBIDDEN with the header read never consulted", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const fixture = await sendBroadcastFixture(tx, cast.admin.id, `svc_detail_missing_${randomUUID()}`);
      const logs = recordDomainLogs();
      const findByIdSpy = trackSpy(spyOn(BroadcastRepository, "findById"));

      const unknownError = await expectRepoError(() => callDetail(tx, NONEXISTENT_BROADCAST_ID, cast.admin.id));
      expect(unknownError).toBeInstanceOf(NotFoundError);
      assertDomainCode(unknownError, "BROADCAST_NOT_FOUND");
      expect(findByIdSpy).toHaveBeenCalledTimes(1);
      expect(findByIdSpy.mock.calls[0]?.[0]).toBe(NONEXISTENT_BROADCAST_ID);

      const teacherError = await expectRepoError(() => callDetail(tx, fixture.header.id, cast.teacher.id));
      expect(teacherError).toBeInstanceOf(ForbiddenError);
      assertDomainCode(teacherError, "FORBIDDEN");
      const studentError = await expectRepoError(() => callDetail(tx, fixture.header.id, cast.student.id));
      expect(studentError).toBeInstanceOf(ForbiddenError);
      assertDomainCode(studentError, "FORBIDDEN");
      const parentError = await expectRepoError(() => callDetail(tx, fixture.header.id, cast.parent.id));
      expect(parentError).toBeInstanceOf(ForbiddenError);
      assertDomainCode(parentError, "FORBIDDEN");
      const missingError = await expectRepoError(() => callDetail(tx, fixture.header.id, NONEXISTENT_USER_ID));
      expect(missingError).toBeInstanceOf(ForbiddenError);
      assertDomainCode(missingError, "FORBIDDEN");

      // Denials never reached the header read: exactly the ONE lookup from
      // the not-found probe above.
      expect(findByIdSpy.mock.calls).toHaveLength(1);
      const header = await headerRow(tx, fixture.header.id);
      expect(header.status).toBe(BroadcastStatus.Active);
      expect(await linkedRows(tx, fixture.header.id)).toHaveLength(fixture.recipientCount);
      expect(logs.entries).toEqual([
        { code: "BROADCAST_NOT_FOUND", entity: "notifications" },
        { code: "FORBIDDEN", entity: "user" },
        { code: "FORBIDDEN", entity: "user" },
        { code: "FORBIDDEN", entity: "user" },
        { code: "FORBIDDEN", entity: "user" },
      ]);
      logs.spy.mockRestore();
    });
  });

  test("stopBroadcast — happy path: CAS wins, engine retract invoked, retracted count returned, header flipped, ONE Suspend audit row", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const title = `svc_stop_${randomUUID()}`;
      const fixture = await sendBroadcastFixture(tx, cast.admin.id, title);
      const linkedBefore = await linkedRows(tx, fixture.header.id);
      expect(linkedBefore).toHaveLength(fixture.recipientCount);
      expect(linkedBefore.length).toBeGreaterThan(0);
      const retractSpy = trackSpy(spyOn(NotificationEngine, "retractByRelatedEntity"));
      const logs = recordDomainLogs();

      const retracted = await callStop(tx, fixture.header.id, cast.admin.id);

      expect(retractSpy).toHaveBeenCalledTimes(1);
      expect(retractSpy.mock.calls[0]?.[0]).toBe(BROADCAST_RELATED_ENTITY_TYPE);
      expect(retractSpy.mock.calls[0]?.[1]).toBe(fixture.header.id);
      expect(retracted).toBe(linkedBefore.length);

      const header = await headerRow(tx, fixture.header.id);
      expect(header.status).toBe(BroadcastStatus.Stopped);
      expect(header.stoppedById).toBe(cast.admin.id);
      expect(header.stoppedAt).toBeInstanceOf(Date);

      expect(await linkedRows(tx, fixture.header.id)).toHaveLength(0);

      const auditRows = await broadcastAuditRowsForEntity(tx, fixture.header.id);
      expect(auditRows.filter(row => toAuditActionType(row.actionType) === AuditActionType.Create)).toHaveLength(1);
      const suspendRows = auditRows.filter(row => toAuditActionType(row.actionType) === AuditActionType.Suspend);
      expect(suspendRows).toHaveLength(1);
      const suspendRow = suspendRows[0];
      if (!suspendRow) {
        throw new Error("expected exactly one Suspend audit row for the stopped broadcast");
      }
      expect(suspendRow.actorId).toBe(cast.admin.id);
      const metadata: unknown = JSON.parse(suspendRow.details ?? "{}");
      expect(metadata).toEqual({ recipientCount: fixture.recipientCount, retractedCount: retracted });
      expect(suspendRow.details).not.toContain(title);

      const detail = await callDetail(tx, fixture.header.id, cast.admin.id);
      expect(detail.liveDeliveredCount).toBe(0);
      expect(detail.liveReadCount).toBe(0);
      expect(detail.entry.recipientCount).toBe(fixture.recipientCount);
      expect(detail.entry.status).toBe(BroadcastStatus.Stopped);

      // Happy paths log NOTHING.
      expect(logs.entries).toEqual([]);
      logs.spy.mockRestore();
    });
  });

  test("stopBroadcast — already stopped → the Conflict contract with zero writes", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const fixture = await sendBroadcastFixture(tx, cast.admin.id, `svc_conflict_${randomUUID()}`);
      const firstCount = await callStop(tx, fixture.header.id, cast.admin.id);
      const headerAfterFirst = await headerRow(tx, fixture.header.id);
      const auditAfterFirst = await broadcastAuditRowsForEntity(tx, fixture.header.id);
      expect(firstCount).toBeGreaterThan(0);
      expect(headerAfterFirst.status).toBe(BroadcastStatus.Stopped);
      expect(auditAfterFirst.filter(row => toAuditActionType(row.actionType) === AuditActionType.Suspend)).toHaveLength(
        1
      );

      const retractSpy = trackSpy(spyOn(NotificationEngine, "retractByRelatedEntity"));
      const logs = recordDomainLogs();

      const error = await expectRepoError(() => callStop(tx, fixture.header.id, cast.admin.id));

      expect(error).toBeInstanceOf(ConflictError);
      assertDomainCode(error, "BROADCAST_ALREADY_STOPPED");
      expect(retractSpy).not.toHaveBeenCalled();
      const headerAfterSecond = await headerRow(tx, fixture.header.id);
      expect(headerAfterSecond.status).toBe(BroadcastStatus.Stopped);
      expect(headerAfterSecond.stoppedById).toBe(headerAfterFirst.stoppedById);
      expect(headerAfterSecond.stoppedAt?.getTime()).toBe(headerAfterFirst.stoppedAt?.getTime());
      expect(await linkedRows(tx, fixture.header.id)).toHaveLength(0);
      expect(await broadcastAuditRowsForEntity(tx, fixture.header.id)).toEqual(auditAfterFirst);
      expect(logs.entries).toEqual([{ code: "BROADCAST_ALREADY_STOPPED", entity: "notifications" }]);
      logs.spy.mockRestore();
    });
  });

  test("stopBroadcast — unknown id → the NotFound contract with zero writes", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const fixture = await sendBroadcastFixture(tx, cast.admin.id, `svc_stop_missing_${randomUUID()}`);
      const auditBefore = await broadcastAuditRowsFor(tx, cast.admin.id);
      const retractSpy = trackSpy(spyOn(NotificationEngine, "retractByRelatedEntity"));
      const logs = recordDomainLogs();

      const error = await expectRepoError(() => callStop(tx, NONEXISTENT_BROADCAST_ID, cast.admin.id));

      expect(error).toBeInstanceOf(NotFoundError);
      assertDomainCode(error, "BROADCAST_NOT_FOUND");
      expect(retractSpy).not.toHaveBeenCalled();
      expect(await broadcastAuditRowsFor(tx, cast.admin.id)).toEqual(auditBefore);
      const header = await headerRow(tx, fixture.header.id);
      expect(header.status).toBe(BroadcastStatus.Active);
      expect(header.stoppedById).toBeNull();
      expect(logs.entries).toEqual([{ code: "BROADCAST_NOT_FOUND", entity: "notifications" }]);
      logs.spy.mockRestore();
    });
  });

  test("stopBroadcast — non-admin and unknown actors → FORBIDDEN with zero state", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const fixture = await sendBroadcastFixture(tx, cast.admin.id, `svc_stop_denied_${randomUUID()}`);
      const auditBefore = await broadcastAuditRowsFor(tx, cast.admin.id);
      const transitionSpy = trackSpy(spyOn(BroadcastRepository, "transitionToStopped"));
      const retractSpy = trackSpy(spyOn(NotificationEngine, "retractByRelatedEntity"));
      const logs = recordDomainLogs();

      const teacherError = await expectRepoError(() => callStop(tx, fixture.header.id, cast.teacher.id));
      expect(teacherError).toBeInstanceOf(ForbiddenError);
      assertDomainCode(teacherError, "FORBIDDEN");
      const studentError = await expectRepoError(() => callStop(tx, fixture.header.id, cast.student.id));
      expect(studentError).toBeInstanceOf(ForbiddenError);
      assertDomainCode(studentError, "FORBIDDEN");
      const parentError = await expectRepoError(() => callStop(tx, fixture.header.id, cast.parent.id));
      expect(parentError).toBeInstanceOf(ForbiddenError);
      assertDomainCode(parentError, "FORBIDDEN");
      const missingError = await expectRepoError(() => callStop(tx, fixture.header.id, NONEXISTENT_USER_ID));
      expect(missingError).toBeInstanceOf(ForbiddenError);
      assertDomainCode(missingError, "FORBIDDEN");

      expect(transitionSpy).not.toHaveBeenCalled();
      expect(retractSpy).not.toHaveBeenCalled();
      const header = await headerRow(tx, fixture.header.id);
      expect(header.status).toBe(BroadcastStatus.Active);
      expect(header.stoppedById).toBeNull();
      expect(header.stoppedAt).toBeNull();
      expect(await linkedRows(tx, fixture.header.id)).toHaveLength(fixture.recipientCount);
      expect(await broadcastAuditRowsFor(tx, cast.admin.id)).toEqual(auditBefore);
      expect(logs.entries).toEqual([
        { code: "FORBIDDEN", entity: "user" },
        { code: "FORBIDDEN", entity: "user" },
        { code: "FORBIDDEN", entity: "user" },
        { code: "FORBIDDEN", entity: "user" },
      ]);
      logs.spy.mockRestore();
    });
  });

  test("Tier 3 — overlapping stop attempts: exactly one transition lands, every racer gets the Conflict contract, header state stays consistent", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const fixture = await sendBroadcastFixture(tx, cast.admin.id, `svc_race_${randomUUID()}`);
      const linkedBefore = await linkedRows(tx, fixture.header.id);
      expect(linkedBefore).toHaveLength(fixture.recipientCount);
      expect(linkedBefore.length).toBeGreaterThan(0);

      // The winning stop completes its whole unit (CAS + retraction + audit)
      // before the racers fire: all attempts share ONE executor here, so a
      // racer's savepoint rollback must never straddle the winner's
      // transition — the racers overlap each other on the same substrate
      // the production pool would give them across connections.
      const winnerCount = await callStop(tx, fixture.header.id, cast.admin.id);
      expect(winnerCount).toBe(linkedBefore.length);

      const settled = await Promise.allSettled([
        callStop(tx, fixture.header.id, cast.admin.id),
        callStop(tx, fixture.header.id, cast.admin.id),
      ]);

      const losers = settled.filter(outcome => outcome.status === "rejected");
      expect(losers).toHaveLength(2);
      for (const loser of losers) {
        expect(loser.status).toBe("rejected");
        if (loser.status !== "rejected") {
          throw new Error("expected the losing stop attempt to reject");
        }
        expect(loser.reason).toBeInstanceOf(ConflictError);
        assertDomainCode(loser.reason, "BROADCAST_ALREADY_STOPPED");
      }

      const header = await headerRow(tx, fixture.header.id);
      expect(header.status).toBe(BroadcastStatus.Stopped);
      expect(header.stoppedById).toBe(cast.admin.id);
      expect(header.stoppedAt).toBeInstanceOf(Date);
      expect(await linkedRows(tx, fixture.header.id)).toHaveLength(0);

      const auditRows = await broadcastAuditRowsForEntity(tx, fixture.header.id);
      const suspendRows = auditRows.filter(row => toAuditActionType(row.actionType) === AuditActionType.Suspend);
      expect(suspendRows).toHaveLength(1);
      const suspendRow = suspendRows[0];
      if (!suspendRow) {
        throw new Error("expected exactly one Suspend audit row after the stop race");
      }
      const metadata: unknown = JSON.parse(suspendRow.details ?? "{}");
      expect(metadata).toEqual({ recipientCount: fixture.recipientCount, retractedCount: winnerCount });
    });
  });
});
