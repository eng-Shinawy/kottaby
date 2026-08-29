/**
 * AuditLogService self-tests — the DEV3-020 Phase 1 audit-trail contract
 * against the live `kottab_test` PostgreSQL instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every case runs inside `runInRollback`; `tx` is passed to EVERY
 *    service/repository/entity-setup call, so nothing commits and the
 *    non-transactional pool path stays unexercised here.
 *  - Entities ONLY via `entity-setup.ts` helpers; boundary values arrive
 *    through deliberate overrides.
 *  - Rejection assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited and appears nowhere.
 *
 * Coverage map:
 *  - Tier 1 (branch/statement): recordAdminAction persists the
 *    actor/action/entity/details tuple inside the caller's transaction;
 *    listAuditTrail returns rows newest-first with the narrow actor summary
 *    embedded + the truthful total; an empty trail reads as an empty page
 *    (total 0), never a shaped guess.
 *  - Tier 2 (boundary/rejects): a details payload exceeding the varchar
 *    bound fails CLOSED (ValidationError — the action must never land with
 *    a truncated record); an action with no optional details serializes the
 *    action code alone.
 *  - Tier 3 (filters/integration): every filter dimension (actorId,
 *    actionType, entityType, entityId) narrows the page; pagination
 *    (limit/offset) slices without dropping the total; the plan-catalog
 *    integration — `PlanCatalogService.createPlan` with an actor writes ONE
 *    audit row with code PLAN_CREATED, and the ACTORLESS seeding path
 *    writes NONE (system acts are unaudited by contract).
 *  - Tier 4 (immutability): an UPDATE and a DELETE against a persisted
 *    audit row are rejected by the database's immutability triggers — the
 *    append-only doctrine holds at the SQL layer, not merely by convention.
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { ValidationError } from "@/backend/lib/errors";
import { AuditLogService } from "@/backend/services/audit/audit-log.service";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";

/** Builds a valid plan-creation payload with a unique title. */
function planSubmitInput() {
  return {
    title: `Audit Plan ${randomUUID().slice(0, 8)}`,
    sessionCount: 8,
    price: "120.00",
    currency: "EGP",
    intervalDays: 30,
  };
}

describe("AuditLogService — recordAdminAction", () => {
  test("persists the action tuple with the action code serialized into details", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });

      const row = await AuditLogService.recordAdminAction(
        {
          actorId: admin.id,
          actionType: "create",
          entityType: "plans",
          entityId: 4242,
          actionCode: "PLAN_CREATED",
          details: { planId: 4242 },
        },
        tx
      );

      expect(row.id).toBeGreaterThan(0);
      expect(row.actorId).toBe(admin.id);
      expect(row.actionType).toBe("create");
      expect(row.entityType).toBe("plans");
      expect(row.entityId).toBe(4242);
      expect(row.details).not.toBeNull();
      const parsed: unknown = JSON.parse(row.details ?? "{}");
      expect((parsed as { code?: string }).code).toBe("PLAN_CREATED");
      expect((parsed as { planId?: number }).planId).toBe(4242);
      expect(row.createdAt).toBeInstanceOf(Date);
    });
  });

  test("an action with no optional details serializes the action code alone", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await AuditLogService.recordAdminAction(
        {
          actorId: admin.id,
          actionType: "update",
          entityType: "subscriptions",
          entityId: 7,
          actionCode: "SUBSCRIPTION_PAYMENT_VERIFIED",
        },
        tx
      );
      const parsed: unknown = JSON.parse(row.details ?? "null");
      expect((parsed as { code?: string }).code).toBe("SUBSCRIPTION_PAYMENT_VERIFIED");
      expect(Object.keys(parsed as object)).toEqual(["code"]);
    });
  });

  test("an oversized details payload fails CLOSED — the write rejects", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const oversized = "x".repeat(2100);
      const error = await expectRepoError(() =>
        AuditLogService.recordAdminAction(
          {
            actorId: admin.id,
            actionType: "create",
            entityType: "plans",
            entityId: 1,
            actionCode: "PLAN_CREATED",
            details: { planId: 1, note: oversized },
          },
          tx
        )
      );
      expect(error).toBeInstanceOf(ValidationError);
    });
  });
});

describe("AuditLogService — listAuditTrail", () => {
  test("an empty trail reads as an empty page with total 0", async () => {
    await runInRollback(async tx => {
      const page = await AuditLogService.listAuditTrail({ limit: 20, offset: 0 }, tx);
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
      expect(page.limit).toBe(20);
      expect(page.offset).toBe(0);
    });
  });

  test("returns rows newest-first with the narrow actor summary embedded and the truthful total", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      await AuditLogService.recordAdminAction(
        { actorId: admin.id, actionType: "create", entityType: "plans", entityId: 1, actionCode: "PLAN_CREATED" },
        tx
      );
      await AuditLogService.recordAdminAction(
        { actorId: admin.id, actionType: "update", entityType: "plans", entityId: 1, actionCode: "PLAN_UPDATED" },
        tx
      );

      const page = await AuditLogService.listAuditTrail({ limit: 10, offset: 0 }, tx);
      expect(page.total).toBe(2);
      expect(page.items).toHaveLength(2);
      // Newest first — the UPDATE (written second) leads.
      expect(page.items[0]?.actionType).toBe("update");
      expect(page.items[1]?.actionType).toBe("create");
      // The narrow actor summary rides every row.
      const actor = page.items[0]?.actor;
      expect(actor?.id).toBe(admin.id);
      expect(actor?.email).toBe(admin.email);
      expect(actor?.fullName).toBe(admin.fullName);
    });
  });

  test("every filter dimension narrows the page", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const other = await createTestUser(tx, { role: "admin" });
      await AuditLogService.recordAdminAction(
        { actorId: admin.id, actionType: "create", entityType: "plans", entityId: 11, actionCode: "PLAN_CREATED" },
        tx
      );
      await AuditLogService.recordAdminAction(
        {
          actorId: other.id,
          actionType: "update",
          entityType: "subscriptions",
          entityId: 22,
          actionCode: "SUBSCRIPTION_PAYMENT_VERIFIED",
        },
        tx
      );

      const byActor = await AuditLogService.listAuditTrail({ actorId: admin.id, limit: 10, offset: 0 }, tx);
      expect(byActor.total).toBe(1);
      expect(byActor.items[0]?.entityId).toBe(11);

      const byAction = await AuditLogService.listAuditTrail({ actionType: "update", limit: 10, offset: 0 }, tx);
      expect(byAction.total).toBe(1);
      expect(byAction.items[0]?.actor.id).toBe(other.id);

      const byEntity = await AuditLogService.listAuditTrail({ entityType: "subscriptions", limit: 10, offset: 0 }, tx);
      expect(byEntity.total).toBe(1);
      expect(byEntity.items[0]?.entityId).toBe(22);

      const byEntityId = await AuditLogService.listAuditTrail({ entityId: 22, limit: 10, offset: 0 }, tx);
      expect(byEntityId.total).toBe(1);

      const byNone = await AuditLogService.listAuditTrail({ limit: 10, offset: 0 }, tx);
      expect(byNone.total).toBe(2);
    });
  });

  test("pagination slices the page while the total stays the window-independent count", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      for (let index = 0; index < 3; index += 1) {
        await AuditLogService.recordAdminAction(
          { actorId: admin.id, actionType: "create", entityType: "plans", entityId: index, actionCode: "PLAN_CREATED" },
          tx
        );
      }
      const firstPage = await AuditLogService.listAuditTrail({ limit: 2, offset: 0 }, tx);
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.total).toBe(3);
      const secondPage = await AuditLogService.listAuditTrail({ limit: 2, offset: 2 }, tx);
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.total).toBe(3);
    });
  });
});

describe("DEV3-020 integration — the billing surfaces write the trail", () => {
  test("createPlan WITH an actor writes exactly one PLAN_CREATED audit row in the same transaction", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const plan = await PlanCatalogService.createPlan(planSubmitInput(), "en", admin.id, tx);

      const page = await AuditLogService.listAuditTrail({ actorId: admin.id, limit: 10, offset: 0 }, tx);
      expect(page.total).toBe(1);
      const entry = page.items[0];
      expect(entry?.actionType).toBe("create");
      expect(entry?.entityType).toBe("plans");
      expect(entry?.entityId).toBe(plan.id);
      const parsed: unknown = JSON.parse(entry?.details ?? "{}");
      expect((parsed as { code?: string }).code).toBe("PLAN_CREATED");
    });
  });

  test("the ACTORLESS (seeding) path writes NO audit row", async () => {
    await runInRollback(async tx => {
      await PlanCatalogService.createPlan(planSubmitInput(), "en", undefined, tx);
      const page = await AuditLogService.listAuditTrail({ limit: 10, offset: 0 }, tx);
      expect(page.total).toBe(0);
    });
  });

  test("updatePlan's audit details name the changed FIELDS — never values", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const plan = await PlanCatalogService.createPlan(planSubmitInput(), "en", admin.id, tx);
      await PlanCatalogService.updatePlan(plan.id, { price: "199.99", sessionCount: 12 }, "en", admin.id, tx);

      const page = await AuditLogService.listAuditTrail({ actorId: admin.id, limit: 10, offset: 0 }, tx);
      expect(page.total).toBe(2);
      const updateEntry = page.items[0];
      const parsed: unknown = JSON.parse(updateEntry?.details ?? "{}");
      expect((parsed as { fields?: string[] }).fields).toEqual(["sessionCount", "price"]);
      // The raw values must NOT ride the trail (privacy posture).
      expect(updateEntry?.details?.includes("199.99")).toBeFalse();
    });
  });

  test("setPlanActiveStatus records the transition code (PLAN_ACTIVATED / PLAN_DEACTIVATED)", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const plan = await PlanCatalogService.createPlan(planSubmitInput(), "en", admin.id, tx);
      await PlanCatalogService.setPlanActiveStatus(plan.id, false, "en", admin.id, tx);
      await PlanCatalogService.setPlanActiveStatus(plan.id, true, "en", admin.id, tx);

      const page = await AuditLogService.listAuditTrail({ actorId: admin.id, limit: 10, offset: 0 }, tx);
      const codes = page.items.map(entry => {
        const parsed: unknown = JSON.parse(entry.details ?? "{}");
        return (parsed as { code?: string }).code;
      });
      expect(codes).toContain("PLAN_DEACTIVATED");
      expect(codes).toContain("PLAN_ACTIVATED");
    });
  });
});

describe("Immutability — the append-only doctrine holds at the SQL layer", () => {
  test("an UPDATE against a persisted audit row is rejected by the immutability trigger", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await AuditLogService.recordAdminAction(
        { actorId: admin.id, actionType: "create", entityType: "plans", entityId: 1, actionCode: "PLAN_CREATED" },
        tx
      );
      await expectRepoError(() =>
        tx.update(auditLogs).set({ details: '{"code":"TAMPERED"}' }).where(eq(auditLogs.id, row.id))
      );
    });
  });

  test("a DELETE against a persisted audit row is rejected by the immutability trigger", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await AuditLogService.recordAdminAction(
        { actorId: admin.id, actionType: "create", entityType: "plans", entityId: 1, actionCode: "PLAN_CREATED" },
        tx
      );
      await expectRepoError(() => tx.delete(auditLogs).where(eq(auditLogs.id, row.id)));
    });
  });
});
