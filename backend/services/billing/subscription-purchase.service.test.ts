/**
 * SubscriptionPurchaseService tests — the purchase flow (governance gate,
 * idempotency-key boundary, gateway checkout outside the transaction, the
 * active-plan/lane re-validation, the savepoint-bracketed claim, the
 * pending subscription/payment/junction writes, and the replay
 * classification) plus the owner-scoped listing, against the live PGlite
 * database on REAL repositories.
 *
 * Per `backend/db/test/AGENTS.md` (the DB-backed service-test rules the
 * sibling suites apply):
 *  - Every transactional case runs inside `runInRollback`; the `tx` (as
 *    `outerTx`) is propagated to EVERY service call so the flow executes
 *    on the caller's transaction (the service's documented test path — a
 *    SAVEPOINT on it, released or rolled back per outcome).
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data; nothing escapes the transaction.
 *  - NO `expect(...).rejects.toThrow()` — every denial goes through
 *    `expectRepoError` (try/catch); typed denials are asserted through the
 *    `DomainError.code` contract plus the exact translated message.
 *
 * Coverage map:
 *  - Tier 1 (branch/statement): the happy path (pending pair + junction +
 *    claim backfill + checkout descriptor); inactive AND missing plan →
 *    the plan-not-purchasable denial with a zero-writes proof; NULL lane →
 *    the fail-closed lane denial; missing key → the localized validation
 *    denial; a reserved admin-namespace key (`subscription-admin:…`) is
 *    rejected the same way (zero writes — the admin claim space stays
 *    server-owned); same-caller replay → `DUPLICATE_REQUEST` conflict whose
 *    rollback leaves the first pair intact and burns no second row;
 *    renewal with a fresh key creates a second pair; the suspended-caller
 *    governance deny.
 *  - Tier 2 (boundary): empty-string key treated as missing; the 128-char
 *    key accepted verbatim and the 129-char key rejected; the plan row is
 *    the source of truth (padded titles, decimal-string amount carried
 *    verbatim, never client-derived); the strict purchase whitelist
 *    (forged extra fields — amount, currency, identity — are ignored and
 *    never persisted).
 *  - Tier 3 (chaos): concurrent double-submit on the SAME key through
 *    `Promise.allSettled` on the production savepoint path → exactly one
 *    success, exactly one `DUPLICATE_REQUEST` conflict, exactly ONE
 *    pending pair; a mid-flow failure (junction FK) rolls back the claim
 *    with the rest of the purchase, so the SAME key is reusable on retry.
 *  - Tier 4 (abuse/identity): a foreign caller replaying another user's
 *    key gets the oracle-safe not-found denial (no existence leak — the
 *    message carries no owner identifiers); the server-derived amount is
 *    unaffected by crafted input.
 *  - In-transaction re-validation (mid-flight): a plan price changed during
 *    checkout and a caller suspended during checkout are both denied INSIDE
 *    the transaction — before any row write — with the zero-writes proof
 *    (the hostile mutation rides the checkout seam: the only await between
 *    the pre-checkout reads and the transaction body).
 *  - Listing (owner scope): empty state, strict ownership isolation, and
 *    `created_at DESC` ordering with the strongly-typed enum mapping.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { PlanRepository } from "@/backend/db/repo";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestPlan,
  createTestStudent,
  createTestSubscription,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { MockPaymentGatewayAdapter } from "@/backend/services/billing/payment-gateway/mock-payment-gateway.adapter";
import { resetPaymentGateway } from "@/backend/services/billing/payment-gateway/payment-gateway.factory";
import { MAX_INTERVAL_DAYS, MAX_SESSION_COUNT } from "@/backend/services/billing/plan-catalog.helpers";
import { SubscriptionPurchaseService } from "@/backend/services/billing/subscription-purchase.service";
import type { DBTransaction, PurchaseSubscriptionReturnType, PurchaseSubscriptionSubmitInput } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

/**
 * Concurrent-transaction cases run ONLY on a real multi-connection
 * PostgreSQL: PGlite is a single-connection shim, so two interleaved
 * transactions share one session (and two concurrent savepoints on one
 * outer transaction share one savepoint name) — the interleaving poisons
 * the shared transaction rather than racing two independent claims. The
 * sibling session-lifecycle suite applies the same environment gate.
 */
const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

/** The errors-namespace translations for the default test locale. */
function t() {
  return getServerTranslations("en").errorsTranslations;
}

/**
 * Type-guard read of a caught rejection's `extensions.code` — the
 * assertion-free form of the typed-denial contract check (an
 * `instanceof` guard, never a narrowing cast).
 */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Asserts a caught error is a `DomainError` carrying EXACTLY the expected
 * `extensions.code` and the exact translated message (never the raw
 * translation key).
 */
function expectDomainDenial(error: Error, code: string, message: string): void {
  expect(error).toBeInstanceOf(DomainError);
  expect(rejectionCode(error)).toBe(code);
  expect(error.message).toBe(message);
  expect(error.message).not.toContain(code);
}

/** A unique opaque purchase idempotency key (carried verbatim by the service). */
function purchaseKey(): string {
  return `pur-${crypto.randomUUID()}`;
}

/** Wholesale-count reads for the zero-writes proofs. */
async function countRows(
  tx: DBTransaction,
  userId: number
): Promise<{ subs: number; payments: number; claims: number }> {
  const subs = await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const payments = await tx.select().from(studentPayments).where(eq(studentPayments.studentId, userId));
  const claims = await tx
    .select()
    .from(subscriptionPurchaseIdempotency)
    .where(eq(subscriptionPurchaseIdempotency.userId, userId));
  return { subs: subs.length, payments: payments.length, claims: claims.length };
}

/**
 * The hostile-mutation seam: the ONLY await between the pre-checkout plan
 * read / governance check and the transaction body is the gateway checkout,
 * so the spy performs the mutation DURING checkout creation — exactly the
 * window the in-transaction re-validations own. The original adapter method
 * is captured BEFORE the spy is installed and invoked from inside the mock
 * implementation, so the checkout descriptor itself stays byte-identical to
 * the real adapter's.
 */
function interceptCheckoutDuring(mutation: () => Promise<void>) {
  const prototype = MockPaymentGatewayAdapter.prototype;
  const realCreateCheckout = prototype.createCheckout;
  return spyOn(prototype, "createCheckout").mockImplementation(async input => {
    await mutation();
    return realCreateCheckout.call(prototype, input);
  });
}

describe("SubscriptionPurchaseService — purchase (Tier 1: branches)", () => {
  beforeAll(() => {
    // Resolve the gateway adapter from the runner's environment (mock
    // provider) — hermetic regardless of a prior suite's env mutations.
    resetPaymentGateway();
  });

  test("happy path: pending pair + junction + claim backfill + checkout descriptor", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Hifz });

      const result = await SubscriptionPurchaseService.purchase(
        student.id,
        { planId: plan.id },
        purchaseKey(),
        "en",
        tx
      );

      // The returned composition — pending pair with strongly-typed enums.
      expect(result.subscription.userId).toBe(student.id);
      expect(result.subscription.planId).toBe(plan.id);
      expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
      expect(result.subscription.paymentMethod).toBe(PaymentGateway.Mock);
      expect(result.subscription.startDate).toBeNull();
      expect(result.payment.subscriptionId).toBe(result.subscription.id);
      expect(result.payment.studentId).toBe(student.id);
      expect(result.payment.status).toBe(PaymentStatus.Pending);
      expect(result.payment.paymentGateway).toBe(PaymentGateway.Mock);
      expect(result.payment.amount).toBe("200.00");
      expect(typeof result.payment.amount).toBe("string");
      expect(result.payment.currency).toBe("EGP");
      expect(result.checkout.provider).toBe(PaymentGateway.Mock);
      expect(result.checkout.providerReference.startsWith("mock_")).toBe(true);
      expect(result.checkout.checkoutUrl).toBeNull();

      // The persisted pair — one subscription + one payment + one junction
      // row, all pending, all owned by the caller.
      const storedSubs = await tx.select().from(subscriptions).where(eq(subscriptions.userId, student.id));
      expect(storedSubs).toHaveLength(1);
      expect(storedSubs[0].status).toBe(SubscriptionStatus.Pending);
      expect(storedSubs[0].paymentMethod).toBe(PaymentGateway.Mock);
      expect(storedSubs[0].paymentReference).toBe(result.checkout.providerReference);

      const storedPayments = await tx.select().from(studentPayments).where(eq(studentPayments.studentId, student.id));
      expect(storedPayments).toHaveLength(1);
      expect(storedPayments[0].amount).toBe("200.00");
      expect(storedPayments[0].subscriptionId).toBe(storedSubs[0].id);

      const junction = await tx
        .select()
        .from(studentSubscriptions)
        .where(eq(studentSubscriptions.studentId, student.id));
      expect(junction).toHaveLength(1);
      expect(junction[0].subscriptionId).toBe(storedSubs[0].id);

      // The claim — keyed, owned by the caller, backfilled with the
      // subscription pointer.
      const claims = await tx
        .select()
        .from(subscriptionPurchaseIdempotency)
        .where(eq(subscriptionPurchaseIdempotency.userId, student.id));
      expect(claims).toHaveLength(1);
      expect(claims[0].subscriptionId).toBe(storedSubs[0].id);
    });
  });

  test("inactive plan and unknown plan both deny as not purchasable — zero writes", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const inactive = await createTestPlan(tx, { isActive: false, deactivatedAt: new Date() });

      const inactiveErr = await expectRepoError(() =>
        SubscriptionPurchaseService.purchase(student.id, { planId: inactive.id }, purchaseKey(), "en", tx)
      );
      expectDomainDenial(inactiveErr, "PLAN_NOT_FOUND", t().subscriptionPurchase.planNotPurchasable);

      const unknownErr = await expectRepoError(() =>
        SubscriptionPurchaseService.purchase(student.id, { planId: 987654321 }, purchaseKey(), "en", tx)
      );
      expectDomainDenial(unknownErr, "PLAN_NOT_FOUND", t().subscriptionPurchase.planNotPurchasable);

      const counts = await countRows(tx, student.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("NULL balance lane fails the purchase closed — zero writes", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const lanelessPlan = await createTestPlan(tx, { balanceLane: null });

      const err = await expectRepoError(() =>
        SubscriptionPurchaseService.purchase(student.id, { planId: lanelessPlan.id }, purchaseKey(), "en", tx)
      );
      expectDomainDenial(err, "PLAN_LANE_UNCONFIGURED", t().subscriptionPurchase.planLaneUnconfigured);

      const counts = await countRows(tx, student.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("plan intervalDays past the catalog ceiling fails the purchase closed — zero writes", async () => {
    await runInRollback(async tx => {
      // Direct-DB fixture (tracked cleanup = the rollback): the catalog's
      // MAX_INTERVAL_DAYS ceiling guards WRITES only — the DB check enforces
      // just `> 0` — so an active, lane-configured, over-ceiling row is
      // insertable outside the validated catalog path. Committing a purchase
      // against it would pair the settled charge with a subscription whose
      // activation is guaranteed to quarantine (the activation boundary
      // refuses the Date window arithmetic on an out-of-range interval).
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const overCeilingPlan = await createTestPlan(tx, {
        balanceLane: SubscriptionCreditLane.Hifz,
        intervalDays: MAX_INTERVAL_DAYS + 1,
      });

      const err = await expectRepoError(() =>
        SubscriptionPurchaseService.purchase(student.id, { planId: overCeilingPlan.id }, purchaseKey(), "en", tx)
      );
      expectDomainDenial(err, "PLAN_INTERVAL_DAYS_OUT_OF_RANGE", t().validation);
      if (err instanceof ValidationError) {
        const fieldError = err.fields?.find(entry => entry.field === "planId");
        expect(fieldError?.code).toBe("PLAN_INTERVAL_DAYS_OUT_OF_RANGE");
        expect(fieldError?.message).toBe(t().validation);
      }

      // The in-transaction gate fired BEFORE any write: no pair, no claim.
      const counts = await countRows(tx, student.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("plan sessionCount past the catalog ceiling fails the purchase closed — zero writes", async () => {
    await runInRollback(async tx => {
      // Direct-DB fixture (tracked cleanup = the rollback): the symmetric
      // twin of the interval case above — the catalog's MAX_SESSION_COUNT
      // ceiling guards WRITES only — the DB check enforces just `> 0` — so
      // an active, lane-configured, over-ceiling row is insertable outside
      // the validated catalog path. Committing a purchase against it would
      // pair the settled charge with a subscription whose activation is
      // guaranteed to quarantine (the activation credit would overflow the
      // lane's int4 balance on the out-of-range session count).
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const overCeilingPlan = await createTestPlan(tx, {
        balanceLane: SubscriptionCreditLane.Hifz,
        sessionCount: MAX_SESSION_COUNT + 1,
      });

      const err = await expectRepoError(() =>
        SubscriptionPurchaseService.purchase(student.id, { planId: overCeilingPlan.id }, purchaseKey(), "en", tx)
      );
      expectDomainDenial(err, "PLAN_SESSION_COUNT_OUT_OF_RANGE", t().validation);
      if (err instanceof ValidationError) {
        const fieldError = err.fields?.find(entry => entry.field === "planId");
        expect(fieldError?.code).toBe("PLAN_SESSION_COUNT_OUT_OF_RANGE");
        expect(fieldError?.message).toBe(t().validation);
      }

      // The in-transaction gate fired BEFORE any write: no pair, no claim.
      const counts = await countRows(tx, student.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("missing idempotency key → localized validation denial — zero writes", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });

      const err = await expectRepoError(() =>
        SubscriptionPurchaseService.purchase(student.id, { planId: plan.id }, null, "en", tx)
      );
      expectDomainDenial(err, "VALIDATION", t().subscriptionPurchase.idempotencyKeyRequired);

      const counts = await countRows(tx, student.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("a reserved admin-namespace key (`subscription-admin:…`) → localized validation denial — zero writes", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });

      // The admin subscription flows mint their claim keys server-side
      // under the reserved `subscription-admin:` prefix — a client header
      // squatting it could pre-claim (and permanently block) the admin
      // renew / plan-change flows for a targeted row, so the purchase
      // boundary refuses to carry it.
      const err = await expectRepoError(() =>
        SubscriptionPurchaseService.purchase(student.id, { planId: plan.id }, "subscription-admin:renew:1", "en", tx)
      );
      expectDomainDenial(err, "VALIDATION", t().validation);
      if (err instanceof ValidationError) {
        const fieldError = err.fields?.find(entry => entry.field === "idempotencyKey");
        expect(fieldError?.code).toBe("RESERVED_ADMIN_IDEMPOTENCY_KEY");
        expect(fieldError?.message).toBe(t().validation);
      }

      // Zero writes: no pair, no claim — the squat never lands.
      const counts = await countRows(tx, student.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("governed caller (suspended) → forbidden — zero writes", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { suspended: true });
      const student = await createTestStudent(tx, user.id);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });

      const err = await expectRepoError(() =>
        SubscriptionPurchaseService.purchase(student.id, { planId: plan.id }, purchaseKey(), "en", tx)
      );
      expectDomainDenial(err, "FORBIDDEN", t().forbidden);

      const counts = await countRows(tx, student.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("same-caller key replay throws the duplicate-request conflict and keeps ONE pair", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });
      const key = purchaseKey();

      const first = await SubscriptionPurchaseService.purchase(student.id, { planId: plan.id }, key, "en", tx);

      const replayErr = await expectRepoError(() =>
        SubscriptionPurchaseService.purchase(student.id, { planId: plan.id }, key, "en", tx)
      );
      expectDomainDenial(replayErr, "DUPLICATE_REQUEST", t().duplicateRequest);
      expect(replayErr).toBeInstanceOf(ConflictError);

      // The replay burned no second row: one pair, one claim, still linked
      // to the FIRST purchase.
      const counts = await countRows(tx, student.id);
      expect(counts).toEqual({ subs: 1, payments: 1, claims: 1 });
      const claims = await tx
        .select()
        .from(subscriptionPurchaseIdempotency)
        .where(eq(subscriptionPurchaseIdempotency.userId, student.id));
      expect(claims[0].subscriptionId).toBe(first.subscription.id);
    });
  });

  test("renewal: a fresh key creates a second pending pair", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });

      await SubscriptionPurchaseService.purchase(student.id, { planId: plan.id }, purchaseKey(), "en", tx);
      const second = await SubscriptionPurchaseService.purchase(
        student.id,
        { planId: plan.id },
        purchaseKey(),
        "en",
        tx
      );

      expect(second.subscription.status).toBe(SubscriptionStatus.Pending);
      const counts = await countRows(tx, student.id);
      expect(counts).toEqual({ subs: 2, payments: 2, claims: 2 });

      const listing = await SubscriptionPurchaseService.listOwn(student.id, "en", tx);
      expect(listing).toHaveLength(2);
    });
  });
});

describe("SubscriptionPurchaseService — purchase (Tier 2: boundaries)", () => {
  test("empty-string key treated as missing; 128-char key carried verbatim; 129 rejected", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });

      const emptyErr = await expectRepoError(() =>
        SubscriptionPurchaseService.purchase(student.id, { planId: plan.id }, "", "en", tx)
      );
      expectDomainDenial(emptyErr, "VALIDATION", t().subscriptionPurchase.idempotencyKeyRequired);

      const maxKey = "k".repeat(128);
      const accepted = await SubscriptionPurchaseService.purchase(student.id, { planId: plan.id }, maxKey, "en", tx);
      expect(accepted.subscription.status).toBe(SubscriptionStatus.Pending);
      const claims = await tx
        .select()
        .from(subscriptionPurchaseIdempotency)
        .where(eq(subscriptionPurchaseIdempotency.userId, student.id));
      expect(claims).toHaveLength(1);
      expect(claims[0].idempotencyKey).toBe(maxKey);

      const overlongErr = await expectRepoError(() =>
        SubscriptionPurchaseService.purchase(student.id, { planId: plan.id }, "k".repeat(129), "en", tx)
      );
      expectDomainDenial(overlongErr, "VALIDATION", t().subscriptionPurchase.idempotencyKeyRequired);
    });
  });

  test("the plan row is the source of truth: padded copy and verbatim decimal amount", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const plan = await createTestPlan(tx, {
        title: "   Padded Plan Copy   ",
        price: "199.99",
        balanceLane: SubscriptionCreditLane.Tajweed,
      });

      const result = await SubscriptionPurchaseService.purchase(
        student.id,
        { planId: plan.id },
        purchaseKey(),
        "en",
        tx
      );

      expect(result.subscription.planId).toBe(plan.id);
      expect(result.payment.amount).toBe("199.99");
      expect(typeof result.payment.amount).toBe("string");
      expect(result.payment.currency).toBe("EGP");

      const storedPayments = await tx.select().from(studentPayments).where(eq(studentPayments.studentId, student.id));
      expect(storedPayments[0].amount).toBe("199.99");
    });
  });
});

describe("SubscriptionPurchaseService — purchase (in-transaction re-validation, mid-flight)", () => {
  test("a plan price changed during checkout → PLAN_PRICE_CHANGED validation denial, zero writes", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Hifz });

      // Direct repo update riding the checkout seam: the pre-checkout read
      // fed the gateway the ORIGINAL price; the fresh in-transaction row now
      // disagrees — committing would pair the provider's charge with a
      // different stored amount (a settlement guaranteed to quarantine).
      const checkoutSpy = interceptCheckoutDuring(async () => {
        await PlanRepository.updatePlanFields(plan.id, { price: "999.99" }, tx);
      });

      let err: Error;
      try {
        err = await expectRepoError(() =>
          SubscriptionPurchaseService.purchase(student.id, { planId: plan.id }, purchaseKey(), "en", tx)
        );
      } finally {
        checkoutSpy.mockRestore();
      }

      // The generic localized validation label, machine-coded for the field
      // payload — the plan selector is the offending input.
      expectDomainDenial(err, "VALIDATION", t().validation);
      if (!(err instanceof ValidationError)) {
        throw new Error("expected the mid-flight price denial to be a ValidationError");
      }
      expect(err.fields).toEqual([{ field: "planId", code: "PLAN_PRICE_CHANGED", message: t().validation }]);

      // Thrown BEFORE any row write: no pair, no junction, no claim.
      const counts = await countRows(tx, student.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("a caller suspended during checkout → forbidden denial, zero writes", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });

      // The pre-checkout governance check saw a CLEAN actor; the suspension
      // flips the actor's column during checkout (the session-lifecycle
      // fixture manipulation idiom), so only the in-transaction
      // re-assertion can catch it.
      const checkoutSpy = interceptCheckoutDuring(async () => {
        await tx.update(users).set({ suspended: true }).where(eq(users.id, user.id));
      });

      let err: Error;
      try {
        err = await expectRepoError(() =>
          SubscriptionPurchaseService.purchase(student.id, { planId: plan.id }, purchaseKey(), "en", tx)
        );
      } finally {
        checkoutSpy.mockRestore();
      }

      expectDomainDenial(err, "FORBIDDEN", t().forbidden);
      expect(err).toBeInstanceOf(ForbiddenError);

      // The governed caller wrote nothing: no pair, no junction, no claim.
      const counts = await countRows(tx, student.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });
});

describe("SubscriptionPurchaseService — purchase (Tier 3: chaos)", () => {
  test("concurrent double-submit on the SAME key: exactly one success, one conflict, ONE pair", async () => {
    // Serialized-pair invariant proof (safe on the single-connection
    // provider): the second submit on the same key — whether it arrives
    // concurrently (real PG, below) or back-to-back (here) — must surface
    // the duplicate conflict while exactly ONE pending pair survives.
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });
      const key = purchaseKey();

      const first = await SubscriptionPurchaseService.purchase(student.id, { planId: plan.id }, key, "en", tx);
      const secondErr = await expectRepoError(() =>
        SubscriptionPurchaseService.purchase(student.id, { planId: plan.id }, key, "en", tx)
      );
      expect(secondErr).toBeInstanceOf(ConflictError);
      expect(rejectionCode(secondErr)).toBe("DUPLICATE_REQUEST");
      expect(first.subscription.status).toBe(SubscriptionStatus.Pending);

      const counts = await countRows(tx, student.id);
      expect(counts).toEqual({ subs: 1, payments: 1, claims: 1 });
      const storedSubs = await tx.select().from(subscriptions).where(eq(subscriptions.userId, student.id));
      expect(storedSubs[0].status).toBe(SubscriptionStatus.Pending);
    });
  });

  test("a mid-flow failure releases the claim — the SAME key is reusable on retry", async () => {
    await runInRollback(async tx => {
      // A user WITHOUT a students row: the claim and subscription insert,
      // then the payment's student FK fails and rolls the whole purchase
      // (claim included) back.
      const user = await createTestUser(tx);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });
      const key = purchaseKey();

      const fkErr = await expectRepoError(() =>
        SubscriptionPurchaseService.purchase(user.id, { planId: plan.id }, key, "en", tx)
      );
      expect(fkErr).toBeInstanceOf(Error);
      expect(fkErr).not.toBeInstanceOf(DomainError);

      const claimsAfterFailure = await tx
        .select()
        .from(subscriptionPurchaseIdempotency)
        .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, key));
      expect(claimsAfterFailure).toHaveLength(0);
      const subsAfterFailure = await tx.select().from(subscriptions).where(eq(subscriptions.userId, user.id));
      expect(subsAfterFailure).toHaveLength(0);

      // Provision the student and retry with the SAME key — the claim was
      // never burned.
      await createTestStudent(tx, user.id);
      const retry = await SubscriptionPurchaseService.purchase(user.id, { planId: plan.id }, key, "en", tx);
      expect(retry.subscription.status).toBe(SubscriptionStatus.Pending);
    });
  });
});

describe("SubscriptionPurchaseService — purchase (chaos: production tx path, committed fixtures)", () => {
  let chaosStudentId = 0;
  let chaosPlanId = 0;

  beforeAll(async () => {
    // Committed fixtures — the production path opens its OWN transaction
    // per call, so the race needs real committed entities (the sibling
    // session-lifecycle chaos block).
    await db.transaction(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Hifz });
      chaosStudentId = student.id;
      chaosPlanId = plan.id;
    });
  });

  afterAll(async () => {
    // FK-safe hard-delete of every fixture row. The payment-ledger rows are
    // un-deletable through their append-only DELETE guard — and the amended
    // UPDATE guard also blocks the FK set-null the subscriptions delete
    // would fire against a surviving payment row — so that leg runs under
    // the sanctioned teardown-window trigger suspension (the sibling
    // schema/replay/roles/journey teardowns wrap this exact leg); with the
    // ledger leg resolved the rest deletes in strict child-first order
    // (payments before subscriptions, so no set-null write ever fires
    // against a surviving parent row).
    await withImmutabilityTriggersSuspended(["student_payments"], async () => {
      await db.delete(studentPayments).where(eq(studentPayments.studentId, chaosStudentId));
    });
    await db.delete(subscriptionPurchaseIdempotency).where(eq(subscriptionPurchaseIdempotency.userId, chaosStudentId));
    await db.delete(studentSubscriptions).where(eq(studentSubscriptions.studentId, chaosStudentId));
    await db.delete(subscriptions).where(eq(subscriptions.userId, chaosStudentId));
    await db.delete(students).where(eq(students.id, chaosStudentId));
    await db.delete(users).where(eq(users.id, chaosStudentId));
    await db.delete(plans).where(eq(plans.id, chaosPlanId));

    // Load-bearing residue proof: the teardown must leave zero rows behind.
    const residueCounts = await Promise.all([
      db.$count(subscriptions, eq(subscriptions.userId, chaosStudentId)),
      db.$count(studentPayments, eq(studentPayments.studentId, chaosStudentId)),
      db.$count(studentSubscriptions, eq(studentSubscriptions.studentId, chaosStudentId)),
      db.$count(subscriptionPurchaseIdempotency, eq(subscriptionPurchaseIdempotency.userId, chaosStudentId)),
      db.$count(users, eq(users.id, chaosStudentId)),
    ]);
    for (const count of residueCounts) {
      expect(count).toBe(0);
    }
  });

  function chaosPurchase(key: string): Promise<PurchaseSubscriptionReturnType> {
    // NO outerTx — the production path: the service opens its own
    // transaction, giving every concurrent call a real connection.
    return SubscriptionPurchaseService.purchase(chaosStudentId, { planId: chaosPlanId }, key, "en");
  }

  testOnRealPostgres(
    "concurrent double-submit on independent production transactions: one success, one conflict, ONE pair",
    async () => {
      // The SAME idempotency key rides BOTH concurrent attempts — the
      // invariant under test is same-key double-submit: the claim-race
      // loser must surface the duplicate-replay conflict, never mint a
      // second pair under a fresh key.
      const sharedKey = purchaseKey();
      const attempts = await Promise.allSettled([chaosPurchase(sharedKey), chaosPurchase(sharedKey)]);

      const fulfilled = attempts.filter(entry => entry.status === "fulfilled");
      const rejected = attempts.filter(entry => entry.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const reason = rejected[0].reason;
      expect(reason).toBeInstanceOf(ConflictError);
      expect(rejectionCode(reason)).toBe("DUPLICATE_REQUEST");

      // Exactly ONE pending pair survived the race, and the claim points
      // at the winning subscription.
      const storedSubs = await db.select().from(subscriptions).where(eq(subscriptions.userId, chaosStudentId));
      expect(storedSubs).toHaveLength(1);
      expect(storedSubs[0].status).toBe(SubscriptionStatus.Pending);
      const storedPayments = await db
        .select()
        .from(studentPayments)
        .where(eq(studentPayments.studentId, chaosStudentId));
      expect(storedPayments).toHaveLength(1);
      const claims = await db
        .select()
        .from(subscriptionPurchaseIdempotency)
        .where(eq(subscriptionPurchaseIdempotency.userId, chaosStudentId));
      expect(claims).toHaveLength(1);
      expect(claims[0].subscriptionId).toBe(storedSubs[0].id);
    }
  );
});

describe("SubscriptionPurchaseService — purchase (Tier 4: abuse)", () => {
  test("foreign caller replaying another user's key gets the oracle-safe not-found (no existence leak)", async () => {
    await runInRollback(async tx => {
      const ownerUser = await createTestUser(tx);
      const owner = await createTestStudent(tx, ownerUser.id);
      const attackerUser = await createTestUser(tx);
      const attacker = await createTestStudent(tx, attackerUser.id);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });

      const spentKey = purchaseKey();
      await SubscriptionPurchaseService.purchase(owner.id, { planId: plan.id }, spentKey, "en", tx);

      const foreignErr = await expectRepoError(() =>
        SubscriptionPurchaseService.purchase(attacker.id, { planId: plan.id }, spentKey, "en", tx)
      );
      expect(foreignErr).toBeInstanceOf(NotFoundError);
      expectDomainDenial(foreignErr, "PAYMENT_NOT_FOUND", t().notFound);
      // No existence leak: the denial carries no owner identifiers.
      expect(foreignErr.message.includes(owner.id.toString())).toBe(false);
      expect(foreignErr.message.includes(ownerUser.email)).toBe(false);

      // The attacker wrote nothing; the owner's pair is intact.
      const attackerCounts = await countRows(tx, attacker.id);
      expect(attackerCounts).toEqual({ subs: 0, payments: 0, claims: 0 });
      const ownerCounts = await countRows(tx, owner.id);
      expect(ownerCounts).toEqual({ subs: 1, payments: 1, claims: 1 });
    });
  });

  test("server-derived amount and identity are unaffected by crafted input", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const otherUser = await createTestUser(tx);
      const otherStudent = await createTestStudent(tx, otherUser.id);
      const plan = await createTestPlan(tx, { price: "150.50", balanceLane: SubscriptionCreditLane.Tajweed });

      // A forged payload that smuggles amount/currency/identity past the
      // boundary: only the plan selector may cross.
      const forged = {
        planId: plan.id,
        amount: "0.01",
        currency: "USD",
        userId: otherStudent.id,
        studentId: otherStudent.id,
      } satisfies PurchaseSubscriptionSubmitInput & Record<string, unknown>;

      const result = await SubscriptionPurchaseService.purchase(student.id, forged, purchaseKey(), "en", tx);

      expect(result.subscription.userId).toBe(student.id);
      expect(result.payment.studentId).toBe(student.id);
      expect(result.payment.amount).toBe("150.50");
      expect(result.payment.currency).toBe("EGP");

      const storedPayments = await tx.select().from(studentPayments).where(eq(studentPayments.studentId, student.id));
      expect(storedPayments).toHaveLength(1);
      expect(storedPayments[0].amount).toBe("150.50");
      const forgedRows = await tx.select().from(studentPayments).where(eq(studentPayments.studentId, otherStudent.id));
      expect(forgedRows).toHaveLength(0);
    });
  });
});

describe("SubscriptionPurchaseService — listOwn (owner scope)", () => {
  test("empty state: a caller with no purchases gets an empty list", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);

      const listing = await SubscriptionPurchaseService.listOwn(student.id, "en", tx);
      expect(listing).toEqual([]);
    });
  });

  test("ownership isolation: a caller never sees another caller's rows", async () => {
    await runInRollback(async tx => {
      const aUser = await createTestUser(tx);
      const a = await createTestStudent(tx, aUser.id);
      const bUser = await createTestUser(tx);
      const b = await createTestStudent(tx, bUser.id);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });

      await SubscriptionPurchaseService.purchase(a.id, { planId: plan.id }, purchaseKey(), "en", tx);
      await SubscriptionPurchaseService.purchase(b.id, { planId: plan.id }, purchaseKey(), "en", tx);

      const aListing = await SubscriptionPurchaseService.listOwn(a.id, "en", tx);
      const bListing = await SubscriptionPurchaseService.listOwn(b.id, "en", tx);

      expect(aListing).toHaveLength(1);
      expect(aListing.every(row => row.userId === a.id)).toBe(true);
      expect(bListing).toHaveLength(1);
      expect(bListing.every(row => row.userId === b.id)).toBe(true);
      expect(aListing[0].id).not.toBe(bListing[0].id);
    });
  });

  test("ordering is newest-first and the rows carry strongly-typed enums", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });

      const older = await createTestSubscription(tx, student.id, plan.id, {
        status: SubscriptionStatus.Active,
        paymentMethod: PaymentGateway.Mock,
        paymentReference: `mock-older-${crypto.randomUUID()}`,
        createdAt: new Date(Date.now() - 3_600_000),
      });
      const newer = await createTestSubscription(tx, student.id, plan.id, {
        status: SubscriptionStatus.Pending,
        paymentMethod: PaymentGateway.Other,
        createdAt: new Date(),
      });

      const listing = await SubscriptionPurchaseService.listOwn(student.id, "en", tx);
      expect(listing).toHaveLength(2);
      expect(listing[0].id).toBe(newer.id);
      expect(listing[1].id).toBe(older.id);

      expect(listing[0].status).toBe(SubscriptionStatus.Pending);
      expect(listing[0].paymentMethod).toBe(PaymentGateway.Other);
      expect(listing[1].status).toBe(SubscriptionStatus.Active);
      expect(listing[1].paymentMethod).toBe(PaymentGateway.Mock);
    });
  });
});
