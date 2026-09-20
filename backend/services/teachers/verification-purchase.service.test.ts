/**
 * VerificationPurchaseService tests — the verification-plan purchase flow
 * (server-side plan resolution by the canonical title constant, the
 * governance + idempotency-key pre-DB boundary, the gateway checkout
 * outside the transaction, the in-transaction lifecycle guard, the
 * savepoint-bracketed claim, the NULL-owner pending pair, the re-application
 * attempt accounting, the guarded purchase-time flip, and the replay
 * classification) against the live test database on REAL repositories.
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
 *  - The gateway checkout seam is the mock adapter's prototype — the ONLY
 *    external-effect boundary spied here.
 *
 * Coverage map:
 *  - Tier 1 (branch/statement): the happy path (pending pair with a NULL
 *    payment owner, the guarded pending → in_evaluation flip with the
 *    attempt counter untouched, the backfilled claim, the mock checkout
 *    descriptor, and the deliberately absent student-junction row);
 *    cooldown-active → the localized cooldown denial with a zero-writes
 *    proof; expired cooldown + `failed` → the re-application attempt
 *    increment plus the flip; `passed` → the certified denial; a
 *    non-applicant caller → the applicant-not-found denial; a missing or
 *    empty idempotency key → the localized validation denial; no active
 *    plan with the canonical title → the plan-not-purchasable denial; a
 *    repeat purchase from `in_evaluation` → a second pair with the flip
 *    as a silent no-op.
 *  - Tier 2 (boundary): the replay classification — a same-caller key
 *    replay surfaces the duplicate-request conflict while exactly one
 *    pair survives; a key spent by a DIFFERENT caller is denied with the
 *    oracle-safe payment-not-found error (no owner-identity leak, and no
 *    idempotency-key material in any domain log).
 *  - Mid-flight (the checkout network window — the in-transaction
 *    re-validations that own it): a plan price/currency change during
 *    checkout → the PLAN_PRICE_CHANGED validation denial; a caller
 *    suspended during checkout → the forbidden denial; an ambiguous
 *    canonical catalog (two active rows sharing the title) → the
 *    client-safe conflict. All zero-write.
 *  - Tier 3 (chaos): a gateway outage at the pre-transaction boundary
 *    writes zero rows (the checkout is the only await before the
 *    transaction opens); concurrent double-submit on the SAME key through
 *    `Promise.allSettled` on the production transaction path → exactly
 *    one success, exactly one `DUPLICATE_REQUEST` conflict, exactly ONE
 *    pair (real multi-connection PostgreSQL only — the single-connection
 *    provider is skipped, the sibling suite's environment gate).
 *  - Tier 4 (abuse/identity fuzz): RTL/CJK/emoji applicant names — both
 *    localized denials resolve distinctly per locale with zero placeholder
 *    residue and zero identity leakage.
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
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { users } from "@/backend/db/schema/users/users";
import { createTestApplicant, createTestPlan, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { MockPaymentGatewayAdapter } from "@/backend/services/billing/payment-gateway/mock-payment-gateway.adapter";
import { resetPaymentGateway } from "@/backend/services/billing/payment-gateway/payment-gateway.factory";
import { VerificationPurchaseService } from "@/backend/services/teachers/verification-purchase.service";
import type { DBTransaction, PlanSelectType, PurchaseSubscriptionReturnType } from "@/backend/types";
import {
  VERIFICATION_PLAN_SESSION_COUNT,
  VERIFICATION_PLAN_TITLE,
} from "@/shared/constants/verification-plan.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

/**
 * Concurrent-transaction cases run ONLY on a real multi-connection
 * PostgreSQL: PGlite is a single-connection shim, so two interleaved
 * transactions share one session (and two concurrent savepoints on one
 * outer transaction share one savepoint name) — the interleaving poisons
 * the shared transaction rather than racing two independent claims. The
 * sibling purchase suite applies the same environment gate.
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
  return `vfy-${crypto.randomUUID()}`;
}

/** An applicant fixture user: real `users` row (teacher role) + applicants row. */
async function createApplicantFixture(
  tx: DBTransaction,
  overrides: { fullName?: string; status?: ApplicantStatus; cooldownUntil?: Date | null } = {}
) {
  const user = await createTestUser(tx, {
    role: "teacher",
    ...(overrides.fullName !== undefined ? { fullName: overrides.fullName } : {}),
  });
  const applicant = await createTestApplicant(tx, user.id, {
    status: overrides.status ?? ApplicantStatus.Pending,
    ...(overrides.cooldownUntil !== undefined ? { cooldownUntil: overrides.cooldownUntil } : {}),
  });
  return { user, applicant };
}

/**
 * The verification-plan product row EXACTLY as the service resolves it
 * (active catalog + exact title match) — money/window assertions are
 * grounded in the row the service actually charges. Provisioned ONLY when
 * the catalog lacks the canonical member: the purchase service REJECTS an
 * ambiguous catalog (multiple active rows sharing the canonical title),
 * so a blind fixture insert on a seeded catalog would flip every purchase
 * into a conflict. On seeded catalogs the pre-existing committed row
 * serves (its product fields are pinned identical by the seeder — read,
 * never mutated); the conditional insert rides the caller's transaction
 * and rolls back with it.
 */
async function ensureVerificationPlanRow(tx: DBTransaction): Promise<PlanSelectType> {
  const active = await PlanRepository.listActive(tx);
  const existing = active.find(candidate => candidate.title === VERIFICATION_PLAN_TITLE);
  if (existing !== undefined) {
    return existing;
  }
  return createTestPlan(tx, {
    title: VERIFICATION_PLAN_TITLE,
    sessionCount: VERIFICATION_PLAN_SESSION_COUNT,
    price: "150.00",
    currency: "EGP",
    intervalDays: 14,
    balanceLane: SubscriptionCreditLane.Reviews,
    isActive: true,
  });
}

/**
 * Wholesale ledger counts for one purchaser (the payment leg is linked
 * through the subscription — a verification payment's owner is NULL by
 * contract, so the payment count cannot ride a student id).
 */
async function ledgerCounts(
  tx: DBTransaction,
  userId: number
): Promise<{ subs: number; payments: number; claims: number }> {
  const subs = await tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.userId, userId));
  const payments = subs.length
    ? await tx
        .select({ id: studentPayments.id })
        .from(studentPayments)
        .where(
          inArray(
            studentPayments.subscriptionId,
            subs.map(row => row.id)
          )
        )
    : [];
  const claims = await tx
    .select({ id: subscriptionPurchaseIdempotency.id })
    .from(subscriptionPurchaseIdempotency)
    .where(eq(subscriptionPurchaseIdempotency.userId, userId));
  return { subs: subs.length, payments: payments.length, claims: claims.length };
}

/**
 * The cooldown template's anchors: the template sliced at its single
 * `{cooldownUntil}` placeholder — the expanded denial must start with the
 * prefix and end with the suffix (fully expanded, no placeholder residue).
 * The single-placeholder contract is mechanically pinned by the locale
 * parity suite.
 */
function cooldownAnchors(locale: string): readonly [string, string] {
  const parts = getServerTranslations(locale).errorsTranslations.applicantCooldownActive.split("{cooldownUntil}");
  expect(parts).toHaveLength(2);
  const [prefix = "", suffix = ""] = parts;
  expect(prefix.length + suffix.length).toBeGreaterThan(0);
  return [prefix, suffix];
}

describe("VerificationPurchaseService — purchase (Tier 1: branches)", () => {
  beforeAll(() => {
    // Resolve the gateway adapter from the runner's environment (mock
    // provider) — hermetic regardless of a prior suite's env mutations.
    resetPaymentGateway();
  });

  test("happy path: NULL-owner pending pair + guarded flip (attempts untouched) + backfilled claim + mock checkout", async () => {
    await runInRollback(async tx => {
      const { user } = await createApplicantFixture(tx);
      const plan = await ensureVerificationPlanRow(tx);
      const key = purchaseKey();

      const result = await VerificationPurchaseService.purchase(user.id, key, "en", tx);

      // The returned composition — pending pair with strongly-typed enums
      // and the NULL payment owner.
      expect(result.subscription.userId).toBe(user.id);
      expect(result.subscription.planId).toBe(plan.id);
      expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
      expect(result.subscription.paymentMethod).toBe(PaymentGateway.Mock);
      expect(result.subscription.startDate).toBeNull();
      expect(result.payment.subscriptionId).toBe(result.subscription.id);
      expect(result.payment.studentId).toBeNull();
      expect(result.payment.status).toBe(PaymentStatus.Pending);
      expect(result.payment.paymentGateway).toBe(PaymentGateway.Mock);
      expect(result.payment.amount).toBe("150.00");
      expect(typeof result.payment.amount).toBe("string");
      expect(result.payment.currency).toBe("EGP");
      expect(result.checkout.provider).toBe(PaymentGateway.Mock);
      expect(result.checkout.providerReference.startsWith("mock_")).toBe(true);
      expect(result.checkout.checkoutUrl).toBeNull();

      // The persisted pair — one subscription + one NULL-owner payment,
      // both pending, and NO student-junction row (an applicant owns no
      // `students` row by construction).
      const storedSubs = await tx.select().from(subscriptions).where(eq(subscriptions.userId, user.id));
      expect(storedSubs).toHaveLength(1);
      expect(storedSubs[0].status).toBe(SubscriptionStatus.Pending);
      expect(storedSubs[0].paymentMethod).toBe(PaymentGateway.Mock);
      expect(storedSubs[0].paymentReference).toBe(result.checkout.providerReference);

      const storedPayments = await tx
        .select()
        .from(studentPayments)
        .where(eq(studentPayments.subscriptionId, storedSubs[0].id));
      expect(storedPayments).toHaveLength(1);
      expect(storedPayments[0].studentId).toBeNull();
      expect(storedPayments[0].amount).toBe("150.00");
      expect(storedPayments[0].subscriptionId).toBe(storedSubs[0].id);

      const junction = await tx
        .select()
        .from(studentSubscriptions)
        .where(eq(studentSubscriptions.subscriptionId, storedSubs[0].id));
      expect(junction).toHaveLength(0);

      // The purchase-time flip — pending → in_evaluation, first purchase is
      // NOT a re-application: the attempt audit trail stays untouched.
      const flipped = await tx.select().from(applicants).where(eq(applicants.id, user.id));
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe(ApplicantStatus.InEvaluation);
      expect(flipped[0].verificationAttempts).toBe(0);
      expect(flipped[0].lastAttemptAt).toBeNull();

      // The claim — keyed verbatim, owned by the purchaser, backfilled with
      // the subscription pointer.
      const claimRows = await tx
        .select()
        .from(subscriptionPurchaseIdempotency)
        .where(eq(subscriptionPurchaseIdempotency.userId, user.id));
      expect(claimRows).toHaveLength(1);
      expect(claimRows[0].idempotencyKey).toBe(key);
      expect(claimRows[0].subscriptionId).toBe(storedSubs[0].id);
    });
  });

  test("cooldown-active applicant → localized cooldown denial — zero writes", async () => {
    await runInRollback(async tx => {
      const { user } = await createApplicantFixture(tx, {
        status: ApplicantStatus.Failed,
        cooldownUntil: new Date(Date.now() + 86_400_000),
      });
      await ensureVerificationPlanRow(tx);

      const err = await expectRepoError(() => VerificationPurchaseService.purchase(user.id, purchaseKey(), "en", tx));
      expect(err).toBeInstanceOf(ValidationError);
      expect(rejectionCode(err)).toBe("APPLICANT_COOLDOWN_ACTIVE");
      const [prefix, suffix] = cooldownAnchors("en");
      expect(err.message.startsWith(prefix)).toBe(true);
      expect(err.message.endsWith(suffix)).toBe(true);
      expect(err.message).not.toContain("{cooldownUntil}");

      // The denial fired inside the purchase transaction BEFORE any write:
      // no pair, no claim, and the applicant row untouched.
      const counts = await ledgerCounts(tx, user.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
      const rows = await tx.select().from(applicants).where(eq(applicants.id, user.id));
      expect(rows[0].status).toBe(ApplicantStatus.Failed);
      expect(rows[0].verificationAttempts).toBe(0);
    });
  });

  test("expired cooldown + failed applicant → re-application: attempts +1 and the flip lands", async () => {
    await runInRollback(async tx => {
      const { user } = await createApplicantFixture(tx, {
        status: ApplicantStatus.Failed,
        cooldownUntil: new Date(Date.now() - 60_000),
      });
      await ensureVerificationPlanRow(tx);

      const result = await VerificationPurchaseService.purchase(user.id, purchaseKey(), "en", tx);

      expect(result.subscription.status).toBe(SubscriptionStatus.Pending);

      const rows = await tx.select().from(applicants).where(eq(applicants.id, user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe(ApplicantStatus.InEvaluation);
      expect(rows[0].verificationAttempts).toBe(1);
      expect(rows[0].lastAttemptAt).not.toBeNull();
    });
  });

  test("certified applicant (passed) → the localized already-certified denial — zero writes", async () => {
    await runInRollback(async tx => {
      const { user } = await createApplicantFixture(tx, { status: ApplicantStatus.Passed });
      await ensureVerificationPlanRow(tx);

      const err = await expectRepoError(() => VerificationPurchaseService.purchase(user.id, purchaseKey(), "en", tx));
      expectDomainDenial(err, "APPLICANT_ALREADY_CERTIFIED", t().applicantAlreadyCertified);

      const counts = await ledgerCounts(tx, user.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("non-applicant caller (no applicants row) → the applicant-not-found denial — zero writes", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await ensureVerificationPlanRow(tx);

      const err = await expectRepoError(() => VerificationPurchaseService.purchase(user.id, purchaseKey(), "en", tx));
      expect(err).toBeInstanceOf(NotFoundError);
      expectDomainDenial(err, "APPLICANT_NOT_FOUND", t().applicantNotFound);

      const counts = await ledgerCounts(tx, user.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("missing and empty idempotency keys → the localized key-required denial — zero writes", async () => {
    await runInRollback(async tx => {
      const { user } = await createApplicantFixture(tx);
      await ensureVerificationPlanRow(tx);

      const missingErr = await expectRepoError(() => VerificationPurchaseService.purchase(user.id, null, "en", tx));
      expectDomainDenial(missingErr, "VALIDATION", t().subscriptionPurchase.idempotencyKeyRequired);

      const emptyErr = await expectRepoError(() => VerificationPurchaseService.purchase(user.id, "", "en", tx));
      expectDomainDenial(emptyErr, "VALIDATION", t().subscriptionPurchase.idempotencyKeyRequired);

      const counts = await ledgerCounts(tx, user.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("a reserved admin-namespace key (`subscription-admin:…`) → localized validation denial — zero writes", async () => {
    await runInRollback(async tx => {
      const { user } = await createApplicantFixture(tx);
      await ensureVerificationPlanRow(tx);

      // The admin subscription flows mint their claim keys server-side
      // under the reserved `subscription-admin:` prefix — a client key
      // squatting it could pre-claim (and permanently block) the admin
      // renew / plan-change flows for a targeted row, so this purchase
      // boundary refuses to carry it (the sibling subscription-purchase
      // suite pins the same guard; the mirrored denial here keeps the
      // verification flow's identical boundary honest).
      const err = await expectRepoError(() =>
        VerificationPurchaseService.purchase(user.id, "subscription-admin:renew:1", "en", tx)
      );
      expectDomainDenial(err, "VALIDATION", t().validation);
      if (err instanceof ValidationError) {
        const fieldError = err.fields?.find(entry => entry.field === "idempotencyKey");
        expect(fieldError?.code).toBe("RESERVED_ADMIN_IDEMPOTENCY_KEY");
        expect(fieldError?.message).toBe(t().validation);
      }

      // Zero writes: no pair, no claim — the squat never lands.
      const counts = await ledgerCounts(tx, user.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("no active plan with the canonical title → the plan-not-purchasable denial — zero writes", async () => {
    await runInRollback(async tx => {
      const { user } = await createApplicantFixture(tx);
      // Environment-proof precondition: whatever the catalog holds, NO
      // active row carries the canonical title (the deactivation rides the
      // test transaction and rolls back with it).
      await tx
        .update(plans)
        .set({ isActive: false, deactivatedAt: new Date() })
        .where(eq(plans.title, VERIFICATION_PLAN_TITLE));

      const err = await expectRepoError(() => VerificationPurchaseService.purchase(user.id, purchaseKey(), "en", tx));
      expectDomainDenial(err, "PLAN_NOT_FOUND", t().subscriptionPurchase.planNotPurchasable);

      // The plan resolve fails BEFORE the gateway call and BEFORE any
      // write — the denial never even opens the purchase transaction.
      const counts = await ledgerCounts(tx, user.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("a canonical row with a WRONG product contract (price) → the client-safe conflict, zero writes", async () => {
    await runInRollback(async tx => {
      const { user } = await createApplicantFixture(tx);
      // Environment-proof isolation: whatever ACTIVE canonical rows the
      // catalog holds are deactivated inside this transaction, then ONE
      // row with the canonical title but a WRONG price is inserted — the
      // single title match must still be denied because the gateway would
      // charge a price the product contract never declares.
      await tx
        .update(plans)
        .set({ isActive: false, deactivatedAt: new Date() })
        .where(eq(plans.title, VERIFICATION_PLAN_TITLE));
      await createTestPlan(tx, {
        title: VERIFICATION_PLAN_TITLE,
        sessionCount: VERIFICATION_PLAN_SESSION_COUNT,
        price: "999.00",
        currency: "EGP",
        intervalDays: 14,
        balanceLane: SubscriptionCreditLane.Reviews,
        isActive: true,
      });

      const err = await expectRepoError(() => VerificationPurchaseService.purchase(user.id, purchaseKey(), "en", tx));
      expectDomainDenial(err, "CONFLICT", "Payment could not be processed.");
      // Denied BEFORE the gateway call and any write.
      const counts = await ledgerCounts(tx, user.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("repeat purchase from in_evaluation (fresh key) → second pair; the flip is a silent no-op", async () => {
    await runInRollback(async tx => {
      const { user } = await createApplicantFixture(tx);
      await ensureVerificationPlanRow(tx);

      await VerificationPurchaseService.purchase(user.id, purchaseKey(), "en", tx);
      const second = await VerificationPurchaseService.purchase(user.id, purchaseKey(), "en", tx);

      expect(second.subscription.status).toBe(SubscriptionStatus.Pending);
      const counts = await ledgerCounts(tx, user.id);
      expect(counts).toEqual({ subs: 2, payments: 2, claims: 2 });

      // The guarded transition matched zero rows the second time — the
      // applicant row stays in_evaluation and the attempt counter keeps
      // its first-purchase value (a repeat purchase is not a re-application).
      const rows = await tx.select().from(applicants).where(eq(applicants.id, user.id));
      expect(rows[0].status).toBe(ApplicantStatus.InEvaluation);
      expect(rows[0].verificationAttempts).toBe(0);
    });
  });
});

describe("VerificationPurchaseService — purchase (Tier 2: replay classification)", () => {
  test("same-caller key replay throws the duplicate-request conflict and keeps ONE pair", async () => {
    await runInRollback(async tx => {
      const { user } = await createApplicantFixture(tx);
      await ensureVerificationPlanRow(tx);
      const key = purchaseKey();

      const first = await VerificationPurchaseService.purchase(user.id, key, "en", tx);

      const replayErr = await expectRepoError(() => VerificationPurchaseService.purchase(user.id, key, "en", tx));
      expectDomainDenial(replayErr, "DUPLICATE_REQUEST", t().duplicateRequest);
      expect(replayErr).toBeInstanceOf(ConflictError);

      // The replay burned no second row: one pair, one claim, still linked
      // to the FIRST purchase.
      const counts = await ledgerCounts(tx, user.id);
      expect(counts).toEqual({ subs: 1, payments: 1, claims: 1 });
      const claims = await tx
        .select()
        .from(subscriptionPurchaseIdempotency)
        .where(eq(subscriptionPurchaseIdempotency.userId, user.id));
      expect(claims[0].subscriptionId).toBe(first.subscription.id);
    });
  });

  test("a key spent by ANOTHER caller gets the oracle-safe payment-not-found (no identity leak, no key material in logs)", async () => {
    await runInRollback(async tx => {
      const { user: ownerUser } = await createApplicantFixture(tx);
      const { user: attackerUser } = await createApplicantFixture(tx);
      await ensureVerificationPlanRow(tx);

      const spentKey = purchaseKey();
      await VerificationPurchaseService.purchase(ownerUser.id, spentKey, "en", tx);

      // The recording stub keeps the denial's log line out of test stdout
      // AND lets the suite pin the no-key-material logging contract.
      const logSpy = spyOn(logger, "logDomainError").mockImplementation(() => {});
      let foreignErr: Error;
      try {
        foreignErr = await expectRepoError(() =>
          VerificationPurchaseService.purchase(attackerUser.id, spentKey, "en", tx)
        );
      } finally {
        const calls = logSpy.mock.calls;
        logSpy.mockRestore();
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
          expect(JSON.stringify(call)).not.toContain(spentKey);
        }
      }

      expect(foreignErr).toBeInstanceOf(NotFoundError);
      expectDomainDenial(foreignErr, "PAYMENT_NOT_FOUND", t().notFound);
      // No existence leak: the denial carries no owner identifiers.
      expect(foreignErr.message.includes(ownerUser.id.toString())).toBe(false);
      expect(foreignErr.message.includes(ownerUser.email)).toBe(false);

      // The attacker wrote nothing; the owner's pair is intact.
      const attackerCounts = await ledgerCounts(tx, attackerUser.id);
      expect(attackerCounts).toEqual({ subs: 0, payments: 0, claims: 0 });
      const ownerCounts = await ledgerCounts(tx, ownerUser.id);
      expect(ownerCounts).toEqual({ subs: 1, payments: 1, claims: 1 });
    });
  });
});

describe("VerificationPurchaseService — purchase (Tier 3: chaos)", () => {
  test("a gateway outage at the pre-transaction boundary writes zero rows", async () => {
    await runInRollback(async tx => {
      const { user } = await createApplicantFixture(tx);
      await ensureVerificationPlanRow(tx);

      // The checkout is the ONLY await between the pre-DB boundary and the
      // transaction body — an outage there must leave the ledger untouched
      // (nothing has been written yet; no claim to release).
      const outageSpy = spyOn(MockPaymentGatewayAdapter.prototype, "createCheckout").mockImplementation(async () => {
        throw new Error("simulated gateway outage");
      });

      let err: Error;
      try {
        err = await expectRepoError(() => VerificationPurchaseService.purchase(user.id, purchaseKey(), "en", tx));
      } finally {
        outageSpy.mockRestore();
      }

      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(DomainError);
      expect(err.message).toBe("simulated gateway outage");

      const counts = await ledgerCounts(tx, user.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });
});

describe("VerificationPurchaseService — purchase (Tier 4: identity fuzz)", () => {
  test("RTL/CJK/emoji applicant names: localized denials resolve per locale with no placeholder residue and no identity leak", async () => {
    await runInRollback(async tx => {
      const unicodeName = "أحمد 拉菲格 🕌";
      const { user } = await createApplicantFixture(tx, {
        fullName: unicodeName,
        status: ApplicantStatus.Failed,
        cooldownUntil: new Date(Date.now() + 86_400_000),
      });
      await ensureVerificationPlanRow(tx);

      // Cooldown-active denial — both locales, distinct expansions, fully
      // expanded templates, and neither the name nor the id leaks.
      const cooldownUser = user;
      const cooldownErrEn = await expectRepoError(() =>
        VerificationPurchaseService.purchase(cooldownUser.id, purchaseKey(), "en", tx)
      );
      const cooldownErrAr = await expectRepoError(() =>
        VerificationPurchaseService.purchase(cooldownUser.id, purchaseKey(), "ar", tx)
      );
      expect(rejectionCode(cooldownErrEn)).toBe("APPLICANT_COOLDOWN_ACTIVE");
      expect(rejectionCode(cooldownErrAr)).toBe("APPLICANT_COOLDOWN_ACTIVE");
      expect(cooldownErrEn.message).not.toBe(cooldownErrAr.message);
      const [prefixEn, suffixEn] = cooldownAnchors("en");
      const [prefixAr, suffixAr] = cooldownAnchors("ar");
      expect(cooldownErrEn.message.startsWith(prefixEn)).toBe(true);
      expect(cooldownErrEn.message.endsWith(suffixEn)).toBe(true);
      expect(cooldownErrAr.message.startsWith(prefixAr)).toBe(true);
      expect(cooldownErrAr.message.endsWith(suffixAr)).toBe(true);
      expect(cooldownErrEn.message.includes(unicodeName)).toBe(false);
      expect(cooldownErrAr.message.includes(unicodeName)).toBe(false);
      expect(cooldownErrEn.message.includes(cooldownUser.id.toString())).toBe(false);
      expect(cooldownErrAr.message.includes(cooldownUser.id.toString())).toBe(false);

      // Certified denial — byte-equal per locale against the typed bundle.
      const certified = await createApplicantFixture(tx, {
        fullName: `${unicodeName} Certified`,
        status: ApplicantStatus.Passed,
      });
      const certifiedErrEn = await expectRepoError(() =>
        VerificationPurchaseService.purchase(certified.user.id, purchaseKey(), "en", tx)
      );
      const certifiedErrAr = await expectRepoError(() =>
        VerificationPurchaseService.purchase(certified.user.id, purchaseKey(), "ar", tx)
      );
      expectDomainDenial(certifiedErrEn, "APPLICANT_ALREADY_CERTIFIED", t().applicantAlreadyCertified);
      expectDomainDenial(
        certifiedErrAr,
        "APPLICANT_ALREADY_CERTIFIED",
        getServerTranslations("ar").errorsTranslations.applicantAlreadyCertified
      );

      // Neither applicant wrote anything.
      const cooldownCounts = await ledgerCounts(tx, cooldownUser.id);
      expect(cooldownCounts).toEqual({ subs: 0, payments: 0, claims: 0 });
      const certifiedCounts = await ledgerCounts(tx, certified.user.id);
      expect(certifiedCounts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });
});

/**
 * Checkout-window combinator: runs `attempt` (the purchase) while the mock
 * adapter's checkout seam first executes `mutation` — emulating the network
 * window between the pre-checkout reads and the purchase transaction (the
 * checkout is the ONLY await separating them). The spy restores itself even
 * when the attempt rejects, so a denial mid-suite never poisons the shared
 * adapter prototype.
 */
async function attemptDuringCheckoutWindow<T>(mutation: () => Promise<void>, attempt: () => Promise<T>): Promise<T> {
  const prototype = MockPaymentGatewayAdapter.prototype;
  const realCreateCheckout = prototype.createCheckout;
  const checkoutSpy = spyOn(prototype, "createCheckout").mockImplementation(async input => {
    await mutation();
    return realCreateCheckout.call(prototype, input);
  });
  try {
    return await attempt();
  } finally {
    checkoutSpy.mockRestore();
  }
}

describe("VerificationPurchaseService — purchase (in-transaction re-validation, mid-flight)", () => {
  beforeAll(() => {
    resetPaymentGateway();
  });

  test("a plan price changed during checkout → PLAN_PRICE_CHANGED validation denial, zero writes", async () => {
    await runInRollback(async tx => {
      const { user } = await createApplicantFixture(tx);
      const plan = await ensureVerificationPlanRow(tx);

      // Direct repo update riding the checkout seam: the pre-checkout read
      // fed the gateway the ORIGINAL price; the fresh in-transaction row now
      // disagrees — committing would pair the provider's charge with a
      // different stored amount (a settlement guaranteed to quarantine).
      const err = await attemptDuringCheckoutWindow(
        async () => {
          await PlanRepository.updatePlanFields(plan.id, { price: "999.99" }, tx);
        },
        () => expectRepoError(() => VerificationPurchaseService.purchase(user.id, purchaseKey(), "en", tx))
      );

      // The generic localized validation label, machine-coded for the field
      // payload — the plan selector is the offending input.
      expectDomainDenial(err, "VALIDATION", t().validation);
      if (!(err instanceof ValidationError)) {
        throw new Error("expected the mid-flight price denial to be a ValidationError");
      }
      expect(err.fields).toEqual([{ field: "planId", code: "PLAN_PRICE_CHANGED", message: t().validation }]);

      // Thrown BEFORE any row write: no pair, no claim.
      const counts = await ledgerCounts(tx, user.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("a same-price, same-currency contract drift during checkout → the client-safe conflict, zero writes", async () => {
    await runInRollback(async tx => {
      const { user } = await createApplicantFixture(tx);
      const plan = await ensureVerificationPlanRow(tx);

      // The charged pair is untouched — the shared checkout guard passes —
      // but the product contract drifted: the fresh in-transaction row no
      // longer carries the canonical session count, so storing its id as
      // the subscription's terms would activate a mis-termed product.
      // Only the in-transaction canonical re-assertion can catch it.
      const err = await attemptDuringCheckoutWindow(
        async () => {
          await PlanRepository.updatePlanFields(plan.id, { sessionCount: 3 }, tx);
        },
        () => expectRepoError(() => VerificationPurchaseService.purchase(user.id, purchaseKey(), "en", tx))
      );

      // The catalog misconfiguration is the internal-invariant breach: the
      // client-safe conflict copy (the exact divergent field never
      // surfaces), thrown before any write.
      expectDomainDenial(err, "CONFLICT", "Payment could not be processed.");

      // The drifted contract stored nothing: no pair, no claim.
      const counts = await ledgerCounts(tx, user.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("a caller suspended during checkout → forbidden denial, zero writes", async () => {
    await runInRollback(async tx => {
      const { user } = await createApplicantFixture(tx);
      await ensureVerificationPlanRow(tx);

      // The pre-checkout governance check saw a CLEAN actor; the suspension
      // flips the actor's column during checkout, so only the
      // in-transaction re-assertion can catch it.
      const err = await attemptDuringCheckoutWindow(
        async () => {
          await tx.update(users).set({ suspended: true }).where(eq(users.id, user.id));
        },
        () => expectRepoError(() => VerificationPurchaseService.purchase(user.id, purchaseKey(), "en", tx))
      );

      expectDomainDenial(err, "FORBIDDEN", t().forbidden);
      expect(err).toBeInstanceOf(ForbiddenError);

      // The governed caller wrote nothing: no pair, no claim.
      const counts = await ledgerCounts(tx, user.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });

  test("an ambiguous canonical catalog (two active rows) → the client-safe conflict, zero writes", async () => {
    await runInRollback(async tx => {
      const { user } = await createApplicantFixture(tx);
      // Two active canonical rows, environment-proof: on a seeded catalog
      // the committed member already exists, so ONE explicit fixture insert
      // already creates the ambiguity; on an unseeded one two inserts do.
      // Both shapes ride this transaction and roll back with it.
      await createTestPlan(tx, {
        title: VERIFICATION_PLAN_TITLE,
        sessionCount: VERIFICATION_PLAN_SESSION_COUNT,
        price: "150.00",
        currency: "EGP",
        intervalDays: 14,
        balanceLane: SubscriptionCreditLane.Reviews,
        isActive: true,
      });
      await createTestPlan(tx, {
        title: VERIFICATION_PLAN_TITLE,
        sessionCount: VERIFICATION_PLAN_SESSION_COUNT,
        price: "150.00",
        currency: "EGP",
        intervalDays: 14,
        balanceLane: SubscriptionCreditLane.Reviews,
        isActive: true,
      });

      const err = await expectRepoError(() => VerificationPurchaseService.purchase(user.id, purchaseKey(), "en", tx));
      // The catalog misconfiguration is the internal-invariant breach: the
      // client-safe conflict copy (the exact ambiguity never surfaces), and
      // the denial lands BEFORE the gateway call — zero writes.
      expectDomainDenial(err, "CONFLICT", "Payment could not be processed.");
      const counts = await ledgerCounts(tx, user.id);
      expect(counts).toEqual({ subs: 0, payments: 0, claims: 0 });
    });
  });
});

describe("VerificationPurchaseService — purchase (chaos: production tx path, committed fixtures)", () => {
  let chaosUserId = 0;
  let chaosPlanId = 0;

  beforeAll(async () => {
    // Committed fixtures — the production path opens its OWN transaction
    // per call, so the race needs real committed entities (the sibling
    // purchase suite's chaos block).
    await db.transaction(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Pending });
      // CONDITIONAL catalog fixture: on a seeded catalog the canonical
      // member already exists (committed), and the purchase service
      // REJECTS an ambiguous catalog — a blind second insert would flip
      // this suite AND parallel workers' purchases into conflicts. The
      // committed fixture is created only on a catalog without the
      // canonical member; `chaosPlanId` stays 0 when the existing row
      // serves, and the afterAll deletes only a row this suite created.
      const active = await PlanRepository.listActive(tx);
      const existing = active.find(candidate => candidate.title === VERIFICATION_PLAN_TITLE);
      if (existing === undefined) {
        const plan = await createTestPlan(tx, {
          title: VERIFICATION_PLAN_TITLE,
          sessionCount: VERIFICATION_PLAN_SESSION_COUNT,
          balanceLane: SubscriptionCreditLane.Reviews,
        });
        chaosPlanId = plan.id;
      }
      chaosUserId = user.id;
    });
  });

  afterAll(async () => {
    // FK-safe hard-delete of every fixture row. The NULL-owner payment
    // ledger rows are un-deletable through their append-only DELETE guard,
    // so that leg runs under the sanctioned teardown-window trigger
    // suspension and is addressed through the subscription linkage (a
    // verification payment owns no student id); the rest deletes in strict
    // child-first order.
    const chaosSubs = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.userId, chaosUserId));
    const chaosSubIds = chaosSubs.map(row => row.id);

    await withImmutabilityTriggersSuspended(["student_payments"], async () => {
      if (chaosSubIds.length > 0) {
        await db.delete(studentPayments).where(inArray(studentPayments.subscriptionId, chaosSubIds));
      }
    });
    await db.delete(subscriptionPurchaseIdempotency).where(eq(subscriptionPurchaseIdempotency.userId, chaosUserId));
    if (chaosSubIds.length > 0) {
      await db.delete(studentSubscriptions).where(inArray(studentSubscriptions.subscriptionId, chaosSubIds));
    }
    await db.delete(subscriptions).where(eq(subscriptions.userId, chaosUserId));
    await db.delete(applicants).where(eq(applicants.id, chaosUserId));
    if (chaosPlanId > 0) {
      // Only a row THIS suite created is deleted — the seeded canonical
      // member (when it served) is never touched.
      await db.delete(plans).where(eq(plans.id, chaosPlanId));
    }
    await db.delete(users).where(eq(users.id, chaosUserId));

    // Load-bearing residue proof: the teardown must leave zero rows behind.
    const residueCounts = await Promise.all([
      db.$count(subscriptions, eq(subscriptions.userId, chaosUserId)),
      db.$count(subscriptionPurchaseIdempotency, eq(subscriptionPurchaseIdempotency.userId, chaosUserId)),
      db.$count(applicants, eq(applicants.id, chaosUserId)),
      db.$count(plans, eq(plans.id, chaosPlanId)),
      db.$count(users, eq(users.id, chaosUserId)),
      chaosSubIds.length
        ? db.$count(studentPayments, inArray(studentPayments.subscriptionId, chaosSubIds))
        : Promise.resolve(0),
      chaosSubIds.length
        ? db.$count(studentSubscriptions, inArray(studentSubscriptions.subscriptionId, chaosSubIds))
        : Promise.resolve(0),
    ]);
    for (const count of residueCounts) {
      expect(count).toBe(0);
    }
  });

  function chaosPurchase(key: string): Promise<PurchaseSubscriptionReturnType> {
    // NO outerTx — the production path: the service opens its own
    // transaction, giving every concurrent call a real connection.
    return VerificationPurchaseService.purchase(chaosUserId, key, "en");
  }

  testOnRealPostgres(
    "concurrent double-submit on the SAME key: exactly one success, one conflict, ONE pair",
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

      // Exactly ONE pending pair survived the race, the claim points at
      // the winning subscription, and the applicant row flipped exactly
      // once (the guarded UPDATE serializes the writers).
      const storedSubs = await db.select().from(subscriptions).where(eq(subscriptions.userId, chaosUserId));
      expect(storedSubs).toHaveLength(1);
      expect(storedSubs[0].status).toBe(SubscriptionStatus.Pending);
      const storedPayments = await db
        .select()
        .from(studentPayments)
        .where(eq(studentPayments.subscriptionId, storedSubs[0].id));
      expect(storedPayments).toHaveLength(1);
      expect(storedPayments[0].studentId).toBeNull();
      const claims = await db
        .select()
        .from(subscriptionPurchaseIdempotency)
        .where(eq(subscriptionPurchaseIdempotency.userId, chaosUserId));
      expect(claims).toHaveLength(1);
      expect(claims[0].subscriptionId).toBe(storedSubs[0].id);
      const applicantRows = await db.select().from(applicants).where(eq(applicants.id, chaosUserId));
      expect(applicantRows[0].status).toBe(ApplicantStatus.InEvaluation);
      expect(applicantRows[0].verificationAttempts).toBe(0);
    }
  );
});
