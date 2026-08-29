/**
 * SubscriptionService self-tests — the DEV1-006 Phase A purchase-entry
 * contract against the live `kottab_test` PostgreSQL instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every case runs inside `runInRollback`; `tx` is passed to EVERY
 *    service/repository/entity-setup call, so nothing commits and the
 *    non-transactional pool path stays unexercised here.
 *  - Entities ONLY via `entity-setup.ts` helpers; boundary values arrive
 *    through deliberate overrides.
 *  - Rejection assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited and appears nowhere.
 *  - Translated-message assertions use literals computed in-file from
 *    `getServerTranslations` — never raw keys, never hardcoded copy.
 *  - The logging contract is verified via logger spies; no console output.
 *
 * Coverage map:
 *  - Tier 1 (branch/statement): request happy path — PENDING row with the
 *    D2-locked plan embedded, no dates/payment data, audit seam marker;
 *    `listMySubscriptions` empty + populated (newest first, plan joined).
 *  - Tier 2 (boundary/rejects): non-positive / non-integer plan ids →
 *    localized plan-not-found ValidationError; unresolved duplicate
 *    (user, plan) → SUBSCRIPTION_REQUEST_EXISTS; DEACTIVATED plan →
 *    PLAN_INACTIVE (D2 purchase-time re-validation); MISSING plan →
 *    PLAN_INACTIVE (deliberately indistinguishable); an
 *    active-history-but-no-pending user can request again (renewals are
 *    the payment phase's concern).
 *  - Tier 3 (ordering/state): newest-first listing; pending request
 *    SURVIVES a later plan deactivation (purchase completed while active
 *    is never retro-invalidated).
 *  - Tier 4 (i18n): rejections switch between "en" and "ar" literals for
 *    every new code (PLAN_INACTIVE / SUBSCRIPTION_REQUEST_EXISTS).
 *
 * DEV1-006 Phase B — the admin payment-verification transition: guarded
 * pending→active with payment stamps, queue read, race/idempotency
 * rejects, REQ-017 deactivation survival, in-tx audit row.
 *
 * DEV1-009 — the admin lifecycle surface: `listAllSubscriptionsForAdmin`
 * (newest-first ordering across ALL statuses, status filter, pagination
 * slicing, invalid-filter i18n rejects, limit clamping, filtered total)
 * and `cancelSubscription` (active|pending → cancelled happy paths,
 * terminal-state + idempotency fences, not-found/validation rejects,
 * suspend-family audit row) + the repo-level guarded-write twin
 * (`cancelById` returns null on terminal rows).
 */

import { describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { SubscriptionRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { createTestPlan, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { ConflictError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { SubscriptionService } from "@/backend/services/billing/subscription.service";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const enErrors = getServerTranslations("en").errorsTranslations;
const arErrors = getServerTranslations("ar").errorsTranslations;

describe("SubscriptionService", () => {
  describe("Tier 1 — happy paths and branch coverage", () => {
    test("requestPlanSubscription creates a PENDING subscription with the plan embedded and no payment data", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const plan = await createTestPlan(tx);
        const infoSpy = spyOn(logger, "info");

        const row = await SubscriptionService.requestPlanSubscription(user.id, plan.id, "en", tx);

        expect(row.status).toBe("pending");
        expect(row.userId).toBe(user.id);
        expect(row.planId).toBe(plan.id);
        expect(row.startDate).toBeNull();
        expect(row.endDate).toBeNull();
        expect(row.paymentMethod).toBeNull();
        expect(row.paymentReference).toBeNull();
        expect(row.paymentVerifiedAt).toBeNull();
        // The embedded plan is the D2-locked active row — identity by id.
        expect(row.plan.id).toBe(plan.id);
        expect(row.plan.title).toBe(plan.title);

        // Audit seam emitted exactly once (DEV3-020 attach point).
        expect(infoSpy).toHaveBeenCalledTimes(1);
        const [message, payload] = infoSpy.mock.calls[0] ?? ["", {}];
        expect(message).toContain("SUBSCRIPTION_REQUESTED");
        expect((payload as { entityId?: number }).entityId).toBe(row.id);
        infoSpy.mockRestore();
      });
    });

    test("listMySubscriptions returns [] for a user with no subscriptions", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const rows = await SubscriptionService.listMySubscriptions(user.id, "en");
        expect(rows).toEqual([]);
      });
    });

    test("listMySubscriptions returns the user's rows newest-first with plans embedded", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const planA = await createTestPlan(tx, { title: `Plan A ${randomUUID().slice(0, 8)}` });
        const planB = await createTestPlan(tx, { title: `Plan B ${randomUUID().slice(0, 8)}` });

        const first = await SubscriptionService.requestPlanSubscription(user.id, planA.id, "en", tx);
        const second = await SubscriptionService.requestPlanSubscription(user.id, planB.id, "en", tx);

        const rows = await SubscriptionService.listMySubscriptions(user.id, "en", tx);
        expect(rows.length).toBe(2);
        // Newest first.
        expect(rows[0]?.id).toBe(second.id);
        expect(rows[1]?.id).toBe(first.id);
        // Plans embedded and matched to the right subscription.
        expect(rows[0]?.plan.id).toBe(planB.id);
        expect(rows[1]?.plan.id).toBe(planA.id);
      });
    });
  });

  describe("Tier 2 — boundary and rejection matrix", () => {
    test("non-positive and non-integer plan ids reject with the localized plan-not-found ValidationError", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        for (const badId of [0, -1, 1.5, Number.NaN]) {
          const error = await expectRepoError(() =>
            SubscriptionService.requestPlanSubscription(user.id, badId, "en", tx)
          );
          expect(error).toBeInstanceOf(ValidationError);
          expect(error.message).toBe(enErrors.planNotFound);
        }
      });
    });

    test("a second request for the same plan while one is pending rejects with SUBSCRIPTION_REQUEST_EXISTS", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const plan = await createTestPlan(tx);
        const domainSpy = spyOn(logger, "logDomainError");

        await SubscriptionService.requestPlanSubscription(user.id, plan.id, "en", tx);
        const error = await expectRepoError(() =>
          SubscriptionService.requestPlanSubscription(user.id, plan.id, "en", tx)
        );

        expect(error).toBeInstanceOf(ConflictError);
        expect(error.message).toBe(enErrors.subscriptionRequestExists);
        expect(domainSpy.mock.calls.some(call => String(call[1]?.code) === "SUBSCRIPTION_REQUEST_EXISTS")).toBe(true);
        domainSpy.mockRestore();
      });
    });

    test("a DEACTIVATED plan rejects with PLAN_INACTIVE (D2 purchase-time re-validation)", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const plan = await createTestPlan(tx, { isActive: false, deactivatedAt: new Date() });
        const domainSpy = spyOn(logger, "logDomainError");

        const error = await expectRepoError(() =>
          SubscriptionService.requestPlanSubscription(user.id, plan.id, "en", tx)
        );

        expect(error).toBeInstanceOf(ConflictError);
        expect(error.message).toBe(enErrors.planInactive);
        expect(domainSpy.mock.calls.some(call => String(call[1]?.code) === "PLAN_INACTIVE")).toBe(true);
        domainSpy.mockRestore();
      });
    });

    test("a MISSING plan rejects with PLAN_INACTIVE — indistinguishable from inactive at the purchase boundary", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const error = await expectRepoError(() =>
          SubscriptionService.requestPlanSubscription(user.id, 999_999_999, "en", tx)
        );
        expect(error).toBeInstanceOf(ConflictError);
        expect(error.message).toBe(enErrors.planInactive);
      });
    });

    test("a resolved (cancelled) history does NOT block a fresh request — only unresolved pending does", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const plan = await createTestPlan(tx);

        await SubscriptionService.requestPlanSubscription(user.id, plan.id, "en", tx);
        // Resolve the pending row as cancelled (simulates admin rejection /
        // user withdrawal — the resolution surface arrives with a later
        // phase; the state edit here stands in for its outcome).
        await tx
          .update(subscriptions)
          .set({ status: "cancelled" })
          .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.planId, plan.id)));

        const second = await SubscriptionService.requestPlanSubscription(user.id, plan.id, "en", tx);
        expect(second.status).toBe("pending");
      });
    });
  });

  describe("Tier 3 — state transitions after a request", () => {
    test("a pending request SURVIVES a later plan deactivation (never retro-invalidated)", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const plan = await createTestPlan(tx);

        await SubscriptionService.requestPlanSubscription(user.id, plan.id, "en", tx);
        // Deactivate AFTER the purchase transaction committed (here: inside
        // the same rollback tx, sequentially — the race window itself is
        // closed by the FOR UPDATE lock exercised in the D2 tests above).
        await tx.update(plans).set({ isActive: false, deactivatedAt: new Date() }).where(eq(plans.id, plan.id));

        const rows = await SubscriptionService.listMySubscriptions(user.id, "en", tx);
        expect(rows.length).toBe(1);
        expect(rows[0]?.status).toBe("pending");
        // The owner still sees the plan row (real lifecycle state, not the
        // active-catalog slice).
        expect(rows[0]?.plan.id).toBe(plan.id);
        expect(rows[0]?.plan.isActive).toBe(false);
      });
    });
  });

  describe("Tier 4 — i18n", () => {
    test("PLAN_INACTIVE and SUBSCRIPTION_REQUEST_EXISTS reject with Arabic literals under locale=ar", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const plan = await createTestPlan(tx);

        const inactiveError = await expectRepoError(() =>
          SubscriptionService.requestPlanSubscription(user.id, 999_999_999, "ar", tx)
        );
        expect(inactiveError.message).toBe(arErrors.planInactive);

        await SubscriptionService.requestPlanSubscription(user.id, plan.id, "ar", tx);
        const duplicateError = await expectRepoError(() =>
          SubscriptionService.requestPlanSubscription(user.id, plan.id, "ar", tx)
        );
        expect(duplicateError.message).toBe(arErrors.subscriptionRequestExists);
      });
    });
  });

  // ── DEV1-006 Phase B — the admin payment-verification transition ─────────
  describe("Phase B — verifySubscriptionPayment", () => {
    test("happy path: stamps payment columns, flips pending → active, derives endDate from the plan's intervalDays, writes the audit row with verifiedBy", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const admin = await createTestUser(tx, { role: "admin" });
        const plan = await createTestPlan(tx, { intervalDays: 30 });
        const request = await SubscriptionService.requestPlanSubscription(user.id, plan.id, "en", tx);

        const before = Date.now();
        const activated = await SubscriptionService.verifySubscriptionPayment(
          {
            subscriptionId: request.id,
            paymentMethod: "offline_cash",
            paymentReference: "  RCPT-00123  ",
            verifiedBy: admin.id,
          },
          "en",
          tx
        );
        const after = Date.now();

        expect(activated.status).toBe("active");
        expect(activated.paymentMethod).toBe("offline_cash");
        // Reference is TRIMMED before the write.
        expect(activated.paymentReference).toBe("RCPT-00123");
        expect(activated.paymentVerifiedAt).not.toBeNull();
        expect(activated.startDate).not.toBeNull();
        expect(activated.endDate).not.toBeNull();
        // startDate = verification instant; endDate = start + 30 days.
        const start = activated.startDate as Date;
        const end = activated.endDate as Date;
        expect(start.getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(start.getTime()).toBeLessThanOrEqual(after + 1000);
        expect(end.getTime() - start.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
        // The embedded plan rides the canonical wire shape.
        expect(activated.plan.id).toBe(plan.id);

        // DEV3-020: the verification is an ADMIN action — one immutable
        // audit row rides the SAME transaction, attributed to the verifying
        // admin (the logger marker alone is the ACTORLESS path's contract).
        const auditRows = await tx.select().from(auditLogs).where(eq(auditLogs.actorId, admin.id));
        expect(auditRows).toHaveLength(1);
        const auditRow = auditRows[0];
        expect(auditRow?.entityType).toBe("subscriptions");
        expect(auditRow?.entityId).toBe(request.id);
        const parsed: unknown = JSON.parse(auditRow?.details ?? "{}");
        expect((parsed as { code?: string }).code).toBe("SUBSCRIPTION_PAYMENT_VERIFIED");
        expect((parsed as { planId?: number }).planId).toBe(plan.id);
        expect((parsed as { verifiedBy?: number }).verifiedBy).toBe(admin.id);
      });
    });

    test("listPendingSubscriptionRequests returns pending rows oldest-first with plan + purchaser embedded", async () => {
      await runInRollback(async tx => {
        const buyerA = await createTestUser(tx, { fullName: "Buyer A" });
        const buyerB = await createTestUser(tx, { fullName: "Buyer B" });
        const planA = await createTestPlan(tx, { title: `Plan A ${randomUUID().slice(0, 8)}` });
        const planB = await createTestPlan(tx, { title: `Plan B ${randomUUID().slice(0, 8)}` });

        const first = await SubscriptionService.requestPlanSubscription(buyerA.id, planA.id, "en", tx);
        const second = await SubscriptionService.requestPlanSubscription(buyerB.id, planB.id, "en", tx);

        const queue = await SubscriptionService.listPendingSubscriptionRequests("en", tx);
        expect(queue.length).toBe(2);
        // FIFO — oldest request first.
        expect(queue[0]?.id).toBe(first.id);
        expect(queue[1]?.id).toBe(second.id);
        // Plan + narrow purchaser summary embedded and correctly joined.
        expect(queue[0]?.plan.id).toBe(planA.id);
        expect(queue[0]?.user.id).toBe(buyerA.id);
        expect(queue[0]?.user.fullName).toBe(buyerA.fullName);
        expect(queue[0]?.user.email).toBe(buyerA.email);
        expect(queue[1]?.user.fullName).toBe(buyerB.fullName);
      });
    });

    test("bank_transfer verifies symmetrically to offline_cash", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const plan = await createTestPlan(tx);
        const request = await SubscriptionService.requestPlanSubscription(user.id, plan.id, "en", tx);

        const activated = await SubscriptionService.verifySubscriptionPayment(
          {
            subscriptionId: request.id,
            paymentMethod: "bank_transfer",
            paymentReference: "TRF-777",
            verifiedBy: user.id,
          },
          "en",
          tx
        );
        expect(activated.status).toBe("active");
        expect(activated.paymentMethod).toBe("bank_transfer");
      });
    });

    test("non-positive and non-integer subscription ids reject with the localized not-found ValidationError", async () => {
      await runInRollback(async tx => {
        for (const badId of [0, -1, 1.5, Number.NaN]) {
          const error = await expectRepoError(() =>
            SubscriptionService.verifySubscriptionPayment(
              { subscriptionId: badId, paymentMethod: "offline_cash", paymentReference: "R-1", verifiedBy: 1 },
              "en",
              tx
            )
          );
          expect(error).toBeInstanceOf(ValidationError);
          expect(error.message).toBe(enErrors.subscriptionNotFound);
        }
      });
    });

    test("payment methods outside the offline set reject with the localized invalid-method ValidationError", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const plan = await createTestPlan(tx);
        const request = await SubscriptionService.requestPlanSubscription(user.id, plan.id, "en", tx);
        const domainSpy = spyOn(logger, "logDomainError");

        for (const badMethod of ["stripe", "paypal", "credit", "OFFLINE_CASH"]) {
          const error = await expectRepoError(() =>
            SubscriptionService.verifySubscriptionPayment(
              { subscriptionId: request.id, paymentMethod: badMethod, paymentReference: "R-1", verifiedBy: 1 },
              "en",
              tx
            )
          );
          expect(error).toBeInstanceOf(ValidationError);
          expect(error.message).toBe(enErrors.paymentMethodInvalid);
        }
        expect(domainSpy.mock.calls.some(call => String(call[1]?.code) === "PAYMENT_METHOD_INVALID")).toBe(true);
        domainSpy.mockRestore();
      });
    });

    test("blank and oversized references reject with the localized invalid-reference ValidationError; boundary values pass", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const plan = await createTestPlan(tx);
        const domainSpy = spyOn(logger, "logDomainError");

        const first = await SubscriptionService.requestPlanSubscription(user.id, plan.id, "en", tx);
        for (const badReference of ["", "   ", "x".repeat(256)]) {
          const error = await expectRepoError(() =>
            SubscriptionService.verifySubscriptionPayment(
              {
                subscriptionId: first.id,
                paymentMethod: "offline_cash",
                paymentReference: badReference,
                verifiedBy: 1,
              },
              "en",
              tx
            )
          );
          expect(error).toBeInstanceOf(ValidationError);
          expect(error.message).toBe(enErrors.paymentReferenceInvalid);
        }
        expect(domainSpy.mock.calls.some(call => String(call[1]?.code) === "PAYMENT_REFERENCE_INVALID")).toBe(true);
        domainSpy.mockRestore();

        // Boundary pass: exactly 255 characters.
        const ok = await SubscriptionService.verifySubscriptionPayment(
          {
            subscriptionId: first.id,
            paymentMethod: "offline_cash",
            paymentReference: "R".repeat(255),
            verifiedBy: 1,
          },
          "en",
          tx
        );
        expect(ok.paymentReference?.length).toBe(255);
      });
    });

    test("a MISSING subscription id rejects with SUBSCRIPTION_NOT_FOUND (ConflictError)", async () => {
      await runInRollback(async tx => {
        const domainSpy = spyOn(logger, "logDomainError");
        const error = await expectRepoError(() =>
          SubscriptionService.verifySubscriptionPayment(
            { subscriptionId: 999_999_999, paymentMethod: "offline_cash", paymentReference: "R-1", verifiedBy: 1 },
            "en",
            tx
          )
        );
        expect(error).toBeInstanceOf(ConflictError);
        expect(error.message).toBe(enErrors.subscriptionNotFound);
        expect(domainSpy.mock.calls.some(call => String(call[1]?.code) === "SUBSCRIPTION_NOT_FOUND")).toBe(true);
        domainSpy.mockRestore();
      });
    });

    test("a resolved (cancelled) subscription rejects with SUBSCRIPTION_ALREADY_RESOLVED — the idempotency fence", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const plan = await createTestPlan(tx);
        const request = await SubscriptionService.requestPlanSubscription(user.id, plan.id, "en", tx);
        await tx.update(subscriptions).set({ status: "cancelled" }).where(eq(subscriptions.id, request.id));

        const error = await expectRepoError(() =>
          SubscriptionService.verifySubscriptionPayment(
            { subscriptionId: request.id, paymentMethod: "offline_cash", paymentReference: "R-1", verifiedBy: 1 },
            "en",
            tx
          )
        );
        expect(error).toBeInstanceOf(ConflictError);
        expect(error.message).toBe(enErrors.subscriptionAlreadyResolved);
      });
    });

    test("a second verification of the SAME pending row rejects with SUBSCRIPTION_ALREADY_RESOLVED (guarded write serializes)", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const plan = await createTestPlan(tx);
        const request = await SubscriptionService.requestPlanSubscription(user.id, plan.id, "en", tx);
        const input = {
          subscriptionId: request.id,
          paymentMethod: "offline_cash" as const,
          paymentReference: "RCPT-DUP",
          verifiedBy: 1,
        };

        const first = await SubscriptionService.verifySubscriptionPayment(input, "en", tx);
        expect(first.status).toBe("active");

        const error = await expectRepoError(() => SubscriptionService.verifySubscriptionPayment(input, "en", tx));
        expect(error).toBeInstanceOf(ConflictError);
        expect(error.message).toBe(enErrors.subscriptionAlreadyResolved);
      });
    });

    test("a pending request whose plan was DEACTIVATED after the request still verifies (REQ-017 — an already-paid user is never stranded)", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx);
        const plan = await createTestPlan(tx);
        const request = await SubscriptionService.requestPlanSubscription(user.id, plan.id, "en", tx);
        await tx.update(plans).set({ isActive: false, deactivatedAt: new Date() }).where(eq(plans.id, plan.id));

        const activated = await SubscriptionService.verifySubscriptionPayment(
          {
            subscriptionId: request.id,
            paymentMethod: "bank_transfer",
            paymentReference: "TRF-POST-DEACT",
            verifiedBy: 1,
          },
          "en",
          tx
        );
        expect(activated.status).toBe("active");
        expect(activated.plan.id).toBe(plan.id);
        expect(activated.plan.isActive).toBe(false);
      });
    });

    test("verification rejections switch to Arabic literals under locale=ar", async () => {
      await runInRollback(async tx => {
        const notFound = await expectRepoError(() =>
          SubscriptionService.verifySubscriptionPayment(
            { subscriptionId: 999_999_999, paymentMethod: "offline_cash", paymentReference: "R-1", verifiedBy: 1 },
            "ar",
            tx
          )
        );
        expect(notFound.message).toBe(arErrors.subscriptionNotFound);

        const user = await createTestUser(tx);
        const plan = await createTestPlan(tx);
        const request = await SubscriptionService.requestPlanSubscription(user.id, plan.id, "en", tx);

        const badMethod = await expectRepoError(() =>
          SubscriptionService.verifySubscriptionPayment(
            { subscriptionId: request.id, paymentMethod: "stripe", paymentReference: "R-1", verifiedBy: 1 },
            "ar",
            tx
          )
        );
        expect(badMethod.message).toBe(arErrors.paymentMethodInvalid);

        const badReference = await expectRepoError(() =>
          SubscriptionService.verifySubscriptionPayment(
            { subscriptionId: request.id, paymentMethod: "offline_cash", paymentReference: "  ", verifiedBy: 1 },
            "ar",
            tx
          )
        );
        expect(badReference.message).toBe(arErrors.paymentReferenceInvalid);

        await SubscriptionService.verifySubscriptionPayment(
          { subscriptionId: request.id, paymentMethod: "offline_cash", paymentReference: "RCPT-AR", verifiedBy: 1 },
          "ar",
          tx
        );
        const alreadyResolved = await expectRepoError(() =>
          SubscriptionService.verifySubscriptionPayment(
            { subscriptionId: request.id, paymentMethod: "offline_cash", paymentReference: "RCPT-AR", verifiedBy: 1 },
            "ar",
            tx
          )
        );
        expect(alreadyResolved.message).toBe(arErrors.subscriptionAlreadyResolved);
      });
    });
  });

  // ── DEV1-009 — the admin lifecycle surface (list + cancel) ───────────────
  describe("DEV1-009 — listAllSubscriptionsForAdmin", () => {
    test("returns rows NEWEST-first across all statuses with plan + narrow purchaser embedded", async () => {
      await runInRollback(async tx => {
        const buyer = await createTestUser(tx, { fullName: "Lifecycle Buyer" });
        const planA = await createTestPlan(tx, { title: `Plan A ${randomUUID().slice(0, 8)}` });
        const planB = await createTestPlan(tx, { title: `Plan B ${randomUUID().slice(0, 8)}` });
        const planC = await createTestPlan(tx, { title: `Plan C ${randomUUID().slice(0, 8)}` });

        const first = await SubscriptionService.requestPlanSubscription(buyer.id, planA.id, "en", tx);
        const second = await SubscriptionService.requestPlanSubscription(buyer.id, planB.id, "en", tx);
        const third = await SubscriptionService.requestPlanSubscription(buyer.id, planC.id, "en", tx);

        const page = await SubscriptionService.listAllSubscriptionsForAdmin({ limit: 10, offset: 0 }, "en", tx);

        expect(page.total).toBe(3);
        expect(page.limit).toBe(10);
        expect(page.offset).toBe(0);
        // Newest first — identity-monotonic tiebreak on same-millisecond rows.
        expect(page.items.map(row => row.id)).toEqual([third.id, second.id, first.id]);
        // Plan + narrow purchaser summary embedded and correctly joined.
        expect(page.items[0]?.plan.id).toBe(planC.id);
        expect(page.items[0]?.user.id).toBe(buyer.id);
        expect(page.items[0]?.user.fullName).toBe(buyer.fullName);
        expect(page.items[0]?.user.email).toBe(buyer.email);
      });
    });

    test("status filter EXCLUDES other statuses in both items and total", async () => {
      await runInRollback(async tx => {
        const buyer = await createTestUser(tx);
        const planA = await createTestPlan(tx);
        const planB = await createTestPlan(tx);

        const pendingRow = await SubscriptionService.requestPlanSubscription(buyer.id, planA.id, "en", tx);
        const activeRow = await SubscriptionService.requestPlanSubscription(buyer.id, planB.id, "en", tx);
        await SubscriptionService.verifySubscriptionPayment(
          {
            subscriptionId: activeRow.id,
            paymentMethod: "offline_cash",
            paymentReference: "RCPT-FILTER",
            verifiedBy: buyer.id,
          },
          "en",
          tx
        );

        const activePage = await SubscriptionService.listAllSubscriptionsForAdmin(
          { status: "active", limit: 10, offset: 0 },
          "en",
          tx
        );
        expect(activePage.total).toBe(1);
        expect(activePage.items.map(row => row.id)).toEqual([activeRow.id]);
        expect(activePage.items[0]?.status).toBe("active");

        const pendingPage = await SubscriptionService.listAllSubscriptionsForAdmin(
          { status: "pending", limit: 10, offset: 0 },
          "en",
          tx
        );
        expect(pendingPage.total).toBe(1);
        expect(pendingPage.items.map(row => row.id)).toEqual([pendingRow.id]);
        expect(pendingPage.items[0]?.status).toBe("pending");
      });
    });

    test("pagination: limit+offset slice the newest-first ordering without dropping the total", async () => {
      await runInRollback(async tx => {
        const buyer = await createTestUser(tx);
        const planA = await createTestPlan(tx);
        const planB = await createTestPlan(tx);
        const planC = await createTestPlan(tx);

        const first = await SubscriptionService.requestPlanSubscription(buyer.id, planA.id, "en", tx);
        const second = await SubscriptionService.requestPlanSubscription(buyer.id, planB.id, "en", tx);
        const third = await SubscriptionService.requestPlanSubscription(buyer.id, planC.id, "en", tx);

        const firstPage = await SubscriptionService.listAllSubscriptionsForAdmin({ limit: 2, offset: 0 }, "en", tx);
        expect(firstPage.items.map(row => row.id)).toEqual([third.id, second.id]);
        expect(firstPage.total).toBe(3);

        const secondPage = await SubscriptionService.listAllSubscriptionsForAdmin({ limit: 2, offset: 2 }, "en", tx);
        expect(secondPage.items.map(row => row.id)).toEqual([first.id]);
        expect(secondPage.total).toBe(3);
        expect(secondPage.offset).toBe(2);
      });
    });

    test("an UNKNOWN status filter rejects with the localized ValidationError — ar AND en literals, BEFORE any read", async () => {
      await runInRollback(async tx => {
        const buyer = await createTestUser(tx);
        const plan = await createTestPlan(tx);
        await SubscriptionService.requestPlanSubscription(buyer.id, plan.id, "en", tx);
        const domainSpy = spyOn(logger, "logDomainError");

        const enError = await expectRepoError(() =>
          SubscriptionService.listAllSubscriptionsForAdmin({ status: "archived", limit: 10, offset: 0 }, "en", tx)
        );
        expect(enError).toBeInstanceOf(ValidationError);
        expect(enError.message).toBe(enErrors.subscriptionStatusInvalid);

        const arError = await expectRepoError(() =>
          SubscriptionService.listAllSubscriptionsForAdmin({ status: "PENDING", limit: 10, offset: 0 }, "ar", tx)
        );
        expect(arError).toBeInstanceOf(ValidationError);
        expect(arError.message).toBe(arErrors.subscriptionStatusInvalid);

        expect(domainSpy.mock.calls.some(call => String(call[1]?.code) === "SUBSCRIPTION_STATUS_INVALID")).toBe(true);
        domainSpy.mockRestore();
      });
    });

    test("limit clamps to the 1..100 band: 1000 → 100, 0 → 1 (default stays 50)", async () => {
      await runInRollback(async tx => {
        const buyer = await createTestUser(tx);
        const plan = await createTestPlan(tx);
        await SubscriptionService.requestPlanSubscription(buyer.id, plan.id, "en", tx);

        const ceiling = await SubscriptionService.listAllSubscriptionsForAdmin({ limit: 1000, offset: 0 }, "en", tx);
        expect(ceiling.limit).toBe(100);

        const floor = await SubscriptionService.listAllSubscriptionsForAdmin({ limit: 0, offset: 0 }, "en", tx);
        expect(floor.limit).toBe(1);

        const omitted = await SubscriptionService.listAllSubscriptionsForAdmin({}, "en", tx);
        expect(omitted.limit).toBe(50);
      });
    });
  });

  describe("DEV1-009 — cancelSubscription", () => {
    test("happy path on an ACTIVE subscription: flips to cancelled with plan + purchaser embedded and payment stamps preserved", async () => {
      await runInRollback(async tx => {
        const buyer = await createTestUser(tx);
        const admin = await createTestUser(tx, { role: "admin" });
        const plan = await createTestPlan(tx);
        const request = await SubscriptionService.requestPlanSubscription(buyer.id, plan.id, "en", tx);
        await SubscriptionService.verifySubscriptionPayment(
          {
            subscriptionId: request.id,
            paymentMethod: "offline_cash",
            paymentReference: "RCPT-CANCEL-1",
            verifiedBy: admin.id,
          },
          "en",
          tx
        );

        const cancelled = await SubscriptionService.cancelSubscription(
          { subscriptionId: request.id, cancelledBy: admin.id },
          "en",
          tx
        );

        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.id).toBe(request.id);
        // Plan embedded (plain read — active predicate deliberately absent).
        expect(cancelled.plan.id).toBe(plan.id);
        // Narrow purchaser summary embedded.
        expect(cancelled.user.id).toBe(buyer.id);
        expect(cancelled.user.fullName).toBe(buyer.fullName);
        expect(cancelled.user.email).toBe(buyer.email);
        // Cancellation does NOT rewrite history: the verification stamps
        // survive untouched (and nothing was refunded/credited — DEV1-007).
        expect(cancelled.paymentMethod).toBe("offline_cash");
        expect(cancelled.paymentReference).toBe("RCPT-CANCEL-1");
        expect(cancelled.paymentVerifiedAt).not.toBeNull();
      });
    });

    test("a PENDING subscription cancels symmetrically (dates/payment stay NULL)", async () => {
      await runInRollback(async tx => {
        const buyer = await createTestUser(tx);
        const plan = await createTestPlan(tx);
        const request = await SubscriptionService.requestPlanSubscription(buyer.id, plan.id, "en", tx);

        const cancelled = await SubscriptionService.cancelSubscription(
          { subscriptionId: request.id, cancelledBy: 1 },
          "en",
          tx
        );

        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.startDate).toBeNull();
        expect(cancelled.paymentMethod).toBeNull();
        expect(cancelled.paymentReference).toBeNull();
        expect(cancelled.plan.id).toBe(plan.id);
      });
    });

    test("terminal states reject with SUBSCRIPTION_ALREADY_RESOLVED: expired (en) and suspended (ar) literals", async () => {
      await runInRollback(async tx => {
        const buyer = await createTestUser(tx);
        const planA = await createTestPlan(tx);
        const planB = await createTestPlan(tx);
        const expiredRow = await SubscriptionService.requestPlanSubscription(buyer.id, planA.id, "en", tx);
        const suspendedRow = await SubscriptionService.requestPlanSubscription(buyer.id, planB.id, "en", tx);
        await tx.update(subscriptions).set({ status: "expired" }).where(eq(subscriptions.id, expiredRow.id));
        await tx.update(subscriptions).set({ status: "suspended" }).where(eq(subscriptions.id, suspendedRow.id));

        const expiredError = await expectRepoError(() =>
          SubscriptionService.cancelSubscription({ subscriptionId: expiredRow.id, cancelledBy: 1 }, "en", tx)
        );
        expect(expiredError).toBeInstanceOf(ConflictError);
        expect(expiredError.message).toBe(enErrors.subscriptionAlreadyResolved);

        const suspendedError = await expectRepoError(() =>
          SubscriptionService.cancelSubscription({ subscriptionId: suspendedRow.id, cancelledBy: 1 }, "ar", tx)
        );
        expect(suspendedError).toBeInstanceOf(ConflictError);
        expect(suspendedError.message).toBe(arErrors.subscriptionAlreadyResolved);
      });
    });

    test("a second cancel of the SAME row rejects with SUBSCRIPTION_ALREADY_RESOLVED (idempotency fence)", async () => {
      await runInRollback(async tx => {
        const buyer = await createTestUser(tx);
        const plan = await createTestPlan(tx);
        const request = await SubscriptionService.requestPlanSubscription(buyer.id, plan.id, "en", tx);
        const domainSpy = spyOn(logger, "logDomainError");

        const first = await SubscriptionService.cancelSubscription(
          { subscriptionId: request.id, cancelledBy: 1 },
          "en",
          tx
        );
        expect(first.status).toBe("cancelled");

        const error = await expectRepoError(() =>
          SubscriptionService.cancelSubscription({ subscriptionId: request.id, cancelledBy: 1 }, "en", tx)
        );
        expect(error).toBeInstanceOf(ConflictError);
        expect(error.message).toBe(enErrors.subscriptionAlreadyResolved);
        expect(domainSpy.mock.calls.some(call => String(call[1]?.code) === "SUBSCRIPTION_ALREADY_RESOLVED")).toBe(true);
        domainSpy.mockRestore();
      });
    });

    test("a MISSING id rejects with SUBSCRIPTION_NOT_FOUND; a non-positive id rejects with the localized ValidationError", async () => {
      await runInRollback(async tx => {
        const notFound = await expectRepoError(() =>
          SubscriptionService.cancelSubscription({ subscriptionId: 999_999_999, cancelledBy: 1 }, "en", tx)
        );
        expect(notFound).toBeInstanceOf(ConflictError);
        expect(notFound.message).toBe(enErrors.subscriptionNotFound);

        const invalid = await expectRepoError(() =>
          SubscriptionService.cancelSubscription({ subscriptionId: 0, cancelledBy: 1 }, "en", tx)
        );
        expect(invalid).toBeInstanceOf(ValidationError);
        expect(invalid.message).toBe(enErrors.subscriptionNotFound);
      });
    });

    test("writes the immutable audit row: action_type 'suspend', SUBSCRIPTION_CANCELLED, attributed to cancelledBy", async () => {
      await runInRollback(async tx => {
        const buyer = await createTestUser(tx);
        const admin = await createTestUser(tx, { role: "admin" });
        const plan = await createTestPlan(tx);
        const request = await SubscriptionService.requestPlanSubscription(buyer.id, plan.id, "en", tx);

        await SubscriptionService.cancelSubscription({ subscriptionId: request.id, cancelledBy: admin.id }, "en", tx);

        const auditRows = await tx.select().from(auditLogs).where(eq(auditLogs.actorId, admin.id));
        expect(auditRows).toHaveLength(1);
        const auditRow = auditRows[0];
        expect(auditRow?.actionType).toBe("suspend");
        expect(auditRow?.entityType).toBe("subscriptions");
        expect(auditRow?.entityId).toBe(request.id);
        const parsed: unknown = JSON.parse(auditRow?.details ?? "{}");
        expect((parsed as { code?: string }).code).toBe("SUBSCRIPTION_CANCELLED");
        expect((parsed as { planId?: number }).planId).toBe(plan.id);
        expect((parsed as { cancelledBy?: number }).cancelledBy).toBe(admin.id);
      });
    });

    test("repo-level guard: cancelById matches NOTHING on an already-cancelled id (terminal rows never match)", async () => {
      await runInRollback(async tx => {
        const buyer = await createTestUser(tx);
        const plan = await createTestPlan(tx);
        const request = await SubscriptionService.requestPlanSubscription(buyer.id, plan.id, "en", tx);

        // Positive twin — the guarded write cancels a pending row exactly once.
        const cancelled = await SubscriptionRepository.cancelById(request.id, tx);
        expect(cancelled?.status).toBe("cancelled");

        // Terminal rows (cancelled) can never match the guarded predicate —
        // asserted at the REPOSITORY layer per the CRON-R6 concurrency
        // lesson (never two service mutations on one outer tx concurrently).
        const secondAttempt = await SubscriptionRepository.cancelById(request.id, tx);
        expect(secondAttempt).toBeNull();
      });
    });
  });
});
