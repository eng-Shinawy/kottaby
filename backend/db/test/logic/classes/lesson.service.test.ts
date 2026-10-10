/**
 * LessonService logic-tree test suite.
 *
 * Real service + real repository + real `audit_logs` rows inside
 * `runInRollback` — the zero-write denial oracle and the audit-trail
 * atomicity are asserted against actual committed-then-rolled-back rows.
 *
 * Every mutation is attributed to a real admin-role user row (provisioned
 * via `entity-setup.createTestUser`) because the service re-asserts the
 * acting admin against the `users` table before any validation or write
 * runs. `logger.logDomainError` is silenced so test stdout stays compact.
 */

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { LessonRepository } from "@/backend/db/repo";
import { PlanRepository } from "@/backend/db/repo/billing/plan.repository";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { createTestLesson, createTestPlan, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { LESSON_AUDIT_ENTITY_TYPE, toLessonWriteDomainError } from "@/backend/services/classes/lesson.helpers";
import { LessonService } from "@/backend/services/classes/lesson.service";
import type { DBTransaction, LessonSubmitInput, LessonUpdateInput, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;

/** Domain log spy family share this stubbed signature. */
type DomainLogSpy = ReturnType<typeof spyOn>;

/** Silences `logger.logDomainError` so test stdout stays compact. */
function silenceDomainLog(): DomainLogSpy {
  return spyOn(logger, "logDomainError").mockImplementation(() => {});
}

/**
 * Provisions a real admin-role user row for use as the `actorId` of
 * subsequent service calls. Returns the user row.
 */
async function provisionAdminActor(tx: DBTransaction): Promise<UserSelectType> {
  return createTestUser(tx, { role: "admin" });
}

/**
 * Widens an action-type enum member to its raw stored string. Insert-returning
 * rows carry the raw `action_type` value (coercion to the enum is the read
 * service's job), so audit-row lookups compare primitive-to-primitive.
 */
function rawActionType(actionType: AuditActionType): string {
  return actionType;
}

/**
 * Fetches every lesson-entity audit row the supplied actor minted for one
 * entity id. Entity+actor scoping keeps counts immune to concurrent test
 * files committing their own rows against the shared database.
 */
async function fetchLessonAuditRows(tx: DBTransaction, actorId: number, entityId: number) {
  const rows = await tx
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.actorId, actorId),
        eq(auditLogs.entityType, LESSON_AUDIT_ENTITY_TYPE),
        eq(auditLogs.entityId, entityId)
      )
    );
  return rows.map(
    (row): { id: number; actionType: string; entityType: string; entityId: number | null; details: string | null } => ({
      id: row.id,
      actionType: row.actionType,
      entityType: row.entityType,
      entityId: row.entityId,
      details: row.details,
    })
  );
}

/**
 * Counts `audit_logs` rows attributable to a single actor id — the zero-write
 * denial oracle. Global table totals are NOT stable mid-test under parallel
 * bun test file execution, so write-freedom is asserted per-actor: an id this
 * test owns (minted inside the rollback tx) cannot be perturbed by concurrent
 * external churn.
 */
async function countAuditRowsForActor(tx: DBTransaction, actorId: number): Promise<number> {
  const rows = await tx.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.actorId, actorId));
  return rows.length;
}

/**
 * Asserts a thrown error is a `ValidationError` carrying exactly the given
 * field code on `extensions.fields[]` — the per-field 422 oracle.
 */
function assertFieldErrorCode(error: Error, field: string, code: string): void {
  expect(error).toBeInstanceOf(ValidationError);
  if (!(error instanceof ValidationError)) return;
  const fieldError = error.fields?.find(entry => entry.field === field);
  expect(fieldError?.code).toBe(code);
}

/**
 * Reads one key out of an audit row's `details` JSON string. The shape is
 * asserted honestly (a malformed payload fails the test with a clear
 * message) and the value is extracted via `Reflect.get` — never an
 * assertion away from the `any` return of `JSON.parse`.
 */
function auditDetailValue(raw: string | null, key: string): unknown {
  const parsed: unknown = JSON.parse(raw ?? "{}");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("audit details should be a JSON object");
  }
  return Reflect.get(parsed, key);
}

afterEach(() => {
  mock.restore();
});

describe("LessonService", () => {
  // ─── Admin happy paths: row + audit row in ONE transaction ─────────────────

  test("createLesson trims the title, inserts one lesson row, and appends one Create audit row", async () => {
    await runInRollback(async tx => {
      const infoSpy = spyOn(logger, "info").mockImplementation(() => {});
      const domainSpy = silenceDomainLog();
      const admin = await provisionAdminActor(tx);
      const plan = await createTestPlan(tx, {});

      const created = await LessonService.createLesson({ planId: plan.id, title: "  Al-Madd  " }, admin.id, LOCALE, tx);

      expect(created.id).toBeGreaterThan(0);
      expect(created.planId).toBe(plan.id);
      expect(created.title).toBe("Al-Madd");
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.updatedAt).toBeInstanceOf(Date);

      const auditRows = await fetchLessonAuditRows(tx, admin.id, created.id);
      expect(auditRows).toHaveLength(1);
      const auditRow = auditRows[0];
      expect(auditRow?.actionType).toBe(rawActionType(AuditActionType.Create));
      expect(auditRow?.entityType).toBe(LESSON_AUDIT_ENTITY_TYPE);
      if (auditRow) {
        expect(auditDetailValue(auditRow.details, "planId")).toBe(plan.id);
        expect(auditDetailValue(auditRow.details, "title")).toBe("Al-Madd");
      }

      expect(infoSpy.mock.calls.length).toBeGreaterThan(0);
      expect(domainSpy.mock.calls).toHaveLength(0);
    });
  });

  test("updateLesson re-links the plan, updates the title, and appends one Update audit row", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const admin = await provisionAdminActor(tx);
      const planA = await createTestPlan(tx, {});
      const planB = await createTestPlan(tx, {});
      const lesson = await createTestLesson(tx, planA.id, { title: "Before Edit" });

      const updated = await LessonService.updateLesson(
        lesson.id,
        { title: "An-Noon as-Sakinah", planId: planB.id },
        admin.id,
        LOCALE,
        tx
      );

      expect(updated.id).toBe(lesson.id);
      expect(updated.planId).toBe(planB.id);
      expect(updated.title).toBe("An-Noon as-Sakinah");
      expect(updated.createdAt).toEqual(lesson.createdAt);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(lesson.updatedAt.getTime());

      const auditRows = await fetchLessonAuditRows(tx, admin.id, lesson.id);
      expect(auditRows).toHaveLength(1);
      if (auditRows[0]) {
        const changedFields = auditDetailValue(auditRows[0].details, "changedFields");
        expect(Array.isArray(changedFields) && changedFields.includes("title")).toBe(true);
        expect(Array.isArray(changedFields) && changedFields.includes("planId")).toBe(true);
      }
    });
  });

  test("deleteLesson removes the row, snapshots {planId, title} into the audit trail, and returns the deleted row", async () => {
    await runInRollback(async tx => {
      const infoSpy = spyOn(logger, "info").mockImplementation(() => {});
      const domainSpy = silenceDomainLog();
      const admin = await provisionAdminActor(tx);
      const plan = await createTestPlan(tx, {});
      const lesson = await createTestLesson(tx, plan.id, { title: "Al-Qalqalah" });

      const deleted = await LessonService.deleteLesson(lesson.id, admin.id, LOCALE, tx);

      expect(deleted.id).toBe(lesson.id);
      expect(deleted.title).toBe("Al-Qalqalah");
      expect(await LessonRepository.findById(lesson.id, tx)).toBeNull();

      const auditRows = await fetchLessonAuditRows(tx, admin.id, lesson.id);
      expect(auditRows).toHaveLength(1);
      const auditRow = auditRows[0];
      expect(auditRow?.actionType).toBe(rawActionType(AuditActionType.Delete));
      if (auditRow) {
        expect(auditDetailValue(auditRow.details, "planId")).toBe(plan.id);
        expect(auditDetailValue(auditRow.details, "title")).toBe("Al-Qalqalah");
      }

      expect(infoSpy.mock.calls.length).toBeGreaterThan(0);
      expect(domainSpy.mock.calls).toHaveLength(0);
    });
  });

  // ─── Validation matrix: pre-DB 422 semantics, ZERO writes ──────────────────

  test("createLesson rejects an empty (whitespace-only) title with LESSON_TITLE_REQUIRED and zero writes", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const admin = await provisionAdminActor(tx);
      const plan = await createTestPlan(tx, {});

      const error = await expectRepoError(() =>
        LessonService.createLesson({ planId: plan.id, title: "   " }, admin.id, LOCALE, tx)
      );
      assertFieldErrorCode(error, "title", "LESSON_TITLE_REQUIRED");

      expect(await LessonRepository.listByPlanId(plan.id, tx)).toHaveLength(0);
      expect(await countAuditRowsForActor(tx, admin.id)).toBe(0);
    });
  });

  test("updateLesson rejects a 256-character title with LESSON_TITLE_TOO_LONG and zero writes", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const admin = await provisionAdminActor(tx);
      const plan = await createTestPlan(tx, {});
      const lesson = await createTestLesson(tx, plan.id, { title: "Before Edit" });

      const error = await expectRepoError(() =>
        LessonService.updateLesson(lesson.id, { title: "x".repeat(256) }, admin.id, LOCALE, tx)
      );
      assertFieldErrorCode(error, "title", "LESSON_TITLE_TOO_LONG");

      expect((await LessonRepository.findById(lesson.id, tx))?.title).toBe("Before Edit");
      expect(await countAuditRowsForActor(tx, admin.id)).toBe(0);
    });
  });

  test("createLesson rejects a non-existent plan id with LESSON_PLAN_NOT_FOUND on the planId field", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const admin = await provisionAdminActor(tx);
      const plan = await createTestPlan(tx, {});
      const bogusPlanId = 999_999_999;

      const error = await expectRepoError(() =>
        LessonService.createLesson({ planId: bogusPlanId, title: "Orphan Lesson" }, admin.id, LOCALE, tx)
      );
      assertFieldErrorCode(error, "planId", "LESSON_PLAN_NOT_FOUND");

      expect(await PlanRepository.findById(bogusPlanId, tx)).toBeNull();
      expect(await LessonRepository.listByPlanId(plan.id, tx)).toHaveLength(0);
      expect(await countAuditRowsForActor(tx, admin.id)).toBe(0);
    });
  });

  test("createLesson rejects a non-positive plan id with LESSON_PLAN_NOT_FOUND before any read", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const admin = await provisionAdminActor(tx);
      const plan = await createTestPlan(tx, {});

      const error = await expectRepoError(() =>
        LessonService.createLesson({ planId: 0, title: "Bad Plan Reference" }, admin.id, LOCALE, tx)
      );
      assertFieldErrorCode(error, "planId", "LESSON_PLAN_NOT_FOUND");

      expect(await LessonRepository.listByPlanId(plan.id, tx)).toHaveLength(0);
      expect(await countAuditRowsForActor(tx, admin.id)).toBe(0);
    });
  });

  test("updateLesson rejects a structurally empty patch with the localized patch-empty error and ZERO audit rows", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const plan = await createTestPlan(tx, {});
      const lesson = await createTestLesson(tx, plan.id, { title: "Before Edit" });
      silenceDomainLog();

      const error = await expectRepoError(() => LessonService.updateLesson(lesson.id, {}, admin.id, LOCALE, tx));
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(tErrors.lessonCatalog.lessonPatchEmpty);

      expect(await fetchLessonAuditRows(tx, admin.id, lesson.id)).toHaveLength(0);
    });
  });

  test("updateLesson rejects an explicit null title with LESSON_TITLE_REQUIRED and ZERO writes", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const admin = await provisionAdminActor(tx);
      const plan = await createTestPlan(tx, {});
      const lesson = await createTestLesson(tx, plan.id, { title: "Before Edit" });

      // graphql-js preserves explicit nulls — the wire can deliver
      // `title: null` even though the static input type is optional-string.
      const patch: LessonUpdateInput = {};
      Object.defineProperty(patch, "title", {
        value: null,
        enumerable: true,
        writable: true,
        configurable: true,
      });

      const error = await expectRepoError(() => LessonService.updateLesson(lesson.id, patch, admin.id, LOCALE, tx));
      assertFieldErrorCode(error, "title", "LESSON_TITLE_REQUIRED");

      expect((await LessonRepository.findById(lesson.id, tx))?.title).toBe("Before Edit");
      expect(await countAuditRowsForActor(tx, admin.id)).toBe(0);
    });
  });

  test("updateLesson rejects an all-undefined patch with the localized patch-empty error and ZERO writes", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const admin = await provisionAdminActor(tx);
      const plan = await createTestPlan(tx, {});
      const lesson = await createTestLesson(tx, plan.id, { title: "Before Edit" });

      const error = await expectRepoError(() =>
        LessonService.updateLesson(lesson.id, { title: undefined, planId: undefined }, admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(tErrors.lessonCatalog.lessonPatchEmpty);

      expect((await LessonRepository.findById(lesson.id, tx))?.title).toBe("Before Edit");
      expect(await countAuditRowsForActor(tx, admin.id)).toBe(0);
    });
  });

  test("INV-PR3: a wire-shaped planId: null ⇒ LESSON_PLAN_NOT_FOUND (the only plan-membership write surface)", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const admin = await provisionAdminActor(tx);
      const plan = await createTestPlan(tx, {});
      const lesson = await createTestLesson(tx, plan.id, { title: "Before Edit" });

      // graphql-js preserves explicit nulls — the wire can deliver
      // `planId: null` past the static input types. Both write arms fold
      // the null into the SAME planId field error a non-existent id
      // produces (the plan-membership denial payload), so no lesson row
      // can ever be created or re-linked without a real plan reference.
      const createInput: LessonSubmitInput = { planId: plan.id, title: "Wire Null Plan" };
      Object.defineProperty(createInput, "planId", {
        value: null,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      const createError = await expectRepoError(() => LessonService.createLesson(createInput, admin.id, LOCALE, tx));
      assertFieldErrorCode(createError, "planId", "LESSON_PLAN_NOT_FOUND");
      // The plan keeps exactly its one fixture lesson — nothing written.
      expect(await LessonRepository.listByPlanId(plan.id, tx)).toHaveLength(1);

      const patch: LessonUpdateInput = { title: "Wire Null Plan" };
      Object.defineProperty(patch, "planId", {
        value: null,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      const updateError = await expectRepoError(() =>
        LessonService.updateLesson(lesson.id, patch, admin.id, LOCALE, tx)
      );
      assertFieldErrorCode(updateError, "planId", "LESSON_PLAN_NOT_FOUND");

      // Zero-write denial oracle: the stored row is untouched and the
      // actor minted no audit rows.
      const stored = await LessonRepository.findById(lesson.id, tx);
      expect(stored?.title).toBe("Before Edit");
      expect(stored?.planId).toBe(plan.id);
      expect(await countAuditRowsForActor(tx, admin.id)).toBe(0);
    });
  });

  // ─── Not-found: hostile ids via coerceLessonId + zero-row guarded writes ───

  test("coerceLessonId rejects hostile ids with LESSON_NOT_FOUND", async () => {
    await runInRollback(async () => {
      silenceDomainLog();
      const hostileIds: Array<string | number> = [0, -1, Number.NaN, "12abc"];
      const errors = await Promise.all(
        hostileIds.map(rawId => expectRepoError(async () => LessonService.coerceLessonId(rawId, LOCALE)))
      );
      for (const error of errors) {
        expect(error).toBeInstanceOf(NotFoundError);
        if (error instanceof NotFoundError) {
          expect(error.code).toBe("LESSON_NOT_FOUND");
          expect(error.message).toContain(tErrors.lessonCatalog.lessonNotFound);
        }
      }
    });
  });

  test("updateLesson/deleteLesson of an unknown id yield LESSON_NOT_FOUND and mint nothing", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const admin = await provisionAdminActor(tx);
      const unknownId = 999_999_999;

      const updateError = await expectRepoError(() =>
        LessonService.updateLesson(unknownId, { title: "Ghost" }, admin.id, LOCALE, tx)
      );
      expect(updateError).toBeInstanceOf(NotFoundError);
      if (updateError instanceof NotFoundError) {
        expect(updateError.code).toBe("LESSON_NOT_FOUND");
        expect(updateError.message).toContain(tErrors.lessonCatalog.lessonNotFound);
      }

      const deleteError = await expectRepoError(() => LessonService.deleteLesson(unknownId, admin.id, LOCALE, tx));
      expect(deleteError).toBeInstanceOf(NotFoundError);
      if (deleteError instanceof NotFoundError) {
        expect(deleteError.code).toBe("LESSON_NOT_FOUND");
      }

      expect(await countAuditRowsForActor(tx, admin.id)).toBe(0);
    });
  });

  // ─── BFLA denial oracle: non-admin actors get FORBIDDEN with ZERO writes ───

  interface DenialProbe {
    readonly role: "student" | "teacher" | "parent";
  }

  /**
   * Runs the full create/update/delete denial matrix for ONE non-admin role
   * and asserts the zero-write denial oracle: every denial is a
   * `ForbiddenError`, the targeted plan keeps ZERO lesson rows, the stored
   * row survives untouched, the actor mints ZERO audit rows, and every
   * denial logs exactly ONE `logger.logDomainError` (REQ-080).
   */
  async function expectRoleDenied(tx: DBTransaction, probe: DenialProbe, domainSpy: DomainLogSpy): Promise<void> {
    const actor = await createTestUser(tx, { role: probe.role });
    const fixturePlan = await createTestPlan(tx, {});
    const freshPlan = await createTestPlan(tx, {});
    const lesson = await createTestLesson(tx, fixturePlan.id, { title: "Untouched" });

    // Create denial — the fresh plan keeps ZERO lesson rows.
    domainSpy.mockClear();
    const createError = await expectRepoError(() =>
      LessonService.createLesson({ planId: freshPlan.id, title: "Denied Lesson" }, actor.id, LOCALE, tx)
    );
    expect(createError).toBeInstanceOf(ForbiddenError);
    if (createError instanceof ForbiddenError) {
      expect(createError.code).toBe("FORBIDDEN");
    }
    expect(await LessonRepository.listByPlanId(freshPlan.id, tx)).toHaveLength(0);
    expect(await countAuditRowsForActor(tx, actor.id)).toBe(0);
    expect(domainSpy.mock.calls).toHaveLength(1);

    // Update denial — the stored row stays untouched.
    domainSpy.mockClear();
    const updateError = await expectRepoError(() =>
      LessonService.updateLesson(lesson.id, { title: "Hacked" }, actor.id, LOCALE, tx)
    );
    expect(updateError).toBeInstanceOf(ForbiddenError);
    expect(await countAuditRowsForActor(tx, actor.id)).toBe(0);
    expect((await LessonRepository.findById(lesson.id, tx))?.title).toBe("Untouched");
    expect(domainSpy.mock.calls).toHaveLength(1);

    // Delete denial — the row survives.
    domainSpy.mockClear();
    const deleteError = await expectRepoError(() => LessonService.deleteLesson(lesson.id, actor.id, LOCALE, tx));
    expect(deleteError).toBeInstanceOf(ForbiddenError);
    expect(await countAuditRowsForActor(tx, actor.id)).toBe(0);
    expect(await LessonRepository.findById(lesson.id, tx)).not.toBeNull();
    expect(domainSpy.mock.calls).toHaveLength(1);
  }

  test("a student actor is denied with FORBIDDEN, zero lesson rows, and zero audit rows", async () => {
    await runInRollback(async tx => {
      const domainSpy = silenceDomainLog();
      await expectRoleDenied(tx, { role: "student" }, domainSpy);
    });
  });

  test("a teacher actor is denied with FORBIDDEN, zero lesson rows, and zero audit rows", async () => {
    await runInRollback(async tx => {
      const domainSpy = silenceDomainLog();
      await expectRoleDenied(tx, { role: "teacher" }, domainSpy);
    });
  });

  test("a parent actor is denied with FORBIDDEN, zero lesson rows, and zero audit rows", async () => {
    await runInRollback(async tx => {
      const domainSpy = silenceDomainLog();
      await expectRoleDenied(tx, { role: "parent" }, domainSpy);
    });
  });

  // ─── BOPLA smuggling: runtime-injected extras are never written ────────────

  test("BOPLA smuggle: extra injected fields (id, createdAt) are never written", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const admin = await provisionAdminActor(tx);
      const plan = await createTestPlan(tx, {});

      const smuggleInput: LessonSubmitInput & { id: number; createdAt: Date } = {
        planId: plan.id,
        title: "Smuggle Attempt",
        id: 12345,
        createdAt: new Date(2000, 1, 1),
      };

      const created = await LessonService.createLesson(smuggleInput, admin.id, LOCALE, tx);

      expect(created.id).not.toBe(12345);
      expect(created.createdAt.getTime()).toBeGreaterThan(new Date(2000, 1, 1).getTime());
      expect(created.planId).toBe(plan.id);
      expect(created.title).toBe("Smuggle Attempt");
    });
  });

  // ─── Concurrency (REQ-042): the double-delete service oracle ───────────────

  test("concurrent double-delete: exactly one call succeeds and the loser receives LESSON_NOT_FOUND", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const admin = await provisionAdminActor(tx);
      const plan = await createTestPlan(tx, {});
      const lesson = await createTestLesson(tx, plan.id, {});

      const [res1, res2] = await Promise.allSettled([
        LessonService.deleteLesson(lesson.id, admin.id, LOCALE, tx),
        LessonService.deleteLesson(lesson.id, admin.id, LOCALE, tx),
      ]);

      const fulfilled = [res1, res2].filter(r => r.status === "fulfilled");
      const rejected = [res1, res2].filter(r => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const firstRejected = rejected[0];
      if (firstRejected && "reason" in firstRejected) {
        expect(firstRejected.reason).toBeInstanceOf(NotFoundError);
        if (firstRejected.reason instanceof NotFoundError) {
          expect(firstRejected.reason.code).toBe("LESSON_NOT_FOUND");
        }
      }
    });
  });

  // ─── Write-error translation: defense-in-depth legs (REQ-044) ──────────────

  test("toLessonWriteDomainError folds the lesson-plan FK violation into the planId field error", async () => {
    await runInRollback(async () => {
      silenceDomainLog();
      const driverError = Object.assign(
        new Error(
          'insert or update on table "lessons" violates foreign key constraint "lessons_plan_id_plans_id_fkey"'
        ),
        { code: "23503", constraint: "lessons_plan_id_plans_id_fkey" }
      );
      const wrapped = new Error("drizzle wrapped", { cause: driverError });

      const mapped = toLessonWriteDomainError(wrapped, tErrors);
      expect(mapped).toBeInstanceOf(ValidationError);
      if (mapped instanceof ValidationError) {
        const fieldError = mapped.fields?.find(entry => entry.field === "planId");
        expect(fieldError?.code).toBe("LESSON_PLAN_NOT_FOUND");
        expect(fieldError?.message).toBe(tErrors.lessonCatalog.lessonPlanNotFound);
      }
    });
  });

  test("toLessonWriteDomainError translates unique/check violations and passes other failures through", async () => {
    await runInRollback(async () => {
      silenceDomainLog();

      const uniqueDriver = Object.assign(new Error("duplicate key value violates unique constraint"), {
        code: "23505",
      });
      const uniqueMapped = toLessonWriteDomainError(new Error("drizzle wrapped", { cause: uniqueDriver }), tErrors);
      expect(uniqueMapped).toBeInstanceOf(ConflictError);

      const checkDriver = Object.assign(new Error("new row violates check constraint"), { code: "23514" });
      const checkMapped = toLessonWriteDomainError(new Error("drizzle wrapped", { cause: checkDriver }), tErrors);
      expect(checkMapped).toBeInstanceOf(ValidationError);
      if (checkMapped instanceof ValidationError) {
        expect(checkMapped.code).toBe("VALIDATION");
      }

      const passthrough = new Error("some other failure");
      expect(toLessonWriteDomainError(passthrough, tErrors)).toBe(passthrough);
    });
  });

  // ─── Read path: NO actor gate, id-ASC curriculum order ─────────────────────

  test("listForPlan returns the plan's lessons in id-ASC order with no actor gate", async () => {
    await runInRollback(async tx => {
      const plan = await createTestPlan(tx, {});
      const first = await createTestLesson(tx, plan.id, {});
      const second = await createTestLesson(tx, plan.id, {});

      const listed = await LessonService.listForPlan(plan.id, LOCALE, tx);

      expect(listed).toHaveLength(2);
      expect(listed[0]?.id).toBe(first.id);
      expect(listed[1]?.id).toBe(second.id);
    });
  });
});
