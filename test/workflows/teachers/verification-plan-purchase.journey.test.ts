/**
 * Cross-actor journey — teacher verification plan purchase → gateway
 * settlement workflow.
 *
 * Sequential, actor-attributed steps executed against the REAL services on
 * the REAL test database (later steps observe the shared state earlier steps
 * committed):
 *
 *   1. System provisions the cast (teacher applicants + a non-applicant
 *      student) and the verification plan fixture; the purchase target is
 *      resolved from the ACTIVE catalog exactly the way the purchase service
 *      resolves it (active-plan read + exact-title match). The plan's price,
 *      currency, interval, and lane are asserted against the resolved row so
 *      the journey's money/window/lane expectations are grounded in the row
 *      the service will actually charge.
 *   2. Applicant A (pending) purchases the verification plan under an
 *      idempotency key → ONE pending pair (subscription + payment with a
 *      NULL student owner) + verbatim-keyed claim backfilled with the pair;
 *      the applicant row flips to `in_evaluation` with the attempt counter
 *      untouched (a first purchase is not a re-application); NO student
 *      junction row is created.
 *   3. The emitter delivers the confirmed gateway event → payment `paid`,
 *      subscription `active` (endDate − startDate = intervalDays exactly),
 *      and NO lane credit for the applicant purchaser (an applicant owns no
 *      `students` row — the credit surface must stay absent, not zeroed).
 *      ONE payment-confirmation notification is persisted in the purchaser's
 *      locale and the receipt is published strictly post-commit, addressed
 *      to Applicant A ONLY. The owner observes the flip through the real
 *      self-profile read path.
 *   4. Applicant B (re-application cooldown ACTIVE) attempts a purchase →
 *      the localized cooldown denial (template fully expanded — no
 *      placeholder residue); zero writes anywhere, applicant row
 *      byte-identical.
 *   5. Applicant C (cooldown EXPIRED, previously failed) re-purchases →
 *      success; the re-application attempt counter increments by exactly 1
 *      and the row flips `failed → in_evaluation`.
 *   6. The student (a non-applicant role) attempts the purchase → the real
 *      applicant-row gate denies with the localized not-found denial; zero
 *      side effects for the student.
 *   7. A FOREIGN APPLICANT (the cooldown-expired re-applicant — an honest
 *      applicant role) replays Applicant A's SPENT idempotency key → the
 *      oracle-safe generic payment-not-found denial (another caller's claim
 *      is never surfaced, so nothing leaks about the key's owner); the
 *      non-applicant student replaying the SAME SPENT key is denied EARLIER
 *      at the applicant-row gate (the gate runs before the claim
 *      classification) with the localized applicant-not-found denial —
 *      equally oracle-safe. Neither foreign caller writes anything and A's
 *      decided pair stays byte-identical.
 *
 * Journey rules honored (`test/workflows/AGENTS.md`):
 * - fixtures COMMITTED in `beforeAll` (cast via the sanctioned journey
 *   fixture provisioner + one committing transaction for the extra
 *   applicants and the plan); never `runInRollback` (the services spawn
 *   their own top-level transactions);
 * - honest actors: real `users` rows + real role-child rows; denials flow
 *   through the real service-level gate — nothing monkey-patched;
 * - external effects intercepted at the notification boundary: the fan-out
 *   publish seam is SPIED (the activation service exposes no
 *   injected-transport parameter, so the spy rides the same namespace-bound
 *   seam the service calls);
 * - error assertions through `catchJourneyError` + translated substrings
 *   from `getServerTranslations("en")` — never `.rejects.toThrow()`, no
 *   hardcoded English strings;
 * - per-run `jrn_teacherverify_<8hex>` prefix on every idempotency key;
 * - cross-actor visibility asserted BOTH directions plus denial probes.
 *
 * Immutable-ledger residue policy: `student_payments` rows are append-only
 * (BEFORE DELETE trigger) — `afterAll` deletes them FIRST under the
 * sanctioned suspension (`withImmutabilityTriggersSuspended`), sweeps the
 * (never-created) student junction defensively, then hard-deletes every
 * tracked row in reverse registration order (claims → subscriptions → plan
 * → extra applicants → cast role-children → users) and re-probes EVERY id —
 * teardown must leave ZERO residue, and a leaking `afterAll` fails the
 * suite loudly. Unique per-run prefixes make any intermediate-crash residue
 * greppable and collision-free.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { PlanRepository } from "@/backend/db/repo";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { notifications } from "@/backend/db/schema/notifications";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import { createTestApplicant, createTestPlan, createTestUser } from "@/backend/db/test/entity-setup";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { NotFoundError, ValidationError } from "@/backend/lib/errors";
import { ApplicantLifecycleService, SubscriptionActivationService } from "@/backend/services";
import { NotificationEngine } from "@/backend/services/notifications";
import { VerificationPurchaseService } from "@/backend/services/teachers/verification-purchase.service";
import type { ApplicantSelectType, PaymentWebhookEvent, PlanSelectType, UserSelectType } from "@/backend/types";
import {
  VERIFICATION_PLAN_CURRENCY,
  VERIFICATION_PLAN_INTERVAL_DAYS,
  VERIFICATION_PLAN_PRICE,
  VERIFICATION_PLAN_SESSION_COUNT,
  VERIFICATION_PLAN_TITLE,
} from "@/shared/constants/verification-plan.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  catchJourneyError,
  createJourneyFixtures,
  type JourneyFixtureBundle,
  journeyCleanup,
  journeyPrefix,
  TrackedFixtures,
} from "@/test/workflows/helpers";

// ─── Harness state ───────────────────────────────────────────────────────────

/** Per-run unique prefix — every idempotency key derives from it. */
const PREFIX = journeyPrefix("teacherverify");

/** Error-copy locale for every service call and denial assertion. */
const ERRORS_EN = getServerTranslations("en").errorsTranslations;
/** Notification copy — the confirmation wave composes in the RECIPIENT's persisted locale. */
const NOTIFS_EN = getServerTranslations("en").notificationsTranslations;

/** Milliseconds per day — the activation window arithmetic. */
const MS_PER_DAY = 86_400_000;

const tracked = new TrackedFixtures();

/**
 * The fan-out publish spy — installed over the engine's publish boundary
 * (the activation service publishes post-commit through this exact
 * namespace-bound seam; it exposes no injected-transport parameter).
 * Restored in `afterAll`.
 */
const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});

/** Idempotency keys — one per purchase/denial leg, ≤128 chars, unique per run. */
const KEY_PURCHASE_A = `${PREFIX}-key-purchase-a`;
const KEY_COOLDOWN = `${PREFIX}-key-cooldown`;
const KEY_PURCHASE_C = `${PREFIX}-key-purchase-c`;
const KEY_STUDENT = `${PREFIX}-key-student`;

/** Ledger rows created by the purchase service during the journey (teardown worklist). */
const ledgerPaymentIds: number[] = [];
const ledgerSubscriptionIds: number[] = [];

/** Journey cast: the sanctioned provisioner bundle (applicant A + student + bystanders). */
let bundle: JourneyFixtureBundle;
/** The purchase target as the SERVICE resolves it (active catalog + exact-title match). */
let planRow: PlanSelectType;
/** The plan row id THIS journey created (0 = the seeded catalog member served). */
let journeyCreatedPlanId = 0;
/** Cooldown-active applicant (B) and cooldown-expired applicant (C) owner rows. */
let applicantB: UserSelectType;
let applicantC: UserSelectType;

// ─── Read-back oracles ───────────────────────────────────────────────────────

/** Committed purchase-set counters for one user (subscriptions + claims). */
async function purchaseSetCounts(userId: number): Promise<{ subs: number; claims: number }> {
  const [subs, claims] = await Promise.all([
    db.$count(subscriptions, eq(subscriptions.userId, userId)),
    db.$count(subscriptionPurchaseIdempotency, eq(subscriptionPurchaseIdempotency.userId, userId)),
  ]);
  return { subs, claims };
}

/** Number of `student_payments` rows the given STUDENT owns (applicants own none — NULL owner). */
async function studentOwnedPaymentCount(studentUserId: number): Promise<number> {
  return db.$count(studentPayments, eq(studentPayments.studentId, studentUserId));
}

/** Number of `students` rows behind a user id — the lane-credit surface probe. */
async function studentsRowCount(userId: number): Promise<number> {
  return db.$count(students, eq(students.id, userId));
}

/** Reads one applicant row by user id, failing when absent. */
async function readApplicantRow(applicantUserId: number): Promise<ApplicantSelectType> {
  const rows = await db.select().from(applicants).where(eq(applicants.id, applicantUserId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`applicant row for user ${applicantUserId} vanished`);
  }
  return row;
}

/** Reads one subscription row by id, failing when absent. */
async function readSubscriptionRow(subscriptionId: number) {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`subscription row ${subscriptionId} vanished`);
  }
  return row;
}

/** Reads one payment ledger row by id, failing when absent. */
async function readPaymentRow(paymentId: number) {
  const rows = await db.select().from(studentPayments).where(eq(studentPayments.id, paymentId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`payment ledger row ${paymentId} vanished`);
  }
  return row;
}

/** Independent read-back oracle — direct Drizzle count on the inbox. */
async function inboxCount(userId: number): Promise<number> {
  return db.$count(notifications, eq(notifications.userId, userId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The fixed prefix of the cooldown template up to its `{cooldownUntil}` placeholder. */
function cooldownMessagePrefix(): string {
  const placeholderAt = ERRORS_EN.applicantCooldownActive.indexOf("{cooldownUntil}");
  return placeholderAt > 0
    ? ERRORS_EN.applicantCooldownActive.slice(0, placeholderAt)
    : ERRORS_EN.applicantCooldownActive;
}

// ─── Fixture provisioning ────────────────────────────────────────────────────

beforeAll(async () => {
  // Phase 1 — the sanctioned cast provisioner: real users + role-children in
  // ONE committing transaction (applicant A pending, a non-applicant student,
  // plus the bystander members the cross-actor fan-out asserts against).
  bundle = await createJourneyFixtures(PREFIX);

  // Phase 2 — ONE committing transaction for everything else the journey
  // needs: persisted EN locale for the whole cast (the confirmation copy
  // composes in the RECIPIENT's persisted locale), the cooldown/expired
  // applicants, and the verification plan fixture.
  const castUserIds = [
    bundle.cast.admin.user.id,
    bundle.cast.student.user.id,
    bundle.cast.parent.user.id,
    bundle.cast.applicant.user.id,
    bundle.cast.certifiedTeacher.user.id,
  ];
  await db.transaction(async tx => {
    await tx.update(users).set({ locale: "en" }).where(inArray(users.id, castUserIds));

    const userB = await createTestUser(tx, { role: "teacher", locale: "en" });
    await createTestApplicant(tx, userB.id, {
      status: ApplicantStatus.Failed,
      cooldownUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    tracked.register(users, userB.id);
    tracked.register(applicants, userB.id);

    const userC = await createTestUser(tx, { role: "teacher", locale: "en" });
    await createTestApplicant(tx, userC.id, {
      status: ApplicantStatus.Failed,
      cooldownUntil: new Date(Date.now() - 60_000),
    });
    tracked.register(users, userC.id);
    tracked.register(applicants, userC.id);
    applicantB = userB;
    applicantC = userC;

    // CONDITIONAL catalog fixture: the purchase service resolves its target
    // server-side by the canonical title and REJECTS an ambiguous catalog
    // (multiple active rows sharing it), so a blind insert on a seeded
    // catalog would flip every purchase into a conflict. The committed
    // fixture is created ONLY when the catalog lacks the canonical member;
    // on a seeded catalog the pre-existing row serves (read, never
    // mutated — its product fields are pinned identical by the seeder).
    const activeInTx = await PlanRepository.listActive(tx);
    const existingCanonical = activeInTx.find(entry => entry.title === VERIFICATION_PLAN_TITLE);
    if (existingCanonical === undefined) {
      const plan = await createTestPlan(tx, {
        title: VERIFICATION_PLAN_TITLE,
        sessionCount: VERIFICATION_PLAN_SESSION_COUNT,
        price: VERIFICATION_PLAN_PRICE,
        currency: VERIFICATION_PLAN_CURRENCY,
        intervalDays: VERIFICATION_PLAN_INTERVAL_DAYS,
        balanceLane: SubscriptionCreditLane.Reviews,
        isActive: true,
      });
      tracked.register(plans, plan.id);
      journeyCreatedPlanId = plan.id;
    }
  });

  // Resolve the purchase target EXACTLY the way the purchase service does:
  // committed active-catalog read + exact-title match. With the
  // conditional-fixture guard above, exactly ONE active row carries the
  // canonical title, so the match is deterministic — no first-match
  // ambiguity against a seeded sibling row.
  const activeCatalog = await PlanRepository.listActive();
  const resolved = activeCatalog.find(entry => entry.title === VERIFICATION_PLAN_TITLE);
  if (!resolved) {
    throw new Error(
      `journey fixture: no ACTIVE plan titled "${VERIFICATION_PLAN_TITLE}" in the catalog — the verification plan fixture failed to commit`
    );
  }
  // When this journey provisioned the fixture itself, the resolved row
  // MUST be it (the catalog held no other canonical member) — the created
  // fixture is never silently swapped for a seeded row.
  if (journeyCreatedPlanId > 0) {
    expect(resolved.id).toBe(journeyCreatedPlanId);
  }
  planRow = resolved;
});

afterAll(async () => {
  publishSpy.mockRestore();

  // Immutable-ledger teardown leg FIRST: the append-only trigger blocks a
  // plain DELETE, so the sanctioned suspension wraps exactly this leg — then
  // the sweep is re-probed to zero.
  if (ledgerPaymentIds.length > 0) {
    await withImmutabilityTriggersSuspended(["student_payments"], async () => {
      await db.delete(studentPayments).where(inArray(studentPayments.id, ledgerPaymentIds));
    });
    const paymentResidue = await db.$count(studentPayments, inArray(studentPayments.id, ledgerPaymentIds));
    if (paymentResidue !== 0) {
      throw new Error(`journey teardown: ${paymentResidue} student_payments row(s) survived deletion`);
    }
  }

  // Student junction rows: verification purchases must never create any; the
  // sweep is defensive (a leaking junction must not strand the subscription
  // delete) and re-probed to zero ahead of the tracked sweep.
  if (ledgerSubscriptionIds.length > 0) {
    await db.delete(studentSubscriptions).where(inArray(studentSubscriptions.subscriptionId, ledgerSubscriptionIds));
    const junctionResidue = await db.$count(
      studentSubscriptions,
      inArray(studentSubscriptions.subscriptionId, ledgerSubscriptionIds)
    );
    if (junctionResidue !== 0) {
      throw new Error(`journey teardown: ${junctionResidue} student junction row(s) survived deletion`);
    }
  }

  // Reverse-registration-order hard delete + zero-residue re-probes for every
  // tracked row (notifications → claims → subscriptions → plan → extra
  // applicants' rows).
  await tracked.cleanup();

  // Cast rows via the provisioner registry: audit-log sweep under suspended
  // triggers, role-children, then users.
  await journeyCleanup(bundle.registry);

  // Post-teardown existence probes for EVERY cast row — the residue check is
  // load-bearing, not advisory.
  const castIds = bundle.registry.userIds;
  const [
    userResidue,
    applicantResidue,
    studentResidue,
    teacherResidue,
    parentResidue,
    adminResidue,
    notificationResidue,
  ] = await Promise.all([
    db.$count(users, inArray(users.id, castIds)),
    db.$count(applicants, inArray(applicants.id, castIds)),
    db.$count(students, inArray(students.id, castIds)),
    db.$count(teacher, inArray(teacher.id, castIds)),
    db.$count(parents, inArray(parents.id, castIds)),
    db.$count(admin, inArray(admin.id, castIds)),
    db.$count(notifications, inArray(notifications.userId, castIds)),
  ]);
  const residueTotal =
    userResidue +
    applicantResidue +
    studentResidue +
    teacherResidue +
    parentResidue +
    adminResidue +
    notificationResidue;
  if (residueTotal !== 0) {
    throw new Error(
      `journey teardown: ${residueTotal} cast row(s) survived cleanup ` +
        `(users=${userResidue}, applicants=${applicantResidue}, students=${studentResidue}, ` +
        `teacher=${teacherResidue}, parents=${parentResidue}, admin=${adminResidue}, notifications=${notificationResidue})`
    );
  }
});

// ─── The journey ─────────────────────────────────────────────────────────────

describe("cross-actor journey: verification plan purchase → gateway settlement", () => {
  test("step 1 — System: cast + verification plan fixture committed; the purchase target resolves from the ACTIVE catalog", async () => {
    // The plan fixture carries the canonical product contract.
    expect(planRow.title).toBe(VERIFICATION_PLAN_TITLE);
    expect(planRow.sessionCount).toBe(VERIFICATION_PLAN_SESSION_COUNT);
    expect(planRow.isActive).toBe(true);
    expect(planRow.balanceLane).toBe(SubscriptionCreditLane.Reviews);

    // Applicant A: pending, never re-applied, no cooldown.
    const rowA = await readApplicantRow(bundle.cast.applicant.user.id);
    expect(rowA.status).toBe(ApplicantStatus.Pending);
    expect(rowA.verificationAttempts ?? 0).toBe(0);
    expect(rowA.cooldownUntil).toBeNull();

    // Applicant B: failed WITH an active cooldown; Applicant C: failed with an
    // EXPIRED cooldown (strict `>` boundary — already in the past).
    const rowB = await readApplicantRow(applicantB.id);
    expect(rowB.status).toBe(ApplicantStatus.Failed);
    if (rowB.cooldownUntil === null) {
      throw new Error("journey fixture: applicant B must carry a cooldown expiry");
    }
    expect(rowB.cooldownUntil.getTime()).toBeGreaterThan(Date.now());
    const rowC = await readApplicantRow(applicantC.id);
    expect(rowC.status).toBe(ApplicantStatus.Failed);
    if (rowC.cooldownUntil === null) {
      throw new Error("journey fixture: applicant C must carry a cooldown expiry");
    }
    expect(rowC.cooldownUntil.getTime()).toBeLessThan(Date.now());

    // The lane-credit surface: applicants own NO students row (the credit-skip
    // baseline is ABSENCE, not a zeroed balance); the student cast member does.
    expect(await studentsRowCount(bundle.cast.applicant.user.id)).toBe(0);
    expect(await studentsRowCount(applicantB.id)).toBe(0);
    expect(await studentsRowCount(applicantC.id)).toBe(0);
    expect(await studentsRowCount(bundle.cast.student.user.id)).toBe(1);

    // Clean slate everywhere the journey asserts deltas.
    expect(await purchaseSetCounts(bundle.cast.applicant.user.id)).toEqual({ subs: 0, claims: 0 });
    expect(await inboxCount(bundle.cast.applicant.user.id)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(0);
  });

  test("step 2 — Applicant A: purchase commits ONE pending pair with a NULL payment owner + backfilled claim; status flips to in_evaluation; attempts stay 0", async () => {
    const purchaserId = bundle.cast.applicant.user.id;
    const purchasesBefore = await purchaseSetCounts(purchaserId);

    const result = await VerificationPurchaseService.purchase(purchaserId, KEY_PURCHASE_A, "en");

    // The returned pending pair: subscription pending, gateway reference
    // correlation, verbatim plan money — no arithmetic, no client values.
    expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
    expect(result.subscription.userId).toBe(purchaserId);
    expect(result.subscription.planId).toBe(planRow.id);
    expect(result.subscription.paymentReference).toBe(result.checkout.providerReference);
    expect(result.checkout.provider).toBe(PaymentGateway.Mock);
    expect(result.checkout.checkoutUrl).toBeNull();
    expect(result.payment.amount).toBe(planRow.price);
    expect(result.payment.currency).toBe(planRow.currency);
    expect(result.payment.status).toBe(PaymentStatus.Pending);
    expect(result.payment.subscriptionId).toBe(result.subscription.id);
    // THE owner-shape assertion: a verification purchase's payment is owned by
    // the subscription's generic user, NOT by a student.
    expect(result.payment.studentId).toBeNull();

    // Exactly ONE committed pending set for the purchaser.
    expect(await purchaseSetCounts(purchaserId)).toEqual({
      subs: purchasesBefore.subs + 1,
      claims: purchasesBefore.claims + 1,
    });

    // The student junction is deliberately NOT performed for a verification
    // purchase (the purchaser owns no students row).
    expect(await db.$count(studentSubscriptions, eq(studentSubscriptions.subscriptionId, result.subscription.id))).toBe(
      0
    );

    // The claim is keyed VERBATIM and backfilled with the winning pair.
    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, KEY_PURCHASE_A));
    expect(claimRows).toHaveLength(1);
    expect(claimRows[0]?.userId).toBe(purchaserId);
    expect(claimRows[0]?.subscriptionId).toBe(result.subscription.id);

    // Track every service-created row for teardown before moving on.
    tracked.register(subscriptions, result.subscription.id);
    tracked.register(studentPayments, result.payment.id);
    for (const claimRow of claimRows) {
      tracked.register(subscriptionPurchaseIdempotency, claimRow.id);
    }
    ledgerSubscriptionIds.push(result.subscription.id);
    ledgerPaymentIds.push(result.payment.id);

    // The lifecycle flip is PURCHASE-time and attempt-free: pending →
    // in_evaluation with the re-application counter untouched.
    const rowA = await readApplicantRow(purchaserId);
    expect(rowA.status).toBe(ApplicantStatus.InEvaluation);
    expect(rowA.verificationAttempts ?? 0).toBe(0);

    // Purchases emit nothing: no inbox row, no publish.
    expect(await inboxCount(purchaserId)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(0);
  });

  test("step 3 — System: confirmed webhook → paid + active window; NO lane credit for the applicant purchaser; ONE receipt published to Applicant A ONLY", async () => {
    const purchaserId = bundle.cast.applicant.user.id;
    const subscriptionId = ledgerSubscriptionIds[0] ?? 0;
    const paymentId = ledgerPaymentIds[0] ?? 0;
    const windowStart = Date.now() - 2_000;

    const ledger = await readPaymentRow(paymentId);
    const reference = (await readSubscriptionRow(subscriptionId)).paymentReference;
    if (reference === null) {
      throw new Error("expected the pending subscription to carry the gateway payment reference");
    }
    const event: PaymentWebhookEvent = {
      reference,
      outcome: "confirmed",
      amount: ledger.amount,
      currency: ledger.currency,
    };

    const outcome = await SubscriptionActivationService.processWebhookEvent(event, "en");
    expect(outcome).toEqual({ processed: true });

    // The ledger decision: pending → paid; the window: startDate ≈ now,
    // verification stamped, endDate − startDate = intervalDays exactly.
    expect((await readPaymentRow(paymentId)).status).toBe(PaymentStatus.Paid);
    const active = await readSubscriptionRow(subscriptionId);
    expect(active.status).toBe(SubscriptionStatus.Active);
    expect(active.paymentVerifiedAt).not.toBeNull();
    if (active.startDate === null || active.endDate === null) {
      throw new Error("expected the activated subscription to carry its window dates");
    }
    expect(active.startDate.getTime()).toBeGreaterThanOrEqual(windowStart);
    expect(active.endDate.getTime() - active.startDate.getTime()).toBe(planRow.intervalDays * MS_PER_DAY);

    // The credit-skip contract: the applicant still owns NO students row —
    // no lane was credited, and no students row was conjured to credit into.
    // The committed activation (active + paid above) proves the flow did not
    // abort or roll back on the missing credit surface.
    expect(await studentsRowCount(purchaserId)).toBe(0);
    expect(await db.$count(studentSubscriptions, eq(studentSubscriptions.subscriptionId, subscriptionId))).toBe(0);

    // ONE persisted notification, composed for the purchaser in their
    // persisted locale.
    const inboxRows = await db.select().from(notifications).where(eq(notifications.userId, purchaserId));
    expect(inboxRows).toHaveLength(1);
    const notification = inboxRows[0];
    if (!notification) {
      throw new Error("expected the purchaser's inbox to hold the confirmation row");
    }
    tracked.register(notifications, notification.id);
    expect(notification.type).toBe(NotificationType.PaymentConfirmation);
    expect(notification.relatedEntityType).toBe("subscription");
    expect(notification.relatedEntityId).toBe(subscriptionId);
    expect(notification.isRead).toBe(false);
    expect(notification.title).toBe(NOTIFS_EN.eventPaymentConfirmedTitle);
    expect(notification.body).toBe(NOTIFS_EN.eventPaymentConfirmedBody(planRow.title));

    // The receipt published strictly post-commit — to Applicant A ONLY.
    expect(publishSpy.mock.calls).toHaveLength(1);
    const published: unknown = publishSpy.mock.calls[0]?.[0];
    if (!Array.isArray(published) || published.length !== 1) {
      throw new Error("expected exactly one published delivery receipt");
    }
    const receipt = published[0];
    if (!isRecord(receipt) || !Array.isArray(receipt.recipientUserIds)) {
      throw new Error("expected the published receipt to carry its recipient ids");
    }
    expect(receipt.recipientUserIds).toEqual([purchaserId]);

    // Cross-actor fan-out: no other cast member's inbox exists or grew.
    const observerInboxCounts = await Promise.all(
      [
        applicantB.id,
        applicantC.id,
        bundle.cast.student.user.id,
        bundle.cast.parent.user.id,
        bundle.cast.admin.user.id,
        bundle.cast.certifiedTeacher.user.id,
      ].map(observerId => inboxCount(observerId))
    );
    expect(observerInboxCounts).toEqual([0, 0, 0, 0, 0, 0]);

    // The intended observer sees the flip through the REAL self-profile read.
    const profile = await ApplicantLifecycleService.getMyApplicantProfile(purchaserId, "en");
    if (!profile) {
      throw new Error("expected the purchaser's self profile to resolve after the purchase");
    }
    expect(profile.status).toBe(ApplicantStatus.InEvaluation);
    expect(profile.verificationAttempts).toBe(0);
    expect(profile.cooldownActive).toBe(false);
  });

  test("step 4 — Applicant B (cooldown active): purchase denied with the localized cooldown copy; zero writes", async () => {
    const deniedUserId = applicantB.id;
    const countsBefore = await purchaseSetCounts(deniedUserId);
    const rowBefore = await readApplicantRow(deniedUserId);

    const denial = await catchJourneyError(() =>
      VerificationPurchaseService.purchase(deniedUserId, KEY_COOLDOWN, "en")
    );
    if (!(denial instanceof ValidationError)) {
      throw new Error(`expected ValidationError (got ${denial instanceof Error ? denial.name : String(denial)})`);
    }
    expect(denial.code).toBe("APPLICANT_COOLDOWN_ACTIVE");
    expect(denial.message).toContain(cooldownMessagePrefix());
    expect(denial.message).not.toContain("{cooldownUntil}");

    // The denial wrote nothing: no pair, no claim, and the applicant row is
    // byte-identical (status, attempts, cooldown, last-attempt stamp).
    expect(await purchaseSetCounts(deniedUserId)).toEqual(countsBefore);
    const rowAfter = await readApplicantRow(deniedUserId);
    expect(rowAfter.status).toBe(rowBefore.status);
    expect(rowAfter.verificationAttempts).toBe(rowBefore.verificationAttempts);
    expect(rowAfter.cooldownUntil?.getTime()).toBe(rowBefore.cooldownUntil?.getTime());
    expect(rowAfter.lastAttemptAt).toBeNull();

    // No notification fan-out anywhere.
    expect(await inboxCount(deniedUserId)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(1);
  });

  test("step 5 — Applicant C (cooldown expired): re-purchase succeeds; attempts increment by exactly 1; failed → in_evaluation", async () => {
    const reapplicantId = applicantC.id;
    const countsBefore = await purchaseSetCounts(reapplicantId);
    const rowBefore = await readApplicantRow(reapplicantId);
    expect(rowBefore.verificationAttempts ?? 0).toBe(0);

    const result = await VerificationPurchaseService.purchase(reapplicantId, KEY_PURCHASE_C, "en");

    expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
    expect(result.subscription.userId).toBe(reapplicantId);
    expect(result.payment.status).toBe(PaymentStatus.Pending);
    expect(result.payment.amount).toBe(planRow.price);
    expect(result.payment.studentId).toBeNull();

    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, KEY_PURCHASE_C));
    expect(claimRows).toHaveLength(1);
    expect(claimRows[0]?.subscriptionId).toBe(result.subscription.id);
    expect(await purchaseSetCounts(reapplicantId)).toEqual({
      subs: countsBefore.subs + 1,
      claims: countsBefore.claims + 1,
    });

    tracked.register(subscriptions, result.subscription.id);
    tracked.register(studentPayments, result.payment.id);
    for (const claimRow of claimRows) {
      tracked.register(subscriptionPurchaseIdempotency, claimRow.id);
    }
    ledgerSubscriptionIds.push(result.subscription.id);
    ledgerPaymentIds.push(result.payment.id);

    // The re-application contract: exactly one attempt recorded, the row
    // flipped back into evaluation, the attempt stamped.
    const rowAfter = await readApplicantRow(reapplicantId);
    expect(rowAfter.status).toBe(ApplicantStatus.InEvaluation);
    expect(rowAfter.verificationAttempts).toBe((rowBefore.verificationAttempts ?? 0) + 1);
    expect(rowAfter.lastAttemptAt).not.toBeNull();

    expect(await inboxCount(reapplicantId)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(1);
  });

  test("step 6 — Student (non-applicant): purchase denied through the real applicant gate; zero side effects", async () => {
    const foreignUserId = bundle.cast.student.user.id;
    const countsBefore = await purchaseSetCounts(foreignUserId);
    const paymentsBefore = await studentOwnedPaymentCount(foreignUserId);

    const denial = await catchJourneyError(() =>
      VerificationPurchaseService.purchase(foreignUserId, KEY_STUDENT, "en")
    );
    if (!(denial instanceof NotFoundError)) {
      throw new Error(`expected NotFoundError (got ${denial instanceof Error ? denial.name : String(denial)})`);
    }
    expect(denial.code).toBe("APPLICANT_NOT_FOUND");
    expect(denial.message).toContain(ERRORS_EN.applicantNotFound);

    // The denial wrote nothing for the foreign caller.
    expect(await purchaseSetCounts(foreignUserId)).toEqual(countsBefore);
    expect(await studentOwnedPaymentCount(foreignUserId)).toBe(paymentsBefore);
    expect(await studentsRowCount(foreignUserId)).toBe(1);
    expect(await inboxCount(foreignUserId)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(1);
  });

  test("step 7 — Foreign APPLICANT: replaying Applicant A's SPENT key → oracle-safe payment-not-found; the student's replay is gate-denied; the owner's decided pair stays byte-identical", async () => {
    const foreignApplicantId = applicantC.id;
    const foreignStudentId = bundle.cast.student.user.id;
    const ownerId = bundle.cast.applicant.user.id;
    const ownerSubscriptionId = ledgerSubscriptionIds[0] ?? 0;
    const ownerPaymentId = ledgerPaymentIds[0] ?? 0;
    const foreignApplicantCountsBefore = await purchaseSetCounts(foreignApplicantId);
    const foreignApplicantRowBefore = await readApplicantRow(foreignApplicantId);
    const foreignStudentCountsBefore = await purchaseSetCounts(foreignStudentId);
    const ownerSubscriptionBefore = await readSubscriptionRow(ownerSubscriptionId);
    const ownerPaymentBefore = await readPaymentRow(ownerPaymentId);

    // The honest FOREIGN APPLICANT (an applicants row with no active
    // cooldown) passes the lifecycle gate, reaches the SPENT key's claim
    // classification, and is denied with the oracle-safe payment-not-found:
    // another caller's claim is never surfaced.
    const applicantDenial = await catchJourneyError(() =>
      VerificationPurchaseService.purchase(foreignApplicantId, KEY_PURCHASE_A, "en")
    );
    if (!(applicantDenial instanceof NotFoundError)) {
      throw new Error(
        `expected NotFoundError (got ${applicantDenial instanceof Error ? applicantDenial.name : String(applicantDenial)})`
      );
    }
    expect(applicantDenial.code).toBe("PAYMENT_NOT_FOUND");
    expect(applicantDenial.message).toContain(ERRORS_EN.notFound);
    // Oracle-safe: the generic denial leaks nothing about the key's owner.
    expect(applicantDenial.message).not.toContain(bundle.cast.applicant.user.email);

    // The STUDENT (non-applicant) replaying the SAME SPENT key is denied
    // EARLIER — the applicant-row gate runs inside the transaction before
    // the claim classification — with the localized applicant-not-found
    // denial; equally oracle-safe (it also discloses nothing about the
    // key's owner).
    const studentDenial = await catchJourneyError(() =>
      VerificationPurchaseService.purchase(foreignStudentId, KEY_PURCHASE_A, "en")
    );
    if (!(studentDenial instanceof NotFoundError)) {
      throw new Error(
        `expected NotFoundError (got ${studentDenial instanceof Error ? studentDenial.name : String(studentDenial)})`
      );
    }
    expect(studentDenial.code).toBe("APPLICANT_NOT_FOUND");
    expect(studentDenial.message).toContain(ERRORS_EN.applicantNotFound);
    expect(studentDenial.message).not.toContain(bundle.cast.applicant.user.email);

    // Neither foreign caller wrote anything: the replaying applicant's row
    // is byte-identical (status, attempts, last-attempt stamp) and the
    // owner's decided pair is untouched.
    expect(await purchaseSetCounts(foreignApplicantId)).toEqual(foreignApplicantCountsBefore);
    const foreignApplicantRowAfter = await readApplicantRow(foreignApplicantId);
    expect(foreignApplicantRowAfter.status).toBe(foreignApplicantRowBefore.status);
    expect(foreignApplicantRowAfter.verificationAttempts).toBe(foreignApplicantRowBefore.verificationAttempts);
    expect(foreignApplicantRowAfter.lastAttemptAt?.getTime()).toBe(foreignApplicantRowBefore.lastAttemptAt?.getTime());
    expect(await purchaseSetCounts(foreignStudentId)).toEqual(foreignStudentCountsBefore);
    const ownerSubscriptionAfter = await readSubscriptionRow(ownerSubscriptionId);
    expect(ownerSubscriptionAfter.status).toBe(SubscriptionStatus.Active);
    expect(ownerSubscriptionAfter.updatedAt.getTime()).toBe(ownerSubscriptionBefore.updatedAt.getTime());
    const ownerPaymentAfter = await readPaymentRow(ownerPaymentId);
    expect(ownerPaymentAfter.status).toBe(PaymentStatus.Paid);
    expect(ownerPaymentAfter.updatedAt.getTime()).toBe(ownerPaymentBefore.updatedAt.getTime());
    expect(await inboxCount(ownerId)).toBe(1);
    expect(await inboxCount(foreignApplicantId)).toBe(0);
    expect(await inboxCount(foreignStudentId)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(1);
  });
});
