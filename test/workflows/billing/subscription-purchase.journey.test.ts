/**
 * Cross-actor journey — subscription purchase → gateway settlement workflow.
 *
 * Sequential, actor-attributed steps executed against the REAL services on
 * the REAL test database (later steps observe the shared state earlier steps
 * committed):
 *
 *   1. Student A purchases a plan under an idempotency key → ONE pending
 *      pair (subscription + payment) + junction row + verbatim-keyed claim,
 *      with the gateway checkout descriptor surfaced.
 *   2. Student A retries the SAME key → DUPLICATE_REQUEST conflict; the
 *      committed pending set is byte-for-byte the same row count.
 *   3. Emitter delivers the confirmed gateway event → payment `paid`,
 *      subscription `active` (endDate − startDate = intervalDays exactly),
 *      the plan's balance lane credited the full sessionCount, ONE
 *      payment-confirmation notification persisted, and the receipt
 *      published strictly post-commit — addressed to Student A ONLY.
 *   4. Student A lists own subscriptions → the active row with dates; the
 *      balance delta is present. Student B's list stays empty.
 *   5. Emitter replays the SAME confirmed event → `{ processed, replayed }`
 *      ack: no second credit (balance identical), no second notification,
 *      no second publish, decided rows untouched.
 *   6. Student A purchases again (fresh key) and the gateway fails the
 *      payment → payment `failed`, subscription stays pending, zero credit.
 *   7. Parent attempts the purchase mutation through the real GraphQL scope
 *      gate → FORBIDDEN; zero rows. (The service layer itself is
 *      role-agnostic — the scope gate is the GraphQL boundary. The full
 *      401/403/200 role matrix for BOTH operations is pinned by
 *      `backend/graphql/test/subscription-purchase.roles.test.ts`.)
 *   8. Student B replays Student A's SPENT key → the oracle-safe generic
 *      not-found denial (no owner existence leak); B writes nothing and B's
 *      own list is untouched.
 *   9. Anonymous caller → UNAUTHORIZED through the same scope gate (route
 *      transport mapping pinned by `backend/graphql/test/context-keys.test.ts`).
 *  10. System: a webhook delivery whose signature fails verification is
 *      masked at the route boundary with 401 BEFORE any parsing (pinned by
 *      `app/api/payments/webhook/test/payments-webhook-route.test.ts` — not
 *      re-testable in-process; the service only ever receives verified
 *      events). The service-level truth proven here: a delivery carrying an
 *      uncorrelatable reference mutates NOTHING and logs one bounded
 *      unknown-reference entry.
 *  11. Student A purchases the SEEDED Reviews-lane plan ("New Teacher
 *      Verification & Evaluation Plan" — the demo-catalog member seeded
 *      ACTIVE on the reviews lane) and the emitter confirms it →
 *      `balance_reviews` credited exactly the seeded plan's `sessionCount`
 *      (hifz/tajweed byte-identical): the seeded, documented lane routes
 *      like any other plan end-to-end.
 *  12. Student A purchases the journey's own Tajweed-lane plan (provisioned
 *      in the fixture transaction) and the emitter confirms it →
 *      `balance_tajweed` credited exactly the plan's `sessionCount` with
 *      hifz/reviews/trial byte-identical; a replay of the SAME confirmed
 *      event acks replayed with no second credit; no foreign actor observes
 *      a balance change, inbox entry, or publish.
 *
 * Journey rules honored (`test/workflows/AGENTS.md`):
 * - fixtures COMMITTED in `beforeAll` inside ONE committing transaction;
 *   never `runInRollback` (the services spawn their own top-level
 *   transactions);
 * - honest actors: real `users` rows + real role-child rows via the
 *   actor-context factory; denials flow through the real authorization path
 *   (GraphQL scope gate / service ownership checks), nothing monkey-patched;
 * - external effects intercepted at the notification boundary: the fan-out
 *   publish seam is SPIED (the activation service publishes post-commit
 *   through the engine's default transport seam — the service exposes no
 *   injected-transport parameter, so the spy rides the same namespace-bound
 *   seam the service calls, per the layer's interception rule);
 * - error assertions through `catchJourneyError` + translated substrings /
 *   domain codes — never `.rejects.toThrow()`;
 * - per-run `jrn_billing_<8hex>` prefix on every fixture name and
 *   idempotency key;
 * - cross-actor visibility asserted BOTH directions plus denial probes.
 *
 * Immutable-ledger residue policy: `student_payments` rows are append-only
 * (BEFORE DELETE trigger) and a decided payment can never be edited or
 * removed through the guarded surface — but the rows ARE deletable under the
 * sanctioned teardown suspension (`withImmutabilityTriggersSuspended`), which
 * is exactly what `afterAll` does FIRST, followed by the junction, then the
 * claims → subscriptions → plans → role-children → users legs via
 * `TrackedFixtures` (registration order is the FK-safe reverse-delete order).
 * Teardown must leave ZERO residue: every registered row is re-probed after
 * the sweep, and a leaking `afterAll` fails the suite loudly. Unique per-run
 * prefixes make any intermediate crash residue greppable and harmless.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { graphql } from "graphql";
import { db } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { notifications } from "@/backend/db/schema/notifications";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { createTestPlan } from "@/backend/db/test/entity-setup";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { toUserRole } from "@/backend/enum/users/user-role.enum";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { ConflictError, NotFoundError } from "@/backend/lib/errors";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import { SubscriptionActivationService, SubscriptionPurchaseService } from "@/backend/services";
import { NotificationEngine } from "@/backend/services/notifications";
import type { DBTransaction, PaymentWebhookEvent, PlanSelectType, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { Translations } from "@/shared/locale/types/message";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  catchJourneyError,
  journeyPrefix,
  provisionParentActor,
  provisionStudentActor,
  TrackedFixtures,
} from "@/test/workflows/helpers";

// ─── Harness state ───────────────────────────────────────────────────────────

/** Per-run unique prefix — every fixture name, plan title, and idempotency key. */
const PREFIX = journeyPrefix("billing");

/** Error-copy locale for every service call and denial assertion. */
const ERRORS_EN = getServerTranslations("en").errorsTranslations;
/** Notification copy — the confirmation wave composes in the RECIPIENT's persisted locale. */
const NOTIFS_EN = getServerTranslations("en").notificationsTranslations;

/** Milliseconds per day — the activation window arithmetic. */
const MS_PER_DAY = 86_400_000;

/** Session count the journey plan grants (the credit amount under test). */
const PLAN_SESSION_COUNT = 7;
/** Activation window of the journey plan (days). */
const PLAN_INTERVAL_DAYS = 30;
/** Session count of the Tajweed-lane fixture plan (distinct from the Hifz plan's). */
const TAJWEED_PLAN_SESSION_COUNT = 5;

const tracked = new TrackedFixtures();

/**
 * The fan-out publish spy — installed over the engine's publish boundary
 * (the activation service publishes post-commit through this exact
 * namespace-bound seam; it exposes no injected-transport parameter).
 * Restored in `afterAll`.
 */
const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});

/** Idempotency keys — one per purchase/denial leg, ≤128 chars, unique per run. */
const KEY_PURCHASE = `${PREFIX}-key-purchase`;
const KEY_SECOND = `${PREFIX}-key-second`;
const KEY_PARENT = `${PREFIX}-key-parent`;
const KEY_REVIEWS = `${PREFIX}-key-reviews`;
const KEY_TAJWEED = `${PREFIX}-key-tajweed`;

/**
 * The SEEDED Reviews-lane demo plan (step 11's purchase target). Seeded by
 * the plan-catalog seeder (CI runs `bun run db seed` before the service
 * suites; the canonical spec lives in `backend/db/seeds/billing/seed-plans.ts`)
 * — read-only here, never mutated, never tracked: it is environment catalog
 * state, not a journey fixture. Read in `beforeAll` and fail-fast loudly if
 * the environment lacks it.
 */
const REVIEWS_PLAN_TITLE = "New Teacher Verification & Evaluation Plan";

/** Ledger rows created by the service during the journey (teardown worklist). */
const ledgerPaymentIds: number[] = [];
const ledgerSubscriptionIds: number[] = [];

let studentA: JourneyActorRow;
let studentB: JourneyActorRow;
let parentActor: { readonly userId: number };
let parentUser: UserSelectType;
let planRow: PlanSelectType;
let reviewsPlanRow: PlanSelectType;
let tajweedPlanRow: PlanSelectType;

/** A journey cast member: the actor-context bundle plus its user row. */
interface JourneyActorRow {
  readonly userId: number;
  readonly user: UserSelectType;
}

// ─── GraphQL denial harness (in-process — the same schema/scope gate the HTTP boundary runs) ──

const PURCHASE_SOURCE = `
  mutation PurchaseSubscription($input: PurchaseSubscriptionInput!) {
    purchaseSubscription(input: $input) {
      subscription { id status }
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

/** Anonymous context — the factory's absent-token shape (no token verified). */
function anonymousContext(): Context {
  const translations = getServerTranslations("en");
  return {
    locale: "en",
    t: async <K extends keyof Translations>(namespace: K) => translations[namespace],
    requestId: `${PREFIX}-request`,
    idempotencyKey: null,
    user: null,
    safeUser: null,
    permissions: [],
    isSuperAdmin: false,
    role: null,
    cookies: {},
    authCookieOut: [],
  };
}

/** Runs the purchase mutation as one caller through the real scope gate. */
async function executePurchaseMutation(contextValue: Context) {
  return graphql({
    schema: graphQLSchema,
    source: PURCHASE_SOURCE,
    variableValues: { input: { planId: String(planRow.id) } },
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

/** Committed pending-set counters for one user (the purchase oracle). */
async function pendingSetCounts(studentUserId: number): Promise<{
  subs: number;
  payments: number;
  junction: number;
  claims: number;
}> {
  const [subs, payments, junction, claims] = await Promise.all([
    db.$count(subscriptions, eq(subscriptions.userId, studentUserId)),
    db.$count(studentPayments, eq(studentPayments.studentId, studentUserId)),
    db.$count(studentSubscriptions, eq(studentSubscriptions.studentId, studentUserId)),
    db.$count(subscriptionPurchaseIdempotency, eq(subscriptionPurchaseIdempotency.userId, studentUserId)),
  ]);
  return { subs, payments, junction, claims };
}

/** Reads one student's live balance lanes. */
async function readBalances(studentUserId: number): Promise<StudentBalance> {
  const rows = await db.select().from(students).where(eq(students.id, studentUserId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("readBalances: student fixture row vanished");
  }
  return {
    hifz: row.balanceHifz,
    tajweed: row.balanceTajweed,
    reviews: row.balanceReviews,
    trial: row.balanceTrial,
  };
}

/** The student balance lanes this journey asserts on (trial is non-nullable). */
interface StudentBalance {
  readonly hifz: number | null;
  readonly tajweed: number | null;
  readonly reviews: number | null;
  readonly trial: number;
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

/** Reads one payment ledger row by id, failing when absent. */
async function paymentRow(paymentId: number) {
  const rows = await db.select().from(studentPayments).where(eq(studentPayments.id, paymentId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`payment ledger row ${paymentId} vanished`);
  }
  return row;
}

/** Reads one subscription row by id, failing when absent. */
async function subscriptionRow(subscriptionId: number) {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`subscription row ${subscriptionId} vanished`);
  }
  return row;
}

/**
 * Installs a recording stub over `logger.logDomainError` so expected
 * domain rejections stay silent in test output AND become assertable.
 * Callers MUST `stop()` (use try/finally).
 */
function recordDomainLogs(): { codes: string[]; stop: () => void } {
  const codes: string[] = [];
  const spy = spyOn(logger, "logDomainError").mockImplementation((_message: string, ctx?: DomainErrorContext) => {
    codes.push(ctx?.code ?? "<missing>");
  });
  return { codes, stop: () => spy.mockRestore() };
}

// ─── Fixture provisioning ────────────────────────────────────────────────────

/**
 * Provisions one student cast member through the actor-context factory and
 * re-reads the committed user row (the GraphQL denial harness consumes it).
 */
async function provisionStudent(tx: DBTransaction): Promise<JourneyActorRow> {
  const actor = await provisionStudentActor(tx, { tracked });
  // The journey cast members carry an explicit stored locale: the activation
  // composes the confirmation copy in the RECIPIENT's persisted locale (the
  // users row's `locale`, falling back to the platform default when unset),
  // and every copy assertion below composes against the EN bundle.
  await tx.update(users).set({ locale: "en" }).where(eq(users.id, actor.userId));
  const rows = await tx.select().from(users).where(eq(users.id, actor.userId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("journey fixture: student user row vanished inside the provisioning transaction");
  }
  return { userId: actor.userId, user: row };
}

beforeAll(async () => {
  // ONE committing transaction: commit-or-nothing fixture provisioning.
  await db.transaction(async tx => {
    studentA = await provisionStudent(tx);
    studentB = await provisionStudent(tx);

    const parent = await provisionParentActor(tx, { tracked });
    const parentRows = await tx.select().from(users).where(eq(users.id, parent.userId)).limit(1);
    const parentRow = parentRows[0];
    if (!parentRow) {
      throw new Error("journey fixture: parent user row vanished inside the provisioning transaction");
    }
    parentActor = { userId: parent.userId };
    parentUser = parentRow;

    planRow = await createTestPlan(tx, {
      title: `${PREFIX} plan`,
      sessionCount: PLAN_SESSION_COUNT,
      price: "200.00",
      currency: "EGP",
      intervalDays: PLAN_INTERVAL_DAYS,
      balanceLane: SubscriptionCreditLane.Hifz,
    });
    tracked.register(plans, planRow.id);

    tajweedPlanRow = await createTestPlan(tx, {
      title: `${PREFIX} tajweed plan`,
      sessionCount: TAJWEED_PLAN_SESSION_COUNT,
      price: "150.00",
      currency: "EGP",
      intervalDays: PLAN_INTERVAL_DAYS,
      balanceLane: SubscriptionCreditLane.Tajweed,
    });
    tracked.register(plans, tajweedPlanRow.id);

    // The seeded Reviews-lane plan (step 11's purchase target): a read-only
    // catalog lookup — the row is environment seed state, never registered
    // for cleanup (we never mutate it). A missing row is a loud environment
    // failure, not a silent skip.
    const reviewsRows = await tx.select().from(plans).where(eq(plans.title, REVIEWS_PLAN_TITLE)).limit(1);
    const reviewsRow = reviewsRows[0];
    if (!reviewsRow) {
      throw new Error(
        `journey fixture: the seeded Reviews-lane plan "${REVIEWS_PLAN_TITLE}" is missing from the test catalog — run the plan-catalog seeder`
      );
    }
    reviewsPlanRow = reviewsRow;
  });
});

afterAll(async () => {
  publishSpy.mockRestore();
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

describe("cross-actor journey: subscription purchase → gateway settlement", () => {
  test("step 1 — Student A: purchase commits ONE pending pair + junction + verbatim claim, checkout descriptor surfaced", async () => {
    const purchasesBefore = await pendingSetCounts(studentA.userId);

    const result = await SubscriptionPurchaseService.purchase(
      studentA.userId,
      { planId: planRow.id },
      KEY_PURCHASE,
      "en"
    );

    // The returned pending pair: subscription pending, gateway reference
    // correlation, verbatim plan money — no arithmetic, no client values.
    expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
    expect(result.subscription.userId).toBe(studentA.userId);
    expect(result.subscription.planId).toBe(planRow.id);
    expect(result.subscription.paymentReference).toBe(result.checkout.providerReference);
    expect(result.checkout.provider).toBe(PaymentGateway.Mock);
    expect(result.checkout.providerReference.startsWith("mock_")).toBe(true);
    expect(result.checkout.checkoutUrl).toBeNull();
    expect(result.payment.amount).toBe(planRow.price);
    expect(result.payment.currency).toBe(planRow.currency);
    expect(result.payment.status).toBe(PaymentStatus.Pending);
    expect(result.payment.subscriptionId).toBe(result.subscription.id);

    // Exactly ONE committed pending set for the purchaser.
    const counts = await pendingSetCounts(studentA.userId);
    expect(counts).toEqual({
      subs: purchasesBefore.subs + 1,
      payments: purchasesBefore.payments + 1,
      junction: purchasesBefore.junction + 1,
      claims: purchasesBefore.claims + 1,
    });

    // The junction binds the purchasing student to the new subscription.
    const junctionRows = await db
      .select()
      .from(studentSubscriptions)
      .where(eq(studentSubscriptions.subscriptionId, result.subscription.id));
    expect(junctionRows).toHaveLength(1);
    expect(junctionRows[0]?.studentId).toBe(studentA.userId);

    // The claim is keyed VERBATIM and backfilled with the winning pair.
    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, KEY_PURCHASE));
    // Track every service-created row for teardown before asserting
    // cardinality — a duplicate row must not strand committed rows.
    tracked.register(subscriptions, result.subscription.id);
    tracked.register(studentPayments, result.payment.id);
    for (const claimRow of claimRows) {
      tracked.register(subscriptionPurchaseIdempotency, claimRow.id);
    }
    expect(claimRows).toHaveLength(1);
    expect(claimRows[0]?.userId).toBe(studentA.userId);
    expect(claimRows[0]?.subscriptionId).toBe(result.subscription.id);

    ledgerSubscriptionIds.push(result.subscription.id);
    ledgerPaymentIds.push(result.payment.id);
  });

  test("step 2 — Student A: same-key retry → DUPLICATE_REQUEST, zero second rows", async () => {
    const countsBefore = await pendingSetCounts(studentA.userId);

    const conflict = await catchJourneyError(() =>
      SubscriptionPurchaseService.purchase(studentA.userId, { planId: planRow.id }, KEY_PURCHASE, "en")
    );
    if (!(conflict instanceof ConflictError)) {
      throw new Error(`expected ConflictError (got ${conflict instanceof Error ? conflict.name : String(conflict)})`);
    }
    expect(conflict.code).toBe("DUPLICATE_REQUEST");

    // The replay burned nothing: the pending set is unchanged.
    expect(await pendingSetCounts(studentA.userId)).toEqual(countsBefore);
  });

  test("step 3 — Emitter: confirmed event → paid + active window + full lane credit + ONE notification published to Student A ONLY", async () => {
    const balancesBefore = await readBalances(studentA.userId);
    const purchasesBefore = await pendingSetCounts(studentA.userId);
    const windowStart = Date.now() - 2_000;

    const reference = (await subscriptionRow(ledgerSubscriptionIds[0] ?? 0)).paymentReference;
    const ledger = await paymentRow(ledgerPaymentIds[0] ?? 0);
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

    // The ledger decision: pending → paid.
    const paid = await paymentRow(ledgerPaymentIds[0] ?? 0);
    expect(paid.status).toBe(PaymentStatus.Paid);

    // The activation window: startDate ≈ now, verification stamped,
    // endDate − startDate = intervalDays exactly.
    const active = await subscriptionRow(ledgerSubscriptionIds[0] ?? 0);
    expect(active.status).toBe(SubscriptionStatus.Active);
    expect(active.paymentVerifiedAt).not.toBeNull();
    if (active.startDate === null || active.endDate === null) {
      throw new Error("expected the activated subscription to carry its window dates");
    }
    expect(active.startDate.getTime()).toBeGreaterThanOrEqual(windowStart);
    expect(active.endDate.getTime() - active.startDate.getTime()).toBe(PLAN_INTERVAL_DAYS * MS_PER_DAY);

    // The lane credit: exactly the plan's full sessionCount on the plan's lane.
    const balancesAfter = await readBalances(studentA.userId);
    expect((balancesAfter.hifz ?? 0) - (balancesBefore.hifz ?? 0)).toBe(PLAN_SESSION_COUNT);
    expect(balancesAfter.tajweed).toBe(balancesBefore.tajweed);
    expect(balancesAfter.reviews).toBe(balancesBefore.reviews);

    // The purchase set did not grow (activation mutated, never inserted).
    expect(await pendingSetCounts(studentA.userId)).toEqual(purchasesBefore);

    // ONE persisted notification, composed for the purchaser.
    const row = await soleNotification(studentA.userId);
    tracked.register(notifications, row.id);
    expect(row.type).toBe(NotificationType.PaymentConfirmation);
    expect(row.relatedEntityType).toBe("subscription");
    expect(row.relatedEntityId).toBe(ledgerSubscriptionIds[0]);
    expect(row.isRead).toBe(false);
    expect(row.title).toBe(NOTIFS_EN.eventPaymentConfirmedTitle);
    expect(row.body).toBe(NOTIFS_EN.eventPaymentConfirmedBody(planRow.title));

    // The receipt published strictly post-commit — to Student A ONLY.
    expect(publishSpy.mock.calls).toHaveLength(1);
    const published: unknown = publishSpy.mock.calls[0]?.[0];
    if (!Array.isArray(published) || published.length !== 1) {
      throw new Error("expected exactly one published delivery receipt");
    }
    const receipt = published[0];
    if (!isRecord(receipt) || !Array.isArray(receipt.recipientUserIds)) {
      throw new Error("expected the published receipt to carry its recipient ids");
    }
    expect(receipt.recipientUserIds).toEqual([studentA.userId]);

    // Both directions: no other cast member's inbox exists or grew.
    expect(await inboxCount(studentB.userId)).toBe(0);
    expect(await inboxCount(parentActor.userId)).toBe(0);
  });

  test("step 4 — Student A: listOwn shows the active window; Student B's list stays empty; balance delta present", async () => {
    const owned = await SubscriptionPurchaseService.listOwn(studentA.userId);
    expect(owned).toHaveLength(1);
    const active = owned[0];
    if (!active) {
      throw new Error("expected the owner's list to hold the purchased subscription");
    }
    expect(active.id).toBe(ledgerSubscriptionIds[0]);
    expect(active.status).toBe(SubscriptionStatus.Active);
    expect(active.startDate).not.toBeNull();
    expect(active.endDate).not.toBeNull();
    expect(active.paymentReference).toBe((await subscriptionRow(ledgerSubscriptionIds[0] ?? 0)).paymentReference);

    // The credited lane is visible on the owner's balance.
    const balances = await readBalances(studentA.userId);
    expect(balances.hifz).toBe(PLAN_SESSION_COUNT);

    // Isolation: the second student sees nothing of the owner's rows.
    expect(await SubscriptionPurchaseService.listOwn(studentB.userId)).toEqual([]);
  });

  test("step 5 — Emitter: replaying the SAME confirmed event → replayed ack, no double credit, no second notification/publish", async () => {
    const balancesBefore = await readBalances(studentA.userId);
    const decidedBefore = await paymentRow(ledgerPaymentIds[0] ?? 0);
    const activeBefore = await subscriptionRow(ledgerSubscriptionIds[0] ?? 0);
    const publishesBefore = publishSpy.mock.calls.length;
    const reference = activeBefore.paymentReference;
    if (reference === null) {
      throw new Error("expected the activated subscription to keep its gateway payment reference");
    }

    const event: PaymentWebhookEvent = {
      reference,
      outcome: "confirmed",
      amount: decidedBefore.amount,
      currency: decidedBefore.currency,
    };
    const outcome = await SubscriptionActivationService.processWebhookEvent(event, "en");
    expect(outcome).toEqual({ processed: true, replayed: true });

    // No second credit, no second notification, no second publish.
    expect(await readBalances(studentA.userId)).toEqual(balancesBefore);
    expect(await inboxCount(studentA.userId)).toBe(1);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);

    // The decided rows are untouched — statuses and timestamps identical.
    const decidedAfter = await paymentRow(ledgerPaymentIds[0] ?? 0);
    expect(decidedAfter.status).toBe(PaymentStatus.Paid);
    expect(decidedAfter.updatedAt.getTime()).toBe(decidedBefore.updatedAt.getTime());
    const activeAfter = await subscriptionRow(ledgerSubscriptionIds[0] ?? 0);
    expect(activeAfter.startDate?.getTime()).toBe(activeBefore.startDate?.getTime());
    expect(activeAfter.endDate?.getTime()).toBe(activeBefore.endDate?.getTime());
    expect(activeAfter.updatedAt.getTime()).toBe(activeBefore.updatedAt.getTime());
  });

  test("step 6 — Student A: fresh-key purchase + failed event → payment failed, subscription stays pending, zero credit", async () => {
    const balancesBefore = await readBalances(studentA.userId);
    const countsBefore = await pendingSetCounts(studentA.userId);

    const result = await SubscriptionPurchaseService.purchase(
      studentA.userId,
      { planId: planRow.id },
      KEY_SECOND,
      "en"
    );
    expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
    tracked.register(subscriptions, result.subscription.id);
    tracked.register(studentPayments, result.payment.id);
    ledgerSubscriptionIds.push(result.subscription.id);
    ledgerPaymentIds.push(result.payment.id);
    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, KEY_SECOND));
    for (const claimRow of claimRows) {
      tracked.register(subscriptionPurchaseIdempotency, claimRow.id);
    }
    expect(claimRows).toHaveLength(1);

    const event: PaymentWebhookEvent = {
      reference: result.checkout.providerReference,
      outcome: "failed",
      amount: result.payment.amount,
      currency: result.payment.currency,
    };
    const outcome = await SubscriptionActivationService.processWebhookEvent(event, "en");
    expect(outcome).toEqual({ processed: true });

    // The ledger records the failure; the subscription stays pending.
    const failed = await paymentRow(result.payment.id);
    expect(failed.status).toBe(PaymentStatus.Failed);
    const owned = await SubscriptionPurchaseService.listOwn(studentA.userId);
    expect(owned).toHaveLength(2);
    const pending = owned.find(entry => entry.id === result.subscription.id);
    if (!pending) {
      throw new Error("expected the failed purchase's subscription in the owner's list");
    }
    expect(pending.status).toBe(SubscriptionStatus.Pending);
    expect(pending.startDate).toBeNull();
    expect(pending.endDate).toBeNull();

    // Zero credit; the failure leg persists + publishes ONE failure
    // notification (the failed copy pair) to Student A.
    expect(await readBalances(studentA.userId)).toEqual(balancesBefore);
    expect(await inboxCount(studentA.userId)).toBe(2);
    expect(publishSpy.mock.calls).toHaveLength(2);
    const failureNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.relatedEntityId, result.subscription.id));
    expect(failureNotifs).toHaveLength(1);
    if (failureNotifs[0]) {
      tracked.register(notifications, failureNotifs[0].id);
      expect(failureNotifs[0].type).toBe(NotificationType.PaymentConfirmation);
      expect(failureNotifs[0].userId).toBe(studentA.userId);
    }

    // The committed pending set grew by exactly the new pair.
    const countsAfter = await pendingSetCounts(studentA.userId);
    expect(countsAfter).toEqual({
      subs: countsBefore.subs + 1,
      payments: countsBefore.payments + 1,
      junction: countsBefore.junction + 1,
      claims: countsBefore.claims + 1,
    });
  });

  test("step 7 — Parent: purchase through the real GraphQL scope gate → FORBIDDEN, zero writes", async () => {
    const countsBefore = await pendingSetCounts(parentActor.userId);

    const result = await executePurchaseMutation(contextFor(parentUser, KEY_PARENT));
    expectSingleDenial(result, "FORBIDDEN");

    // The denial wrote nothing for the denied caller.
    expect(await pendingSetCounts(parentActor.userId)).toEqual(countsBefore);
  });

  test("step 8 — Student B: replaying A's SPENT key → oracle-safe not-found, no writes, owner's set intact", async () => {
    const countsBefore = await pendingSetCounts(studentB.userId);
    const ownerCounts = await pendingSetCounts(studentA.userId);

    const denial = await catchJourneyError(() =>
      SubscriptionPurchaseService.purchase(studentB.userId, { planId: planRow.id }, KEY_PURCHASE, "en")
    );
    if (!(denial instanceof NotFoundError)) {
      throw new Error(`expected NotFoundError (got ${denial instanceof Error ? denial.name : String(denial)})`);
    }
    expect(denial.code).toBe("PAYMENT_NOT_FOUND");
    expect(denial.message).toContain(ERRORS_EN.notFound);
    // Oracle-safe: the generic denial leaks nothing about the key's owner.
    expect(denial.message).not.toContain(studentA.user.email);

    // The foreign caller wrote nothing; the owner's set is untouched.
    expect(await pendingSetCounts(studentB.userId)).toEqual(countsBefore);
    expect(await pendingSetCounts(studentA.userId)).toEqual(ownerCounts);
    expect(await SubscriptionPurchaseService.listOwn(studentB.userId)).toEqual([]);
  });

  test("step 9 — Anonymous: purchase through the real scope gate → UNAUTHORIZED, zero writes", async () => {
    const ownerCounts = await pendingSetCounts(studentA.userId);
    const parentCounts = await pendingSetCounts(parentActor.userId);

    const result = await executePurchaseMutation(anonymousContext());
    expectSingleDenial(result, "UNAUTHORIZED");

    expect(await pendingSetCounts(studentA.userId)).toEqual(ownerCounts);
    expect(await pendingSetCounts(parentActor.userId)).toEqual(parentCounts);
  });

  test("step 10 — System: unverifiable deliveries never reach the service (route-pinned); an uncorrelatable reference mutates nothing", async () => {
    const logs = recordDomainLogs();
    const ownerCounts = await pendingSetCounts(studentA.userId);
    const balancesBefore = await readBalances(studentA.userId);
    try {
      // A wrong-signature webhook is masked at the route boundary with 401
      // BEFORE parsing — pinned by the route suite; the service's honest
      // in-process contract is the uncorrelatable-reference delivery.
      const event: PaymentWebhookEvent = {
        reference: `mock_unknown-${PREFIX}`,
        outcome: "confirmed",
        amount: planRow.price,
        currency: planRow.currency,
      };
      const outcome = await SubscriptionActivationService.processWebhookEvent(event, "en");
      expect(outcome).toEqual({ processed: false });

      // Exactly ONE bounded log — never an error storm.
      expect(logs.codes).toEqual(["PAYMENT_REFERENCE_UNKNOWN"]);
    } finally {
      logs.stop();
    }

    // Zero mutation anywhere: pending set, balances, inbox, publishes.
    expect(await pendingSetCounts(studentA.userId)).toEqual(ownerCounts);
    expect(await readBalances(studentA.userId)).toEqual(balancesBefore);
    expect(await inboxCount(studentA.userId)).toBe(2);
    expect(publishSpy.mock.calls).toHaveLength(2);
  });

  test("step 11 — Student A: purchase on the seeded Reviews-lane plan + confirmed event → balance_reviews credited exactly", async () => {
    // The seeded-catalog premise: the verification plan is ACTIVE and rides
    // the reviews lane (the same lane the demo seeder declares).
    expect(reviewsPlanRow.isActive).toBe(true);
    expect(reviewsPlanRow.balanceLane).toBe(SubscriptionCreditLane.Reviews);

    const balancesBefore = await readBalances(studentA.userId);
    const countsBefore = await pendingSetCounts(studentA.userId);

    const result = await SubscriptionPurchaseService.purchase(
      studentA.userId,
      { planId: reviewsPlanRow.id },
      KEY_REVIEWS,
      "en"
    );
    expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
    expect(result.payment.amount).toBe(reviewsPlanRow.price);
    expect(result.payment.currency).toBe(reviewsPlanRow.currency);
    tracked.register(subscriptions, result.subscription.id);
    tracked.register(studentPayments, result.payment.id);
    ledgerSubscriptionIds.push(result.subscription.id);
    ledgerPaymentIds.push(result.payment.id);
    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, KEY_REVIEWS));
    for (const claimRow of claimRows) {
      tracked.register(subscriptionPurchaseIdempotency, claimRow.id);
    }
    expect(claimRows).toHaveLength(1);

    const event: PaymentWebhookEvent = {
      reference: result.checkout.providerReference,
      outcome: "confirmed",
      amount: result.payment.amount,
      currency: result.payment.currency,
    };
    const outcome = await SubscriptionActivationService.processWebhookEvent(event, "en");
    expect(outcome).toEqual({ processed: true });

    // The reviews lane credited exactly the seeded plan's sessionCount; the
    // hifz/tajweed lanes are byte-identical — the documented lane routes
    // like any other plan.
    const balancesAfter = await readBalances(studentA.userId);
    expect((balancesAfter.reviews ?? 0) - (balancesBefore.reviews ?? 0)).toBe(reviewsPlanRow.sessionCount);
    expect(balancesAfter.hifz).toBe(balancesBefore.hifz);
    expect(balancesAfter.tajweed).toBe(balancesBefore.tajweed);

    // The third subscription activated; the payment decided paid.
    const active = await subscriptionRow(result.subscription.id);
    expect(active.status).toBe(SubscriptionStatus.Active);
    expect((await paymentRow(result.payment.id)).status).toBe(PaymentStatus.Paid);

    // The committed pending set grew by exactly the third pair.
    const countsAfter = await pendingSetCounts(studentA.userId);
    expect(countsAfter).toEqual({
      subs: countsBefore.subs + 1,
      payments: countsBefore.payments + 1,
      junction: countsBefore.junction + 1,
      claims: countsBefore.claims + 1,
    });

    // ONE more persisted notification (student A's inbox now holds three:
    // the step-3 confirmation, the step-6 failure copy, this confirmation)
    // and ONE more post-commit publish — the confirmation fan-out targets
    // the purchaser only, exactly like step 3's.
    expect(await inboxCount(studentA.userId)).toBe(3);
    const reviewsNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.relatedEntityId, result.subscription.id));
    for (const notification of reviewsNotifs) {
      tracked.register(notifications, notification.id);
    }
    expect(reviewsNotifs).toHaveLength(1);
    if (reviewsNotifs[0]) {
      expect(reviewsNotifs[0].type).toBe(NotificationType.PaymentConfirmation);
      expect(reviewsNotifs[0].userId).toBe(studentA.userId);
    }
    expect(publishSpy.mock.calls).toHaveLength(3);
  });

  test("step 12 — Student A: purchase on the Tajweed-lane fixture plan + confirmed event → balance_tajweed credited exactly; replay never double-credits", async () => {
    expect(tajweedPlanRow.balanceLane).toBe(SubscriptionCreditLane.Tajweed);

    const balancesBefore = await readBalances(studentA.userId);
    const foreignBefore = await readBalances(studentB.userId);
    const countsBefore = await pendingSetCounts(studentA.userId);

    const result = await SubscriptionPurchaseService.purchase(
      studentA.userId,
      { planId: tajweedPlanRow.id },
      KEY_TAJWEED,
      "en"
    );
    expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
    expect(result.payment.amount).toBe(tajweedPlanRow.price);
    expect(result.payment.currency).toBe(tajweedPlanRow.currency);
    tracked.register(subscriptions, result.subscription.id);
    tracked.register(studentPayments, result.payment.id);
    ledgerSubscriptionIds.push(result.subscription.id);
    ledgerPaymentIds.push(result.payment.id);
    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, KEY_TAJWEED));
    for (const claimRow of claimRows) {
      tracked.register(subscriptionPurchaseIdempotency, claimRow.id);
    }
    expect(claimRows).toHaveLength(1);

    const event: PaymentWebhookEvent = {
      reference: result.checkout.providerReference,
      outcome: "confirmed",
      amount: result.payment.amount,
      currency: result.payment.currency,
    };
    const outcome = await SubscriptionActivationService.processWebhookEvent(event, "en");
    expect(outcome).toEqual({ processed: true });

    // The tajweed lane credited exactly the plan's sessionCount; every sibling
    // lane — hifz, reviews, and the trial lane — is byte-identical.
    const balancesAfter = await readBalances(studentA.userId);
    expect((balancesAfter.tajweed ?? 0) - (balancesBefore.tajweed ?? 0)).toBe(TAJWEED_PLAN_SESSION_COUNT);
    expect(balancesAfter.hifz).toBe(balancesBefore.hifz);
    expect(balancesAfter.reviews).toBe(balancesBefore.reviews);
    expect(balancesAfter.trial).toBe(balancesBefore.trial);

    // The fourth subscription activated; the payment decided paid.
    const active = await subscriptionRow(result.subscription.id);
    expect(active.status).toBe(SubscriptionStatus.Active);
    expect((await paymentRow(result.payment.id)).status).toBe(PaymentStatus.Paid);

    // The committed pending set grew by exactly the fourth pair.
    const countsAfter = await pendingSetCounts(studentA.userId);
    expect(countsAfter).toEqual({
      subs: countsBefore.subs + 1,
      payments: countsBefore.payments + 1,
      junction: countsBefore.junction + 1,
      claims: countsBefore.claims + 1,
    });

    // ONE more persisted notification (student A's inbox now holds four:
    // the step-3 confirmation, the step-6 failure copy, the step-11
    // confirmation, this confirmation) and ONE more post-commit publish —
    // addressed to Student A ONLY.
    expect(await inboxCount(studentA.userId)).toBe(4);
    const tajweedNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.relatedEntityId, result.subscription.id));
    for (const notification of tajweedNotifs) {
      tracked.register(notifications, notification.id);
    }
    expect(tajweedNotifs).toHaveLength(1);
    if (tajweedNotifs[0]) {
      expect(tajweedNotifs[0].type).toBe(NotificationType.PaymentConfirmation);
      expect(tajweedNotifs[0].userId).toBe(studentA.userId);
      expect(tajweedNotifs[0].title).toBe(NOTIFS_EN.eventPaymentConfirmedTitle);
      expect(tajweedNotifs[0].body).toBe(NOTIFS_EN.eventPaymentConfirmedBody(tajweedPlanRow.title));
    }
    expect(publishSpy.mock.calls).toHaveLength(4);
    const lastPublish: unknown = publishSpy.mock.calls[3]?.[0];
    if (!Array.isArray(lastPublish) || lastPublish.length !== 1) {
      throw new Error("expected exactly one published delivery receipt for the tajweed activation");
    }
    const receipt = lastPublish[0];
    if (!isRecord(receipt) || !Array.isArray(receipt.recipientUserIds)) {
      throw new Error("expected the published receipt to carry its recipient ids");
    }
    expect(receipt.recipientUserIds).toEqual([studentA.userId]);

    // Foreign invariance: no other cast member's balance, inbox, or own list
    // observed anything of this leg.
    expect(await readBalances(studentB.userId)).toEqual(foreignBefore);
    expect(await inboxCount(studentB.userId)).toBe(0);
    expect(await inboxCount(parentActor.userId)).toBe(0);

    // Replaying the SAME confirmed event acks replayed and credits nothing:
    // the decided rows, every lane, the inbox, and the publish log stay
    // byte-identical.
    const replayOutcome = await SubscriptionActivationService.processWebhookEvent(event, "en");
    expect(replayOutcome).toEqual({ processed: true, replayed: true });
    expect(await readBalances(studentA.userId)).toEqual(balancesAfter);
    expect((await paymentRow(result.payment.id)).status).toBe(PaymentStatus.Paid);
    expect(await inboxCount(studentA.userId)).toBe(4);
    expect(publishSpy.mock.calls).toHaveLength(4);
  });
});
