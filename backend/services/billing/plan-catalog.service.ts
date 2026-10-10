/**
 * PlanCatalogService — domain service for plan catalog management.
 *
 * Implements business rules, validation, and concurrency-guarded transitions
 * for subscription plans. Field-level input validation lives in the sibling
 * `plan-catalog.helpers.ts` module.
 *
 * Forward-only lifecycle guarantee:
 * Deactivating or modifying a plan does NOT cascade to subscriptions, balances,
 * invoices, or payments. This file contains ZERO imports of student or subscription tables.
 *
 * Catalog mutations are admin-gated: the acting admin's id is a required
 * parameter that is re-asserted against the `users` table before any
 * validation or write runs, and every successful mutation appends exactly
 * one audit row inside the caller's transaction (the row shares the
 * mutation's commit/rollback fate).
 */

import { PlanRepository } from "@/backend/db/repo/billing/plan.repository";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { DomainError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActorAdmin } from "@/backend/services/admin/admin-gate.helpers";
import { AuditService } from "@/backend/services/admin/audit.service";
import {
  buildPlanAuditContract,
  toPlanWriteDomainError,
  validateAndExtractPlanPatch,
  validatePlanInput,
} from "@/backend/services/billing/plan-catalog.helpers";
import type {
  DBQueryExecutor,
  DBTransaction,
  PlanInsertType,
  PlanListForAdminOptions,
  PlanReturnType,
  PlanSubmitInput,
  PlanUpdateInput,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * Shared mutation prelude for the admin catalog surface: resolves the
 * request locale, re-asserts that the acting actor id belongs to a real
 * admin-role user BEFORE any validation or write runs, and returns the
 * resolved error translations for the localized domain messages.
 */
async function assertPlanMutationActor(
  actorId: number,
  locale: string | undefined,
  tx?: DBTransaction
): Promise<ErrorsLabels> {
  const resolvedLocale = locale ?? "en";
  await assertActorAdmin(actorId, resolvedLocale, tx);
  return getServerTranslations(resolvedLocale).errorsTranslations;
}

export namespace PlanCatalogService {
  /**
   * Coerces a GraphQL `ID` argument into a plan id using STRICT numeric
   * parsing. Unlike `Number.parseInt`, `Number()` rejects trailing
   * garbage (`"12abc"` -> NaN) so a malformed id can never silently address an
   * unrelated plan row; any non-integer / non-positive result maps onto the
   * canonical `PLAN_NOT_FOUND` domain error.
   */
  export function coercePlanId(rawId: string | number, locale?: string): number {
    const tErrors = getServerTranslations(locale ?? "en").errorsTranslations;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id < 1) {
      logger.logDomainError("Plan id failed strict numeric coercion", {
        code: "PLAN_NOT_FOUND",
        entity: "plans",
      });
      throw new NotFoundError("PLAN", tErrors.planCatalog.planNotFound);
    }
    return id;
  }

  /**
   * Creates a new subscription plan in the catalog.
   *
   * Admin-gated before validation — a non-admin actor id is rejected with
   * zero writes. The insert and its audit row (Create, with the persisted
   * plan's catalog fields as details) share one transaction: a failure on
   * either side rolls back both.
   */
  export async function createPlan(
    input: PlanSubmitInput,
    actorId: number,
    locale?: string,
    tx?: DBTransaction
  ): Promise<PlanReturnType> {
    const tErrors = await assertPlanMutationActor(actorId, locale, tx);
    validatePlanInput(input, tErrors);

    const insert: PlanInsertType = {
      title: input.title.trim(),
      sessionCount: input.sessionCount,
      price: input.price.trim(),
      currency: input.currency.trim().toUpperCase(),
      intervalDays: input.intervalDays,
      balanceLane: input.balanceLane ?? null,
    };

    try {
      return await withTransaction(tx, async scopedTx => {
        const created = await PlanRepository.insertPlan(insert, scopedTx);

        await AuditService.createAuditLog(
          buildPlanAuditContract(actorId, AuditActionType.Create, created.id, {
            title: created.title,
            sessionCount: created.sessionCount,
            price: created.price,
            currency: created.currency,
            intervalDays: created.intervalDays,
          }),
          scopedTx
        );

        logger.info("Plan created successfully", { planId: created.id });
        return created;
      });
    } catch (error: unknown) {
      throw toPlanWriteDomainError(error, tErrors);
    }
  }

  /**
   * Updates mutable fields on an existing plan record.
   *
   * Admin-gated before validation. The update and its audit row (Update,
   * with the supplied field names as `changedFields`) share one
   * transaction; a zero-row update classifies as PLAN_NOT_FOUND and mints
   * nothing.
   */
  export async function updatePlan(
    id: number,
    patch: PlanUpdateInput,
    actorId: number,
    locale?: string,
    tx?: DBTransaction
  ): Promise<PlanReturnType> {
    const tErrors = await assertPlanMutationActor(actorId, locale, tx);

    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
      throw new ValidationError(tErrors.badRequest);
    }

    if (Object.keys(patch).length === 0) {
      throw new ValidationError(tErrors.planCatalog.planPatchEmpty);
    }

    const { updatePatch, fields } = validateAndExtractPlanPatch(patch, tErrors);

    if (fields.length > 0) {
      throw new ValidationError(tErrors.validation, fields);
    }

    try {
      return await withTransaction(tx, async scopedTx => {
        const updated = await PlanRepository.updatePlanFields(id, updatePatch, scopedTx);
        if (!updated) {
          logger.logDomainError("Plan not found during update", {
            code: "PLAN_NOT_FOUND",
            entity: "plans",
            entityId: id,
          });
          throw new NotFoundError("PLAN", tErrors.planCatalog.planNotFound);
        }

        await AuditService.createAuditLog(
          buildPlanAuditContract(actorId, AuditActionType.Update, id, {
            changedFields: Object.keys(updatePatch),
          }),
          scopedTx
        );

        logger.info("Plan updated successfully", { planId: id });
        return updated;
      });
    } catch (error: unknown) {
      throw toPlanWriteDomainError(error, tErrors);
    }
  }

  /**
   * Activates or deactivates a plan with atomic concurrency guards.
   *
   * Admin-gated before any write. The guarded transition and its audit row
   * (Suspend on deactivation, Reactivate on activation) share one
   * transaction; a zero-row transition classifies via the existence probe
   * into PLAN_NOT_FOUND or the already-in-target-status domain error and
   * mints nothing.
   */
  export async function setPlanActiveStatus(
    id: number,
    isActive: boolean,
    actorId: number,
    locale?: string,
    tx?: DBTransaction
  ): Promise<PlanReturnType> {
    const tErrors = await assertPlanMutationActor(actorId, locale, tx);

    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
      throw new ValidationError(tErrors.badRequest);
    }

    return withTransaction(tx, async scopedTx => {
      const updated = await PlanRepository.setActiveStatusOnce(id, isActive, scopedTx);
      if (updated) {
        await AuditService.createAuditLog(
          buildPlanAuditContract(actorId, isActive ? AuditActionType.Reactivate : AuditActionType.Suspend, id, {
            isActive,
          }),
          scopedTx
        );

        logger.info("Plan active status changed", { planId: id, isActive });
        return updated;
      }

      // Disambiguate why guarded update returned null
      const exists = await PlanRepository.existsById(id, scopedTx);
      if (!exists) {
        logger.logDomainError("Plan not found during status change", {
          code: "PLAN_NOT_FOUND",
          entity: "plans",
          entityId: id,
        });
        throw new NotFoundError("PLAN", tErrors.planCatalog.planNotFound);
      }

      const code = isActive ? "PLAN_ALREADY_ACTIVE" : "PLAN_ALREADY_INACTIVE";
      const message = isActive ? tErrors.planCatalog.planAlreadyActive : tErrors.planCatalog.planAlreadyInactive;

      logger.logDomainError("Plan already in target active status", {
        code,
        entity: "plans",
        entityId: id,
      });
      throw new DomainError(code, message);
    });
  }

  /**
   * Lists active plans for student catalog browsing.
   */
  export async function listActiveCatalog(_locale?: string, tx?: DBTransaction): Promise<PlanReturnType[]> {
    return PlanRepository.listActive(tx);
  }

  /**
   * Lists plans for admin management.
   */
  export async function listForAdmin(
    options: PlanListForAdminOptions = {},
    _locale?: string,
    tx?: DBTransaction
  ): Promise<PlanReturnType[]> {
    return options.includeInactive ? PlanRepository.listAll(tx) : PlanRepository.listActive(tx);
  }

  /**
   * Finds a plan by ID.
   */
  export async function findById(id: number, locale?: string, tx?: DBTransaction): Promise<PlanReturnType> {
    const tErrors = getServerTranslations(locale ?? "en").errorsTranslations;

    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
      throw new ValidationError(tErrors.badRequest);
    }

    const plan = await PlanRepository.findById(id, tx);
    if (!plan) {
      logger.logDomainError("Plan not found", {
        code: "PLAN_NOT_FOUND",
        entity: "plans",
        entityId: id,
      });
      throw new NotFoundError("PLAN", tErrors.planCatalog.planNotFound);
    }
    return plan;
  }

  /**
   * Batch plan lookup keyed by id — the `findById` twin for page-level
   * enrichment. One map entry per DISTINCT requested id, `null` for ids
   * with no stored row (the honest miss, never a thrown denial), duplicate
   * ids collapsed, and results keyed by each row's own `id` (never by input
   * order). NO active predicate is layered here: a deactivated plan still
   * enriches historical subscription rows — callers that need an
   * active-only read keep using the single-row methods, which own their
   * own denial semantics. An empty id list short-circuits to an empty map
   * without touching the database.
   */
  export async function findByIds(
    ids: readonly number[],
    _locale?: string,
    tx?: DBQueryExecutor
  ): Promise<Map<number, PlanReturnType | null>> {
    const distinctIds = [...new Set(ids)];
    const plansById = new Map<number, PlanReturnType | null>(distinctIds.map(id => [id, null]));
    if (distinctIds.length === 0) {
      return plansById;
    }
    for (const plan of await PlanRepository.findByIds(distinctIds, tx)) {
      plansById.set(plan.id, plan);
    }
    return plansById;
  }
}
