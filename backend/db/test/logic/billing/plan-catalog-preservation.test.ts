/**
 * REQ-075 — Deactivation Preservation Proof (Phase 5.1).
 *
 * Proves REQ-017 / REQ-018 lifecycle independence: plan catalog mutations
 * (`PlanCatalogService.setPlanActiveStatus` and `PlanCatalogService.updatePlan`)
 * NEVER touch existing subscriptions or credited balances — the commercial
 * ledger stays byte-identical while the catalog row itself changes.
 *
 * Per `backend/db/test/AGENTS.md` and the sibling service-test pattern:
 *  - Every case runs inside `runInRollback`; `tx` is passed to EVERY
 *    service/entity-setup/direct-Drizzle call, so nothing commits.
 *  - Entities ONLY via `entity-setup.ts` helpers (`createTestPlanWithSubscription`);
 *    the student-payments ledger lane is inserted directly through the Drizzle
 *    schema (no helper exists) following the same entity-setup idioms.
 *  - Balance lanes are the per-student `students.balance_*` columns
 *    (`balanceHifz` / `balanceTajweed` / `balanceReviews` — REQ-017's credited
 *    lanes), credited with NON-ZERO values so any decrement/recompute would
 *    be caught, plus one `student_payments` row linked to the fixture
 *    subscription's student (the billing financial lane).
 *  - Preservation is asserted on FULL row objects (deep-equal between a
 *    pre-mutation SELECT snapshot and a post-mutation re-read) — never on
 *    selected columns (5.1.SR).
 *  - The catalog row is co-asserted to have ACTUALLY changed (isActive false,
 *    `deactivatedAt` non-null, edited fields applied) — guards against vacuous
 *    tests where the service call silently did nothing.
 *  - No `getServerTranslations` in scaffolding (Rule 19): literal "en" locale
 *    strings only. No rejection probes here (covered by the service suite), so
 *    `expectRepoError` is not needed.
 *
 * Coverage map:
 *  - Deactivation (`setPlanActiveStatus(id, false)`) preserves subscription +
 *    student balance row + student payment row byte-identically (REQ-017/075,
 *    A.9 independence: `subscription.status` unaffected).
 *  - Forward-only edit (`updatePlan` price/sessionCount/intervalDays) preserves
 *    the same ledger rows byte-identically (REQ-018, INV-B2/B3 shield).
 *  - Deactivate → edit in sequence: both operations combined still never
 *    rewrite the ledger (INV-PC2), while the catalog reflects both changes.
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { students } from "@/backend/db/schema/students/students";
import { createTestPlanWithSubscription } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";
import type { DBTransaction } from "@/backend/types";

/** Non-zero credited balances so any recompute/decrement breaks the proof. */
const CREDITED_BALANCES = { balanceHifz: 12, balanceTajweed: 8, balanceReviews: 3 } as const;

/** The full-row ledger snapshot/re-read shape (subscription + both balance lanes). */
type LedgerSnapshot = {
  subscription: typeof subscriptions.$inferSelect;
  student: typeof students.$inferSelect;
  payment: typeof studentPayments.$inferSelect;
};

type PreservationFixture = Awaited<ReturnType<typeof createTestPlanWithSubscription>> & {
  payment: typeof studentPayments.$inferSelect;
};

/**
 * Builds the preservation fixture inside the caller's transaction:
 * plan → subscription → student (with non-zero credited balances) via
 * `createTestPlanWithSubscription`, plus one `student_payments` row linked to
 * the fixture subscription's student via direct schema insert (the billing
 * financial lane; no entity-setup helper exists for it). The subscription is
 * pinned to deterministic start/end dates and offline-verified payment
 * metadata so the byte-identical proof covers status + dates (REQ-075).
 */
async function createPreservationFixture(tx: DBTransaction): Promise<PreservationFixture> {
  const fixture = await createTestPlanWithSubscription(tx, {
    student: { ...CREDITED_BALANCES },
    subscription: {
      status: "active",
      startDate: new Date("2024-01-15T10:00:00.000Z"),
      endDate: new Date("2025-01-15T10:00:00.000Z"),
      paymentMethod: "paymob",
      paymentReference: `PRESERVE-${randomUUID()}`,
      paymentVerifiedAt: new Date("2024-01-15T11:00:00.000Z"),
    },
  });

  const [payment] = await tx
    .insert(studentPayments)
    .values({
      studentId: fixture.student.id,
      subscriptionId: fixture.subscription.id,
      amount: "250.00",
      currency: "EGP",
      paymentGateway: "paymob",
      status: "paid",
    })
    .returning();
  if (!payment) {
    throw new Error("createPreservationFixture: student payment insert returned no rows");
  }
  return { ...fixture, payment };
}

/** Full-row SELECT of every ledger lane touched by the proof (snapshot + re-read). */
async function readLedgerSnapshot(tx: DBTransaction, fixture: PreservationFixture): Promise<LedgerSnapshot> {
  const [subscriptionRow] = await tx.select().from(subscriptions).where(eq(subscriptions.id, fixture.subscription.id));
  if (!subscriptionRow) {
    throw new Error("readLedgerSnapshot: subscription row missing");
  }
  const [studentRow] = await tx.select().from(students).where(eq(students.id, fixture.student.id));
  if (!studentRow) {
    throw new Error("readLedgerSnapshot: student balance row missing");
  }
  const [paymentRow] = await tx.select().from(studentPayments).where(eq(studentPayments.id, fixture.payment.id));
  if (!paymentRow) {
    throw new Error("readLedgerSnapshot: student payment row missing");
  }
  return { subscription: subscriptionRow, student: studentRow, payment: paymentRow };
}

/** Asserts every ledger lane is byte-identical to the pre-mutation snapshot. */
function expectLedgerUnchanged(before: LedgerSnapshot, after: LedgerSnapshot): void {
  // Full-row deep-equal — NOT selected columns (5.1.SR): status, dates,
  // payment metadata, timestamps, and all balance lanes must match exactly.
  expect(after.subscription).toEqual(before.subscription);
  expect(after.student).toEqual(before.student);
  expect(after.payment).toEqual(before.payment);

  // Explicit balance-lane echo so a failure reads as a REQ-017/018 violation,
  // not an opaque deep-equal diff.
  expect(after.student.balanceHifz).toBe(before.student.balanceHifz);
  expect(after.student.balanceTajweed).toBe(before.student.balanceTajweed);
  expect(after.student.balanceReviews).toBe(before.student.balanceReviews);
}

describe("PlanCatalogService — deactivation preservation proof (REQ-075)", () => {
  test("setPlanActiveStatus(id, false) leaves subscription + balance rows byte-identical", async () => {
    await runInRollback(async tx => {
      const fixture = await createPreservationFixture(tx);
      const before = await readLedgerSnapshot(tx, fixture);

      const deactivated = await PlanCatalogService.setPlanActiveStatus(fixture.plan.id, false, "en", tx);
      expect(deactivated.id).toBe(fixture.plan.id);

      const after = await readLedgerSnapshot(tx, fixture);
      expectLedgerUnchanged(before, after);

      // Anti-vacuous guard: the catalog row itself DID change (A.1), while
      // the commercial terms stayed frozen.
      expect(deactivated.isActive).toBe(false);
      expect(deactivated.deactivatedAt).toBeInstanceOf(Date);
      const [catalogRow] = await tx.select().from(plans).where(eq(plans.id, fixture.plan.id));
      expect(catalogRow?.isActive).toBe(false);
      expect(catalogRow?.deactivatedAt).toBeInstanceOf(Date);
      // Non-lifecycle catalog columns untouched by the status flip.
      expect(catalogRow?.price).toBe(fixture.plan.price);
      expect(catalogRow?.sessionCount).toBe(fixture.plan.sessionCount);
      expect(catalogRow?.intervalDays).toBe(fixture.plan.intervalDays);
    });
  });

  test("updatePlan(price, sessionCount, intervalDays) leaves subscription + balance rows byte-identical", async () => {
    await runInRollback(async tx => {
      const fixture = await createPreservationFixture(tx);
      const before = await readLedgerSnapshot(tx, fixture);

      const updated = await PlanCatalogService.updatePlan(
        fixture.plan.id,
        { price: "999.99", sessionCount: 12, intervalDays: 7 },
        "en",
        tx
      );
      expect(updated.id).toBe(fixture.plan.id);

      const after = await readLedgerSnapshot(tx, fixture);
      expectLedgerUnchanged(before, after);

      // Anti-vacuous guard: the new terms DID land on the catalog row, and
      // the lifecycle pair was untouched by the field edit.
      expect(updated.price).toBe("999.99");
      expect(updated.sessionCount).toBe(12);
      expect(updated.intervalDays).toBe(7);
      expect(updated.isActive).toBe(true);
      expect(updated.deactivatedAt).toBeNull();
      const [catalogRow] = await tx.select().from(plans).where(eq(plans.id, fixture.plan.id));
      expect(catalogRow?.price).toBe("999.99");
      expect(catalogRow?.sessionCount).toBe(12);
      expect(catalogRow?.intervalDays).toBe(7);
      expect(catalogRow?.title).toBe(fixture.plan.title);
    });
  });

  test("deactivate then edit in sequence never rewrites the ledger (INV-PC2)", async () => {
    await runInRollback(async tx => {
      const fixture = await createPreservationFixture(tx);
      const before = await readLedgerSnapshot(tx, fixture);

      await PlanCatalogService.setPlanActiveStatus(fixture.plan.id, false, "en", tx);
      await PlanCatalogService.updatePlan(
        fixture.plan.id,
        { price: "999.99", sessionCount: 12, intervalDays: 7 },
        "en",
        tx
      );

      const after = await readLedgerSnapshot(tx, fixture);
      expectLedgerUnchanged(before, after);

      // The catalog row carries BOTH mutations: retired AND re-priced —
      // proving the ledger invariance held across the full lifecycle pair.
      const [catalogRow] = await tx.select().from(plans).where(eq(plans.id, fixture.plan.id));
      expect(catalogRow?.isActive).toBe(false);
      expect(catalogRow?.deactivatedAt).toBeInstanceOf(Date);
      expect(catalogRow?.price).toBe("999.99");
      expect(catalogRow?.sessionCount).toBe(12);
      expect(catalogRow?.intervalDays).toBe(7);
      // Subscription remains active and untouched (A.9 independence).
      expect(after.subscription.status).toBe("active");
    });
  });
});
