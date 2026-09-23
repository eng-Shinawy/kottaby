/**
 * LessonService — domain service for curriculum lesson management.
 *
 * Implements business rules, admin gating, and concurrency-guarded writes
 * for the `lessons` table. Field-level input validation lives in the
 * sibling `lesson.helpers.ts` module.
 *
 * Forward-only lifecycle guarantee:
 * Deleting a lesson does NOT cascade to `progress` rows (the FK's
 * ON DELETE SET NULL contract preserves them as historical records). This
 * file contains ZERO writes to `progress` or `plans` — the only tables
 * touched are `lessons` and `audit_logs`.
 *
 * Catalog mutations are admin-gated: the acting admin's id is a required
 * parameter that is re-asserted against the `users` table before any
 * validation or write runs, and every successful mutation appends exactly
 * one audit row inside the caller's transaction (the row shares the
 * mutation's commit/rollback fate). Plan existence is verified BEFORE any
 * write via `PlanRepository.findById` — a non-existent plan rejects with
 * the planId field error (the ticket's 422).
 */

import { LessonRepository, PlanRepository } from "@/backend/db/repo";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActorAdmin } from "@/backend/services/admin/admin-gate.helpers";
import { AuditService } from "@/backend/services/admin/audit.service";
import {
  buildLessonAuditContract,
  buildPlanIdFieldError,
  toLessonWriteDomainError,
  validateAndExtractLessonPatch,
  validateLessonInput,
} from "@/backend/services/classes/lesson.helpers";
import type {
  DBTransaction,
  LessonInsertType,
  LessonReturnType,
  LessonSubmitInput,
  LessonUpdateInput,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * Shared mutation prelude for the admin lesson surface: resolves the
 * request locale, re-asserts that the acting actor id belongs to a real
 * admin-role user BEFORE any validation or write runs, and returns the
 * resolved error translations for the localized domain messages.
 */
async function assertLessonMutationActor(
  actorId: number,
  locale: string | undefined,
  tx?: DBTransaction
): Promise<ErrorsLabels> {
  const resolvedLocale = locale ?? "en";
  await assertActorAdmin(actorId, resolvedLocale, tx);
  return getServerTranslations(resolvedLocale).errorsTranslations;
}

/**
 * Verifies the lesson's plan reference resolves to a real `plans` row
 * BEFORE any write runs — a non-existent plan rejects with the planId
 * field error (`LESSON_PLAN_NOT_FOUND`, the ticket's 422). Any active
 * state is accepted: deactivation does not strand curriculum editing.
 */
async function assertPlanExistsForLesson(planId: number, tErrors: ErrorsLabels, tx?: DBTransaction): Promise<void> {
  const plan = await PlanRepository.findById(planId, tx);
  if (plan) return;
  throw new ValidationError(tErrors.validation, [buildPlanIdFieldError(tErrors)]);
}

export namespace LessonService {
  /**
   * Coerces a GraphQL `ID` argument into a lesson id using STRICT numeric
   * parsing. Unlike `Number.parseInt`, `Number()` rejects trailing
   * garbage (`"12abc"` -> NaN) so a malformed id can never silently address an
   * unrelated lesson row; any non-integer / non-positive result maps onto the
   * canonical `LESSON_NOT_FOUND` domain error.
   */
  export function coerceLessonId(rawId: string | number, locale?: string): number {
    const tErrors = getServerTranslations(locale ?? "en").errorsTranslations;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id < 1) {
      logger.logDomainError("Lesson id failed strict numeric coercion", {
        code: "LESSON_NOT_FOUND",
        entity: "lesson",
      });
      throw new NotFoundError("LESSON", tErrors.lessonCatalog.lessonNotFound);
    }
    return id;
  }

  /**
   * Creates a new curriculum lesson on an existing plan.
   *
   * Admin-gated before validation — a non-admin actor id is rejected with
   * zero writes. The insert and its audit row (Create, with the persisted
   * lesson's fields as details) share one transaction: a failure on
   * either side rolls back both.
   */
  export async function createLesson(
    input: LessonSubmitInput,
    actorId: number,
    locale?: string,
    tx?: DBTransaction
  ): Promise<LessonReturnType> {
    const tErrors = await assertLessonMutationActor(actorId, locale, tx);
    validateLessonInput(input, tErrors);
    await assertPlanExistsForLesson(input.planId, tErrors, tx);

    const insert: LessonInsertType = {
      planId: input.planId,
      title: input.title.trim(),
    };

    try {
      return await withTransaction(tx, async scopedTx => {
        const created = await LessonRepository.insertLesson(insert, scopedTx);

        await AuditService.createAuditLog(
          buildLessonAuditContract(actorId, AuditActionType.Create, created.id, {
            planId: created.planId,
            title: created.title,
          }),
          scopedTx
        );

        logger.info("Lesson created successfully", { lessonId: created.id });
        return created;
      });
    } catch (error: unknown) {
      throw toLessonWriteDomainError(error, tErrors);
    }
  }

  /**
   * Updates mutable fields on an existing lesson record.
   *
   * Admin-gated before validation. The patch is whitelisted to `title` /
   * `planId` only and built field-by-field (never a spread); a re-assignment
   * to another existing plan is allowed after the plan existence is
   * re-verified. The update and its audit row (Update, with the supplied
   * field names as `changedFields`) share one transaction; a zero-row
   * update classifies as LESSON_NOT_FOUND and mints nothing.
   */
  export async function updateLesson(
    id: number,
    patch: LessonUpdateInput,
    actorId: number,
    locale?: string,
    tx?: DBTransaction
  ): Promise<LessonReturnType> {
    const tErrors = await assertLessonMutationActor(actorId, locale, tx);

    if (Object.keys(patch).length === 0) {
      throw new ValidationError(tErrors.lessonCatalog.lessonPatchEmpty);
    }

    const { updatePatch, fields } = validateAndExtractLessonPatch(patch, tErrors);

    if (fields.length > 0) {
      throw new ValidationError(tErrors.validation, fields);
    }

    if (Object.keys(updatePatch).length === 0) {
      throw new ValidationError(tErrors.lessonCatalog.lessonPatchEmpty);
    }

    if (updatePatch.planId !== undefined) {
      await assertPlanExistsForLesson(updatePatch.planId, tErrors, tx);
    }

    try {
      return await withTransaction(tx, async scopedTx => {
        const updated = await LessonRepository.updateLessonFields(id, updatePatch, scopedTx);
        if (!updated) {
          logger.logDomainError("Lesson not found during update", {
            code: "LESSON_NOT_FOUND",
            entity: "lesson",
            entityId: id,
          });
          throw new NotFoundError("LESSON", tErrors.lessonCatalog.lessonNotFound);
        }

        await AuditService.createAuditLog(
          buildLessonAuditContract(actorId, AuditActionType.Update, id, {
            changedFields: Object.keys(updatePatch),
          }),
          scopedTx
        );

        logger.info("Lesson updated successfully", { lessonId: id });
        return updated;
      });
    } catch (error: unknown) {
      throw toLessonWriteDomainError(error, tErrors);
    }
  }

  /**
   * Deletes a lesson record.
   *
   * Admin-gated before any write. The guarded delete and its audit row
   * (Delete, details snapshotting `{ planId, title }` from the removed
   * row) share one transaction; a zero-row delete classifies as
   * LESSON_NOT_FOUND and mints nothing. Referencing `progress` rows
   * survive with `lesson_id = NULL` — this delete never cascades. The
   * deleted row is returned for Apollo cache eviction.
   */
  export async function deleteLesson(
    id: number,
    actorId: number,
    locale?: string,
    tx?: DBTransaction
  ): Promise<LessonReturnType> {
    const tErrors = await assertLessonMutationActor(actorId, locale, tx);

    try {
      return await withTransaction(tx, async scopedTx => {
        const deleted = await LessonRepository.deleteById(id, scopedTx);
        if (!deleted) {
          logger.logDomainError("Lesson not found during delete", {
            code: "LESSON_NOT_FOUND",
            entity: "lesson",
            entityId: id,
          });
          throw new NotFoundError("LESSON", tErrors.lessonCatalog.lessonNotFound);
        }

        await AuditService.createAuditLog(
          buildLessonAuditContract(actorId, AuditActionType.Delete, id, {
            planId: deleted.planId,
            title: deleted.title,
          }),
          scopedTx
        );

        logger.info("Lesson deleted successfully", { lessonId: id });
        return deleted;
      });
    } catch (error: unknown) {
      throw toLessonWriteDomainError(error, tErrors);
    }
  }

  /**
   * Lists all lessons for one plan in curriculum-sequence order.
   *
   * Read path: NO actor gate (the authenticated GraphQL scope is the
   * gate); delegates to `LessonRepository.listByPlanId`.
   */
  export async function listForPlan(planId: number, _locale?: string, tx?: DBTransaction): Promise<LessonReturnType[]> {
    return LessonRepository.listByPlanId(planId, tx);
  }
}
