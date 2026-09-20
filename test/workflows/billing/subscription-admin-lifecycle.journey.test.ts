/**
 * Journey — admin-subscription-lifecycle (cross-actor subscription lifecycle
 * through the real gated admin surface).
 *
 * One shared entity — one student's Hifz subscription — travels the full
 * admin-owned lifecycle across three REAL actors (a producer admin, the
 * owning student, an unrelated student):
 *
 *  | Step | Actor            | Action                                            | Shared state                                   | Side effects                     |
 *  |------|------------------|---------------------------------------------------|------------------------------------------------|----------------------------------|
 *  | 1    | System           | provision student (lane=4 on active Hifz sub S), admin, unrelated student | fixtures | tracked ids registered           |
 *  | 2    | Admin            | extend S +30d                                     | `end_date += 30d` exactly                      | 1 audit row (Update)             |
 *  | 3    | Student          | reads own subscriptions                           | sees the extended window                       | none                             |
 *  | 4    | Admin            | cancel S                                          | status cancelled; lane untouched               | 1 audit row (Suspend)            |
 *  | 5    | Student          | lane preserved                                    | booking would still be allowed IF balance > 0  | none                             |
 *  | 6    | System           | insert expired S2 + drain the lane                | fixtures                                       | tracked                          |
 *  | 7    | Admin            | renew S2                                          | new active S3; lane += plan.sessionCount; junction row | claim row + audit Create |
 *  | 8    | Admin            | renew S2 again (replay)                           | NOTHING new; returns S3                        | second call reads the claim      |
 *  | 9    | Admin            | plan-change S3 → smaller plan                     | S3 cancelled; S4 active on the new plan; lane settles to the new count (excess forfeited) | claim row + audit Override |
 *  | 10   | (denial) Student | tries adminCancelSubscription on own row          | 403 FORBIDDEN, zero mint                       | none                             |
 *  | 11   | (BOLA) Other student | reads adminStudentSubscriptions(otherStudentId) | 403 before touch, no rows leaked             | none                             |
 *
 * NOTIFICATIONS: this feature deliberately emits NO notifications — no step
 * in the lifecycle fans out to any channel. The `NotificationEngine`
 * publish boundary is spied for the WHOLE journey and asserted ZERO
 * dispatches (the absence is the contract, so a future stray publish fails
 * this suite loudly).
 *
 * Per `test/workflows/AGENTS.md`:
 *  - Committed fixtures in `beforeAll` inside ONE committing transaction
 *    (commit-or-nothing); NO `runInRollback` — the services under test spawn
 *    their own top-level transactions. Mid-journey System steps (the step-6
 *    fixture arrangement) commit their own small transaction the same way.
 *  - Real actors only: the cast holds real `users` rows plus real role-child
 *    rows provisioned by the actor-context factory. NEVER monkey-patched,
 *    NEVER scope-stubbed — the denial steps fail through the genuine
 *    `assertActorAdmin` gate.
 *  - Tracked hard-delete in `afterAll` (audit rows swept FIRST — `actor_id`
 *    is ON DELETE RESTRICT and the append-only immutability trigger must be
 *    suspended for the delete — then the user-led `deleteUsersByIds` sweep,
 *    then the tracked registry in FK-safe reverse order), with mandatory
 *    post-teardown zero-residue probes.
 *  - Denial assertions use the `catchJourneyError` try/catch helper +
 *    translated substrings from `getServerTranslations("en").errorsTranslations`
 *    — NEVER `expect(...).rejects.toThrow()` and never raw key echoes.
 *  - Audit rows are REAL DB rows observed through a light audit query helper
 *    (row-per-action shape: verb, entity anchor, actor, EXACT `details`
 *    contract) — never spied, never stubbed.
 *  - Per-run `jrn_billing_<8hex>` prefix keeps repeated or parallel runs
 *    collision-free; a second consecutive green run proves teardown totality.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { SubscriptionRepository } from "@/backend/db/repo/billing/subscription.repository";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { createTestPlan, createTestSubscription } from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { ProrationDirection } from "@/backend/enum/billing/proration-direction.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { ForbiddenError } from "@/backend/lib/errors";
import { SUBSCRIPTION_ADMIN_CLAIM_PREFIXES } from "@/backend/services/billing/subscription-admin.helpers";
import { SubscriptionAdminService } from "@/backend/services/billing/subscription-admin.service";
import { planChangeClaimKey } from "@/backend/services/billing/subscription-plan-change.replay.helpers";
import { SubscriptionPurchaseService } from "@/backend/services/billing/subscription-purchase.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type { SubscriptionSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { countUsersByIds, deleteUsersByIds, withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  type JourneyActor,
  journeyPrefix,
  provisionAdminActor,
  provisionStudentActor,
  TrackedFixtures,
} from "@/test/workflows/helpers";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;

/** Milliseconds per day — the window arithmetic the journey pins exactly. */
const MS_PER_DAY = 86_400_000;

/**
 * Per-run prefix — `jrn_billing_<8hex>`; every fixture name and the cancel
 * reason embed it so repeated or parallel runs never collide.
 */
const runPrefix = journeyPrefix("billing");

/** The run-unique cancel reason — the trail's only free text on this surface. */
const CANCEL_REASON = `${runPrefix} admin billing adjustment`;

/** The audit row's entity anchor for subscription lifecycle actions. */
const SUBSCRIPTION_ENTITY = "subscription";

/**
 * Widened audit verbs — the raw stored `action_type` value is a pgEnum
 * string union, so expectations compare primitive-to-primitive (annotated
 * `string` consts, no enum-type friction).
 */
const UPDATE_VERB: string = AuditActionType.Update;
const SUSPEND_VERB: string = AuditActionType.Suspend;
const CREATE_VERB: string = AuditActionType.Create;
const OVERRIDE_VERB: string = AuditActionType.Override;

/**
 * Widened lifecycle statuses for the same reason (audit `details` carry the
 * raw stored strings).
 */
const ACTIVE_STATUS: string = SubscriptionStatus.Active;
const CANCELLED_STATUS: string = SubscriptionStatus.Cancelled;

/**
 * Fixture plans — same Hifz lane; the target's strictly smaller per-session
 * unit value (25.00 → 12.50) pins the Downgrade direction on the step-9
 * plan change without any price arithmetic ambiguity.
 */
const SOURCE_PLAN_SESSION_COUNT = 8;
const SOURCE_PLAN_PRICE = "200.00";
const SOURCE_PLAN_INTERVAL_DAYS = 30;
const SMALLER_PLAN_SESSION_COUNT = 4;
const SMALLER_PLAN_PRICE = "50.00";
const SMALLER_PLAN_INTERVAL_DAYS = 30;

/** The student's seeded Hifz lane at provisioning (step 1: lane=4 remaining). */
const LANE_SEED = 4;
/** The step-2 extension length. */
const EXTEND_DAYS = 30;
/** The renewal credit = the source plan's full session count (step 7). */
const RENEW_CREDIT = SOURCE_PLAN_SESSION_COUNT;
/**
 * The forfeited excess on the step-9 downgrade: the drained lane held
 * exactly the renewal credit (the seed was drained to 0 in step 6), so the
 * forfeited excess equals the credit exactly and the lane settles to the
 * smaller plan's session count.
 */
const EXCESS_FORFEITED = RENEW_CREDIT;
/** The settled lane value after the downgrade = the smaller plan's session count. */
const SETTLED_LANE = SMALLER_PLAN_SESSION_COUNT;

/**
 * The active subscription's window — whole-second UTC instants (lossless ms
 * round trips on every provider).
 */
const S_START = new Date("2030-01-01T00:00:00.000Z");
const S_END = new Date("2030-01-31T00:00:00.000Z");
const S_EXTENDED_END = new Date(S_END.getTime() + EXTEND_DAYS * MS_PER_DAY);
/**
 * The expired source's window is anchored to the RUN's clock (90 and 120
 * days back) so the row is genuinely past-dated in any environment — the
 * renewal premise holds wherever the suite runs.
 */
const RUN_ANCHOR_MS = Date.now();
const S2_START = new Date(RUN_ANCHOR_MS - 120 * MS_PER_DAY);
const S2_END = new Date(RUN_ANCHOR_MS - 90 * MS_PER_DAY);

/** Fresh-window read skew tolerance for service-minted rows (now-anchored). */
const FRESH_WINDOW_SKEW_MS = 60_000;

/**
 * The notification publish boundary — spied for the WHOLE journey. The
 * feature emits NO notifications by design, so the spy is a zero-dispatch
 * oracle: any call at any step fails the suite. Restored in `afterAll`.
 */
const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});

/** Suite-scoped fixture registry — every committed row and service-minted row. */
const tracked = new TrackedFixtures();

/** Suite-scoped cast — bound in `beforeAll` inside one committing transaction. */
let admin: JourneyActor; // producer — executes every admin action
let student: JourneyActor; // the subscription's owner
let otherStudent: JourneyActor; // unrelated cast member (BOLA probe)

/** Fixture + service-minted entity anchors, bound during the steps. */
let sourcePlanId: number;
let smallerPlanId: number;
let sId: number; // S — the active Hifz subscription (extend → cancel)
let s2Id: number; // S2 — the expired source (renew → replay)
let s3Id: number; // S3 — the renewal's fresh period (plan-change source)
let s4Id: number; // S4 — the plan-change's fresh period

/** The owner's lane baseline as provisioned (step 5 compares byte-identically). */
let baselineLanes: StudentLanes | null = null;

/** The owner's four balance lanes as stored (nullable columns, trial notNull). */
interface StudentLanes {
  readonly hifz: number | null;
  readonly tajweed: number | null;
  readonly reviews: number | null;
  readonly trial: number;
}

/** One audit row projected to the fields the journey pins. */
interface SubscriptionAuditRow {
  readonly id: number;
  readonly actorId: number;
  readonly actionType: string;
  readonly entityType: string;
  readonly entityId: number | null;
  readonly details: string | null;
}

/** JSON-object guard (plain-record type guard for audit `details` payloads). */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses an audit row's `details` payload into a plain JSON object. */
function parseAuditDetails(row: SubscriptionAuditRow): Record<string, unknown> {
  const parsed: unknown = JSON.parse(row.details ?? "null");
  if (!isPlainRecord(parsed)) {
    throw new Error(`journey: audit row ${row.id} details payload is not a JSON object`);
  }
  return parsed;
}

/** Reads one subscription row raw (the read-back oracle for service effects). */
async function readSubscriptionRow(subscriptionId: number): Promise<SubscriptionSelectType> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: no subscription row for id ${subscriptionId}`);
  }
  return row;
}

/** Reads a student's four balance lanes (the byte-identical lane oracle). */
async function readStudentLanes(studentId: number): Promise<StudentLanes> {
  const rows = await db
    .select({
      hifz: students.balanceHifz,
      tajweed: students.balanceTajweed,
      reviews: students.balanceReviews,
      trial: students.balanceTrial,
    })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: no student row for id ${studentId}`);
  }
  return row;
}

/** Narrows the lane baseline (a missing baseline is a step-ordering bug). */
function requireBaselineLanes(): StudentLanes {
  if (!baselineLanes) {
    throw new Error("journey: the lane baseline was never captured in setup");
  }
  return baselineLanes;
}

/** Counts audit rows minted BY one actor (zero-mint oracle for denials). */
async function countAuditRowsForActor(actorId: number): Promise<number> {
  return db.$count(auditLogs, eq(auditLogs.actorId, actorId));
}

/** Counts audit rows anchored on one entity (row-per-action oracle). */
async function countAuditRowsForEntity(entityType: string, entityId: number): Promise<number> {
  return db.$count(auditLogs, and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)));
}

/** Reads the audit rows anchored on one subscription, oldest first. */
async function readSubscriptionAuditRows(subscriptionId: number): Promise<SubscriptionAuditRow[]> {
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
    .where(and(eq(auditLogs.entityType, SUBSCRIPTION_ENTITY), eq(auditLogs.entityId, subscriptionId)))
    .orderBy(auditLogs.id);
}

/** Reads the idempotency claims pointing at one subscription (oldest first). */
async function readClaimsForSubscription(subscriptionId: number): Promise<SubscriptionAuditRow["id"][]> {
  const rows = await db
    .select({ id: subscriptionPurchaseIdempotency.id })
    .from(subscriptionPurchaseIdempotency)
    .where(eq(subscriptionPurchaseIdempotency.subscriptionId, subscriptionId))
    .orderBy(subscriptionPurchaseIdempotency.id);
  return rows.map(row => row.id);
}

/** Counts ALL claims owned by one user (replay zero-mint oracle). */
async function countClaimsForUser(userId: number): Promise<number> {
  return db.$count(subscriptionPurchaseIdempotency, eq(subscriptionPurchaseIdempotency.userId, userId));
}

/** Reads the owner's junction rows as a sorted subscription-id list. */
async function readJunctionSubscriptionIds(studentId: number): Promise<number[]> {
  const rows = await db
    .select({ subscriptionId: studentSubscriptions.subscriptionId })
    .from(studentSubscriptions)
    .where(eq(studentSubscriptions.studentId, studentId));
  return rows.map(row => row.subscriptionId).toSorted((a, b) => a - b);
}

/**
 * Try/catch rejection helper (journey-layer pattern —
 * `expect(...).rejects.toThrow()` is prohibited). Returns the caught error;
 * fails the test when the call resolves successfully.
 */
async function catchJourneyError(fn: () => Promise<unknown>): Promise<Error> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  if (caught === null) {
    throw new Error("catchJourneyError: expected the call to throw, but it resolved successfully");
  }
  if (caught instanceof Error) {
    return caught;
  }
  return new Error(`catchJourneyError: caught non-Error throw (${typeof caught})`);
}

/** Narrows a nullable window bound (a missing bound is a service-contract bug). */
function requireDate(value: Date | null, label: string): Date {
  if (!value) {
    throw new Error(`journey: ${label} is missing`);
  }
  return value;
}

describe("admin-subscription-lifecycle journey — one student's subscription across the admin surface", () => {
  beforeAll(async () => {
    // One COMMITTING transaction: provisioning is commit-or-nothing, so a
    // throwing setup rolls back and leaves nothing behind.
    await db.transaction(async tx => {
      admin = await provisionAdminActor(tx, { tracked });
      student = await provisionStudentActor(tx, { tracked });
      otherStudent = await provisionStudentActor(tx, { tracked });

      // Step-1 fixtures: two ACTIVE same-lane plans — the target's strictly
      // smaller per-session unit value pins the downgrade direction — and
      // the owner's active Hifz subscription S with a fixed whole-second
      // window. The owner's lane is seeded to its step-1 value explicitly.
      const sourcePlan = await createTestPlan(tx, {
        title: `${runPrefix} admin-lifecycle source plan`,
        sessionCount: SOURCE_PLAN_SESSION_COUNT,
        price: SOURCE_PLAN_PRICE,
        intervalDays: SOURCE_PLAN_INTERVAL_DAYS,
        balanceLane: SubscriptionCreditLane.Hifz,
      });
      sourcePlanId = sourcePlan.id;
      tracked.register(plans, sourcePlanId);

      const smallerPlan = await createTestPlan(tx, {
        title: `${runPrefix} admin-lifecycle smaller plan`,
        sessionCount: SMALLER_PLAN_SESSION_COUNT,
        price: SMALLER_PLAN_PRICE,
        intervalDays: SMALLER_PLAN_INTERVAL_DAYS,
        balanceLane: SubscriptionCreditLane.Hifz,
      });
      smallerPlanId = smallerPlan.id;
      tracked.register(plans, smallerPlanId);

      await tx.update(students).set({ balanceHifz: LANE_SEED }).where(eq(students.id, student.userId));

      const subscription = await createTestSubscription(tx, student.userId, sourcePlanId, {
        status: SubscriptionStatus.Active,
        startDate: S_START,
        endDate: S_END,
      });
      sId = subscription.id;
      tracked.register(subscriptions, sId);
    });

    // Lane baseline — captured right after the committing setup so every
    // later "byte-identical" comparison has an honest anchor.
    baselineLanes = await readStudentLanes(student.userId);
  });

  afterAll(async () => {
    // Zero dispatches across the WHOLE journey — the feature emits NO
    // notifications by design (documented in the header).
    expect(publishSpy.mock.calls).toHaveLength(0);
    publishSpy.mockRestore();

    // Every user id the journey created (the cast; no service on this
    // surface ever mints users).
    const journeyUserIds = [admin?.userId, student?.userId, otherStudent?.userId].filter(
      (id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0
    );

    if (journeyUserIds.length > 0) {
      // 1. Audit rows FIRST — `audit_logs.actor_id` is ON DELETE RESTRICT,
      //    and the append-only immutability trigger must be suspended for
      //    the delete (the only sanctioned mutation path). Every lifecycle
      //    audit row is attributed to the journey admin; the defensive
      //    user-entity sweep mirrors the completeness journey's teardown.
      await withAuditDeleteTriggersSuspended(async () => {
        await db.delete(auditLogs).where(inArray(auditLogs.actorId, journeyUserIds));
        await queryDb(
          `DELETE FROM audit_logs
           WHERE entity_type = 'user' AND entity_id = ANY($1::int[])`,
          [journeyUserIds]
        );
      });

      // Defensive notification sweep — the feature should have minted none;
      // `user_id` cascades on user delete anyway.
      await db.delete(notifications).where(inArray(notifications.userId, journeyUserIds));

      // 2. User-led teardown (`deleteUsersByIds` first among the row
      //    sweeps): hard-deletes the RESTRICT-gated references the journey
      //    owns (its subscriptions) together with the users rows; role-child
      //    rows cascade.
      await deleteUsersByIds(journeyUserIds);
    }

    // 3. Tracked hard-delete in reverse registration order (service-minted
    //    claims and subscriptions first, then the fixture plans; users and
    //    their subscriptions are already gone and are tolerated absent),
    //    with mandatory zero-residue existence probes baked in.
    await tracked.cleanup();

    // 4. Post-teardown probes — zero residue, platform-scoped to the journey.
    expect(await countUsersByIds(journeyUserIds)).toBe(0);

    if (admin?.userId) {
      expect(await countAuditRowsForActor(admin.userId)).toBe(0);
    }
    const journeySubscriptionIds = [sId, s2Id, s3Id, s4Id].filter(
      (id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0
    );
    const entityResidues = await Promise.all(
      journeySubscriptionIds.map(async id => countAuditRowsForEntity(SUBSCRIPTION_ENTITY, id))
    );
    for (const residue of entityResidues) {
      expect(residue).toBe(0);
    }

    const journeyStudentIds = [student?.userId, otherStudent?.userId].filter(
      (id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0
    );
    if (journeyStudentIds.length > 0) {
      // The junction rows the renew + plan-change legs inserted cascade away
      // with their subscription/student parents (composite PK — no registry
      // row), and the probe proves it.
      expect(await db.$count(studentSubscriptions, inArray(studentSubscriptions.studentId, journeyStudentIds))).toBe(0);
      expect(
        await db.$count(
          subscriptionPurchaseIdempotency,
          inArray(subscriptionPurchaseIdempotency.userId, journeyUserIds)
        )
      ).toBe(0);
    }
  });

  test("step 1 — system: cast + active Hifz subscription S committed (lane=4), clean audit slate", async () => {
    // 3 actors × (users row + role-child row) + 2 plans + the subscription S.
    expect(tracked.size).toBe(9);

    const row = await readSubscriptionRow(sId);
    expect(row.status).toBe(SubscriptionStatus.Active);
    expect(row.planId).toBe(sourcePlanId);
    expect(row.userId).toBe(student.userId);
    expect(row.startDate?.getTime()).toBe(S_START.getTime());
    expect(row.endDate?.getTime()).toBe(S_END.getTime());

    // The owner's seeded lane and the unrelated student's untouched one.
    const lanes = await readStudentLanes(student.userId);
    expect(lanes.hifz).toBe(LANE_SEED);
    expect(lanes).toEqual(requireBaselineLanes());
    const otherLanes = await readStudentLanes(otherStudent.userId);
    expect(otherLanes.hifz).toBe(0);

    // Clean start: the cast has minted nothing anywhere.
    expect(await countAuditRowsForActor(admin.userId)).toBe(0);
    expect(await countAuditRowsForActor(student.userId)).toBe(0);
    expect(await countAuditRowsForActor(otherStudent.userId)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(0);
  });

  test("step 2 — admin: extend S +30d → end_date += 30d exactly; one Update audit row", async () => {
    // The window anchor is read back first so the expected ISO pair derives
    // from the same committed value the server computes from.
    const before = await readSubscriptionRow(sId);
    const previousEndDate = requireDate(before.endDate, "the extend fixture's window end");
    const lanesBefore = await readStudentLanes(student.userId);
    const auditForAdminBefore = await countAuditRowsForActor(admin.userId);

    const extended = await SubscriptionAdminService.extendSubscription(
      { subscriptionId: sId, days: EXTEND_DAYS },
      admin.userId,
      LOCALE
    );

    expect(extended.id).toBe(sId);
    expect(extended.status).toBe(SubscriptionStatus.Active);
    const extendedEnd = requireDate(extended.endDate, "the extended row's window end");
    expect(extendedEnd.getTime()).toBe(S_EXTENDED_END.getTime());

    // Read-back: the committed row carries the exact +30d window.
    const after = await readSubscriptionRow(sId);
    expect(after.endDate?.getTime()).toBe(previousEndDate.getTime() + EXTEND_DAYS * MS_PER_DAY);

    // Balance-preserving by definition — extend touches no lane column.
    expect(await readStudentLanes(student.userId)).toEqual(lanesBefore);

    // Exactly one Update row anchored on S with the pinned details contract.
    const auditRows = await readSubscriptionAuditRows(sId);
    expect(auditRows).toHaveLength(1);
    const updateRow = auditRows[0];
    if (!updateRow) {
      throw new Error("journey: the extend audit row vanished");
    }
    expect(updateRow.actionType).toBe(UPDATE_VERB);
    expect(updateRow.entityType).toBe(SUBSCRIPTION_ENTITY);
    expect(updateRow.actorId).toBe(admin.userId);
    expect(parseAuditDetails(updateRow)).toEqual({
      previousEndDate: previousEndDate.toISOString(),
      newEndDate: new Date(previousEndDate.getTime() + EXTEND_DAYS * MS_PER_DAY).toISOString(),
      addedDays: EXTEND_DAYS,
    });
    expect(await countAuditRowsForActor(admin.userId)).toBe(auditForAdminBefore + 1);
    expect(publishSpy.mock.calls).toHaveLength(0);
  });

  test("step 3 — student: reads own subscriptions and sees the extended window", async () => {
    const own = await SubscriptionPurchaseService.listOwn(student.userId, LOCALE);

    // Exactly one row — S — carrying the extended window and active status.
    expect(own).toHaveLength(1);
    const ownRow = own[0];
    if (!ownRow) {
      throw new Error("journey: the owner's list came back empty");
    }
    expect(ownRow.id).toBe(sId);
    expect(ownRow.status).toBe(SubscriptionStatus.Active);
    expect(ownRow.planId).toBe(sourcePlanId);
    expect(ownRow.endDate?.getTime()).toBe(S_EXTENDED_END.getTime());

    // Cross-actor visibility: the unrelated student sees nothing of it.
    const foreign = await SubscriptionPurchaseService.listOwn(otherStudent.userId, LOCALE);
    expect(foreign).toHaveLength(0);
    expect(publishSpy.mock.calls).toHaveLength(0);
  });

  test("step 4 — admin: cancel S → cancelled, lanes byte-identical; one Suspend audit row", async () => {
    const lanesBefore = await readStudentLanes(student.userId);
    const auditRowsBefore = await readSubscriptionAuditRows(sId);
    expect(auditRowsBefore).toHaveLength(1); // the step-2 Update row

    const cancelled = await SubscriptionAdminService.cancelSubscription(
      { subscriptionId: sId, reason: CANCEL_REASON },
      admin.userId,
      LOCALE
    );

    expect(cancelled.id).toBe(sId);
    expect(cancelled.status).toBe(SubscriptionStatus.Cancelled);

    // Read-back: the terminal state is committed; the window is untouched.
    const after = await readSubscriptionRow(sId);
    expect(after.status).toBe(SubscriptionStatus.Cancelled);
    expect(after.endDate?.getTime()).toBe(S_EXTENDED_END.getTime());

    // Balance-preserving deny path: the cancel op itself mutates NO lane.
    expect(await readStudentLanes(student.userId)).toEqual(lanesBefore);

    // Exactly one Suspend row appended, anchored on S, with the pinned
    // details contract (the trimmed reason is the trail's only free text).
    const auditRows = await readSubscriptionAuditRows(sId);
    expect(auditRows).toHaveLength(2);
    const suspendRow = auditRows[1];
    if (!suspendRow) {
      throw new Error("journey: the cancel audit row vanished");
    }
    expect(suspendRow.actionType).toBe(SUSPEND_VERB);
    expect(suspendRow.entityType).toBe(SUBSCRIPTION_ENTITY);
    expect(suspendRow.actorId).toBe(admin.userId);
    expect(parseAuditDetails(suspendRow)).toEqual({
      fromStatus: ACTIVE_STATUS,
      toStatus: CANCELLED_STATUS,
      reason: CANCEL_REASON,
    });
    expect(publishSpy.mock.calls).toHaveLength(0);
  });

  test("step 5 — student: lane preserved after the cancel (no booking-denial mutation from the op)", async () => {
    // The lane the booking gate would consult still holds its provisioned
    // value — the cancel op itself never touched it (INV-B4's premise holds:
    // with balance > 0 the student could still book).
    const lanes = await readStudentLanes(student.userId);
    expect(lanes).toEqual(requireBaselineLanes());
    expect(lanes.hifz).toBe(LANE_SEED);

    // Cross-actor visibility of the terminal state through the owner's read.
    const own = await SubscriptionPurchaseService.listOwn(student.userId, LOCALE);
    expect(own).toHaveLength(1);
    expect(own[0]?.status).toBe(SubscriptionStatus.Cancelled);
    expect(own[0]?.endDate?.getTime()).toBe(S_EXTENDED_END.getTime());

    // The cancel appended nothing since its own Suspend row, and the student
    // actor still has minted nothing.
    expect(await readSubscriptionAuditRows(sId)).toHaveLength(2);
    expect(await countAuditRowsForActor(student.userId)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(0);
  });

  test("step 6 — system: expired S2 fixture + drained lane committed", async () => {
    // One committing transaction for the step-6 fixture arrangement
    // (commit-or-nothing, same discipline as the setup).
    await db.transaction(async tx => {
      const expired = await createTestSubscription(tx, student.userId, sourcePlanId, {
        status: SubscriptionStatus.Expired,
        startDate: S2_START,
        endDate: S2_END,
      });
      s2Id = expired.id;
      tracked.register(subscriptions, s2Id);

      await tx.update(students).set({ balanceHifz: 0 }).where(eq(students.id, student.userId));
    });

    // The expired source: past end date, expired status — the renewal's
    // premise (the expiry sweep owns active → expired; renewal recovers it).
    const expired = await readSubscriptionRow(s2Id);
    expect(expired.status).toBe(SubscriptionStatus.Expired);
    expect(expired.planId).toBe(sourcePlanId);
    const expiredEnd = requireDate(expired.endDate, "the expired fixture's window end");
    expect(expiredEnd.getTime()).toBeLessThan(Date.now());

    // The drained lane makes the renewal credit arithmetic exact.
    const lanes = await readStudentLanes(student.userId);
    expect(lanes.hifz).toBe(0);
    expect(lanes.tajweed).toBe(requireBaselineLanes().tajweed);
    expect(lanes.reviews).toBe(requireBaselineLanes().reviews);
    expect(lanes.trial).toBe(requireBaselineLanes().trial);
    expect(publishSpy.mock.calls).toHaveLength(0);
  });

  test("step 7 — admin: renew S2 → active S3, lane credited, junction row, claim + Create audit row", async () => {
    const lanesBefore = await readStudentLanes(student.userId);
    const junctionBefore = await readJunctionSubscriptionIds(student.userId);
    const auditForAdminBefore = await countAuditRowsForActor(admin.userId);

    const renewed = await SubscriptionAdminService.renewSubscription({ subscriptionId: s2Id }, admin.userId, LOCALE);

    // A fresh row — never the source, never a mutated S2.
    s3Id = renewed.id;
    expect(s3Id).not.toBe(s2Id);
    expect(renewed.status).toBe(SubscriptionStatus.Active);
    expect(renewed.planId).toBe(sourcePlanId);
    expect(renewed.paymentMethod).toBeNull();
    expect(renewed.paymentReference).toBeNull();
    tracked.register(subscriptions, s3Id);

    // The fresh window opens at the renewal instant and spans exactly one
    // plan interval.
    const renewedStart = requireDate(renewed.startDate, "the renewed row's window start");
    const renewedEnd = requireDate(renewed.endDate, "the renewed row's window end");
    expect(Math.abs(renewedStart.getTime() - Date.now())).toBeLessThan(FRESH_WINDOW_SKEW_MS);
    expect(renewedEnd.getTime() - renewedStart.getTime()).toBe(SOURCE_PLAN_INTERVAL_DAYS * MS_PER_DAY);

    // The lane credit: drained 0 + the plan's full session count.
    const lanes = await readStudentLanes(student.userId);
    expect(lanes.hifz).toBe(lanesBefore.hifz === null ? RENEW_CREDIT : lanesBefore.hifz + RENEW_CREDIT);

    // The junction row links the owner to the NEW row only.
    expect(await readJunctionSubscriptionIds(student.userId)).toEqual(
      [...junctionBefore, s3Id].toSorted((a, b) => a - b)
    );

    // The idempotency claim: exactly one, server-constructed key, backfilled
    // with the NEW row's id (the replay's resolution pointer).
    const claimIds = await readClaimsForSubscription(s3Id);
    expect(claimIds).toHaveLength(1);
    const claims = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.id, claimIds[0] ?? 0))
      .limit(1);
    const claim = claims[0];
    if (!claim) {
      throw new Error("journey: the renewal claim vanished");
    }
    expect(claim.idempotencyKey).toBe(`${SUBSCRIPTION_ADMIN_CLAIM_PREFIXES.renew}:${s2Id}`);
    expect(claim.userId).toBe(student.userId);
    tracked.register(subscriptionPurchaseIdempotency, claim.id);

    // Exactly one Create row anchored on the NEW row with the pinned details
    // contract; the SOURCE row anchors nothing.
    const auditRows = await readSubscriptionAuditRows(s3Id);
    expect(auditRows).toHaveLength(1);
    const createRow = auditRows[0];
    if (!createRow) {
      throw new Error("journey: the renew audit row vanished");
    }
    expect(createRow.actionType).toBe(CREATE_VERB);
    expect(createRow.entityType).toBe(SUBSCRIPTION_ENTITY);
    expect(createRow.actorId).toBe(admin.userId);
    expect(parseAuditDetails(createRow)).toEqual({
      renewedFromSubscriptionId: s2Id,
      planId: sourcePlanId,
      creditedSessions: RENEW_CREDIT,
      intervalDays: SOURCE_PLAN_INTERVAL_DAYS,
    });
    expect(await readSubscriptionAuditRows(s2Id)).toHaveLength(0);
    expect(await countAuditRowsForActor(admin.userId)).toBe(auditForAdminBefore + 1);
    expect(publishSpy.mock.calls).toHaveLength(0);
  });

  test("step 8 — admin: renew S2 again (replay) → returns S3; NOTHING new", async () => {
    const lanesBefore = await readStudentLanes(student.userId);
    const junctionBefore = await readJunctionSubscriptionIds(student.userId);
    const claimsForS3Before = await readClaimsForSubscription(s3Id);
    const claimsForUserBefore = await countClaimsForUser(student.userId);
    const auditForS3Before = await readSubscriptionAuditRows(s3Id);
    const auditForAdminBefore = await countAuditRowsForActor(admin.userId);

    const replayed = await SubscriptionAdminService.renewSubscription({ subscriptionId: s2Id }, admin.userId, LOCALE);

    // The FIRST renewal's row comes back — same id, no error, no new period.
    expect(replayed.id).toBe(s3Id);
    expect(replayed.status).toBe(SubscriptionStatus.Active);

    // Nothing new anywhere: no second lane credit, no second junction row,
    // no second claim, no second audit row.
    expect(await readStudentLanes(student.userId)).toEqual(lanesBefore);
    expect(await readJunctionSubscriptionIds(student.userId)).toEqual(junctionBefore);
    expect(await readClaimsForSubscription(s3Id)).toEqual(claimsForS3Before);
    expect(await countClaimsForUser(student.userId)).toBe(claimsForUserBefore);
    expect(await readSubscriptionAuditRows(s3Id)).toEqual(auditForS3Before);
    expect(await countAuditRowsForActor(admin.userId)).toBe(auditForAdminBefore);
    expect(publishSpy.mock.calls).toHaveLength(0);
  });

  test("step 9 — admin: plan-change S3 → smaller plan → S3 cancelled, S4 active, lane settles (excess forfeited)", async () => {
    const junctionBefore = await readJunctionSubscriptionIds(student.userId);
    const auditForAdminBefore = await countAuditRowsForActor(admin.userId);

    const changed = await SubscriptionAdminService.changeSubscriptionPlan(
      { subscriptionId: s3Id, newPlanId: smallerPlanId },
      admin.userId,
      LOCALE
    );

    // The proration payload: a downgrade on the smaller unit value carries
    // nothing and forfeits the whole remaining lane.
    s4Id = changed.subscription.id;
    expect(s4Id).not.toBe(s3Id);
    expect(changed.direction).toBe(ProrationDirection.Downgrade);
    expect(changed.carrySessions).toBe(0);
    expect(changed.forfeitedSessions).toBe(EXCESS_FORFEITED);
    tracked.register(subscriptions, s4Id);

    // S4: a fresh active row on the smaller plan, one fresh interval, no
    // gateway payload (the admin change carries no payment material).
    const s4 = await readSubscriptionRow(s4Id);
    expect(s4.status).toBe(SubscriptionStatus.Active);
    expect(s4.planId).toBe(smallerPlanId);
    expect(s4.paymentMethod).toBeNull();
    expect(s4.paymentReference).toBeNull();
    const s4Start = requireDate(s4.startDate, "the changed row's window start");
    const s4End = requireDate(s4.endDate, "the changed row's window end");
    expect(Math.abs(s4Start.getTime() - Date.now())).toBeLessThan(FRESH_WINDOW_SKEW_MS);
    expect(s4End.getTime() - s4Start.getTime()).toBe(SMALLER_PLAN_INTERVAL_DAYS * MS_PER_DAY);

    // S3: flipped to cancelled by the same change; its plan never moved.
    const s3 = await readSubscriptionRow(s3Id);
    expect(s3.status).toBe(SubscriptionStatus.Cancelled);
    expect(s3.planId).toBe(sourcePlanId);

    // The lane settles to the new plan's exact session count — the excess
    // (the whole renewal credit) is forfeited, not carried.
    const lanes = await readStudentLanes(student.userId);
    expect(lanes.hifz).toBe(SETTLED_LANE);

    // The junction now links the owner to BOTH rows (the fresh row was
    // added; the cancelled row's link is history, not deleted).
    expect(await readJunctionSubscriptionIds(student.userId)).toEqual(
      [...junctionBefore, s4Id].toSorted((a, b) => a - b)
    );

    // The idempotency claim: exactly one, keyed from the certified source +
    // target pair, backfilled with S4's id.
    const claimIds = await readClaimsForSubscription(s4Id);
    expect(claimIds).toHaveLength(1);
    const claims = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.id, claimIds[0] ?? 0))
      .limit(1);
    const claim = claims[0];
    if (!claim) {
      throw new Error("journey: the plan-change claim vanished");
    }
    expect(claim.idempotencyKey).toBe(planChangeClaimKey(s3Id, smallerPlanId));
    expect(claim.userId).toBe(student.userId);
    tracked.register(subscriptionPurchaseIdempotency, claim.id);

    // Exactly one Override row anchored on the NEW row with the pinned
    // details contract; S3's flip mints no separate row (the Override IS
    // the record), so S3 still carries only its renewal Create row.
    const auditRows = await readSubscriptionAuditRows(s4Id);
    expect(auditRows).toHaveLength(1);
    const overrideRow = auditRows[0];
    if (!overrideRow) {
      throw new Error("journey: the plan-change audit row vanished");
    }
    expect(overrideRow.actionType).toBe(OVERRIDE_VERB);
    expect(overrideRow.entityType).toBe(SUBSCRIPTION_ENTITY);
    expect(overrideRow.actorId).toBe(admin.userId);
    expect(parseAuditDetails(overrideRow)).toEqual({
      direction: ProrationDirection.Downgrade,
      fromSubscriptionId: s3Id,
      fromPlanId: sourcePlanId,
      toPlanId: smallerPlanId,
      carrySessions: 0,
      forfeitedExcess: EXCESS_FORFEITED,
    });
    expect(await readSubscriptionAuditRows(s3Id)).toHaveLength(1);
    expect(await countAuditRowsForActor(admin.userId)).toBe(auditForAdminBefore + 1);
    expect(publishSpy.mock.calls).toHaveLength(0);
  });

  test("step 10 — denial: student actor calls adminCancelSubscription on own row → FORBIDDEN, zero mint", async () => {
    const s4Before = await readSubscriptionRow(s4Id);
    const lanesBefore = await readStudentLanes(student.userId);
    const auditForAdminBefore = await countAuditRowsForActor(admin.userId);
    const auditForStudentBefore = await countAuditRowsForActor(student.userId);

    const error = await catchJourneyError(() =>
      SubscriptionAdminService.cancelSubscription(
        { subscriptionId: s4Id, reason: `${runPrefix} student self-cancel attempt` },
        student.userId,
        LOCALE
      )
    );

    // The real authorization gate denies through the localized FORBIDDEN
    // channel — never a raw key echo.
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toContain(tErrors.forbidden);

    // The owner's row is byte-identical (no write, no window shift, no
    // status flip), the lanes are untouched, and NOTHING was minted.
    const s4After = await readSubscriptionRow(s4Id);
    expect(s4After.status).toBe(s4Before.status);
    expect(s4After.startDate?.getTime()).toBe(s4Before.startDate?.getTime());
    expect(s4After.endDate?.getTime()).toBe(s4Before.endDate?.getTime());
    expect(await readStudentLanes(student.userId)).toEqual(lanesBefore);
    expect(await countAuditRowsForActor(student.userId)).toBe(auditForStudentBefore);
    expect(await countAuditRowsForEntity(SUBSCRIPTION_ENTITY, s4Id)).toBe(1);
    expect(await countAuditRowsForActor(admin.userId)).toBe(auditForAdminBefore);
    expect(publishSpy.mock.calls).toHaveLength(0);
  });

  test("step 11 — BOLA sanity: unrelated student reads adminStudentSubscriptions(otherStudentId) → FORBIDDEN before touch", async () => {
    // Observation-only spy (original behavior preserved) — proves the gate
    // denies BEFORE the owner-scoped read ever runs.
    const listByUserIdSpy = spyOn(SubscriptionRepository, "listByUserId");
    const auditForOtherBefore = await countAuditRowsForActor(otherStudent.userId);

    const error = await catchJourneyError(() =>
      SubscriptionAdminService.listForAdmin(student.userId, otherStudent.userId, LOCALE)
    );

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toContain(tErrors.forbidden);
    expect(listByUserIdSpy.mock.calls).toHaveLength(0);
    listByUserIdSpy.mockRestore();

    // No rows leaked, nothing minted by the denier, and the owner's surface
    // is exactly the lifecycle the journey built: S cancelled, S2 expired,
    // S3 cancelled, S4 active.
    expect(await countAuditRowsForActor(otherStudent.userId)).toBe(auditForOtherBefore);
    const own = await SubscriptionPurchaseService.listOwn(student.userId, LOCALE);
    expect(own.map(row => row.id).toSorted((a, b) => a - b)).toEqual([sId, s2Id, s3Id, s4Id].toSorted((a, b) => a - b));
    const statusesById = new Map(own.map(row => [row.id, row.status]));
    expect(statusesById.get(sId)).toBe(SubscriptionStatus.Cancelled);
    expect(statusesById.get(s2Id)).toBe(SubscriptionStatus.Expired);
    expect(statusesById.get(s3Id)).toBe(SubscriptionStatus.Cancelled);
    expect(statusesById.get(s4Id)).toBe(SubscriptionStatus.Active);

    // Full lifecycle footprint: 9 setup rows + S2 + S3 + its claim + S4 +
    // its claim.
    expect(tracked.size).toBe(14);
    expect(publishSpy.mock.calls).toHaveLength(0);
  });
});
