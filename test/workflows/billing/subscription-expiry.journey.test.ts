/**
 * Cross-actor journey — subscription validity window → expiry sweep → booking
 * enforcement workflow.
 *
 * Sequential, actor-attributed steps executed against the REAL services on
 * the REAL test database (later steps observe the shared state earlier steps
 * committed):
 *
 *   1. Student A purchases a plan and the gateway confirms the event →
 *      payment `paid`, subscription `active` with `endDate − startDate`
 *      exactly `intervalDays` days (the activation window arithmetic, pinned
 *      at raw and second-precision resolution), the plan's hifz lane credited
 *      the full sessionCount, ONE payment-confirmation notification
 *      persisted, and the receipt published strictly post-commit to A only.
 *   2. Student B rides the SAME real activation path → B's own active
 *      subscription + credited lane: the baseline the isolation probe later
 *      re-proves byte-identical.
 *   3. System: A's `endDate` is backdated past the window (direct Drizzle
 *      write at second-precision resolution, the expired-row fixture shape)
 *      and A's trial allowance is seeded — the row REMAINS `active` (the
 *      window-vs-status lag is expected; the sweep closes it). Pre-sweep
 *      snapshots are captured for every byte-identical probe.
 *   4. System: the expiry sweep runs → honest counts `{ expired: 1,
 *      lanesZeroed: 1 }`; A's row flips to `expired` keeping the ORIGINAL
 *      start/end dates (the sweep mutates status + balances only); A's
 *      uncovered hifz lane zeroes while `balance_trial` survives intact
 *      (the trial lane is never subscription-bound); B's subscription row,
 *      lanes, and inbox are byte-identical — zero cross-tenant effect.
 *   5. Student A: booking on the expired + zeroed lane (trial empty) →
 *      denied. The service-level rejection is captured through the real
 *      authorization path (`SUBSCRIPTION_EXPIRED` on the domain-error
 *      contract, localized copy — never the raw key) AND the same denial
 *      rides the real GraphQL scope gate as exactly one error carrying
 *      `extensions.code === "SUBSCRIPTION_EXPIRED"`; ZERO rows written
 *      (lanes, sessions, claims all unchanged).
 *   6. Student A (trial facet): the same booking with trial credit →
 *      SUCCEEDS funded by the trial lane (`heldBalanceLane = trial`) while
 *      the expired hifz lane stays at zero — the two outcomes co-exist
 *      without interference.
 *   7. System: sweep replay → `{ expired: 0, lanesZeroed: 0 }` honest zero
 *      counts; every terminal state holds (A expired with original dates +
 *      zeroed lane + spent trial, B still byte-identical).
 *
 * Journey rules honored (`test/workflows/AGENTS.md`):
 * - fixtures COMMITTED in `beforeAll` inside ONE committing transaction;
 *   never `runInRollback` (the services spawn their own top-level
 *   transactions);
 * - honest actors: real `users` rows + real role-child rows via the
 *   actor-context factory; denials flow through the real authorization path
 *   (service governance/ownership checks + the GraphQL scope gate), nothing
 *   monkey-patched;
 * - external effects intercepted at the notification boundary: the fan-out
 *   publish seam is SPIED (the same namespace-bound seam the activation
 *   service publishes through — it exposes no injected-transport parameter);
 *   every expected dispatch is asserted with its targeted userIds;
 * - expected rejections captured with `catchJourneyError` — never
 *   `.rejects.toThrow()`; GraphQL denials asserted through the
 *   single-error `extensions.code` shape; no hardcoded English copy;
 * - per-run `jrn_billing_<8hex>` prefix on every fixture name and
 *   idempotency key;
 * - cross-actor visibility asserted BOTH directions plus denial probes.
 *
 * Teardown: `student_payments` rows are append-only (BEFORE DELETE trigger)
 * and are removed FIRST under the sanctioned trigger suspension, then the
 * junction rows (re-probed), then the tracked registry sweep (reverse
 * registration order + zero-residue existence re-probes for EVERY tracked
 * row — a leaking `afterAll` fails the suite loudly). Unique per-run
 * prefixes make any intermediate crash residue greppable and harmless.
 *
 * The expiry sweep service is imported ahead of its implementation: this
 * suite is the executable contract the implementation must satisfy, so the
 * file intentionally cannot load until the sweep exists.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { graphql } from "graphql";
import { db } from "@/backend/db";
import { SubscriptionRepository } from "@/backend/db/repo";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { createTestPlan } from "@/backend/db/test/entity-setup";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { toUserRole } from "@/backend/enum/users/user-role.enum";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { ValidationError } from "@/backend/lib/errors";
import { SubscriptionActivationService, SubscriptionPurchaseService } from "@/backend/services";
import { SubscriptionExpiryService } from "@/backend/services/billing/subscription-expiry.service";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  DBTransaction,
  PaymentWebhookEvent,
  PlanSelectType,
  SubscriptionSelectType,
  UserSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { Translations } from "@/shared/locale/types/message";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  catchJourneyError,
  type JourneyActor,
  journeyPrefix,
  provisionCertifiedTeacherActor,
  provisionStudentActor,
  secondPrecisionMs,
  TrackedFixtures,
} from "@/test/workflows/helpers";

// ─── Harness state ───────────────────────────────────────────────────────────

/** Per-run unique prefix — every fixture name, plan title, and idempotency key. */
const PREFIX = journeyPrefix("billing");

/** Error-copy locale for every service call and denial assertion. */
const ERRORS_EN = getServerTranslations("en").errorsTranslations;

/** Milliseconds per day — the activation window arithmetic. */
const MS_PER_DAY = 86_400_000;

/** Session count the journey plan grants (the credit amount under test). */
const PLAN_SESSION_COUNT = 7;
/** Activation window of the journey plan (days). */
const PLAN_INTERVAL_DAYS = 30;

/**
 * Trial allowance seeded on Student A before the sweep: a NONZERO trial
 * balance that must survive the expiry zeroing untouched, then be consumed
 * by the trial-facet booking.
 */
const TRIAL_ALLOWANCE = 2;
/** Trial units re-granted for the post-expiry trial-facet booking leg. */
const TRIAL_REGRANT = 1;

/** How far past the window the backdated `endDate` lands (one lag hour). */
const EXPIRED_LAG_MS = 60 * 60 * 1000;

/** Idempotency keys — one per purchase/booking leg, unique per run. */
const KEY_PURCHASE_A = `${PREFIX}-purchase-a`;
const KEY_PURCHASE_B = `${PREFIX}-purchase-b`;
const KEY_BOOKING_DENIED = `${PREFIX}-booking-denied`;
const KEY_BOOKING_WIRE = `${PREFIX}-booking-wire`;
const KEY_BOOKING_TRIAL = `${PREFIX}-booking-trial`;

const tracked = new TrackedFixtures();

/**
 * The fan-out publish spy — installed over the engine's publish boundary
 * (the activation service publishes post-commit through this exact
 * namespace-bound seam). Restored in `afterAll`.
 */
const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});

/**
 * The expiry-sweep claim scope — the journey's own cast (studentA/studentB),
 * populated in `beforeAll` once the actor rows exist. The sweep's repository
 * seam scopes its claimed projections to these users, so the exact
 * sweep-count assertions (`{ expired: 1, lanesZeroed: 1 }` and the honest
 * zero replay) stay isolated from unrelated committed due rows any other
 * own-commit suite may hold in the shared test database.
 */
const journeySweepUserIds: number[] = [];

/**
 * The sweep-scope spy — installed over the same namespace-bound repository
 * seam the sweep claims through (the `publishSpy` pattern). The REAL guarded
 * flip still runs — locks, the production transaction path, and the
 * claim-and-settle semantics stay fully exercised — only the returned
 * projections are filtered to `journeySweepUserIds`. Restored in `afterAll`.
 */
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

let studentA: JourneyActorRow;
let studentB: JourneyActorRow;
let teacherActor: JourneyActor;
let planRow: PlanSelectType;

let aSubscriptionId = 0;
let bSubscriptionId = 0;
let aRowBeforeSweep: SubscriptionSelectType | null = null;
let backdatedEndDate: Date | null = null;
let aLanesBeforeSweep: StudentBalance | null = null;
let bRowSnapshot: SubscriptionSelectType | null = null;
let bLanesBeforeSweep: StudentBalance | null = null;
let bInboxBeforeSweep = 0;

/** The pre-sweep baselines the backdate step captures for every later probe. */
interface SweepBaselines {
  readonly aRowBeforeSweep: SubscriptionSelectType;
  readonly backdatedEndDate: Date;
  readonly aLanesBeforeSweep: StudentBalance;
  readonly bRowSnapshot: SubscriptionSelectType;
  readonly bLanesBeforeSweep: StudentBalance;
}

/**
 * Narrows the pre-sweep baselines captured by the backdate step — every
 * later step depends on them (steps run in declaration order).
 */
function sweepBaselines(): SweepBaselines {
  if (
    aRowBeforeSweep === null ||
    backdatedEndDate === null ||
    aLanesBeforeSweep === null ||
    bRowSnapshot === null ||
    bLanesBeforeSweep === null
  ) {
    throw new Error("journey state: pre-sweep baselines are missing — the backdate step must run first");
  }
  return { aRowBeforeSweep, backdatedEndDate, aLanesBeforeSweep, bRowSnapshot, bLanesBeforeSweep };
}

/** A journey cast member: the actor-context bundle plus its user row. */
interface JourneyActorRow {
  readonly userId: number;
  readonly user: UserSelectType;
}

/** The student balance lanes this journey asserts on. */
interface StudentBalance {
  readonly trial: number;
  readonly hifz: number | null;
  readonly tajweed: number | null;
  readonly reviews: number | null;
}

// ─── GraphQL denial harness (in-process — the same schema/scope gate the HTTP boundary runs) ──

const CREATE_SESSION_SOURCE = `
  mutation CreateSession($input: CreateSessionInput!) {
    createSession(input: $input) {
      id
      status
    }
  }
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Builds the per-request context for a REAL user row — the same shape the
 * context factory produces for an authenticated request (sanitized user,
 * enum-mapped role, propagation-only idempotency key).
 */
function contextFor(user: UserSelectType, idempotencyKey: string | null): Context {
  const { passwordHash: _passwordHash, ...rest } = user;
  const safeUser = { ...rest, preferredRecitation: null };
  const locale = "en";
  const translations = getServerTranslations(locale);
  return {
    locale,
    t: async <K extends keyof Translations>(namespace: K) => translations[namespace],
    requestId: `${PREFIX}-request`,
    idempotencyKey,
    user: safeUser,
    safeUser,
    permissions: [],
    isSuperAdmin: user.role === "admin",
    role: toUserRole(user.role),
    cookies: {},
    authCookieOut: [],
  };
}

/** Runs the booking mutation as one caller through the real scope gate. */
async function executeCreateSessionMutation(contextValue: Context, teacherId: number) {
  return graphql({
    schema: graphQLSchema,
    source: CREATE_SESSION_SOURCE,
    variableValues: { input: { teacherId: String(teacherId), intent: "Hifz" } },
    contextValue,
  });
}

/**
 * Asserts the result carries EXACTLY one domain error whose
 * `extensions.code` equals the expected transport code.
 */
function expectSingleDenial(result: { readonly errors?: readonly unknown[] }, expectedCode: string): void {
  const first: unknown = result.errors?.[0];
  expect(first).toBeDefined();
  expect(result.errors).toHaveLength(1);
  if (!isRecord(first) || !isRecord(first.extensions)) {
    throw new Error("expected the denial to carry GraphQL error extensions");
  }
  expect(first.extensions.code).toBe(expectedCode);
}

// ─── Read-back oracles ───────────────────────────────────────────────────────

/** Reads one student's live balance lanes (incl. the INV-exempt trial lane). */
async function readBalances(studentUserId: number): Promise<StudentBalance> {
  const rows = await db.select().from(students).where(eq(students.id, studentUserId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("readBalances: student fixture row vanished");
  }
  return {
    trial: row.balanceTrial,
    hifz: row.balanceHifz,
    tajweed: row.balanceTajweed,
    reviews: row.balanceReviews,
  };
}

/** Reads one subscription row by id, failing when absent. */
async function subscriptionRow(subscriptionId: number): Promise<SubscriptionSelectType> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`subscription row ${subscriptionId} vanished`);
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

/** Every `session` row booked by one student (count oracle). */
async function countSessionsFor(studentId: number): Promise<number> {
  return db.$count(session, eq(session.studentId, studentId));
}

/** Every idempotency claim spent by one user (count oracle). */
async function countClaimsFor(userId: number): Promise<number> {
  return db.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.userId, userId));
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
  if (!isRecord(receipt) || !Array.isArray(receipt.recipientUserIds)) {
    throw new Error(`expected the published receipt at call ${callIndex} to carry its recipient ids`);
  }
  return receipt.recipientUserIds;
}

// ─── Fixture provisioning + the real purchase→activation leg ────────────────

/**
 * Provisions one student cast member through the actor-context factory and
 * re-reads the committed user row (the GraphQL denial harness consumes it).
 */
async function provisionStudent(tx: DBTransaction): Promise<JourneyActorRow> {
  const actor = await provisionStudentActor(tx, { tracked });
  await tx.update(users).set({ locale: "en" }).where(eq(users.id, actor.userId));
  const rows = await tx.select().from(users).where(eq(users.id, actor.userId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("journey fixture: student user row vanished inside the provisioning transaction");
  }
  return { userId: actor.userId, user: row };
}

/**
 * One full real purchase → gateway-confirmation leg on the journey plan:
 * registers EVERY service-created row (subscription, payment ledger,
 * idempotency claim, junction via its subscription id, persisted
 * notification) and returns the activated subscription id.
 */
async function purchaseAndActivate(studentUserId: number, idempotencyKey: string): Promise<number> {
  const purchase = await SubscriptionPurchaseService.purchase(
    studentUserId,
    { planId: planRow.id },
    idempotencyKey,
    "en"
  );
  const subscriptionId = purchase.subscription.id;
  tracked.register(subscriptions, subscriptionId);
  tracked.register(studentPayments, purchase.payment.id);
  ledgerSubscriptionIds.push(subscriptionId);
  ledgerPaymentIds.push(purchase.payment.id);
  const claimRows = await db
    .select()
    .from(subscriptionPurchaseIdempotency)
    .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, idempotencyKey));
  expect(claimRows).toHaveLength(1);
  if (claimRows[0]) {
    tracked.register(subscriptionPurchaseIdempotency, claimRows[0].id);
  }

  const event: PaymentWebhookEvent = {
    reference: purchase.checkout.providerReference,
    outcome: "confirmed",
    amount: purchase.payment.amount,
    currency: purchase.payment.currency,
  };
  const outcome = await SubscriptionActivationService.processWebhookEvent(event, "en");
  expect(outcome).toEqual({ processed: true });

  const notification = await soleNotification(studentUserId);
  tracked.register(notifications, notification.id);
  return subscriptionId;
}

beforeAll(async () => {
  // ONE committing transaction: commit-or-nothing fixture provisioning.
  await db.transaction(async tx => {
    studentA = await provisionStudent(tx);
    studentB = await provisionStudent(tx);
    teacherActor = await provisionCertifiedTeacherActor(tx, { tracked });

    planRow = await createTestPlan(tx, {
      title: `${PREFIX} plan`,
      sessionCount: PLAN_SESSION_COUNT,
      price: "200.00",
      currency: "EGP",
      intervalDays: PLAN_INTERVAL_DAYS,
      balanceLane: SubscriptionCreditLane.Hifz,
    });
    tracked.register(plans, planRow.id);
  });

  // The sweep scope: the journey's own cast (see `sweepScopeSpy`).
  journeySweepUserIds.push(studentA.userId, studentB.userId);
});

afterAll(async () => {
  publishSpy.mockRestore();
  sweepScopeSpy.mockRestore();
  // Immutable-ledger teardown leg FIRST: the append-only trigger blocks a
  // plain DELETE, so the sanctioned suspension wraps exactly this leg.
  if (ledgerPaymentIds.length > 0) {
    await withImmutabilityTriggersSuspended(["student_payments"], () =>
      db.delete(studentPayments).where(inArray(studentPayments.id, ledgerPaymentIds))
    );
  }
  // Junction rows (composite PK — no registry entry; swept by subscription id
  // and re-probed here, ahead of the tracked sweep that deletes parents).
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
  // Reverse-registration-order hard delete + zero-residue re-probes for EVERY
  // tracked row (claims → subscriptions → plan → notifications → cast rows).
  await tracked.cleanup();
});

// ─── The journey ─────────────────────────────────────────────────────────────

describe("cross-actor journey: subscription validity window → expiry sweep", () => {
  test("step 1 — Student A: purchase + confirmed event → active window exactly 30 days, hifz lane credited, receipt to A only", async () => {
    const balancesBefore = await readBalances(studentA.userId);
    expect(balancesBefore.hifz).toBe(0);
    const windowStart = Date.now() - 2_000;

    aSubscriptionId = await purchaseAndActivate(studentA.userId, KEY_PURCHASE_A);

    // The activation window: startDate ≈ now, endDate − startDate =
    // intervalDays days EXACTLY — the raw arithmetic and the same arithmetic
    // restated at the journey's cross-source comparison resolution (both
    // stamps share one captured instant, so flooring preserves the day delta).
    const active = await subscriptionRow(aSubscriptionId);
    expect(active.status).toBe(SubscriptionStatus.Active);
    if (active.startDate === null || active.endDate === null) {
      throw new Error("expected the activated subscription to carry its window dates");
    }
    expect(active.startDate.getTime()).toBeGreaterThanOrEqual(windowStart);
    expect(active.endDate.getTime() - active.startDate.getTime()).toBe(PLAN_INTERVAL_DAYS * MS_PER_DAY);
    expect(secondPrecisionMs(active.endDate) - secondPrecisionMs(active.startDate)).toBe(
      PLAN_INTERVAL_DAYS * MS_PER_DAY
    );

    // The lane credit: exactly the plan's full sessionCount on the plan's
    // lane; the trial lane stays untouched by subscription machinery.
    const balancesAfter = await readBalances(studentA.userId);
    expect((balancesAfter.hifz ?? 0) - (balancesBefore.hifz ?? 0)).toBe(PLAN_SESSION_COUNT);
    expect(balancesAfter.trial).toBe(balancesBefore.trial);
    expect(balancesAfter.tajweed).toBe(balancesBefore.tajweed);
    expect(balancesAfter.reviews).toBe(balancesBefore.reviews);

    // ONE persisted notification and ONE post-commit publish — to A ONLY.
    expect(await inboxCount(studentA.userId)).toBe(1);
    expect(await inboxCount(studentB.userId)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(1);
    expect(publishedRecipientUserIds(0)).toEqual([studentA.userId]);
  });

  test("step 2 — Student B: the same real activation path → own active window + credited lane (isolation baseline)", async () => {
    const balancesBefore = await readBalances(studentB.userId);
    expect(balancesBefore.hifz).toBe(0);

    bSubscriptionId = await purchaseAndActivate(studentB.userId, KEY_PURCHASE_B);

    const owned = await SubscriptionPurchaseService.listOwn(studentB.userId);
    expect(owned).toHaveLength(1);
    const active = owned[0];
    if (!active) {
      throw new Error("expected B's list to hold B's own purchased subscription");
    }
    expect(active.id).toBe(bSubscriptionId);
    expect(active.status).toBe(SubscriptionStatus.Active);
    expect(active.startDate).not.toBeNull();
    expect(active.endDate).not.toBeNull();

    // B's lane credit mirrors A's; A's inbox is untouched by B's activation.
    const balancesAfter = await readBalances(studentB.userId);
    expect((balancesAfter.hifz ?? 0) - (balancesBefore.hifz ?? 0)).toBe(PLAN_SESSION_COUNT);
    expect(await inboxCount(studentB.userId)).toBe(1);
    expect(await inboxCount(studentA.userId)).toBe(1);
    expect(publishSpy.mock.calls).toHaveLength(2);
    expect(publishedRecipientUserIds(1)).toEqual([studentB.userId]);
  });

  test("step 3 — System: backdate A's endDate past the window + seed the trial allowance → row REMAINS active (window-vs-status lag)", async () => {
    // Pre-sweep snapshots: the byte-identical probes later re-read THESE.
    const aRowSnapshot = await subscriptionRow(aSubscriptionId);
    const bRow = await subscriptionRow(bSubscriptionId);
    const aLanesSnapshot = await readBalances(studentA.userId);
    const bLanes = await readBalances(studentB.userId);
    const bInbox = await inboxCount(studentB.userId);
    aRowBeforeSweep = aRowSnapshot;
    bRowSnapshot = bRow;
    aLanesBeforeSweep = aLanesSnapshot;
    bLanesBeforeSweep = bLanes;
    bInboxBeforeSweep = bInbox;

    // The expired-lane premise: the hifz lane holds a nonzero remainder and
    // the trial allowance is seeded (the sweep must leave it intact).
    expect(aLanesSnapshot.hifz).toBe(PLAN_SESSION_COUNT);
    await db
      .update(students)
      .set({ balanceTrial: TRIAL_ALLOWANCE, trialGrantedAt: new Date() })
      .where(eq(students.id, studentA.userId));
    expect((await readBalances(studentA.userId)).trial).toBe(TRIAL_ALLOWANCE);

    // Direct Drizzle backdate — the expired-row fixture shape: an expired
    // subscription needs an endDate in the past, fabricated at the
    // second-precision resolution so the written value and every later
    // read-back agree exactly.
    const laggedEndDate = new Date(secondPrecisionMs(Date.now()) - EXPIRED_LAG_MS);
    backdatedEndDate = laggedEndDate;
    await db.update(subscriptions).set({ endDate: laggedEndDate }).where(eq(subscriptions.id, aSubscriptionId));

    // The lag: NO state change yet — the row is past its window but still
    // `active`; closing that gap is the sweep's job alone.
    const lagging = await subscriptionRow(aSubscriptionId);
    expect(lagging.status).toBe(SubscriptionStatus.Active);
    expect(lagging.startDate?.getTime()).toBe(aRowSnapshot.startDate?.getTime());
    expect(lagging.endDate?.getTime()).toBe(laggedEndDate.getTime());
    expect(lagging.paymentVerifiedAt?.getTime()).toBe(aRowSnapshot.paymentVerifiedAt?.getTime());
  });

  test("step 4 — System: sweep → { expired: 1, lanesZeroed: 1 }; A expired with ORIGINAL dates, hifz zeroed, trial intact; B byte-identical", async () => {
    const baseline = sweepBaselines();
    const sweep = await SubscriptionExpiryService.expireDue();
    expect(sweep).toEqual({ expired: 1, lanesZeroed: 1 });

    // The flip: status mutated, the ORIGINAL window dates untouched (the
    // sweep mutates status + balances only — never the validity window).
    const expiredRow = await subscriptionRow(aSubscriptionId);
    expect(expiredRow.status).toBe(SubscriptionStatus.Expired);
    expect(expiredRow.startDate?.getTime()).toBe(baseline.aRowBeforeSweep.startDate?.getTime());
    expect(expiredRow.endDate?.getTime()).toBe(baseline.backdatedEndDate.getTime());
    expect(expiredRow.paymentVerifiedAt?.getTime()).toBe(baseline.aRowBeforeSweep.paymentVerifiedAt?.getTime());

    // The uncovered-lane zeroing: the hifz remainder is gone; the trial
    // allowance survives EXACTLY (the trial lane is never subscription-bound);
    // the untouched lanes stay byte-identical.
    const aLanes = await readBalances(studentA.userId);
    expect(aLanes.hifz).toBe(0);
    expect(aLanes.trial).toBe(TRIAL_ALLOWANCE);
    expect(aLanes.tajweed).toBe(baseline.aLanesBeforeSweep.tajweed);
    expect(aLanes.reviews).toBe(baseline.aLanesBeforeSweep.reviews);

    // The observer probe: B's subscription row (every column), lanes, and
    // inbox are byte-identical to their pre-sweep snapshots.
    expect(await subscriptionRow(bSubscriptionId)).toEqual(baseline.bRowSnapshot);
    expect(await readBalances(studentB.userId)).toEqual(baseline.bLanesBeforeSweep);
    expect(await inboxCount(studentB.userId)).toBe(bInboxBeforeSweep);
  });

  test("step 5 — Student A: booking on the expired + zeroed lane → SUBSCRIPTION_EXPIRED (service + wire), ZERO writes", async () => {
    const baseline = sweepBaselines();
    // Scenario cell: the trial allowance is spent (a committed fixture
    // transition) so the ladder's double-miss branch is the only stage left.
    await db.update(students).set({ balanceTrial: 0 }).where(eq(students.id, studentA.userId));
    const lanesBeforeDenial = await readBalances(studentA.userId);
    expect(lanesBeforeDenial).toEqual({
      trial: 0,
      hifz: 0,
      tajweed: baseline.aLanesBeforeSweep.tajweed,
      reviews: baseline.aLanesBeforeSweep.reviews,
    });
    const sessionsBefore = await countSessionsFor(studentA.userId);
    const claimsBefore = await countClaimsFor(studentA.userId);

    // Service-level denial through the real authorization path.
    const denial = await catchJourneyError(() =>
      SessionLifecycleService.createSession(
        studentA.userId,
        { teacherId: teacherActor.userId, intent: SessionIntent.Hifz },
        KEY_BOOKING_DENIED,
        "en"
      )
    );
    if (!(denial instanceof ValidationError)) {
      throw new Error(`expected ValidationError (got ${denial instanceof Error ? denial.name : String(denial)})`);
    }
    expect(denial.code).toBe("SUBSCRIPTION_EXPIRED");
    // The copy is server-localized — never the raw key, never empty.
    expect(denial.message.length).toBeGreaterThan(0);
    expect(denial.message).not.toBe("subscriptionExpired");
    expect(denial.message).toContain(ERRORS_EN.subscriptionExpired);

    // Wire contract: the same denial through the real GraphQL scope gate is
    // exactly one error carrying the domain code in its extensions.
    const wireResult = await executeCreateSessionMutation(
      contextFor(studentA.user, KEY_BOOKING_WIRE),
      teacherActor.userId
    );
    expectSingleDenial(wireResult, "SUBSCRIPTION_EXPIRED");

    // Zero rows written on denial: lanes, sessions, and claims all unchanged
    // (neither key was burned — a failed booking never burns its key).
    expect(await readBalances(studentA.userId)).toEqual(lanesBeforeDenial);
    expect(await countSessionsFor(studentA.userId)).toBe(sessionsBefore);
    expect(await countClaimsFor(studentA.userId)).toBe(claimsBefore);
  });

  test("step 6 — Student A (trial facet): the same booking with trial credit SUCCEEDS via the trial lane; the expired lane stays at zero", async () => {
    await db
      .update(students)
      .set({ balanceTrial: TRIAL_REGRANT, trialGrantedAt: new Date() })
      .where(eq(students.id, studentA.userId));
    const lanesBefore = await readBalances(studentA.userId);
    expect(lanesBefore.hifz).toBe(0);

    const booked = await SessionLifecycleService.createSession(
      studentA.userId,
      { teacherId: teacherActor.userId, intent: SessionIntent.Hifz },
      KEY_BOOKING_TRIAL,
      "en"
    );
    expect(booked.id).toBeGreaterThan(0);
    expect(booked.studentId).toBe(studentA.userId);
    expect(booked.teacherId).toBe(teacherActor.userId);
    expect(booked.status).toBe(SessionStatus.Scheduled);
    expect(booked.intent).toBe(SessionIntent.Hifz);
    expect(booked.feeHeld).toBe(true);
    expect(booked.heldBalanceLane).toBe(HeldBalanceLane.Trial);
    tracked.register(session, booked.id);
    const claimRows = await db
      .select()
      .from(sessionRequestIdempotency)
      .where(eq(sessionRequestIdempotency.idempotencyKey, KEY_BOOKING_TRIAL));
    expect(claimRows).toHaveLength(1);
    if (claimRows[0]) {
      tracked.register(sessionRequestIdempotency, claimRows[0].id);
    }

    // The trial lane funded the hold (one unit left); the expired hifz lane
    // did NOT fund and stays zeroed.
    const lanesAfter = await readBalances(studentA.userId);
    expect(lanesAfter.trial).toBe(lanesBefore.trial - 1);
    expect(lanesAfter.hifz).toBe(0);
    expect(lanesAfter.tajweed).toBe(lanesBefore.tajweed);
    expect(lanesAfter.reviews).toBe(lanesBefore.reviews);
  });

  test("step 7 — System: sweep replay → honest zero counts; every terminal state holds", async () => {
    const baseline = sweepBaselines();
    const replay = await SubscriptionExpiryService.expireDue();
    expect(replay).toEqual({ expired: 0, lanesZeroed: 0 });

    // A: still expired, still the ORIGINAL window dates, still zeroed lane
    // and spent trial — the replay changed nothing.
    const after = await subscriptionRow(aSubscriptionId);
    expect(after.status).toBe(SubscriptionStatus.Expired);
    expect(after.startDate?.getTime()).toBe(baseline.aRowBeforeSweep.startDate?.getTime());
    expect(after.endDate?.getTime()).toBe(baseline.backdatedEndDate.getTime());
    expect(await readBalances(studentA.userId)).toEqual({
      trial: 0,
      hifz: 0,
      tajweed: baseline.aLanesBeforeSweep.tajweed,
      reviews: baseline.aLanesBeforeSweep.reviews,
    });

    // B: still byte-identical to the pre-sweep snapshots.
    expect(await subscriptionRow(bSubscriptionId)).toEqual(baseline.bRowSnapshot);
    expect(await readBalances(studentB.userId)).toEqual(baseline.bLanesBeforeSweep);
    expect(await inboxCount(studentB.userId)).toBe(bInboxBeforeSweep);
  });
});
