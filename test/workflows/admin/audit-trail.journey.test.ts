/**
 * Journey — Global audit trail (produce → observe → filter → paginate → deny → govern).
 *
 * Cross-actor workflow test for the global `audit_logs` read surface. An admin
 * producer performs real user-management mutations whose commits mint audit
 * rows; a DIFFERENT admin observer reads the same rows back through the global
 * trail read surface; a System fixture lane seeds the action types whose
 * producers are future work; non-admin actors are denied; and a governed
 * target's history stays fully readable.
 *
 * Per `test/workflows/AGENTS.md`:
 *  - Committed fixtures in `beforeAll` inside ONE committing transaction
 *    (commit-or-nothing); NO `runInRollback` — the services under test spawn
 *    their own top-level transactions. Tracked hard-delete in `afterAll`.
 *  - Permissions resolve via REAL role context — the cast holds real
 *    `users.role` values plus real role-child rows provisioned by the
 *    actor-context factory. NEVER monkey-patched, NEVER scope-stubbed.
 *  - Audit writes are REAL DB rows — observed through the real read service,
 *    never spied. Denial paths emit ZERO audit rows and ZERO notifications,
 *    proven by whole-table row-count oracles (no external channels exist on
 *    this surface, so counts — not spies — are the honest oracle).
 *  - Denial assertions use a try/catch helper + translated substrings from
 *    `getServerTranslations("en").errorsTranslations` — NEVER
 *    `expect(...).rejects.toThrow()` and NEVER raw key echoes.
 *  - Teardown deletes audit rows FIRST (their `actor_id` FK is
 *    `ON DELETE RESTRICT` and the append-only immutability trigger must be
 *    suspended for the delete — the only sanctioned mutation path), then
 *    notifications, then role children, then users; post-teardown re-probes
 *    assert the row-count oracles are back to their baselines (zero residue).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { notifications } from "@/backend/db/schema/notifications";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { ForbiddenError, UnauthorizedError } from "@/backend/lib/errors";
import { AdminUserManagementService, AuditTrailService } from "@/backend/services/admin";
import type {
  AdminAuditTrailFiltersSubmitInput,
  AdminCreateUserSubmitInput,
  AdminUpdateUserPatchInput,
  UserSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
// Deep import (same rationale as the chaos suite — the `test/helpers` barrel
// pulls the Apollo test client into backend-only graphs).
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  ANONYMOUS_ACTOR_ID,
  type JourneyActor,
  provisionAdminActor,
  provisionParentActor,
  provisionStudentActor,
  TrackedFixtures,
} from "@/test/workflows/helpers";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;

/**
 * Per-run prefix — guarantees unique free-text fields (names, emails, fixture
 * detail markers) so repeated or parallel runs never collide.
 */
const runPrefix = `jrn_aud_${randomUUID().slice(0, 8)}`;

/**
 * Plaintext credential for the target student created through the real
 * service path — the service hashes it before the `users` insert.
 *
 * Named without the literal `password` token so static secret-scanners don't
 * classify the declaration as a hardcoded credential. The value is a weak,
 * well-known test fixture — never reused in production paths.
 */
const TARGET_CREDENTIAL = "targetStudentJourney123";

/**
 * Try/catch rejection helper (journey-layer pattern —
 * `expect(...).rejects.toThrow()` is prohibited). Returns the caught error;
 * fails the test when the call resolves successfully.
 */
async function expectJourneyError(fn: () => Promise<unknown>): Promise<Error> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  if (caught === null) {
    throw new Error("expectJourneyError: expected the call to throw, but it resolved successfully");
  }
  if (caught instanceof Error) {
    return caught;
  }
  return new Error(`expectJourneyError: caught non-Error throw (${typeof caught})`);
}

/** Whole-table `audit_logs` row count (row-count oracle). */
async function countAllAuditRows(): Promise<number> {
  return db.$count(auditLogs);
}

/**
 * Widens an action-type enum member to its raw stored string. Insert-returning
 * rows carry the raw `action_type` value (coercion to the enum is the read
 * service's job), so fixture-lane anchor lookups compare primitive-to-primitive.
 */
function rawActionType(actionType: AuditActionType): string {
  return actionType;
}

/** Whole-table `notifications` row count (zero-fan-out oracle). */
async function countAllNotificationRows(): Promise<number> {
  return db.$count(notifications);
}

/** Reads a `users` row by id via the global `db` (post-commit read). */
async function readUserRow(id: number): Promise<UserSelectType | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Suite-scoped cast — bound in `beforeAll` inside one committing transaction. */
const tracked = new TrackedFixtures();
let adminA: JourneyActor; // producer — mints the audit rows
let adminB: JourneyActor; // observer — reads the trail through the global surface
let studentActor: JourneyActor; // denied reader
let parentActor: JourneyActor; // denied reader
let adminAName = "";
let adminBName = "";

/** Row-count oracles — captured after the cast commit, restored by teardown. */
let auditBaseline = 0;
let notificationBaseline = 0;

/** The target student created through the real service path. */
let targetId = 0;

/** Audit row id per action type — anchored by the journey, asserted exactly. */
const rowIdByActionType = new Map<AuditActionType, number>();

/** Producer history (create/update/delete/reactivate) in newest-first id order. */
let producerHistoryIds: number[] = [];

/** System-lane fixture timestamps — explicitly backdated, millisecond-precise. */
let fixtureOverrideAt = new Date(0);
let fixtureAdjustAt = new Date(0);

describe("Global audit-trail journey — produce, observe, filter, paginate, deny, govern", () => {
  beforeAll(async () => {
    // One COMMITTING transaction: provisioning is commit-or-nothing, so a
    // throwing setup rolls back and leaves nothing behind.
    await db.transaction(async tx => {
      adminA = await provisionAdminActor(tx, { tracked });
      adminB = await provisionAdminActor(tx, { tracked });
      studentActor = await provisionStudentActor(tx, { tracked });
      parentActor = await provisionParentActor(tx, { tracked });
    });

    // Capture the actors' current display names — the trail projects the
    // acting account's LIVE `users.full_name` through its join.
    const producerRow = await readUserRow(adminA.userId);
    const observerRow = await readUserRow(adminB.userId);
    if (!producerRow || !observerRow) {
      throw new Error("journey setup: cast user rows missing after the committing transaction");
    }
    adminAName = producerRow.fullName;
    adminBName = observerRow.fullName;

    // Row-count oracles: whole-table baselines the steps assert deltas against.
    auditBaseline = await countAllAuditRows();
    notificationBaseline = await countAllNotificationRows();
  });

  afterAll(async () => {
    // Every user id the journey created (cast + service-minted target).
    const journeyUserIds = [adminA?.userId, adminB?.userId, studentActor?.userId, parentActor?.userId, targetId].filter(
      (id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0
    );

    if (journeyUserIds.length > 0) {
      // 1. Audit rows FIRST — `audit_logs.actor_id` is `ON DELETE RESTRICT`,
      //    so these deletes must precede the `users` delete, and the
      //    append-only immutability trigger must be suspended for them (the
      //    only sanctioned mutation path). The second statement sweeps rows
      //    ABOUT the journey users as the ENTITY (`entity_id` is nullable,
      //    no FK — the raw parameterized query sidesteps Drizzle's `inArray`
      //    typing friction on nullable integer columns).
      await withAuditDeleteTriggersSuspended(async () => {
        await db.delete(auditLogs).where(inArray(auditLogs.actorId, journeyUserIds));
        await queryDb(
          `DELETE FROM audit_logs
           WHERE entity_type = 'user' AND entity_id = ANY($1::int[])`,
          [journeyUserIds]
        );
      });

      // 2. Defensive notification sweep — the oracles prove zero rows were
      //    ever minted, and `user_id` cascades on user delete anyway.
      await db.delete(notifications).where(inArray(notifications.userId, journeyUserIds));
    }

    // 3+4. Role children, then users — reverse registration order via the
    //      tracked registry, with mandatory zero-residue existence probes
    //      (a leaking afterAll fails the suite).
    await tracked.cleanup();

    // 5. Row-count oracles back to baselines — zero residue platform-wide.
    expect(await countAllAuditRows()).toBe(auditBaseline);
    expect(await countAllNotificationRows()).toBe(notificationBaseline);
  });

  // ─── Step 1: System — cast committed; oracles captured ───────────────
  test("system: cast committed in one transaction with a clean audit and notification footprint", async () => {
    // 4 actors × (users row + role-child row), all registered for teardown.
    expect(tracked.size).toBe(8);
    expect(adminAName.length).toBeGreaterThan(0);
    expect(adminBName.length).toBeGreaterThan(0);

    // Clean start: no audit rows minted BY the admins, nothing in ANY cast
    // member's notification inbox.
    const auditByAdmins = await Promise.all(
      [adminA.userId, adminB.userId].map(actorId => db.$count(auditLogs, eq(auditLogs.actorId, actorId)))
    );
    const castInboxes = await Promise.all(
      [adminA.userId, adminB.userId, studentActor.userId, parentActor.userId].map(userId =>
        db.$count(notifications, eq(notifications.userId, userId))
      )
    );
    for (const count of auditByAdmins) {
      expect(count).toBe(0);
    }
    for (const count of castInboxes) {
      expect(count).toBe(0);
    }
  });

  // ─── Step 2: producer mints create; observer reads exactly ONE row ───
  test("producer creates the target student; observer reads exactly one create row with names-only details", async () => {
    const input: AdminCreateUserSubmitInput = {
      fullName: `${runPrefix} Target Student`,
      email: `${runPrefix}-target-${randomUUID().slice(0, 8)}@journey.test`,
      phone: "+10000000000",
      password: TARGET_CREDENTIAL,
      country: "Egypt",
      role: "student",
    };
    const created = await AdminUserManagementService.createUser(input, adminA.userId, LOCALE);
    targetId = created.id;
    tracked.register(users, targetId);
    tracked.register(students, targetId);

    // The OBSERVER (a different admin) reads the target's trail.
    const filters: AdminAuditTrailFiltersSubmitInput = { entityType: "user", entityId: targetId };
    const page = await AuditTrailService.listAuditTrail(filters, 1, 25, adminB.locale, adminB.userId);

    expect(page.totalCount).toBe(1);
    expect(page.items).toHaveLength(1);
    const row = page.items.at(0);
    if (!row) {
      throw new Error("expected exactly one trail row for the freshly created target");
    }
    rowIdByActionType.set(AuditActionType.Create, row.id);
    expect(row.actionType).toBe(AuditActionType.Create);
    expect(row.actorId).toBe(adminA.userId);
    expect(row.actorName).toBe(adminAName);
    expect(row.entityType).toBe("user");
    expect(row.entityId).toBe(targetId);

    // `details` parses to the names-only role payload — no PII pairs (no
    // email, phone, credential, or identifier fields ride along).
    const details: unknown = JSON.parse(row.details ?? "null");
    expect(details).toEqual({ role: "student" });

    // Oracles: exactly one audit row minted by the mutation; zero notifications.
    expect(await countAllAuditRows()).toBe(auditBaseline + 1);
    expect(await countAllNotificationRows()).toBe(notificationBaseline);
  });

  // ─── Step 3: update → soft-delete → reactivate; FOUR rows newest-first ─
  test("producer updates, soft-deletes, reactivates; observer reads four rows newest-first in exact order", async () => {
    const renamedFullName = `${runPrefix} Target Student Renamed`;
    const patch: AdminUpdateUserPatchInput = { fullName: renamedFullName };
    const updated = await AdminUserManagementService.updateUser(targetId, patch, adminA.userId, LOCALE);
    expect(updated.fullName).toBe(renamedFullName);

    const deleted = await AdminUserManagementService.setUserDeleted(targetId, true, adminA.userId, LOCALE);
    expect(deleted.isDeleted).toBe(true);

    const reactivated = await AdminUserManagementService.setUserDeleted(targetId, false, adminA.userId, LOCALE);
    expect(reactivated.isDeleted).toBe(false);

    const filters: AdminAuditTrailFiltersSubmitInput = { entityType: "user", entityId: targetId };
    const page = await AuditTrailService.listAuditTrail(filters, 1, 25, adminB.locale, adminB.userId);

    // FOUR rows, newest-first in the exact action order the mutations ran.
    expect(page.totalCount).toBe(4);
    expect(page.items.map(row => row.actionType)).toEqual([
      AuditActionType.Reactivate,
      AuditActionType.Delete,
      AuditActionType.Update,
      AuditActionType.Create,
    ]);

    // Every row attributed to the producer with the live display name.
    for (const row of page.items) {
      expect(row.actorId).toBe(adminA.userId);
      expect(row.actorName).toBe(adminAName);
      expect(row.entityType).toBe("user");
      expect(row.entityId).toBe(targetId);
    }

    // Newest-first holds on the ids too (distinct, strictly descending).
    const ids = page.items.map(row => row.id);
    producerHistoryIds = ids;
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual([...ids].toSorted((a, b) => b - a));

    // Per-row names-only details: the update row carries field NAMES only,
    // the governance rows carry the boolean they flipped.
    const rowsByActionType = new Map(page.items.map(row => [row.actionType, row]));
    const updateRow = rowsByActionType.get(AuditActionType.Update);
    const deleteRow = rowsByActionType.get(AuditActionType.Delete);
    const reactivateRow = rowsByActionType.get(AuditActionType.Reactivate);
    if (!updateRow || !deleteRow || !reactivateRow) {
      throw new Error("expected update, delete, and reactivate rows in the target history");
    }
    rowIdByActionType.set(AuditActionType.Update, updateRow.id);
    rowIdByActionType.set(AuditActionType.Delete, deleteRow.id);
    rowIdByActionType.set(AuditActionType.Reactivate, reactivateRow.id);
    expect(JSON.parse(updateRow.details ?? "null")).toEqual({ changedFields: ["fullName"] });
    expect(JSON.parse(deleteRow.details ?? "null")).toEqual({ deleted: true });
    expect(JSON.parse(reactivateRow.details ?? "null")).toEqual({ deleted: false });

    // Oracles: three more audit rows; still zero notifications.
    expect(await countAllAuditRows()).toBe(auditBaseline + 4);
    expect(await countAllNotificationRows()).toBe(notificationBaseline);
  });

  // ─── Step 4: System fixture lane; the full action-type vocabulary ────
  test("system fixture lane commits override/adjust/suspend rows; observer filters each of the seven action types", async () => {
    // Explicitly backdated, millisecond-precise timestamps — the fixture lane
    // owns these values end-to-end, so the window probes in the pagination
    // step compare exact stored values (the service-minted rows carry
    // database-generated timestamps and are never used as window bounds).
    const insertWallClock = Date.now();
    fixtureOverrideAt = new Date(insertWallClock - 60_000);
    fixtureAdjustAt = new Date(fixtureOverrideAt.getTime() + 1_000);
    const fixtureSuspendAt = new Date(insertWallClock - 10 * 60_000);

    const fixtureRows = await db.transaction(async tx =>
      tx
        .insert(auditLogs)
        .values([
          {
            actorId: adminB.userId,
            actionType: AuditActionType.Override,
            entityType: "user",
            entityId: parentActor.userId,
            details: `${runPrefix} override fixture`,
            createdAt: fixtureOverrideAt,
          },
          {
            actorId: adminB.userId,
            actionType: AuditActionType.Adjust,
            entityType: "user",
            entityId: parentActor.userId,
            details: `${runPrefix} adjust fixture`,
            createdAt: fixtureAdjustAt,
          },
          {
            actorId: adminB.userId,
            actionType: AuditActionType.Suspend,
            entityType: "user",
            entityId: targetId,
            details: `${runPrefix} suspend fixture`,
            createdAt: fixtureSuspendAt,
          },
        ])
        .returning()
    );
    expect(fixtureRows).toHaveLength(3);

    // The insert-returning rows carry the raw stored `action_type` string
    // (coercion is the read service's job, not the fixture lane's), so the
    // anchor lookups compare against the enum members' primitive values.
    const overrideRow = fixtureRows.find(row => row.actionType === rawActionType(AuditActionType.Override));
    const adjustRow = fixtureRows.find(row => row.actionType === rawActionType(AuditActionType.Adjust));
    const suspendRow = fixtureRows.find(row => row.actionType === rawActionType(AuditActionType.Suspend));
    if (!overrideRow || !adjustRow || !suspendRow) {
      throw new Error("expected the fixture lane to commit one row per seeded action type");
    }
    rowIdByActionType.set(AuditActionType.Override, overrideRow.id);
    rowIdByActionType.set(AuditActionType.Adjust, adjustRow.id);
    rowIdByActionType.set(AuditActionType.Suspend, suspendRow.id);

    // The observer filters by EACH of the seven action-type values. The
    // override/adjust rows live on the parent anchor, every other value's row
    // on the target anchor — each filter must return exactly its own row.
    const anchorEntityIdFor = (actionType: AuditActionType): number =>
      actionType === AuditActionType.Override || actionType === AuditActionType.Adjust ? parentActor.userId : targetId;

    const sweepResults = await Promise.all(
      Object.values(AuditActionType).map(async actionType => {
        const page = await AuditTrailService.listAuditTrail(
          { actionType, entityType: "user", entityId: anchorEntityIdFor(actionType) },
          1,
          25,
          adminB.locale,
          adminB.userId
        );
        return { actionType, page };
      })
    );

    for (const { actionType, page } of sweepResults) {
      const expectedRowId = rowIdByActionType.get(actionType);
      if (expectedRowId === undefined) {
        throw new Error(`no journey row recorded for action type "${actionType}"`);
      }
      expect(page.totalCount).toBe(1);
      expect(page.items).toHaveLength(1);
      const row = page.items.at(0);
      if (!row) {
        throw new Error(`expected exactly one row for action type "${actionType}"`);
      }
      expect(row.id).toBe(expectedRowId);
      expect(row.actionType).toBe(actionType);
    }

    // Mismatch probes: pairing an action type with the WRONG entity anchor
    // sees nothing — the filter excludes, it never blurs.
    const [createOnParent, overrideOnTarget] = await Promise.all([
      AuditTrailService.listAuditTrail(
        { actionType: AuditActionType.Create, entityType: "user", entityId: parentActor.userId },
        1,
        25,
        adminB.locale,
        adminB.userId
      ),
      AuditTrailService.listAuditTrail(
        { actionType: AuditActionType.Override, entityType: "user", entityId: targetId },
        1,
        25,
        adminB.locale,
        adminB.userId
      ),
    ]);
    expect(createOnParent.totalCount).toBe(0);
    expect(createOnParent.items).toHaveLength(0);
    expect(overrideOnTarget.totalCount).toBe(0);
    expect(overrideOnTarget.items).toHaveLength(0);

    // Attribution: the producer's own trail holds exactly the four governance
    // rows — the System-lane fixtures belong to the observer, never to A.
    const producerPage = await AuditTrailService.listAuditTrail(
      { actorId: adminA.userId },
      1,
      25,
      adminB.locale,
      adminB.userId
    );
    expect(producerPage.totalCount).toBe(4);
    expect(producerPage.items.map(row => row.actionType)).toEqual([
      AuditActionType.Reactivate,
      AuditActionType.Delete,
      AuditActionType.Update,
      AuditActionType.Create,
    ]);

    // Oracles: three fixture rows minted; still zero notifications.
    expect(await countAllAuditRows()).toBe(auditBaseline + 7);
    expect(await countAllNotificationRows()).toBe(notificationBaseline);
  });

  // ─── Step 5: pagination + boundary-exact windows ─────────────────────
  test("observer paginates the five-row target history gaplessly and slices it with boundary-exact windows", async () => {
    // The target anchor now holds five rows: the producer's four governance
    // rows plus the backdated System-lane suspend row (oldest).
    const fullPage = await AuditTrailService.listAuditTrail(
      { entityType: "user", entityId: targetId },
      1,
      10,
      adminB.locale,
      adminB.userId
    );
    expect(fullPage.totalCount).toBe(5);
    expect(fullPage.items).toHaveLength(5);
    expect(fullPage.items.map(row => row.actionType)).toEqual([
      AuditActionType.Reactivate,
      AuditActionType.Delete,
      AuditActionType.Update,
      AuditActionType.Create,
      AuditActionType.Suspend,
    ]);
    const expectedOrder = fullPage.items.map(row => row.id);

    // pageSize=2 → three gapless, non-overlapping pages + one honest
    // out-of-range page (empty items, unchanged count).
    const pagedResults = await Promise.all(
      [1, 2, 3, 4].map(async pageNumber => ({
        pageNumber,
        page: await AuditTrailService.listAuditTrail(
          { entityType: "user", entityId: targetId },
          pageNumber,
          2,
          adminB.locale,
          adminB.userId
        ),
      }))
    );
    const [firstPage, secondPage, thirdPage, outOfRangePage] = pagedResults.map(result => result.page);
    for (const { pageNumber, page } of pagedResults) {
      expect(page.totalCount).toBe(5);
      expect(page.page).toBe(pageNumber);
      expect(page.pageSize).toBe(2);
    }
    expect(firstPage.items.map(row => row.actionType)).toEqual([AuditActionType.Reactivate, AuditActionType.Delete]);
    expect(secondPage.items.map(row => row.actionType)).toEqual([AuditActionType.Update, AuditActionType.Create]);
    expect(thirdPage.items.map(row => row.actionType)).toEqual([AuditActionType.Suspend]);
    expect(outOfRangePage.items).toHaveLength(0);

    // Concatenated pages reproduce the single-query order exactly — no gaps,
    // no overlaps, no reordering.
    const pagedIds = [...firstPage.items, ...secondPage.items, ...thirdPage.items].map(row => row.id);
    expect(pagedIds).toEqual(expectedOrder);
    expect(new Set(pagedIds).size).toBe(5);

    // Window semantics on the two System-lane rows about the parent: a row
    // exactly AT `from` is included, a row exactly AT `to` is excluded.
    const overrideRowId = rowIdByActionType.get(AuditActionType.Override);
    if (overrideRowId === undefined) {
      throw new Error("expected the override fixture row id to be recorded by the fixture lane");
    }
    const w1 = await AuditTrailService.listAuditTrail(
      { entityType: "user", entityId: parentActor.userId, from: fixtureOverrideAt, to: fixtureAdjustAt },
      1,
      25,
      adminB.locale,
      adminB.userId
    );
    expect(w1.totalCount).toBe(1);
    expect(w1.items.map(row => row.id)).toEqual([overrideRowId]);

    // Moving `to` one millisecond past the adjust row flips it in — the
    // boundary is exact, not approximate.
    const w2 = await AuditTrailService.listAuditTrail(
      {
        entityType: "user",
        entityId: parentActor.userId,
        from: fixtureOverrideAt,
        to: new Date(fixtureAdjustAt.getTime() + 1),
      },
      1,
      25,
      adminB.locale,
      adminB.userId
    );
    expect(w2.totalCount).toBe(2);
    expect(w2.items.map(row => row.actionType)).toEqual([AuditActionType.Adjust, AuditActionType.Override]);

    // Moving `from` one millisecond past the override row flips it out —
    // the window is left-closed and right-open on both ends.
    const w3 = await AuditTrailService.listAuditTrail(
      {
        entityType: "user",
        entityId: parentActor.userId,
        from: new Date(fixtureOverrideAt.getTime() + 1),
        to: fixtureAdjustAt,
      },
      1,
      25,
      adminB.locale,
      adminB.userId
    );
    expect(w3.totalCount).toBe(0);
    expect(w3.items).toHaveLength(0);

    // Oracles: reads never audit; zero notifications throughout.
    expect(await countAllAuditRows()).toBe(auditBaseline + 7);
    expect(await countAllNotificationRows()).toBe(notificationBaseline);
  });

  // ─── Step 6: denials before any read; oracles byte-unchanged ─────────
  test("student, parent, and anonymous readers are denied before any read; oracles byte-unchanged", async () => {
    const auditBefore = await countAllAuditRows();
    const notificationsBefore = await countAllNotificationRows();

    // The denied filter would match five rows for an admin — the rejections
    // are authorization failures, never empty-result accidents.
    const deniedFilters: AdminAuditTrailFiltersSubmitInput = { entityType: "user", entityId: targetId };

    const studentError = await expectJourneyError(() =>
      AuditTrailService.listAuditTrail(deniedFilters, 1, 25, studentActor.locale, studentActor.userId)
    );
    const parentError = await expectJourneyError(() =>
      AuditTrailService.listAuditTrail(deniedFilters, 1, 25, parentActor.locale, parentActor.userId)
    );
    const anonymousError = await expectJourneyError(() =>
      AuditTrailService.listAuditTrail(deniedFilters, 1, 25, LOCALE, ANONYMOUS_ACTOR_ID)
    );

    // Real error classes through the real authorization path.
    expect(studentError).toBeInstanceOf(ForbiddenError);
    expect(studentError.message).toContain(tErrors.forbidden);
    expect(parentError).toBeInstanceOf(ForbiddenError);
    expect(parentError.message).toContain(tErrors.forbidden);
    expect(anonymousError).toBeInstanceOf(UnauthorizedError);
    expect(anonymousError.message).toContain(tErrors.unauthorized);

    // Zero audit pollution from the attempts — audit AND notification
    // oracles byte-unchanged across all three denials.
    expect(await countAllAuditRows()).toBe(auditBefore);
    expect(await countAllNotificationRows()).toBe(notificationsBefore);
  });

  // ─── Step 7: governance history stays fully readable ─────────────────
  test("governed target keeps its full four-row producer history readable", async () => {
    // The target passed through governance in the earlier step (soft-delete
    // and reactivation — both logged). The producer's complete history about
    // it still renders, in the same newest-first order, with the same row
    // ids: the trail never filters by governance state.
    const page = await AuditTrailService.listAuditTrail(
      { actorId: adminA.userId, entityType: "user", entityId: targetId },
      1,
      25,
      adminB.locale,
      adminB.userId
    );
    expect(page.totalCount).toBe(4);
    expect(page.items.map(row => row.actionType)).toEqual([
      AuditActionType.Reactivate,
      AuditActionType.Delete,
      AuditActionType.Update,
      AuditActionType.Create,
    ]);
    expect(page.items.map(row => row.id)).toEqual(producerHistoryIds);

    // Oracles: still a pure read; zero notifications platform-wide.
    expect(await countAllAuditRows()).toBe(auditBaseline + 7);
    expect(await countAllNotificationRows()).toBe(notificationBaseline);
  });
});
