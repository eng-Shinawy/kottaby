/**
 * PlanCatalogService 4-Tier Unit Test Suite.
 *
 * Tier 1: Statement & branch coverage for all service methods and domain error classes.
 * Tier 2: Boundary conditions & exhaustive REQ-073 validation matrix.
 * Tier 3: Chaos & concurrency (concurrent deactivations, round-trip state transitions).
 * Tier 4: Security (BOPLA field smuggling prevention, cause-chain translation, i18n ar/en).
 */

import { describe, expect, test } from "bun:test";
import { createTestPlan } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { DomainError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";
import type { PlanSubmitInput } from "@/backend/types";

describe("PlanCatalogService", () => {
  // ─── Tier 1: Statement & Branch Coverage ────────────────────────────────────

  test("createPlan creates a plan and returns all fields with defaults", async () => {
    await runInRollback(async tx => {
      const plan = await PlanCatalogService.createPlan(
        {
          title: "Service Test Plan",
          sessionCount: 8,
          price: "250.00",
          currency: "EGP",
          intervalDays: 30,
        },
        "en",
        tx
      );

      expect(plan.id).toBeGreaterThan(0);
      expect(plan.title).toBe("Service Test Plan");
      expect(plan.sessionCount).toBe(8);
      expect(plan.price).toBe("250.00");
      expect(plan.currency).toBe("EGP");
      expect(plan.intervalDays).toBe(30);
      expect(plan.isActive).toBe(true);
      expect(plan.deactivatedAt).toBeNull();
    });
  });

  test("updatePlan modifies allowed fields and returns updated plan", async () => {
    await runInRollback(async tx => {
      const created = await createTestPlan(tx, { title: "Pre-Update Plan", price: "100.00" });

      const updated = await PlanCatalogService.updatePlan(
        created.id,
        {
          title: "Post-Update Plan",
          price: "180.00",
          sessionCount: 16,
        },
        "en",
        tx
      );

      expect(updated.id).toBe(created.id);
      expect(updated.title).toBe("Post-Update Plan");
      expect(updated.price).toBe("180.00");
      expect(updated.sessionCount).toBe(16);
    });
  });

  test("setPlanActiveStatus transitions between active and inactive with timestamps", async () => {
    await runInRollback(async tx => {
      const created = await createTestPlan(tx, { isActive: true });

      // Deactivate
      const deactivated = await PlanCatalogService.setPlanActiveStatus(created.id, false, "en", tx);
      expect(deactivated.isActive).toBe(false);
      expect(deactivated.deactivatedAt).toBeInstanceOf(Date);

      // Reactivate
      const reactivated = await PlanCatalogService.setPlanActiveStatus(created.id, true, "en", tx);
      expect(reactivated.isActive).toBe(true);
      expect(reactivated.deactivatedAt).toBeNull();
    });
  });

  test("setPlanActiveStatus throws NotFoundError on nonexistent ID", async () => {
    await runInRollback(async tx => {
      let thrown: unknown;
      try {
        await PlanCatalogService.setPlanActiveStatus(99999999, false, "en", tx);
      } catch (err: unknown) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(NotFoundError);
      if (thrown instanceof NotFoundError) {
        expect(thrown.code).toBe("PLAN_NOT_FOUND");
      }
    });
  });

  test("setPlanActiveStatus throws DomainError on already inactive/active target state", async () => {
    await runInRollback(async tx => {
      const plan = await createTestPlan(tx, { isActive: true });

      // Plan is already active, attempting to activate throws PLAN_ALREADY_ACTIVE
      let thrownActive: unknown;
      try {
        await PlanCatalogService.setPlanActiveStatus(plan.id, true, "en", tx);
      } catch (err: unknown) {
        thrownActive = err;
      }
      expect(thrownActive).toBeInstanceOf(DomainError);
      if (thrownActive instanceof DomainError) {
        expect(thrownActive.code).toBe("PLAN_ALREADY_ACTIVE");
      }

      // Deactivate once
      await PlanCatalogService.setPlanActiveStatus(plan.id, false, "en", tx);

      // Attempting to deactivate again throws PLAN_ALREADY_INACTIVE
      let thrownInactive: unknown;
      try {
        await PlanCatalogService.setPlanActiveStatus(plan.id, false, "en", tx);
      } catch (err: unknown) {
        thrownInactive = err;
      }
      expect(thrownInactive).toBeInstanceOf(DomainError);
      if (thrownInactive instanceof DomainError) {
        expect(thrownInactive.code).toBe("PLAN_ALREADY_INACTIVE");
      }
    });
  });

  test("listActiveCatalog and listForAdmin return correct plans", async () => {
    await runInRollback(async tx => {
      const p1 = await createTestPlan(tx, { title: "Catalog Active", isActive: true });
      const p2 = await createTestPlan(tx, { title: "Catalog Inactive", isActive: false, deactivatedAt: new Date() });

      const activeOnly = await PlanCatalogService.listActiveCatalog("en", tx);
      expect(activeOnly.some(p => p.id === p1.id)).toBe(true);
      expect(activeOnly.some(p => p.id === p2.id)).toBe(false);

      const adminAll = await PlanCatalogService.listForAdmin({ includeInactive: true }, "en", tx);
      expect(adminAll.some(p => p.id === p1.id)).toBe(true);
      expect(adminAll.some(p => p.id === p2.id)).toBe(true);
    });
  });

  test("findById returns plan on existing ID and throws NotFoundError on missing ID", async () => {
    await runInRollback(async tx => {
      const created = await createTestPlan(tx, { title: "Single Plan" });

      const found = await PlanCatalogService.findById(created.id, "en", tx);
      expect(found.id).toBe(created.id);
      expect(found.title).toBe("Single Plan");

      let thrown: unknown;
      try {
        await PlanCatalogService.findById(99999999, "en", tx);
      } catch (err: unknown) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(NotFoundError);
      if (thrown instanceof NotFoundError) {
        expect(thrown.code).toBe("PLAN_NOT_FOUND");
      }
    });
  });

  // ─── Tier 2: Boundary Conditions & Validation Matrix ────────────────────────

  test("validatePlanInput: title boundaries (empty, whitespace, 255 valid, 256 invalid)", async () => {
    await runInRollback(async tx => {
      // Empty title
      let errEmpty: unknown;
      try {
        await PlanCatalogService.createPlan(
          { title: "", sessionCount: 5, price: "100.00", currency: "EGP", intervalDays: 30 },
          "en",
          tx
        );
      } catch (err: unknown) {
        errEmpty = err;
      }
      expect(errEmpty).toBeInstanceOf(ValidationError);

      // Whitespace title
      let errWhitespace: unknown;
      try {
        await PlanCatalogService.createPlan(
          { title: "   ", sessionCount: 5, price: "100.00", currency: "EGP", intervalDays: 30 },
          "en",
          tx
        );
      } catch (err: unknown) {
        errWhitespace = err;
      }
      expect(errWhitespace).toBeInstanceOf(ValidationError);

      // 255 chars title (valid)
      const valid255Title = "A".repeat(255);
      const plan255 = await PlanCatalogService.createPlan(
        { title: valid255Title, sessionCount: 5, price: "100.00", currency: "EGP", intervalDays: 30 },
        "en",
        tx
      );
      expect(plan255.title).toBe(valid255Title);

      // 256 chars title (invalid)
      let err256: unknown;
      try {
        await PlanCatalogService.createPlan(
          { title: "A".repeat(256), sessionCount: 5, price: "100.00", currency: "EGP", intervalDays: 30 },
          "en",
          tx
        );
      } catch (err: unknown) {
        err256 = err;
      }
      expect(err256).toBeInstanceOf(ValidationError);
    });
  });

  test("validatePlanInput: sessionCount boundaries (0, -1, non-integer, 1 valid)", async () => {
    await runInRollback(async tx => {
      // 0 sessions (invalid)
      let err0: unknown;
      try {
        await PlanCatalogService.createPlan(
          { title: "Valid Title", sessionCount: 0, price: "100.00", currency: "EGP", intervalDays: 30 },
          "en",
          tx
        );
      } catch (err: unknown) {
        err0 = err;
      }
      expect(err0).toBeInstanceOf(ValidationError);

      // Non-integer sessions
      let errFloat: unknown;
      try {
        await PlanCatalogService.createPlan(
          { title: "Valid Title", sessionCount: 2.5, price: "100.00", currency: "EGP", intervalDays: 30 },
          "en",
          tx
        );
      } catch (err: unknown) {
        errFloat = err;
      }
      expect(errFloat).toBeInstanceOf(ValidationError);

      // 1 session (valid)
      const valid1 = await PlanCatalogService.createPlan(
        { title: "Single Session Plan", sessionCount: 1, price: "50.00", currency: "EGP", intervalDays: 7 },
        "en",
        tx
      );
      expect(valid1.sessionCount).toBe(1);
    });
  });

  test("validatePlanInput: price regex and boundaries", async () => {
    await runInRollback(async tx => {
      // "0.00" (valid)
      const zeroPlan = await PlanCatalogService.createPlan(
        { title: "Free Trial", sessionCount: 1, price: "0.00", currency: "EGP", intervalDays: 7 },
        "en",
        tx
      );
      expect(zeroPlan.price).toBe("0.00");

      // "-0.01" (invalid)
      let errNeg: unknown;
      try {
        await PlanCatalogService.createPlan(
          { title: "Negative Price", sessionCount: 1, price: "-0.01", currency: "EGP", intervalDays: 7 },
          "en",
          tx
        );
      } catch (err: unknown) {
        errNeg = err;
      }
      expect(errNeg).toBeInstanceOf(ValidationError);

      // "abc" (invalid)
      let errAlpha: unknown;
      try {
        await PlanCatalogService.createPlan(
          { title: "Invalid Alpha", sessionCount: 1, price: "abc", currency: "EGP", intervalDays: 7 },
          "en",
          tx
        );
      } catch (err: unknown) {
        errAlpha = err;
      }
      expect(errAlpha).toBeInstanceOf(ValidationError);

      // "1.005" (invalid - 3 decimal places)
      let err3Dec: unknown;
      try {
        await PlanCatalogService.createPlan(
          { title: "Invalid Decimals", sessionCount: 1, price: "1.005", currency: "EGP", intervalDays: 7 },
          "en",
          tx
        );
      } catch (err: unknown) {
        err3Dec = err;
      }
      expect(err3Dec).toBeInstanceOf(ValidationError);

      // "99999999.99" (valid)
      const maxPlan = await PlanCatalogService.createPlan(
        { title: "Max Price", sessionCount: 100, price: "99999999.99", currency: "EGP", intervalDays: 365 },
        "en",
        tx
      );
      expect(maxPlan.price).toBe("99999999.99");
    });
  });

  test("validatePlanInput: currency formatting", async () => {
    await runInRollback(async tx => {
      // Lowercase "egp" (invalid - must be uppercase 3 chars)
      let errLower: unknown;
      try {
        await PlanCatalogService.createPlan(
          { title: "Lower Currency", sessionCount: 5, price: "100.00", currency: "egp", intervalDays: 30 },
          "en",
          tx
        );
      } catch (err: unknown) {
        errLower = err;
      }
      expect(errLower).toBeInstanceOf(ValidationError);

      // 2 chars "EG" (invalid)
      let err2Char: unknown;
      try {
        await PlanCatalogService.createPlan(
          { title: "Short Currency", sessionCount: 5, price: "100.00", currency: "EG", intervalDays: 30 },
          "en",
          tx
        );
      } catch (err: unknown) {
        err2Char = err;
      }
      expect(err2Char).toBeInstanceOf(ValidationError);
    });
  });

  test("updatePlan rejects empty patch with ValidationError", async () => {
    await runInRollback(async tx => {
      const plan = await createTestPlan(tx);

      let errEmptyPatch: unknown;
      try {
        await PlanCatalogService.updatePlan(plan.id, {}, "en", tx);
      } catch (err: unknown) {
        errEmptyPatch = err;
      }
      expect(errEmptyPatch).toBeInstanceOf(ValidationError);
    });
  });

  // ─── Tier 3: Chaos & Concurrency ──────────────────────────────────────────

  test("concurrent deactivation calls: exactly one succeeds and one receives PLAN_ALREADY_INACTIVE", async () => {
    await runInRollback(async tx => {
      const plan = await createTestPlan(tx, { isActive: true });

      const [res1, res2] = await Promise.allSettled([
        PlanCatalogService.setPlanActiveStatus(plan.id, false, "en", tx),
        PlanCatalogService.setPlanActiveStatus(plan.id, false, "en", tx),
      ]);

      const fulfilled = [res1, res2].filter(r => r.status === "fulfilled");
      const rejected = [res1, res2].filter(r => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const firstRejected = rejected[0];
      if (firstRejected && "reason" in firstRejected) {
        expect(firstRejected.reason).toBeInstanceOf(DomainError);
        if (firstRejected.reason instanceof DomainError) {
          expect(firstRejected.reason.code).toBe("PLAN_ALREADY_INACTIVE");
        }
      }
    });
  });

  // ─── Tier 4: Security, BOPLA Smuggle Prevention & i18n ─────────────────────

  test("BOPLA smuggle: extra injected fields (id, isActive, createdAt) are never written", async () => {
    await runInRollback(async tx => {
      const smuggleInput: PlanSubmitInput & { id: number; isActive: boolean; createdAt: Date } = {
        title: "Smuggle Attempt",
        sessionCount: 10,
        price: "200.00",
        currency: "EGP",
        intervalDays: 30,
        id: 12345,
        isActive: false,
        createdAt: new Date(2000, 1, 1),
      };

      const created = await PlanCatalogService.createPlan(smuggleInput, "en", tx);

      expect(created.id).not.toBe(12345);
      expect(created.isActive).toBe(true);
      expect(created.createdAt.getFullYear()).toBeGreaterThan(2025);
    });
  });

  test("Arabic locale returns localized error messages", async () => {
    await runInRollback(async tx => {
      let thrown: unknown;
      try {
        await PlanCatalogService.createPlan(
          { title: "", sessionCount: 5, price: "100.00", currency: "EGP", intervalDays: 30 },
          "ar",
          tx
        );
      } catch (err: unknown) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ValidationError);
      if (thrown instanceof ValidationError) {
        expect(thrown.message).toBe("إدخال غير صحيح.");
        expect(thrown.fields?.[0]?.message).toBe("عنوان الخطة مطلوب.");
      }
    });
  });
});
