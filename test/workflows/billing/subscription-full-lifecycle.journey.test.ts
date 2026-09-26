/**
 * Cross-actor journey — the full subscription lifecycle, end to end:
 * purchase → gateway settlement → booked-session debit → expiry sweep →
 * admin renew → plan upgrade (prorated carry) → plan downgrade (excess
 * forfeited) → admin cancel → student BFLA denials.
 *
 * Sequential, actor-attributed steps executed against the REAL services on
 * the REAL test database; every later step observes the state earlier steps
 * committed. The control tenant (S2) holds its OWN untouched subscription
 * and is byte-compared after every mutation step — no lifecycle step may
 * touch a sibling tenant's window or balances.
 *
 * Oracles reused from the established billing journey corpus:
 *  - payment/subscription pending pair + settlement window + lane credit
 *    + replay idempotency (subscription-purchase journey);
 *  - the guarded expiry sweep flip with lane zeroing and honest re-run
 *    counts, driven by row backdating only — no fake timers;
 *  - the admin renew / plan-change / cancel service surface with its
 *    idempotency claims and audit rows (subscription-admin-lifecycle
 *    journey);
 *  - plan-change proration asserted in SESSION UNITS ONLY — unit value is
 *    `price / sessionCount` in exact minor units; a strictly greater unit
 *    value is an upgrade whose carry is
 *    `floor(remaining × priceOld × scNew / (scOld × priceNew))` sessions on
 *    top of the target plan's full count, clamped to the catalog ceiling;
 *    a strictly smaller unit value is a downgrade that credits only the
 *    target count and reports the discarded remainder as forfeited.
 *
 * Security posture: the student's admin-operation attempts MUST fail through
 * the real admin-actor gate (assertActorAdmin) with zero side effects —
 * no monkey-patched authorization anywhere.
 *
 * Teardown: audit rows FIRST (actor RESTRICT), then the append-only
 * payments ledger under the sanctioned trigger suspension, then the
 * junction rows, then the tracked registry sweep (reverse registration
 * order) with zero-residue existence re-probes for EVERY tracked row. The
 * per-run `jrn_subfull_` prefix makes any crash residue greppable.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { SubscriptionRepository } from "@/backend/db/repo/billing/subscription.repository";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { createTestPlan, createTestSubscription } from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { ProrationDirection } from "@/backend/enum/billing/proration-direction.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { ForbiddenError } from "@/backend/lib/errors";
import { SubscriptionActivationService, SubscriptionPurchaseService } from "@/backend/services";
import { MAX_SESSION_COUNT } from "@/backend/services/billing/plan-catalog.helpers";
import { SUBSCRIPTION_ADMIN_CLAIM_PREFIXES } from "@/backend/services/billing/subscription-admin.helpers";
import { SubscriptionAdminService } from "@/backend/services/billing/subscription-admin.service";
import { SubscriptionExpiryService } from "@/backend/services/billing/subscription-expiry.service";
import { planChangeClaimKey } from "@/backend/services/billing/subscription-plan-change.replay.helpers";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type { DBTransaction, PaymentWebhookEvent, PlanSelectType, SubscriptionSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withAuditDeleteTriggersSuspended, withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
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

/** Per-run unique prefix — every fixture name, plan title, and idempotency key. */
const PREFIX = journeyPrefix("subfull");

/** Error-copy locale for every service call and denial assertion. */
const tErrors = getServerTranslations("en").errorsTranslations;

// ─── Journey fixtures' arithmetic (session units; exact minor-unit prices) ───

/** Plan LOW — the cheap lane entry point: unit value 25.00 minor/session. */
const LOW_SESSION_COUNT = 6;
const LOW_PRICE = "150.00";
const LOW_PRICE_MINOR = 15_000;

/** Plan HIGH — the strictly greater unit value (50.00 minor/session): upgrades. */
const HIGH_SESSION_COUNT = 12;
const HIGH_PRICE = "600.00";
const HIGH_PRICE_MINOR = 60_000;

const INTERVAL_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXPIRED_LAG_MS = 24 * 60 * 60 * 1000;
const FRESH_WINDOW_SKEW_MS = 2 * 60 * 1000;
const TRIAL_SEED = 3;

/** The upgrade carry, derived with the service's exact formula + ceiling. */
function expectedUpgradeCarry(remainingSessions: number): number {
  return Math.min(
    Math.floor((remainingSessions * LOW_PRICE_MINOR * HIGH_SESSION_COUNT) / (LOW_SESSION_COUNT * HIGH_PRICE_MINOR)),
    MAX_SESSION_COUNT
  );
}

/** The student's purchase + booking idempotency keys (per-run, verbatim). */
const KEY_PURCHASE = `${PREFIX}-purchase-key`;
const KEY_BOOKING = `${PREFIX}-booking-key`;

/** The gateway's settled webhook event for one pending payment (system actor). */
function settledWebhookEvent(reference: string, amount: string, currency: string): PaymentWebhookEvent {
  return {
    reference,
    outcome: "confirmed",
    amount,
    currency,
  };
}

/**
 * The fan-out publish spy — installed over the engine's publish boundary
 * (the activation service publishes post-commit through this exact
 * namespace-bound seam; it exposes no injected-transport parameter).
 * Restored in `afterAll`.
 */
const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});

/**
 * The expiry-sweep claim scope — the journey's own students, populated in
 * `beforeAll`. The sweep's repository seam returns its claimed projections
 * filtered to these users, so the exact sweep-count assertions stay
 * isolated from unrelated committed due rows in the shared test database
 * (the production flip itself still runs fully).
 */
const journeySweepUserIds: number[] = [];
const originalExpireDueActive = SubscriptionRepository.expireDueActive;
const sweepScopeSpy = spyOn(SubscriptionRepository, "expireDueActive").mockImplementation(
  async (now: Date, tx?: DBTransaction) => {
    const claimed = await originalExpireDueActive(now, tx);
    return claimed.filter(row => journeySweepUserIds.includes(row.userId));
  }
);

/** Ledger rows created by the services during the journey (teardown worklist). */
const ledgerPaymentIds: number[] = [];
const ledgerSubscriptionIds: number[] = [];

/** Suite-scoped fixture registry — every committed row and service-minted row. */
const tracked = new TrackedFixtures();

let studentS: JourneyActor;
let studentS2: JourneyActor;
let teacherActor: JourneyActor;
let adminActor: JourneyActor;
let lowPlan: PlanSelectType;
let highPlan: PlanSelectType;

// ─── The subscription ids the journey's legs mint, bound per step ────────────
let sPurchaseId = 0; // the purchased LOW subscription (expiry's source)
let sRenewId = 0; // the renewal's fresh active row
let sUpgradedId = 0; // the upgrade's fresh active row (plan HIGH)
let sDowngradedId = 0; // the downgrade's fresh active row (plan LOW)

/** The control tenant's untouched subscription id (never mutated). */
let s2ControlId = 0;

/** The control tenant's pre-chain snapshots (byte-identical oracle). */
let s2ControlRow: SubscriptionSelectType | null = null;

/** The student's four balance lanes as stored (nullable columns, trial notNull). */
interface StudentLanes {
  readonly hifz: number | null;
  readonly tajweed: number | null;
  readonly reviews: number | null;
  readonly trial: number;
}

let sLanesBaseline: StudentLanes | null = null;
let s2LanesBaseline: StudentLanes | null = null;

// ─── Read-back oracles ───────────────────────────────────────────────────────

/** Reads one subscription row raw, failing when absent. */
async function subscriptionRow(subscriptionId: number): Promise<SubscriptionSelectType> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: subscription row ${subscriptionId} vanished`);
  }
  return row;
}

/** Reads one student's live balance lanes. */
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

/** Reads the single notification row of an inbox, failing on any other shape. */
async function soleNotification(userId: number) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
  const row = rows[0];
  if (rows.length !== 1 || !row) {
    throw new Error(`expected exactly one notification row for user ${userId}, found ${rows.length}`);
  }
  return row;
}

/** One audit row projected to the fields the journey pins. */
interface AuditRow {
  readonly id: number;
  readonly actorId: number;
  readonly actionType: string;
  readonly details: string | null;
}

/** Reads the audit rows anchored on one subscription, oldest first. */
async function readSubscriptionAuditRows(subscriptionId: number): Promise<AuditRow[]> {
  return db
    .select({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actionType: auditLogs.actionType,
      details: auditLogs.details,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "subscription"), eq(auditLogs.entityId, subscriptionId)))
    .orderBy(auditLogs.id);
}

/** Counts audit rows minted BY one actor (zero-mint oracle for denials). */
async function countAuditRowsForActor(actorId: number): Promise<number> {
  return db.$count(auditLogs, eq(auditLogs.actorId, actorId));
}

/** Plain-object type guard over an untyped `JSON.parse` result. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses an audit row's `details` payload into a plain JSON object. */
function parseAuditDetails(row: AuditRow): Record<string, unknown> {
  const parsed: unknown = JSON.parse(row.details ?? "null");
  if (!isPlainRecord(parsed)) {
    throw new Error(`journey: audit row ${row.id} details payload is not a JSON object`);
  }
  return parsed;
}

/** Narrows the purchaser's lane baseline (a missing baseline is an ordering bug). */
/** Narrows the control tenant's lane baseline (missing = an ordering bug). */
function requireS2LanesBaseline(): StudentLanes {
  if (!s2LanesBaseline) {
    throw new Error("journey: the control tenant's lane baseline was never captured in setup");
  }
  return s2LanesBaseline;
}

/** Narrows the purchaser's lane baseline (a missing baseline is an ordering bug). */
function requireLanesBaseline(): StudentLanes {
  if (!sLanesBaseline) {
    throw new Error("journey: the purchaser's lane baseline was never captured in setup");
  }
  return sLanesBaseline;
}

/** Narrows the control-tenant snapshot (a missing snapshot is an ordering bug). */
function requireS2Snapshot(): SubscriptionSelectType {
  if (!s2ControlRow) {
    throw new Error("journey: the control tenant's pre-chain snapshot was never captured");
  }
  return s2ControlRow;
}

/**
 * The control-tenant invariance oracle — the untouched sibling's
 * subscription row, lanes, and inbox are byte-identical to the pre-chain
 * snapshots.
 */
async function expectControlTenantUntouched(): Promise<void> {
  expect(await subscriptionRow(s2ControlId)).toEqual(requireS2Snapshot());
  expect(await readLanes(studentS2.userId)).toEqual(requireS2LanesBaseline());
  expect(await inboxCount(studentS2.userId)).toBe(0);
}

/** Registers one service-minted subscription (+ junction sweep entry). */
function trackSubscription(subscriptionId: number): void {
  tracked.register(subscriptions, subscriptionId);
  ledgerSubscriptionIds.push(subscriptionId);
}

// ─── Fixture provisioning + teardown ──────────────────────────────────────────

beforeAll(async () => {
  // ONE committing transaction: commit-or-nothing fixture provisioning.
  await db.transaction(async tx => {
    studentS = await provisionStudentActor(tx, { tracked });
    studentS2 = await provisionStudentActor(tx, { tracked });
    teacherActor = await provisionCertifiedTeacherActor(tx, { tracked });
    adminActor = await provisionAdminActor(tx, { tracked });

    // The activation composes its confirmation copy in the recipient's
    // persisted locale — pin both students to the EN bundle.
    await tx
      .update(users)
      .set({ locale: "en" })
      .where(inArray(users.id, [studentS.userId, studentS2.userId]));

    // The debit ladder is trial-first: drain the purchaser's trial lane so
    // the step-5 booking funds its hold from the credited subscription lane
    // (the journey's debit oracle is the hifz lane, not the trial allowance).
    await tx.update(students).set({ balanceTrial: 0 }).where(eq(students.id, studentS.userId));

    lowPlan = await createTestPlan(tx, {
      title: `${PREFIX} LOW plan`,
      sessionCount: LOW_SESSION_COUNT,
      price: LOW_PRICE,
      currency: "EGP",
      intervalDays: INTERVAL_DAYS,
      balanceLane: SubscriptionCreditLane.Hifz,
    });
    tracked.register(plans, lowPlan.id);

    highPlan = await createTestPlan(tx, {
      title: `${PREFIX} HIGH plan`,
      sessionCount: HIGH_SESSION_COUNT,
      price: HIGH_PRICE,
      currency: "EGP",
      intervalDays: INTERVAL_DAYS,
      balanceLane: SubscriptionCreditLane.Hifz,
    });
    tracked.register(plans, highPlan.id);

    // The control tenant's OWN subscription — active, on the LOW plan, with
    // a future window so the expiry sweep never claims it. Never mutated by
    // any journey step; byte-compared after every mutation leg.
    const control = await createTestSubscription(tx, studentS2.userId, lowPlan.id, {
      status: SubscriptionStatus.Active,
      startDate: new Date(Date.now() - MS_PER_DAY),
      endDate: new Date(Date.now() + INTERVAL_DAYS * MS_PER_DAY),
    });
    s2ControlId = control.id;
    tracked.register(subscriptions, s2ControlId);
    ledgerSubscriptionIds.push(s2ControlId);
  });

  // Pre-chain lane snapshots for both students (the byte-identical oracles).
  sLanesBaseline = await readLanes(studentS.userId);
  s2LanesBaseline = await readLanes(studentS2.userId);
  s2ControlRow = await subscriptionRow(s2ControlId);

  // The sweep scope: the journey's own cast (see `sweepScopeSpy`).
  journeySweepUserIds.push(studentS.userId, studentS2.userId);
});

afterAll(async () => {
  publishSpy.mockRestore();
  sweepScopeSpy.mockRestore();

  // Every user id the journey created (the cast; no service here mints users).
  const journeyUserIds = [studentS?.userId, studentS2?.userId, teacherActor?.userId, adminActor?.userId].filter(
    (id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0
  );

  // 1. Audit rows FIRST — `audit_logs.actor_id` is ON DELETE RESTRICT, and
  //    the append-only immutability trigger must be suspended for the delete
  //    (the only sanctioned mutation path). Every lifecycle audit row is
  //    attributed to the journey admin; the user-entity sweep is defensive.
  if (journeyUserIds.length > 0) {
    await withAuditDeleteTriggersSuspended(async () => {
      await db.delete(auditLogs).where(inArray(auditLogs.actorId, journeyUserIds));
      await queryDb(
        `DELETE FROM audit_logs
         WHERE entity_type = 'user' AND entity_id = ANY($1::int[])`,
        [journeyUserIds]
      );
    });

    // Defensive notification sweep — the activation's confirmation fan-out
    // is tracked, and `user_id` cascades on user delete anyway.
    await db.delete(notifications).where(inArray(notifications.userId, journeyUserIds));
  }

  // 2. The append-only payments ledger — the sanctioned suspension wraps
  //    exactly this leg.
  if (ledgerPaymentIds.length > 0) {
    await withImmutabilityTriggersSuspended(["student_payments"], () =>
      db.delete(studentPayments).where(inArray(studentPayments.id, ledgerPaymentIds))
    );
  }

  // 3. Junction rows (composite PK — no registry entry; swept by subscription
  //    id and re-probed ahead of the tracked sweep that deletes parents).
  if (ledgerSubscriptionIds.length > 0) {
    await db.delete(studentSubscriptions).where(inArray(studentSubscriptions.subscriptionId, ledgerSubscriptionIds));
    const junctionResidue = await db.$count(
      studentSubscriptions,
      inArray(studentSubscriptions.subscriptionId, ledgerSubscriptionIds)
    );
    if (junctionResidue !== 0) {
      throw new Error(`journey teardown: ${junctionResidue} junction row(s) survived deletion`);
    }
  }

  // 4. Tracked hard-delete in reverse registration order (service-minted
  //    sessions, claims, subscriptions first; the cast rows last) with the
  //    mandatory zero-residue existence re-probes for EVERY tracked row.
  await tracked.cleanup();
});

// ─── The journey ──────────────────────────────────────────────────────────────

describe("cross-actor journey: subscription full lifecycle (purchase → settle → debit → expiry → renew → proration → cancel)", () => {
  test("step 1 — System: cast + LOW/HIGH plans + control subscription committed; pre-chain snapshots captured", async () => {
    // Both plans ride the SAME hifz lane and differ in session count and
    // price; HIGH's unit value (600.00/12) is strictly greater than LOW's
    // (150.00/6) — the upgrade/downgrade direction is pinned by shape.
    expect(lowPlan.sessionCount).toBe(LOW_SESSION_COUNT);
    expect(lowPlan.balanceLane).toBe(SubscriptionCreditLane.Hifz);
    expect(highPlan.sessionCount).toBe(HIGH_SESSION_COUNT);
    expect(highPlan.balanceLane).toBe(SubscriptionCreditLane.Hifz);

    // The control tenant's committed baseline: an active LOW subscription
    // with a live window, and a clean inbox for every cast member.
    const control = await subscriptionRow(s2ControlId);
    expect(control.status).toBe(SubscriptionStatus.Active);
    expect(control.planId).toBe(lowPlan.id);
    expect(control.endDate?.getTime() ?? 0).toBeGreaterThan(Date.now());
    expect(await inboxCount(studentS.userId)).toBe(0);
    expect(await inboxCount(studentS2.userId)).toBe(0);
    expect(await inboxCount(adminActor.userId)).toBe(0);

    // Nothing minted anywhere yet.
    expect(await countAuditRowsForActor(adminActor.userId)).toBe(0);
    expect(await countAuditRowsForActor(studentS.userId)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(0);
  });

  test("step 2 — Student S: purchase LOW → ONE pending pair, gateway correlation, verbatim claim", async () => {
    const result = await SubscriptionPurchaseService.purchase(
      studentS.userId,
      { planId: lowPlan.id },
      KEY_PURCHASE,
      "en"
    );

    sPurchaseId = result.subscription.id;
    expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
    expect(result.subscription.planId).toBe(lowPlan.id);
    expect(result.subscription.paymentReference).toBe(result.checkout.providerReference);
    expect(result.payment.status).toBe(PaymentStatus.Pending);
    expect(result.payment.amount).toBe(lowPlan.price);
    expect(result.payment.subscriptionId).toBe(sPurchaseId);

    // Track EVERY service-created row before asserting anything else.
    trackSubscription(sPurchaseId);
    tracked.register(studentPayments, result.payment.id);
    ledgerPaymentIds.push(result.payment.id);
    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, KEY_PURCHASE));
    expect(claimRows).toHaveLength(1);
    if (claimRows[0]) {
      tracked.register(subscriptionPurchaseIdempotency, claimRows[0].id);
    }

    // Zero credit while the payment is undecided.
    expect(await readLanes(studentS.userId)).toEqual(requireLanesBaseline());
    await expectControlTenantUntouched();
  });

  test("step 3 — System: settled webhook → paid + active window + LOW lane credit; ONE confirmation to S ONLY", async () => {
    const windowStart = Date.now() - FRESH_WINDOW_SKEW_MS;
    const purchased = await subscriptionRow(sPurchaseId);
    const purchaseReference = purchased.paymentReference;
    if (purchaseReference === null) {
      throw new Error("journey: the pending subscription lost its gateway payment reference");
    }

    const outcome = await SubscriptionActivationService.processWebhookEvent(
      settledWebhookEvent(purchaseReference, lowPlan.price, lowPlan.currency),
      "en"
    );
    expect(outcome).toEqual({ processed: true });

    // The ledger decision and the activation window (exactly one interval).
    const paid = await db
      .select()
      .from(studentPayments)
      .where(eq(studentPayments.id, ledgerPaymentIds[0] ?? 0))
      .limit(1);
    expect(paid[0]?.status).toBe(PaymentStatus.Paid);
    const active = await subscriptionRow(sPurchaseId);
    expect(active.status).toBe(SubscriptionStatus.Active);
    expect(active.paymentVerifiedAt).not.toBeNull();
    expect(active.startDate?.getTime() ?? 0).toBeGreaterThanOrEqual(windowStart);
    expect((active.endDate?.getTime() ?? 0) - (active.startDate?.getTime() ?? 0)).toBe(INTERVAL_DAYS * MS_PER_DAY);

    // The lane credit: exactly LOW's session count on the hifz lane; every
    // sibling lane (incl. trial) byte-identical.
    const lanesAfter = await readLanes(studentS.userId);
    expect((lanesAfter.hifz ?? 0) - (requireLanesBaseline().hifz ?? 0)).toBe(LOW_SESSION_COUNT);
    expect(lanesAfter.tajweed).toBe(requireLanesBaseline().tajweed);
    expect(lanesAfter.reviews).toBe(requireLanesBaseline().reviews);
    expect(lanesAfter.trial).toBe(requireLanesBaseline().trial);

    // ONE persisted confirmation, addressed to the purchaser only.
    const notification = await soleNotification(studentS.userId);
    tracked.register(notifications, notification.id);
    expect(notification.userId).toBe(studentS.userId);
    expect(publishSpy.mock.calls).toHaveLength(1);

    await expectControlTenantUntouched();
  });

  test("step 4 — System: replaying the SAME settled event → replayed ack, no double credit, decided rows untouched", async () => {
    const lanesBefore = await readLanes(studentS.userId);
    const decidedBefore = await subscriptionRow(sPurchaseId);
    const publishesBefore = publishSpy.mock.calls.length;
    const inboxBefore = await inboxCount(studentS.userId);

    const replayReference = decidedBefore.paymentReference;
    if (replayReference === null) {
      throw new Error("journey: the activated subscription lost its gateway payment reference");
    }
    const replay = await SubscriptionActivationService.processWebhookEvent(
      settledWebhookEvent(replayReference, lowPlan.price, lowPlan.currency),
      "en"
    );
    expect(replay).toEqual({ processed: true, replayed: true });

    expect(await readLanes(studentS.userId)).toEqual(lanesBefore);
    expect(await inboxCount(studentS.userId)).toBe(inboxBefore);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
    const decidedAfter = await subscriptionRow(sPurchaseId);
    expect(decidedAfter.startDate?.getTime()).toBe(decidedBefore.startDate?.getTime());
    expect(decidedAfter.endDate?.getTime()).toBe(decidedBefore.endDate?.getTime());

    await expectControlTenantUntouched();
  });

  test("step 5 — Student S: book ONE session with T → the hifz lane funds the hold (−1) through the real debit ladder", async () => {
    const lanesBefore = await readLanes(studentS.userId);
    const inboxBefore = await inboxCount(studentS.userId);

    const booked = await SessionLifecycleService.createSession(
      studentS.userId,
      { teacherId: teacherActor.userId, intent: SessionIntent.Hifz },
      KEY_BOOKING,
      "en"
    );
    expect(booked.studentId).toBe(studentS.userId);
    expect(booked.teacherId).toBe(teacherActor.userId);
    expect(booked.feeHeld).toBe(true);
    expect(booked.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    tracked.register(session, booked.id);

    // The booking's idempotency claim — spent once, registered for teardown.
    const claimRows = await db
      .select()
      .from(sessionRequestIdempotency)
      .where(eq(sessionRequestIdempotency.idempotencyKey, KEY_BOOKING));
    expect(claimRows).toHaveLength(1);
    if (claimRows[0]) {
      tracked.register(sessionRequestIdempotency, claimRows[0].id);
    }

    // The real debit ladder moved exactly one unit from the credited lane.
    const lanesAfter = await readLanes(studentS.userId);
    expect((lanesBefore.hifz ?? 0) - (lanesAfter.hifz ?? 0)).toBe(1);
    expect(lanesAfter.trial).toBe(lanesBefore.trial);
    expect(lanesAfter.tajweed).toBe(lanesBefore.tajweed);
    expect(lanesAfter.reviews).toBe(lanesBefore.reviews);

    // The booking fanned no receipt publish through the billing seam.
    expect(publishSpy.mock.calls).toHaveLength(1);
    expect(await inboxCount(studentS.userId)).toBe(inboxBefore);

    await expectControlTenantUntouched();
  });

  test("step 6 — System: backdate S's window past now → the row stays active (the sweep alone closes the gap)", async () => {
    // Seed a nonzero trial allowance so the sweep's trial-survival oracle is
    // non-trivial.
    await db
      .update(students)
      .set({ balanceTrial: TRIAL_SEED, trialGrantedAt: new Date() })
      .where(eq(students.id, studentS.userId));
    const lanesBeforeSweep = await readLanes(studentS.userId);
    expect(lanesBeforeSweep.hifz).toBe(LOW_SESSION_COUNT - 1);
    expect(lanesBeforeSweep.trial).toBe(TRIAL_SEED);

    // Direct Drizzle backdate — second-precision resolution so the written
    // value and every later read-back agree exactly. Time control is row
    // backdating ONLY; no fake timers anywhere in this file.
    const laggedEndDate = new Date(secondPrecisionMs(Date.now()) - EXPIRED_LAG_MS);
    await db.update(subscriptions).set({ endDate: laggedEndDate }).where(eq(subscriptions.id, sPurchaseId));

    // The lag: past its window but still `active` — no state change yet.
    const lagging = await subscriptionRow(sPurchaseId);
    expect(lagging.status).toBe(SubscriptionStatus.Active);
    expect(lagging.endDate?.getTime()).toBe(laggedEndDate.getTime());

    await expectControlTenantUntouched();
  });

  test("step 7 — System: expiry sweep → { expired: 1, lanesZeroed: 1 }; hifz zeroed, trial intact, S2 byte-identical", async () => {
    const preSweep = await subscriptionRow(sPurchaseId);
    const sweep = await SubscriptionExpiryService.expireDue();
    expect(sweep).toEqual({ expired: 1, lanesZeroed: 1 });

    // The flip: expired with the ORIGINAL window dates (the sweep mutates
    // status + balances only).
    const expired = await subscriptionRow(sPurchaseId);
    expect(expired.status).toBe(SubscriptionStatus.Expired);
    expect(expired.startDate?.getTime()).toBe(preSweep.startDate?.getTime());
    expect(expired.endDate?.getTime()).toBe(preSweep.endDate?.getTime());

    // The uncovered lane zeroed; the trial allowance survives EXACTLY (the
    // trial lane is never subscription-bound).
    const lanes = await readLanes(studentS.userId);
    expect(lanes.hifz).toBe(0);
    expect(lanes.trial).toBe(TRIAL_SEED);
    expect(lanes.tajweed).toBe(requireLanesBaseline().tajweed);
    expect(lanes.reviews).toBe(requireLanesBaseline().reviews);

    await expectControlTenantUntouched();
  });

  test("step 8 — System: sweep replay → honest zero counts; every terminal state holds", async () => {
    const replay = await SubscriptionExpiryService.expireDue();
    expect(replay).toEqual({ expired: 0, lanesZeroed: 0 });

    const expired = await subscriptionRow(sPurchaseId);
    expect(expired.status).toBe(SubscriptionStatus.Expired);
    const lanes = await readLanes(studentS.userId);
    expect(lanes.hifz).toBe(0);
    expect(lanes.trial).toBe(TRIAL_SEED);

    await expectControlTenantUntouched();
  });

  test("step 9 — Admin A: renew the expired source → fresh ACTIVE row, LOW lane re-credited, claim + Create audit row", async () => {
    const junctionBefore = await db
      .select({ subscriptionId: studentSubscriptions.subscriptionId })
      .from(studentSubscriptions)
      .where(eq(studentSubscriptions.studentId, studentS.userId));
    const auditForAdminBefore = await countAuditRowsForActor(adminActor.userId);

    const renewed = await SubscriptionAdminService.renewSubscription(
      { subscriptionId: sPurchaseId },
      adminActor.userId,
      "en"
    );

    sRenewId = renewed.id;
    expect(sRenewId).not.toBe(sPurchaseId);
    expect(renewed.status).toBe(SubscriptionStatus.Active);
    expect(renewed.planId).toBe(lowPlan.id);
    expect(renewed.paymentMethod).toBeNull();
    expect(renewed.paymentReference).toBeNull();
    trackSubscription(sRenewId);

    // A fresh window opening at the renewal instant, spanning one interval.
    expect(Math.abs((renewed.startDate?.getTime() ?? 0) - Date.now())).toBeLessThan(FRESH_WINDOW_SKEW_MS);
    expect((renewed.endDate?.getTime() ?? 0) - (renewed.startDate?.getTime() ?? 0)).toBe(INTERVAL_DAYS * MS_PER_DAY);

    // The lane credit: zeroed by the sweep + the LOW plan's full count.
    const lanes = await readLanes(studentS.userId);
    expect(lanes.hifz).toBe(LOW_SESSION_COUNT);

    // The junction links the owner to the NEW row too.
    const junctionAfter = await db
      .select({ subscriptionId: studentSubscriptions.subscriptionId })
      .from(studentSubscriptions)
      .where(eq(studentSubscriptions.studentId, studentS.userId));
    expect(junctionAfter).toHaveLength(junctionBefore.length + 1);

    // The idempotency claim: server-constructed renew key, owner-bound.
    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(
        eq(subscriptionPurchaseIdempotency.idempotencyKey, `${SUBSCRIPTION_ADMIN_CLAIM_PREFIXES.renew}:${sPurchaseId}`)
      );
    expect(claimRows).toHaveLength(1);
    if (claimRows[0]) {
      tracked.register(subscriptionPurchaseIdempotency, claimRows[0].id);
    }

    // Exactly ONE Create audit row anchored on the fresh row.
    const auditRows = await readSubscriptionAuditRows(sRenewId);
    expect(auditRows).toHaveLength(1);
    if (auditRows[0]) {
      expect(auditRows[0].actionType).toBe(AuditActionType.Create);
      expect(auditRows[0].actorId).toBe(adminActor.userId);
      expect(parseAuditDetails(auditRows[0])).toEqual({
        renewedFromSubscriptionId: sPurchaseId,
        planId: lowPlan.id,
        creditedSessions: LOW_SESSION_COUNT,
        intervalDays: INTERVAL_DAYS,
      });
    }
    expect(await countAuditRowsForActor(adminActor.userId)).toBe(auditForAdminBefore + 1);

    await expectControlTenantUntouched();
  });

  test("step 10 — Admin A: renew replay → the SAME fresh row returns; NOTHING new (lane, claim, audit)", async () => {
    const lanesBefore = await readLanes(studentS.userId);
    const claimsBefore = await db.$count(
      subscriptionPurchaseIdempotency,
      eq(subscriptionPurchaseIdempotency.userId, studentS.userId)
    );
    const auditForAdminBefore = await countAuditRowsForActor(adminActor.userId);

    const replayed = await SubscriptionAdminService.renewSubscription(
      { subscriptionId: sPurchaseId },
      adminActor.userId,
      "en"
    );

    expect(replayed.id).toBe(sRenewId);
    expect(replayed.status).toBe(SubscriptionStatus.Active);
    expect(await readLanes(studentS.userId)).toEqual(lanesBefore);
    expect(
      await db.$count(subscriptionPurchaseIdempotency, eq(subscriptionPurchaseIdempotency.userId, studentS.userId))
    ).toBe(claimsBefore);
    expect(await readSubscriptionAuditRows(sRenewId)).toHaveLength(1);
    expect(await countAuditRowsForActor(adminActor.userId)).toBe(auditForAdminBefore);

    await expectControlTenantUntouched();
  });

  test("step 11 — Admin A: plan-change UP to HIGH → Upgrade direction, floored carry on top of HIGH's count, Override audit row", async () => {
    const remaining = LOW_SESSION_COUNT; // the renewal's credit is the whole lane
    const expectedCarry = expectedUpgradeCarry(remaining);
    const auditForAdminBefore = await countAuditRowsForActor(adminActor.userId);

    const changed = await SubscriptionAdminService.changeSubscriptionPlan(
      { subscriptionId: sRenewId, newPlanId: highPlan.id },
      adminActor.userId,
      "en"
    );

    // The proration payload: HIGH's unit value is strictly greater, so the
    // direction is Upgrade; the carry is the exact floored ratio clamped to
    // the catalog ceiling; nothing is forfeited on an upgrade.
    sUpgradedId = changed.subscription.id;
    expect(sUpgradedId).not.toBe(sRenewId);
    expect(changed.direction).toBe(ProrationDirection.Upgrade);
    expect(changed.carrySessions).toBe(expectedCarry);
    expect(changed.forfeitedSessions).toBe(0);
    trackSubscription(sUpgradedId);

    // The fresh row: active on HIGH, one fresh interval, no gateway payload.
    const upgraded = await subscriptionRow(sUpgradedId);
    expect(upgraded.status).toBe(SubscriptionStatus.Active);
    expect(upgraded.planId).toBe(highPlan.id);
    expect(upgraded.paymentMethod).toBeNull();
    expect(upgraded.paymentReference).toBeNull();
    expect((upgraded.endDate?.getTime() ?? 0) - (upgraded.startDate?.getTime() ?? 0)).toBe(INTERVAL_DAYS * MS_PER_DAY);

    // The source row is flipped to cancelled by the same change.
    expect((await subscriptionRow(sRenewId)).status).toBe(SubscriptionStatus.Cancelled);

    // The lane settles to HIGH's full count PLUS the carry.
    const lanes = await readLanes(studentS.userId);
    expect(lanes.hifz).toBe(HIGH_SESSION_COUNT + expectedCarry);

    // The idempotency claim: one, keyed from the certified (source, target)
    // pair, backfilled with the fresh row's id.
    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, planChangeClaimKey(sRenewId, highPlan.id)));
    expect(claimRows).toHaveLength(1);
    if (claimRows[0]) {
      tracked.register(subscriptionPurchaseIdempotency, claimRows[0].id);
    }

    // Exactly ONE Override audit row anchored on the fresh row.
    const auditRows = await readSubscriptionAuditRows(sUpgradedId);
    expect(auditRows).toHaveLength(1);
    if (auditRows[0]) {
      expect(auditRows[0].actionType).toBe(AuditActionType.Override);
      expect(auditRows[0].actorId).toBe(adminActor.userId);
      expect(parseAuditDetails(auditRows[0])).toEqual({
        direction: ProrationDirection.Upgrade,
        fromSubscriptionId: sRenewId,
        fromPlanId: lowPlan.id,
        toPlanId: highPlan.id,
        carrySessions: expectedCarry,
        forfeitedExcess: 0,
      });
    }
    expect(await countAuditRowsForActor(adminActor.userId)).toBe(auditForAdminBefore + 1);

    await expectControlTenantUntouched();
  });

  test("step 12 — Admin A: replay the SAME plan change → the SAME upgraded row returns, direction re-derived, NOTHING new", async () => {
    const lanesBefore = await readLanes(studentS.userId);
    const claimsBefore = await db.$count(
      subscriptionPurchaseIdempotency,
      eq(subscriptionPurchaseIdempotency.userId, studentS.userId)
    );
    const auditForAdminBefore = await countAuditRowsForActor(adminActor.userId);

    const replayed = await SubscriptionAdminService.changeSubscriptionPlan(
      { subscriptionId: sRenewId, newPlanId: highPlan.id },
      adminActor.userId,
      "en"
    );

    // The replay resolves through the idempotency claim: the original row
    // returns with the direction RE-DERIVED from the two plan rows. THIS
    // call moved nothing, so the replay reports a zero carry — the original
    // computation consumed the remainder.
    expect(replayed.subscription.id).toBe(sUpgradedId);
    expect(replayed.direction).toBe(ProrationDirection.Upgrade);
    expect(replayed.carrySessions).toBe(0);

    expect(await readLanes(studentS.userId)).toEqual(lanesBefore);
    expect(
      await db.$count(subscriptionPurchaseIdempotency, eq(subscriptionPurchaseIdempotency.userId, studentS.userId))
    ).toBe(claimsBefore);
    expect(await readSubscriptionAuditRows(sUpgradedId)).toHaveLength(1);
    expect(await countAuditRowsForActor(adminActor.userId)).toBe(auditForAdminBefore);

    await expectControlTenantUntouched();
  });

  test("step 13 — Admin A: plan-change DOWN to LOW → Downgrade direction, excess forfeited, lane resets to LOW's count, Override audit row", async () => {
    const lanesBefore = await readLanes(studentS.userId);
    const excess = lanesBefore.hifz ?? 0; // the whole carried lane is the excess
    const auditForAdminBefore = await countAuditRowsForActor(adminActor.userId);

    const changed = await SubscriptionAdminService.changeSubscriptionPlan(
      { subscriptionId: sUpgradedId, newPlanId: lowPlan.id },
      adminActor.userId,
      "en"
    );

    // LOW's unit value is strictly smaller: a downgrade carries nothing and
    // forfeits the whole remaining lane.
    sDowngradedId = changed.subscription.id;
    expect(sDowngradedId).not.toBe(sUpgradedId);
    expect(changed.direction).toBe(ProrationDirection.Downgrade);
    expect(changed.carrySessions).toBe(0);
    expect(changed.forfeitedSessions).toBe(excess);
    trackSubscription(sDowngradedId);

    const downgraded = await subscriptionRow(sDowngradedId);
    expect(downgraded.status).toBe(SubscriptionStatus.Active);
    expect(downgraded.planId).toBe(lowPlan.id);
    expect((await subscriptionRow(sUpgradedId)).status).toBe(SubscriptionStatus.Cancelled);

    // The lane resets to LOW's full count — the excess is forfeited.
    const lanes = await readLanes(studentS.userId);
    expect(lanes.hifz).toBe(LOW_SESSION_COUNT);

    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, planChangeClaimKey(sUpgradedId, lowPlan.id)));
    expect(claimRows).toHaveLength(1);
    if (claimRows[0]) {
      tracked.register(subscriptionPurchaseIdempotency, claimRows[0].id);
    }

    // Exactly ONE Override audit row recording the forfeit.
    const auditRows = await readSubscriptionAuditRows(sDowngradedId);
    expect(auditRows).toHaveLength(1);
    if (auditRows[0]) {
      expect(auditRows[0].actionType).toBe(AuditActionType.Override);
      expect(parseAuditDetails(auditRows[0])).toEqual({
        direction: ProrationDirection.Downgrade,
        fromSubscriptionId: sUpgradedId,
        fromPlanId: highPlan.id,
        toPlanId: lowPlan.id,
        carrySessions: 0,
        forfeitedExcess: excess,
      });
    }
    expect(await countAuditRowsForActor(adminActor.userId)).toBe(auditForAdminBefore + 1);

    await expectControlTenantUntouched();
  });

  test("step 14 — Admin A: cancel the active row → cancelled; every lane byte-identical preserved; one Suspend audit row", async () => {
    const lanesBefore = await readLanes(studentS.userId);
    const windowBefore = await subscriptionRow(sDowngradedId);

    const cancelled = await SubscriptionAdminService.cancelSubscription(
      { subscriptionId: sDowngradedId, reason: `${PREFIX} lifecycle cancel` },
      adminActor.userId,
      "en"
    );

    expect(cancelled.id).toBe(sDowngradedId);
    expect(cancelled.status).toBe(SubscriptionStatus.Cancelled);
    const after = await subscriptionRow(sDowngradedId);
    expect(after.status).toBe(SubscriptionStatus.Cancelled);
    expect(after.endDate?.getTime()).toBe(windowBefore.endDate?.getTime());

    // Balance preservation: the cancel op itself mutates NO lane.
    expect(await readLanes(studentS.userId)).toEqual(lanesBefore);

    const auditRows = await readSubscriptionAuditRows(sDowngradedId);
    expect(auditRows).toHaveLength(2); // the downgrade Override + this Suspend
    if (auditRows[1]) {
      expect(auditRows[1].actionType).toBe(AuditActionType.Suspend);
      expect(auditRows[1].actorId).toBe(adminActor.userId);
    }

    await expectControlTenantUntouched();
  });

  test("step 15 — Student S: attempts every admin op (renew / change plan / cancel) → ForbiddenError through the real admin gate, zero side effects", async () => {
    const lanesBefore = await readLanes(studentS.userId);
    const subscriptionsBefore = await db.$count(subscriptions, eq(subscriptions.userId, studentS.userId));
    const auditForStudentBefore = await countAuditRowsForActor(studentS.userId);
    const auditForAdminBefore = await countAuditRowsForActor(adminActor.userId);
    const rowBefore = await subscriptionRow(sDowngradedId);

    // Each admin surface re-asserts the actor's role before any read or
    // write — a student caller never gets past the gate.
    const renewDenial = await catchJourneyError(() =>
      SubscriptionAdminService.renewSubscription({ subscriptionId: sPurchaseId }, studentS.userId, "en")
    );
    expect(renewDenial).toBeInstanceOf(ForbiddenError);
    expect(renewDenial.message).toContain(tErrors.forbidden);

    const changeDenial = await catchJourneyError(() =>
      SubscriptionAdminService.changeSubscriptionPlan(
        { subscriptionId: sDowngradedId, newPlanId: highPlan.id },
        studentS.userId,
        "en"
      )
    );
    expect(changeDenial).toBeInstanceOf(ForbiddenError);
    expect(changeDenial.message).toContain(tErrors.forbidden);

    const cancelDenial = await catchJourneyError(() =>
      SubscriptionAdminService.cancelSubscription(
        { subscriptionId: sDowngradedId, reason: `${PREFIX} student self-cancel attempt` },
        studentS.userId,
        "en"
      )
    );
    expect(cancelDenial).toBeInstanceOf(ForbiddenError);
    expect(cancelDenial.message).toContain(tErrors.forbidden);

    // Zero side effects across all three attempts: no lane delta, no new
    // subscription row, no status flip on the targeted row, no audit mint
    // by ANY cast member.
    expect(await readLanes(studentS.userId)).toEqual(lanesBefore);
    expect(await db.$count(subscriptions, eq(subscriptions.userId, studentS.userId))).toBe(subscriptionsBefore);
    const rowAfter = await subscriptionRow(sDowngradedId);
    expect(rowAfter.status).toBe(rowBefore.status);
    expect(rowAfter.endDate?.getTime()).toBe(rowBefore.endDate?.getTime());
    expect(await countAuditRowsForActor(studentS.userId)).toBe(auditForStudentBefore);
    expect(await countAuditRowsForActor(adminActor.userId)).toBe(auditForAdminBefore);

    await expectControlTenantUntouched();
  });

  test("step 16 — System: final tenancy sweep — the control tenant's subscription, lanes, and inbox are byte-identical to step 1", async () => {
    await expectControlTenantUntouched();

    // The journey's own terminal footprint through the owner's read: the
    // purchased row expired, the renewal row cancelled by the upgrade, the
    // upgraded row cancelled by the downgrade, the downgraded row cancelled.
    const own = await SubscriptionPurchaseService.listOwn(studentS.userId, "en");
    const statusesById = new Map(own.map(row => [row.id, row.status]));
    expect(statusesById.get(sPurchaseId)).toBe(SubscriptionStatus.Expired);
    expect(statusesById.get(sRenewId)).toBe(SubscriptionStatus.Cancelled);
    expect(statusesById.get(sUpgradedId)).toBe(SubscriptionStatus.Cancelled);
    expect(statusesById.get(sDowngradedId)).toBe(SubscriptionStatus.Cancelled);
  });
});
