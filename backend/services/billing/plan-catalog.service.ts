/**
 * PlanCatalogService — domain service for plan catalog management.
 *
 * Implements business rules, validation, and concurrency-guarded transitions
 * for subscription plans (REQ-001..REQ-083).
 *
 * Forward-only lifecycle guarantee (REQ-017, REQ-018):
 * Deactivating or modifying a plan does NOT cascade to subscriptions, balances,
 * invoices, or payments. This file contains ZERO imports of student or subscription tables.
 */

import { PlanRepository } from "@/backend/db/repo/billing/plan.repository";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type {
  ApiFieldErrorType,
  DBTransaction,
  PlanInsertType,
  PlanListForAdminOptions,
  PlanReturnType,
  PlanSubmitInput,
  PlanUpdateInput,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

const PRICE_REGEX = /^\d{1,8}(\.\d{1,2})?$/;
const CURRENCY_REGEX = /^[A-Z]{3}$/;

/**
 * Type guard for checking PostgreSQL error codes across the cause chain.
 */
function isPgErrorWithCode(error: unknown, code: string): boolean {
  if (typeof error === "object" && error !== null) {
    if ("code" in error && error.code === code) {
      return true;
    }
    if ("cause" in error) {
      return isPgErrorWithCode(error.cause, code);
    }
  }
  return false;
}

function validateTitleField(
  title: string | undefined,
  tErrors: ErrorsLabels
): { value?: string; error?: ApiFieldErrorType } {
  if (title === undefined) return {};
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return {
      error: {
        field: "title",
        code: "PLAN_TITLE_EMPTY",
        message: tErrors.planCatalog.planTitleRequired,
      },
    };
  }
  if (trimmed.length > 255) {
    return {
      error: {
        field: "title",
        code: "PLAN_TITLE_TOO_LONG",
        message: tErrors.planCatalog.planTitleTooLong,
      },
    };
  }
  return { value: trimmed };
}

function validateSessionCountField(
  count: number | undefined,
  tErrors: ErrorsLabels
): { value?: number; error?: ApiFieldErrorType } {
  if (count === undefined) return {};
  if (!Number.isInteger(count) || count < 1) {
    return {
      error: {
        field: "sessionCount",
        code: "PLAN_SESSION_COUNT_INVALID",
        message: tErrors.planCatalog.planSessionCountInvalid,
      },
    };
  }
  return { value: count };
}

function validatePriceField(
  price: string | undefined,
  tErrors: ErrorsLabels
): { value?: string; error?: ApiFieldErrorType } {
  if (price === undefined) return {};
  const trimmed = price.trim();
  if (!PRICE_REGEX.test(trimmed) || Number.parseFloat(trimmed) < 0) {
    return {
      error: {
        field: "price",
        code: "PLAN_PRICE_INVALID",
        message: tErrors.planCatalog.planPriceInvalid,
      },
    };
  }
  return { value: trimmed };
}

function validateCurrencyField(
  currency: string | undefined,
  tErrors: ErrorsLabels
): { value?: string; error?: ApiFieldErrorType } {
  if (currency === undefined) return {};
  const trimmed = currency.trim();
  if (!CURRENCY_REGEX.test(trimmed)) {
    return {
      error: {
        field: "currency",
        code: "PLAN_CURRENCY_INVALID",
        message: tErrors.planCatalog.planCurrencyInvalid,
      },
    };
  }
  return { value: trimmed.toUpperCase() };
}

function validateIntervalDaysField(
  days: number | undefined,
  tErrors: ErrorsLabels
): { value?: number; error?: ApiFieldErrorType } {
  if (days === undefined) return {};
  if (!Number.isInteger(days) || days < 1) {
    return {
      error: {
        field: "intervalDays",
        code: "PLAN_INTERVAL_DAYS_INVALID",
        message: tErrors.planCatalog.planIntervalDaysInvalid,
      },
    };
  }
  return { value: days };
}

/**
 * Validates plan submit/create input fields.
 */
function validatePlanInput(input: PlanSubmitInput, tErrors: ErrorsLabels): void {
  const fields: ApiFieldErrorType[] = [];

  const titleResult = validateTitleField(input.title, tErrors);
  if (titleResult.error) fields.push(titleResult.error);

  const sessionResult = validateSessionCountField(input.sessionCount, tErrors);
  if (sessionResult.error) fields.push(sessionResult.error);

  const priceResult = validatePriceField(input.price, tErrors);
  if (priceResult.error) fields.push(priceResult.error);

  const currencyResult = validateCurrencyField(input.currency, tErrors);
  if (currencyResult.error) fields.push(currencyResult.error);

  const intervalResult = validateIntervalDaysField(input.intervalDays, tErrors);
  if (intervalResult.error) fields.push(intervalResult.error);

  if (fields.length > 0) {
    throw new ValidationError(tErrors.validation, fields);
  }
}

interface ValidatedPatchResult {
  updatePatch: PlanUpdateInput;
  fields: ApiFieldErrorType[];
}

/**
 * Validates and projects supplied patch fields for updating a plan.
 */
function validateAndExtractPlanPatch(patch: PlanUpdateInput, tErrors: ErrorsLabels): ValidatedPatchResult {
  const fields: ApiFieldErrorType[] = [];

  const titleResult = validateTitleField(patch.title, tErrors);
  if (titleResult.error) fields.push(titleResult.error);

  const sessionResult = validateSessionCountField(patch.sessionCount, tErrors);
  if (sessionResult.error) fields.push(sessionResult.error);

  const priceResult = validatePriceField(patch.price, tErrors);
  if (priceResult.error) fields.push(priceResult.error);

  const currencyResult = validateCurrencyField(patch.currency, tErrors);
  if (currencyResult.error) fields.push(currencyResult.error);

  const intervalResult = validateIntervalDaysField(patch.intervalDays, tErrors);
  if (intervalResult.error) fields.push(intervalResult.error);

  const updatePatch: PlanUpdateInput = {
    ...(titleResult.value !== undefined && { title: titleResult.value }),
    ...(sessionResult.value !== undefined && { sessionCount: sessionResult.value }),
    ...(priceResult.value !== undefined && { price: priceResult.value }),
    ...(currencyResult.value !== undefined && { currency: currencyResult.value }),
    ...(intervalResult.value !== undefined && { intervalDays: intervalResult.value }),
  };

  return { updatePatch, fields };
}

export namespace PlanCatalogService {
  /**
   * Coerces a GraphQL `ID` argument into a plan id using STRICT numeric
   * parsing (REQ-032). Unlike `Number.parseInt`, `Number()` rejects trailing
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
   */
  export async function createPlan(
    input: PlanSubmitInput,
    locale?: string,
    tx?: DBTransaction
  ): Promise<PlanReturnType> {
    const tErrors = getServerTranslations(locale ?? "en").errorsTranslations;
    validatePlanInput(input, tErrors);

    const insert: PlanInsertType = {
      title: input.title.trim(),
      sessionCount: input.sessionCount,
      price: input.price.trim(),
      currency: input.currency.trim().toUpperCase(),
      intervalDays: input.intervalDays,
    };

    try {
      const created = await PlanRepository.insertPlan(insert, tx);
      // DEV3-020 audit hook seam
      logger.info("Plan created successfully", { planId: created.id });
      return created;
    } catch (error: unknown) {
      if (isPgErrorWithCode(error, "23505")) {
        throw new ConflictError(tErrors.conflict, { cause: error });
      }
      if (isPgErrorWithCode(error, "23514")) {
        throw new ValidationError("VALIDATION", tErrors.validation, { cause: error });
      }
      throw error;
    }
  }

  /**
   * Updates mutable fields on an existing plan record.
   */
  export async function updatePlan(
    id: number,
    patch: PlanUpdateInput,
    locale?: string,
    tx?: DBTransaction
  ): Promise<PlanReturnType> {
    const tErrors = getServerTranslations(locale ?? "en").errorsTranslations;

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
      const updated = await PlanRepository.updatePlanFields(id, updatePatch, tx);
      if (!updated) {
        logger.logDomainError("Plan not found during update", {
          code: "PLAN_NOT_FOUND",
          entity: "plans",
          entityId: id,
        });
        throw new NotFoundError("PLAN", tErrors.planCatalog.planNotFound);
      }

      // DEV3-020 audit hook seam
      logger.info("Plan updated successfully", { planId: id });
      return updated;
    } catch (error: unknown) {
      if (isPgErrorWithCode(error, "23505")) {
        throw new ConflictError(tErrors.conflict, { cause: error });
      }
      if (isPgErrorWithCode(error, "23514")) {
        throw new ValidationError("VALIDATION", tErrors.validation, { cause: error });
      }
      throw error;
    }
  }

  /**
   * Activates or deactivates a plan with atomic concurrency guards.
   */
  export async function setPlanActiveStatus(
    id: number,
    isActive: boolean,
    locale?: string,
    tx?: DBTransaction
  ): Promise<PlanReturnType> {
    const tErrors = getServerTranslations(locale ?? "en").errorsTranslations;

    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
      throw new ValidationError(tErrors.badRequest);
    }

    const updated = await PlanRepository.setActiveStatusOnce(id, isActive, tx);
    if (updated) {
      // DEV3-020 audit hook seam
      logger.info("Plan active status changed", { planId: id, isActive });
      return updated;
    }

    // Disambiguate why guarded update returned null
    const exists = await PlanRepository.existsById(id, tx);
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
}
