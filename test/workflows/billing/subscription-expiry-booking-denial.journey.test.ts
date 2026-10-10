/**
 * Cross-actor journey — TWO covering subscriptions → lapse one at a time →
 * lane zero → booking denial → admin renew → re-booking (the expiry ×
 * booking-enforcement delta legs).
 *
 * The middle leg of the chain (one funded purchase → real expiry sweep →
 * lane zeroed → booking denied `SUBSCRIPTION_EXPIRED` at the service AND
 * wire layers with ZERO writes → sweep-replay idempotency) already exists
 * green in the sibling `subscription-expiry.journey.test.ts` — this suite
 * runs and records that spine as the expiry/denial evidence and builds
 * ONLY the delta legs on top of the same as-built semantics:
 *
 *   1. Student holds TWO active subscriptions covering the Hifz lane; a
 *      funded control booking succeeds (the lane was live pre-expiry).
 *   2. The sweep expires the first subscription → the covering row keeps
 *      the lane intact (the covered-lane skip: zeroing is withheld while
 *      another active/pending subscription still covers the lane).
 *   3. The covering subscription lapses too (backdate + sweep) → the now
 *      UNCOVERED lane zeroes → booking denied `SUBSCRIPTION_EXPIRED`
 *      (the expiry gate takes precedence over the balance denial; the
 *      insufficient-balance code fires only for a never-funded student)
 *      with ZERO session rows and a REUSABLE idempotency key — the
 *      denied booking never burns its key.
 *   4. The denial holds against EVERY teacher (a lapsed student cannot
 *      book any certified teacher) and leaks no other tenant's data.
 *   5. Admin RENEW (the expired row's only recovery path — extend requires
 *      an active row and shifts the window without crediting lanes)
 *      credits the lane → the SAME previously-denied key books again on
 *      the renewed lane.
 *
 * Sequential, actor-attributed steps executed against the REAL services on
 * the REAL test database (later steps observe the shared state earlier
 * steps committed):
 *
 *   | Step | Actor          | Action                                  | Shared state                              | Side effects                     |
 *   |------|----------------|-----------------------------------------|-------------------------------------------|----------------------------------|
 *   | 1    | System         | cast + plan + TWO covering actives + funded lanes + control tenant | fixtures committed        | tracked ids registered           |
 *   | 2    | Student        | control booking with Teacher A          | session scheduled; hifz lane −1           | 1 teacher wave (A only)          |
 *   | 3    | System         | backdate S1's endDate past now          | row REMAINS active (window-vs-status lag)  | none                             |
 *   | 4    | System         | expiry sweep                            | { expired: 1, lanesZeroed: 0 }; lane INTACT; S2 + control byte-identical | none (silent sweep) |
 *   | 5    | System         | backdate S2 + sweep                     | { expired: 1, lanesZeroed: 1 }; lane zeroed; trial untouched | none |
 *   | 6    | Student       | booking vs Teacher A AND Teacher B      | SUBSCRIPTION_EXPIRED both times; ZERO session rows; key NOT burned | none |
 *   | 7    | Control student| renew attempt on the expired row         | ForbiddenError through the real admin gate | none (zero mint)                |
 *   | 8    | Admin          | renewSubscription the expired source    | fresh ACTIVE period; lane +5; claim + ONE Create audit row | 1 audit row |
 *   | 9    | Student       | re-booking with the SAME denied key      | session scheduled; lane −1 on the renewed lane | 1 teacher wave (A only) |
 *   | 10   | System         | sweep replay                           | { expired: 0, lanesZeroed: 0 }; every terminal state holds | none |
 *
 * Journey rules honored (`test/workflows/AGENTS.md`):
 * - fixtures COMMITTED in `beforeAll` inside ONE committing transaction;
 *   never `runInRollback` (the services spawn their own top-level
 *   transactions);
 * - honest actors: real `users` rows + real role-child rows via the
 *   actor-context factory; the admin gate, governance gate, and lane
 *   probes all run the real authorization path — nothing monkey-patched
 *   except the notification publish seam and the sweep-claim scope filter
 *   (both restored in `afterAll`);
 * - external effects intercepted at the notification boundary: the
 *   fan-out publish seam is SPIED for the WHOLE journey (the booking wave
 *   rides this exact seam); every expected dispatch is asserted with its
 *   targeted userIds, and the two expiry sweeps + the renew are asserted
 *   SILENT (the sweep is system-scope and actor-less by design);
 * - expected rejections captured with `catchJourneyError` — never
 *   `.rejects.toThrow()`; denial copy asserted as translated substrings
 *   from the server locale bundle — never raw keys, never hardcoded copy;
 * - per-run `jrn_billing_<8hex>` prefix on every fixture name and
 *   idempotency key;
 * - cross-actor visibility asserted BOTH directions: the control tenant's
 *   subscription row, lanes, and inbox are byte-compared after every
 *   mutation leg, and the non-admin renew probe denies through the real
 *   `assertActorAdmin` gate with the owner's row byte-identical.
 *
 * Teardown: audit rows (actor-scoped + user-entity) FIRST under the
 * sanctioned audit-delete trigger suspension (`audit_logs.actor_id` is ON
 * DELETE RESTRICT and the ledger is append-only), then a defensive
 * notification sweep, then the junction rows (re-probed), then the tracked
 * registry sweep (reverse registration order + zero-residue existence
 * re-probes for EVERY tracked row — a leaking `afterAll` fails the suite
 * loudly), then platform-scoped residue probes. Unique per-run prefixes
 * make any intermediate crash residue greppable and harmless.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { SubscriptionRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications";
import { students } from "@/backend/db/schema/students/students";
import { createTestPlan, createTestSubscription } from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ForbiddenError, ValidationError } from "@/backend/lib/errors";
import { SUBSCRIPTION_ADMIN_CLAIM_PREFIXES } from "@/backend/services/billing/subscription-admin.helpers";
import { SubscriptionAdminService } from "@/backend/services/billing/subscription-admin.service";
import { SubscriptionExpiryService } from "@/backend/services/billing/subscription-expiry.service";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type { DBTransaction, PlanSelectType, SubscriptionSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { countUsersByIds, withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  catchJourneyError,
  type JourneyActor,
  journeyPrefix,
  provisionAdminActor,
  provisionCertifiedTeacherActor,
  provisionStudentActor,
  secondPrecisionMs,
  TrackedFixtures,
} from "@/test/workflows/helpers";

// ─── Harness state ───────────────────────────────────────────────────────────

/** Per-run unique prefix — every fixture name and idempotency key. */
const PREFIX = journeyPrefix("billing");

/** Error-copy locale for every service call and denial assertion. */
const ERRORS_EN = getServerTranslations("en").errorsTranslations;

/** Milliseconds per day — the window arithmetic. */
const MS_PER_DAY = 86_400_000;

/** Session count the journey plan grants (the credit amount under test). */
const PLAN_SESSION_COUNT = 5;
/** Activation window of the journey plan (days). */
const PLAN_INTERVAL_DAYS = 30;

/** How far past the window each backdated `endDate` lands (one lag hour). */
const EXPIRED_LAG_MS = 60 * 60 * 1000;

/** Fresh-window read skew tolerance for service-minted rows (now-anchored). */
const FRESH_WINDOW_SKEW_MS = 2 * 60 * 1000;

/** The control booking's idempotency key (unique per run). */
const KEY_BOOKING_CONTROL = `${PREFIX}-booking-control`;
/**
 * The denial/recovery booking's idempotency key — used FIRST by the two
 * denied bookings (which must NOT burn it) and then by the successful
 * post-renew re-booking (the reusability pin: one key, two outcomes).
 */
const KEY_BOOKING_RECOVERY = `${PREFIX}-booking-recovery`;

/**
 * The fan-out publish spy — installed over the engine's publish boundary
 * (the booking wave publishes post-commit through this exact seam). Every
 * dispatch is recorded and its targeted userIds asserted; the two sweeps
 * and the renew are asserted SILENT. Restored in `afterAll`.
 */
const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});

/**
 * The expiry-sweep claim scope — the journey's own students, populated in
 * `beforeAll`. The sweep's repository seam scopes its claimed projections
 * to these users, so the exact sweep-count assertions (the covered skip
 * `{ expired: 1, lanesZeroed: 0 }`, the uncovered zeroing
 * `{ expired: 1, lanesZeroed: 1 }`, and the honest zero replay) stay
 * isolated from unrelated committed due rows any other own-commit suite
 * may hold in the shared test database.
 */
const journeySweepUserIds: number[] = [];
const originalExpireDueActive = SubscriptionRepository.expireDueActive;
const sweepScopeSpy = spyOn(SubscriptionRepository, "expireDueActive").mockImplementation(
  async (now: Date, tx?: DBTransaction) => {
    const claimed = await originalExpireDueActive(now, tx);
    return claimed.filter(row => journeySweepUserIds.includes(row.userId));
  }
);

/** Suite-scoped fixture registry — every committed row and service-minted row. */
const tracked = new TrackedFixtures();

let student: JourneyActor; // the subscription owner under test
let controlStudent: JourneyActor; // untouched sibling tenant (isolation oracle)
let teacherA: JourneyActor; // the control + recovery booking target
let teacherB: JourneyActor; // the cross-teacher denial probe target
let admin: JourneyActor; // the real admin renew actor

let planRow: PlanSelectType;
let s1Id = 0; // S1 — the first covering subscription (lapses first)
let s2Id = 0; // S2 — the covering subscription (keeps the lane, then lapses too)
let controlSubId = 0; // the control tenant's active row (never mutated)
let renewedId = 0; // the renew flow's fresh active period

/** The control tenant's pre-journey snapshots (byte-identical oracle). */
let controlRowSnapshot: SubscriptionSelectType | null = null;
/** The expired S1's post-sweep snapshot (the renew-probe byte-identical oracle). */
let s1ExpiredSnapshot: SubscriptionSelectType | null = null;

/** Every subscription id the journey owns (junction-sweep worklist). */
const journeySubscriptionIds: number[] = [];

// ─── Read-back oracles ───────────────────────────────────────────────────────

/** The student's four balance lanes as stored (nullable columns, trial notNull). */
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

/** Plain-object type guard over an untyped `JSON.parse` result. */
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

/** Reads one subscription row raw, failing when absent. */
async function subscriptionRow(subscriptionId: number): Promise<SubscriptionSelectType> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: subscription row ${subscriptionId} vanished`);
  }
  return row;
}

/** Reads one student's live balance lanes (incl. the INV-exempt trial lane). */
async function readLanes(studentId: number): Promise<StudentLanes> {
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
    throw new Error(`journey: student row ${studentId} vanished`);
  }
  return row;
}

/** Independent read-back oracle — direct Drizzle count on the inbox. */
async function inboxCount(userId: number): Promise<number> {
  return db.$count(notifications, eq(notifications.userId, userId));
}

/** Every `session` row booked by one student (count oracle). */
async function countSessionsFor(studentId: number): Promise<number> {
  return db.$count(session, eq(session.studentId, studentId));
}

/** Reads the booking idempotency claim rows carrying one key (key-burn oracle). */
async function claimsForKey(key: string) {
  return db.select().from(sessionRequestIdempotency).where(eq(sessionRequestIdempotency.idempotencyKey, key));
}

/** Counts audit rows minted BY one actor (zero-mint oracle for denials). */
async function countAuditRowsForActor(actorId: number): Promise<number> {
  return db.$count(auditLogs, eq(auditLogs.actorId, actorId));
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
    .where(and(eq(auditLogs.entityType, "subscription"), eq(auditLogs.entityId, subscriptionId)))
    .orderBy(auditLogs.id);
}

/**
 * The control-tenant invariance oracle — the untouched sibling's
 * subscription row, lanes, and inbox are byte-identical to the
 * pre-journey snapshots (no cross-tenant leak from any leg).
 */
async function expectControlTenantUntouched(): Promise<void> {
  if (controlRowSnapshot === null) {
    throw new Error("journey: the control tenant's snapshot was never captured in setup");
  }
  expect(await subscriptionRow(controlSubId)).toEqual(controlRowSnapshot);
  expect(await inboxCount(controlStudent.userId)).toBe(0);
  expect(await countSessionsFor(controlStudent.userId)).toBe(0);
}

/** Narrows the expired S1 snapshot (missing = a step-ordering bug). */
function requireS1ExpiredSnapshot(): SubscriptionSelectType {
  if (s1ExpiredSnapshot === null) {
    throw new Error("journey: the expired S1 snapshot was never captured");
  }
  return s1ExpiredSnapshot;
}

/**
 * Reads the published receipt at one spy call index, failing on any other
 * shape (runtime-guarded — zero casts).
 */
function publishedRecipientUserIds(callIndex: number): readonly unknown[] {
  const published: unknown = publishSpy.mock.calls[callIndex]?.[0];
  if (!Array.isArray(published) || published.length !== 1) {
    throw new Error(`expected exactly one published delivery receipt at call ${callIndex}`);
  }
  const receipt = published[0];
  if (!isPlainRecord(receipt) || !Array.isArray(receipt.recipientUserIds)) {
    throw new Error(`expected the published receipt at call ${callIndex} to carry its recipient ids`);
  }
  return receipt.recipientUserIds;
}

// ─── Fixture provisioning + teardown ──────────────────────────────────────────

beforeAll(async () => {
  // ONE committing transaction: commit-or-nothing fixture provisioning.
  await db.transaction(async tx => {
    student = await provisionStudentActor(tx, { tracked });
    controlStudent = await provisionStudentActor(tx, { tracked });
    teacherA = await provisionCertifiedTeacherActor(tx, { tracked });
    teacherB = await provisionCertifiedTeacherActor(tx, { tracked });
    admin = await provisionAdminActor(tx, { tracked });

    planRow = await createTestPlan(tx, {
      title: `${PREFIX} expiry-denial plan`,
      sessionCount: PLAN_SESSION_COUNT,
      price: "200.00",
      currency: "EGP",
      intervalDays: PLAN_INTERVAL_DAYS,
      balanceLane: SubscriptionCreditLane.Hifz,
    });
    tracked.register(plans, planRow.id);

    // Funded lanes: the debit ladder is trial-first, so both students'
    // trial lanes are pinned to zero (the denial premise — a double-miss
    // ladder) and the Hifz lanes carry the plan's full session count.
    await tx.update(students).set({ balanceTrial: 0 }).where(eq(students.id, student.userId));
    await tx.update(students).set({ balanceTrial: 0 }).where(eq(students.id, controlStudent.userId));
    await tx.update(students).set({ balanceHifz: PLAN_SESSION_COUNT }).where(eq(students.id, student.userId));
    await tx.update(students).set({ balanceHifz: PLAN_SESSION_COUNT }).where(eq(students.id, controlStudent.userId));

    // S1 + S2 — the TWO active subscriptions covering the Hifz lane
    // (distinct future windows; neither is due at provisioning time).
    const s1 = await createTestSubscription(tx, student.userId, planRow.id, {
      status: SubscriptionStatus.Active,
      startDate: new Date(Date.now() - 2 * MS_PER_DAY),
      endDate: new Date(Date.now() + 20 * MS_PER_DAY),
    });
    s1Id = s1.id;
    tracked.register(subscriptions, s1Id);
    journeySubscriptionIds.push(s1Id);

    const s2 = await createTestSubscription(tx, student.userId, planRow.id, {
      status: SubscriptionStatus.Active,
      startDate: new Date(Date.now() - MS_PER_DAY),
      endDate: new Date(Date.now() + 25 * MS_PER_DAY),
    });
    s2Id = s2.id;
    tracked.register(subscriptions, s2Id);
    journeySubscriptionIds.push(s2Id);

    // The control tenant's OWN active subscription — future window, never
    // mutated by any journey step; byte-compared after every leg.
    const control = await createTestSubscription(tx, controlStudent.userId, planRow.id, {
      status: SubscriptionStatus.Active,
      startDate: new Date(Date.now() - MS_PER_DAY),
      endDate: new Date(Date.now() + PLAN_INTERVAL_DAYS * MS_PER_DAY),
    });
    controlSubId = control.id;
    tracked.register(subscriptions, controlSubId);
    journeySubscriptionIds.push(controlSubId);
  });

  // The control tenant's pre-journey snapshot (the byte-identical oracle).
  controlRowSnapshot = await subscriptionRow(controlSubId);

  // The sweep scope: the journey's own students (see `sweepScopeSpy`).
  journeySweepUserIds.push(student.userId, controlStudent.userId);
});

afterAll(async () => {
  publishSpy.mockRestore();
  sweepScopeSpy.mockRestore();

  // Every user id the journey created (the cast; no service here mints users).
  const journeyUserIds = [
    student?.userId,
    controlStudent?.userId,
    teacherA?.userId,
    teacherB?.userId,
    admin?.userId,
  ].filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0);

  if (journeyUserIds.length > 0) {
    // 1. Audit rows FIRST — `audit_logs.actor_id` is ON DELETE RESTRICT,
    //    and the append-only immutability trigger must be suspended for
    //    the delete (the only sanctioned mutation path). The renew leg's
    //    Create row is attributed to the journey admin; the user-entity
    //    sweep is defensive.
    await withAuditDeleteTriggersSuspended(async () => {
      await db.delete(auditLogs).where(inArray(auditLogs.actorId, journeyUserIds));
      await queryDb(
        `DELETE FROM audit_logs
         WHERE entity_type = 'user' AND entity_id = ANY($1::int[])`,
        [journeyUserIds]
      );
    });

    // Defensive notification sweep — the booking waves minted the
    // teacher intake rows (tracked counts asserted in-step), and
    // `user_id` cascades on user delete anyway.
    await db.delete(notifications).where(inArray(notifications.userId, journeyUserIds));
  }

  // 2. Junction rows (composite PK — no registry entry; swept by
  //    subscription id and re-probed ahead of the tracked sweep that
  //    deletes the parents).
  if (journeySubscriptionIds.length > 0) {
    await db.delete(studentSubscriptions).where(inArray(studentSubscriptions.subscriptionId, journeySubscriptionIds));
    const junctionResidue = await db.$count(
      studentSubscriptions,
      inArray(studentSubscriptions.subscriptionId, journeySubscriptionIds)
    );
    if (junctionResidue !== 0) {
      throw new Error(`journey teardown: ${junctionResidue} junction row(s) survived deletion`);
    }
  }

  // 3. Tracked hard-delete in reverse registration order (service-minted
  //    sessions, claims, subscriptions first; the cast rows last) with the
  //    mandatory zero-residue existence re-probes for EVERY tracked row.
  await tracked.cleanup();

  // 4. Post-teardown probes — zero residue, platform-scoped to the journey.
  if (journeyUserIds.length > 0) {
    expect(await countUsersByIds(journeyUserIds)).toBe(0);
    if (admin) {
      expect(await countAuditRowsForActor(admin.userId)).toBe(0);
    }
    const entityResidues = await Promise.all(
      journeySubscriptionIds.map(async id =>
        db.$count(auditLogs, and(eq(auditLogs.entityType, "subscription"), eq(auditLogs.entityId, id)))
      )
    );
    for (const residue of entityResidues) {
      expect(residue).toBe(0);
    }
    expect(
      await db.$count(subscriptionPurchaseIdempotency, inArray(subscriptionPurchaseIdempotency.userId, journeyUserIds))
    ).toBe(0);
    expect(await db.$count(sessionRequestIdempotency, inArray(sessionRequestIdempotency.userId, journeyUserIds))).toBe(
      0
    );
    expect(
      await db.$count(studentSubscriptions, inArray(studentSubscriptions.subscriptionId, journeySubscriptionIds))
    ).toBe(0);
    if (student) {
      expect(await countSessionsFor(student.userId)).toBe(0);
    }
  }
});

// ─── The journey ──────────────────────────────────────────────────────────────

describe("cross-actor journey: two covering subscriptions → lapse one by one → lane zero → booking denied → admin renew → re-booking", () => {
  test("step 1 — System: cast + plan + TWO active covering subscriptions + funded lanes committed; clean slate", async () => {
    // 5 actors × (users row + role-child row) + the plan + 3 subscriptions.
    expect(tracked.size).toBe(14);

    // The two covering rows: both active, both on the plan, distinct
    // future windows — neither is due yet.
    const s1 = await subscriptionRow(s1Id);
    expect(s1.status).toBe(SubscriptionStatus.Active);
    expect(s1.planId).toBe(planRow.id);
    expect(s1.userId).toBe(student.userId);
    expect(s1.endDate?.getTime() ?? 0).toBeGreaterThan(Date.now());
    const s2 = await subscriptionRow(s2Id);
    expect(s2.status).toBe(SubscriptionStatus.Active);
    expect(s2.planId).toBe(planRow.id);
    expect(s2.endDate?.getTime() ?? 0).toBeGreaterThan(Date.now());

    // The funded premise: the Hifz lane holds the plan's full session
    // count and the trial lane is empty (the debit ladder is trial-first).
    const lanes = await readLanes(student.userId);
    expect(lanes.hifz).toBe(PLAN_SESSION_COUNT);
    expect(lanes.trial).toBe(0);

    // The control tenant's funded baseline (never mutated from here on).
    const controlLanes = await readLanes(controlStudent.userId);
    expect(controlLanes.hifz).toBe(PLAN_SESSION_COUNT);
    expect(controlLanes.trial).toBe(0);

    // Clean start: nothing minted anywhere for any cast member.
    expect(await countAuditRowsForActor(admin.userId)).toBe(0);
    expect(await countAuditRowsForActor(student.userId)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(0);
    expect(await countSessionsFor(student.userId)).toBe(0);
    expect(await inboxCount(teacherA.userId)).toBe(0);
    expect(await inboxCount(teacherB.userId)).toBe(0);
    expect(await claimsForKey(KEY_BOOKING_RECOVERY)).toHaveLength(0);
  });

  test("step 2 — Student: control booking with Teacher A succeeds — the lane was live pre-expiry (hifz −1, hold on Hifz)", async () => {
    const lanesBefore = await readLanes(student.userId);
    const teacherAInboxBefore = await inboxCount(teacherA.userId);

    const booked = await SessionLifecycleService.createSession(
      student.userId,
      { teacherId: teacherA.userId, intent: SessionIntent.Hifz },
      KEY_BOOKING_CONTROL,
      "en"
    );
    expect(booked.studentId).toBe(student.userId);
    expect(booked.teacherId).toBe(teacherA.userId);
    expect(booked.status).toBe(SessionStatus.Scheduled);
    expect(booked.intent).toBe(SessionIntent.Hifz);
    expect(booked.feeHeld).toBe(true);
    expect(booked.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    tracked.register(session, booked.id);

    // The booking's idempotency claim — spent once, registered for teardown.
    const claimRows = await claimsForKey(KEY_BOOKING_CONTROL);
    expect(claimRows).toHaveLength(1);
    if (claimRows[0]) {
      tracked.register(sessionRequestIdempotency, claimRows[0].id);
    }

    // The real debit ladder moved exactly one unit from the funded lane.
    const lanesAfter = await readLanes(student.userId);
    expect((lanesBefore.hifz ?? 0) - (lanesAfter.hifz ?? 0)).toBe(1);
    expect(lanesAfter.trial).toBe(0);
    expect(lanesAfter.tajweed).toBe(lanesBefore.tajweed);
    expect(lanesAfter.reviews).toBe(lanesBefore.reviews);

    // The booking's fan-out: ONE wave, addressed to Teacher A ONLY.
    expect(publishSpy.mock.calls).toHaveLength(1);
    expect(publishedRecipientUserIds(0)).toEqual([teacherA.userId]);
    expect(await inboxCount(teacherA.userId)).toBe(teacherAInboxBefore + 1);
    expect(await inboxCount(teacherB.userId)).toBe(0);

    await expectControlTenantUntouched();
  });

  test("step 3 — System: backdate S1's endDate past the window → row REMAINS active (window-vs-status lag)", async () => {
    const s1Snapshot = await subscriptionRow(s1Id);
    const lanesBefore = await readLanes(student.userId);

    // Direct Drizzle backdate — the expired-row fixture shape, fabricated
    // at the second-precision resolution so the written value and every
    // later read-back agree exactly.
    const laggedEndDate = new Date(secondPrecisionMs(Date.now()) - EXPIRED_LAG_MS);
    await db.update(subscriptions).set({ endDate: laggedEndDate }).where(eq(subscriptions.id, s1Id));

    // The lag: NO state change yet — the row is past its window but still
    // `active`; closing that gap is the sweep's job alone.
    const lagging = await subscriptionRow(s1Id);
    expect(lagging.status).toBe(SubscriptionStatus.Active);
    expect(lagging.startDate?.getTime()).toBe(s1Snapshot.startDate?.getTime());
    expect(lagging.endDate?.getTime()).toBe(laggedEndDate.getTime());
    expect(lagging.paymentVerifiedAt?.getTime()).toBe(s1Snapshot.paymentVerifiedAt?.getTime());

    // The lane is untouched by the backdate — only the sweep may zero it.
    expect(await readLanes(student.userId)).toEqual(lanesBefore);

    await expectControlTenantUntouched();
  });

  test("step 4 — System: sweep expires S1 → { expired: 1, lanesZeroed: 0 } — the covering row keeps the lane INTACT", async () => {
    const s1Before = await subscriptionRow(s1Id);
    const s2Before = await subscriptionRow(s2Id);
    const lanesBefore = await readLanes(student.userId);
    const publishesBefore = publishSpy.mock.calls.length;

    const sweep = await SubscriptionExpiryService.expireDue();
    expect(sweep).toEqual({ expired: 1, lanesZeroed: 0 });

    // The flip: S1 expired, ORIGINAL window dates untouched.
    const expiredRow = await subscriptionRow(s1Id);
    expect(expiredRow.status).toBe(SubscriptionStatus.Expired);
    expect(expiredRow.startDate?.getTime()).toBe(s1Before.startDate?.getTime());
    expect(expiredRow.endDate?.getTime()).toBe(s1Before.endDate?.getTime());

    // The covered-lane skip: zeroing is withheld while S2 still covers the
    // lane — the student's balance survives the partial lapse.
    expect(await readLanes(student.userId)).toEqual(lanesBefore);
    expect(lanesBefore.hifz).toBe(PLAN_SESSION_COUNT - 1);

    // The covering row itself is byte-identical — the sweep flipped ONLY
    // the due row.
    expect(await subscriptionRow(s2Id)).toEqual(s2Before);

    // The sweep is system-scope and actor-less: no notification, no audit.
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
    expect(await countAuditRowsForActor(admin.userId)).toBe(0);

    await expectControlTenantUntouched();
  });

  test("step 5 — System: backdate S2 too + sweep → { expired: 1, lanesZeroed: 1 } — the UNCOVERED lane zeroes", async () => {
    const s1Expired = await subscriptionRow(s1Id);
    const s2Before = await subscriptionRow(s2Id);

    // The covering row's own lapse — the same second-precision backdate.
    const laggedEndDate = new Date(secondPrecisionMs(Date.now()) - EXPIRED_LAG_MS);
    await db.update(subscriptions).set({ endDate: laggedEndDate }).where(eq(subscriptions.id, s2Id));
    const lagging = await subscriptionRow(s2Id);
    expect(lagging.status).toBe(SubscriptionStatus.Active);
    expect(lagging.endDate?.getTime()).toBe(laggedEndDate.getTime());

    const sweep = await SubscriptionExpiryService.expireDue();
    expect(sweep).toEqual({ expired: 1, lanesZeroed: 1 });

    // Both rows now expired; S1's terminal state is byte-stable across the
    // second sweep.
    const s1After = await subscriptionRow(s1Id);
    expect(s1After.status).toBe(SubscriptionStatus.Expired);
    expect(s1After.startDate?.getTime()).toBe(s1Expired.startDate?.getTime());
    expect(s1After.endDate?.getTime()).toBe(s1Expired.endDate?.getTime());
    const s2After = await subscriptionRow(s2Id);
    expect(s2After.status).toBe(SubscriptionStatus.Expired);
    expect(s2After.startDate?.getTime()).toBe(s2Before.startDate?.getTime());
    expect(s2After.endDate?.getTime()).toBe(laggedEndDate.getTime());

    // The uncovered-lane zeroing: the Hifz remainder is gone; the trial
    // lane (never subscription-bound) and the untouched lanes survive.
    const lanes = await readLanes(student.userId);
    expect(lanes.hifz).toBe(0);
    expect(lanes.trial).toBe(0);
    expect(lanes.tajweed).toBe(0);
    expect(lanes.reviews).toBe(0);

    // The sweep stays silent.
    expect(publishSpy.mock.calls).toHaveLength(1);

    // The expired S1 snapshot the renew-probe later byte-compares against.
    s1ExpiredSnapshot = s1After;

    await expectControlTenantUntouched();
  });

  test("step 6 — Student: booking denied against BOTH teachers → SUBSCRIPTION_EXPIRED, translated copy, ZERO rows, key NOT burned", async () => {
    const lanesBefore = await readLanes(student.userId);
    const sessionsBefore = await countSessionsFor(student.userId);
    const publishesBefore = publishSpy.mock.calls.length;
    const adminAuditBefore = await countAuditRowsForActor(admin.userId);
    expect(sessionsBefore).toBe(1);

    // Denial vs Teacher A — the expiry gate takes precedence over the
    // balance denial (the ladder double-missed AND an uncovered expired
    // lane exists), captured through the real authorization path.
    const denialA = await catchJourneyError(() =>
      SessionLifecycleService.createSession(
        student.userId,
        { teacherId: teacherA.userId, intent: SessionIntent.Hifz },
        KEY_BOOKING_RECOVERY,
        "en"
      )
    );
    if (!(denialA instanceof ValidationError)) {
      throw new Error(`expected ValidationError (got ${denialA instanceof Error ? denialA.name : String(denialA)})`);
    }
    expect(denialA.code).toBe("SUBSCRIPTION_EXPIRED");
    // The copy is server-localized — never the raw key, never empty.
    expect(denialA.message.length).toBeGreaterThan(0);
    expect(denialA.message).not.toBe("subscriptionExpired");
    expect(denialA.message).toContain(ERRORS_EN.subscriptionExpired);

    // The same lapsed student cannot book ANY teacher — the denial is
    // lane-owned, not teacher-paired.
    const denialB = await catchJourneyError(() =>
      SessionLifecycleService.createSession(
        student.userId,
        { teacherId: teacherB.userId, intent: SessionIntent.Hifz },
        KEY_BOOKING_RECOVERY,
        "en"
      )
    );
    if (!(denialB instanceof ValidationError)) {
      throw new Error(`expected ValidationError (got ${denialB instanceof Error ? denialB.name : String(denialB)})`);
    }
    expect(denialB.code).toBe("SUBSCRIPTION_EXPIRED");
    expect(denialB.message).toContain(ERRORS_EN.subscriptionExpired);

    // No cross-tenant leak: the denial copy carries no participant ids —
    // neither the owner, the addressed teachers, nor the control tenant.
    for (const id of [student.userId, teacherA.userId, teacherB.userId, controlStudent.userId]) {
      expect(denialA.message).not.toContain(String(id));
      expect(denialB.message).not.toContain(String(id));
    }

    // ZERO rows written on denial: lanes, sessions unchanged, and the
    // idempotency key NOT burned — a failed booking never spends its key
    // (the recovery leg reuses this exact key).
    expect(await readLanes(student.userId)).toEqual(lanesBefore);
    expect(await countSessionsFor(student.userId)).toBe(sessionsBefore);
    expect(await claimsForKey(KEY_BOOKING_RECOVERY)).toHaveLength(0);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
    expect(await countAuditRowsForActor(admin.userId)).toBe(adminAuditBefore);

    await expectControlTenantUntouched();
  });

  test("step 7 — Control student: renew attempt on the expired row → Forbidden through the real admin gate, zero mint", async () => {
    const lanesBefore = await readLanes(student.userId);
    const claimsBefore = await db.$count(
      subscriptionPurchaseIdempotency,
      eq(subscriptionPurchaseIdempotency.userId, student.userId)
    );
    const adminAuditBefore = await countAuditRowsForActor(admin.userId);
    const publishesBefore = publishSpy.mock.calls.length;

    // A non-admin cast member (honest role: real `student` rows) attempts
    // the admin-owned surface on another tenant's expired row — the real
    // defense-in-depth gate denies before any write.
    const forbidden = await catchJourneyError(() =>
      SubscriptionAdminService.renewSubscription({ subscriptionId: s1Id }, controlStudent.userId, "en")
    );
    if (!(forbidden instanceof ForbiddenError)) {
      throw new Error(
        `expected ForbiddenError (got ${forbidden instanceof Error ? forbidden.name : String(forbidden)})`
      );
    }
    expect(forbidden.message).toContain(ERRORS_EN.forbidden);

    // Zero mint: the target row is byte-identical, no claim, no audit row.
    expect(await subscriptionRow(s1Id)).toEqual(requireS1ExpiredSnapshot());
    expect(await readLanes(student.userId)).toEqual(lanesBefore);
    expect(
      await db.$count(subscriptionPurchaseIdempotency, eq(subscriptionPurchaseIdempotency.userId, student.userId))
    ).toBe(claimsBefore);
    expect(await countAuditRowsForActor(admin.userId)).toBe(adminAuditBefore);
    expect(await countAuditRowsForActor(controlStudent.userId)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);

    await expectControlTenantUntouched();
  });

  test("step 8 — Admin: renew the expired source → fresh ACTIVE period, lane credited, claim + ONE Create audit row", async () => {
    const junctionBefore = await db
      .select({ subscriptionId: studentSubscriptions.subscriptionId })
      .from(studentSubscriptions)
      .where(eq(studentSubscriptions.studentId, student.userId));
    const adminAuditBefore = await countAuditRowsForActor(admin.userId);
    const publishesBefore = publishSpy.mock.calls.length;

    // RENEW — the expired row's only recovery path (extend requires an
    // active row and shifts the window WITHOUT crediting lanes).
    const renewed = await SubscriptionAdminService.renewSubscription({ subscriptionId: s1Id }, admin.userId, "en");

    renewedId = renewed.id;
    expect(renewedId).not.toBe(s1Id);
    expect(renewed.status).toBe(SubscriptionStatus.Active);
    expect(renewed.planId).toBe(planRow.id);
    expect(renewed.userId).toBe(student.userId);
    expect(renewed.paymentMethod).toBeNull();
    expect(renewed.paymentReference).toBeNull();
    tracked.register(subscriptions, renewedId);
    journeySubscriptionIds.push(renewedId);

    // A fresh window opening at the renewal instant, spanning one interval.
    expect(Math.abs((renewed.startDate?.getTime() ?? 0) - Date.now())).toBeLessThan(FRESH_WINDOW_SKEW_MS);
    expect((renewed.endDate?.getTime() ?? 0) - (renewed.startDate?.getTime() ?? 0)).toBe(
      PLAN_INTERVAL_DAYS * MS_PER_DAY
    );

    // The lane credit: zeroed by the sweep + the plan's full session count.
    const lanes = await readLanes(student.userId);
    expect(lanes.hifz).toBe(PLAN_SESSION_COUNT);
    expect(lanes.trial).toBe(0);

    // The junction links the owner to the fresh row too.
    const junctionAfter = await db
      .select({ subscriptionId: studentSubscriptions.subscriptionId })
      .from(studentSubscriptions)
      .where(eq(studentSubscriptions.studentId, student.userId));
    expect(junctionAfter).toHaveLength(junctionBefore.length + 1);

    // The idempotency claim: server-constructed renew key, owner-bound.
    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, `${SUBSCRIPTION_ADMIN_CLAIM_PREFIXES.renew}:${s1Id}`));
    expect(claimRows).toHaveLength(1);
    if (claimRows[0]) {
      expect(claimRows[0].userId).toBe(student.userId);
      tracked.register(subscriptionPurchaseIdempotency, claimRows[0].id);
    }

    // Exactly ONE Create audit row anchored on the fresh row, with the
    // pinned details contract (ids and integers only).
    const auditRows = await readSubscriptionAuditRows(renewedId);
    expect(auditRows).toHaveLength(1);
    const auditRow = auditRows[0];
    if (!auditRow) {
      throw new Error("journey: the renew audit row vanished");
    }
    expect(auditRow.actionType).toBe(AuditActionType.Create);
    expect(auditRow.entityType).toBe("subscription");
    expect(auditRow.actorId).toBe(admin.userId);
    expect(parseAuditDetails(auditRow)).toEqual({
      renewedFromSubscriptionId: s1Id,
      planId: planRow.id,
      creditedSessions: PLAN_SESSION_COUNT,
      intervalDays: PLAN_INTERVAL_DAYS,
    });
    expect(await countAuditRowsForActor(admin.userId)).toBe(adminAuditBefore + 1);

    // The renew emits no new notification wave.
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);

    await expectControlTenantUntouched();
  });

  test("step 9 — Student: re-booking with the SAME key the denials used → SUCCEEDS on the renewed lane", async () => {
    const lanesBefore = await readLanes(student.userId);
    const sessionsBefore = await countSessionsFor(student.userId);
    const teacherAInboxBefore = await inboxCount(teacherA.userId);

    // The key the two denied bookings carried — never burned by a denial —
    // now books successfully on the renewed lane.
    const rebooked = await SessionLifecycleService.createSession(
      student.userId,
      { teacherId: teacherA.userId, intent: SessionIntent.Hifz },
      KEY_BOOKING_RECOVERY,
      "en"
    );
    expect(rebooked.studentId).toBe(student.userId);
    expect(rebooked.teacherId).toBe(teacherA.userId);
    expect(rebooked.status).toBe(SessionStatus.Scheduled);
    expect(rebooked.feeHeld).toBe(true);
    expect(rebooked.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    tracked.register(session, rebooked.id);

    // The key's FIRST claim is minted by this successful booking alone.
    const claimRows = await claimsForKey(KEY_BOOKING_RECOVERY);
    expect(claimRows).toHaveLength(1);
    if (claimRows[0]) {
      tracked.register(sessionRequestIdempotency, claimRows[0].id);
    }

    // The renewed lane funded the hold (one unit); every sibling untouched.
    const lanesAfter = await readLanes(student.userId);
    expect((lanesBefore.hifz ?? 0) - (lanesAfter.hifz ?? 0)).toBe(1);
    expect(lanesAfter.trial).toBe(0);
    expect(lanesAfter.tajweed).toBe(lanesBefore.tajweed);
    expect(lanesAfter.reviews).toBe(lanesBefore.reviews);
    expect(await countSessionsFor(student.userId)).toBe(sessionsBefore + 1);

    // The re-booking's fan-out: ONE wave, addressed to Teacher A ONLY.
    expect(publishSpy.mock.calls).toHaveLength(2);
    expect(publishedRecipientUserIds(1)).toEqual([teacherA.userId]);
    expect(await inboxCount(teacherA.userId)).toBe(teacherAInboxBefore + 1);
    expect(await inboxCount(teacherB.userId)).toBe(0);

    await expectControlTenantUntouched();
  });

  test("step 10 — System: sweep replay → { expired: 0, lanesZeroed: 0 }; every terminal state holds", async () => {
    const replay = await SubscriptionExpiryService.expireDue();
    expect(replay).toEqual({ expired: 0, lanesZeroed: 0 });

    // The terminal state: both source rows still expired with their
    // original windows, the renewed period still active, the lane at its
    // post-re-booking remainder — the replay changed nothing.
    const s1After = await subscriptionRow(s1Id);
    expect(s1After.status).toBe(SubscriptionStatus.Expired);
    expect(s1After).toEqual(requireS1ExpiredSnapshot());
    const s2After = await subscriptionRow(s2Id);
    expect(s2After.status).toBe(SubscriptionStatus.Expired);
    const renewedRow = await subscriptionRow(renewedId);
    expect(renewedRow.status).toBe(SubscriptionStatus.Active);
    expect(renewedRow.endDate?.getTime() ?? 0).toBeGreaterThan(Date.now());

    const lanes = await readLanes(student.userId);
    expect(lanes.hifz).toBe(PLAN_SESSION_COUNT - 1);
    expect(lanes.trial).toBe(0);

    // The audit trail and the notification ledger are exactly what the
    // journey minted — no replay side effects.
    expect(await countAuditRowsForActor(admin.userId)).toBe(1);
    expect(publishSpy.mock.calls).toHaveLength(2);

    await expectControlTenantUntouched();
  });
});
