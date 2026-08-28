/**
 * PlanCatalogService — business-logic hub for the `plans` subscription
 * catalog domain.
 *
 * Responsibilities:
 *  1. `createPlan` — validates the submitted catalog payload BEFORE any
 *     write, maps it field-by-field onto the insert shape, and delegates the
 *     single INSERT to `PlanRepository.insertPlan`. Lifecycle columns
 *     (`isActive`/`deactivatedAt`) and timestamps are server-owned: a new
 *     plan always enters the catalog active, and no caller input can ever
 *     reach those columns (the explicit mapping is the BOPLA boundary).
 *  2. `updatePlan` — validates every supplied field, whitelists the patch
 *     key-by-key, and delegates to `PlanRepository.updatePlanFields`. Field
 *     edits are forward-only: nothing here touches subscription rows, so
 *     existing purchases keep their original terms.
 *  3. `setPlanActiveStatus` — the ONLY lifecycle state-transition surface.
 *     It delegates to the guarded `setActiveStatusOnce` primitive and maps
 *     the `null` miss through an `existsById` probe: a missing row is a
 *     `PLAN_NOT_FOUND` domain error, a row already in the target state is a
 *     `PLAN_ALREADY_ACTIVE` / `PLAN_ALREADY_INACTIVE` conflict (idempotency
 *     rejects, never silent no-ops).
 *  4. `listActiveCatalog` / `listForAdmin` — read-only catalog shaping over
 *     the repository's single active-visibility predicate: consumers browse
 *     active plans only, admins see every row.
 *
 * Disciplines enforced here:
 *  - Validation is pure and happens before ANY write; one aggregated
 *    `ValidationError` carries the full `{field, code, message}` payload so
 *    forms can surface every offending field at once.
 *  - Database CHECK-violation errors (23514) are translated through the
 *    driver cause chain into the matching localized field error — raw
 *    constraint names and SQL fragments never reach a caller-facing message.
 *  - All user-facing strings resolve through
 *    `getServerTranslations(locale).errorsTranslations`; no hardcoded
 *    messages, and no raw print-style logging.
 *  - Logging: expected domain rejections go through `logger.logDomainError`
 *    with payloads limited to the plan id + code; unexpected database
 *    failures log a static line via `logger.error` and bubble unswallowed to
 *    the GraphQL masking boundary.
 *  - Zero imports of subscription, payment, student, wallet, or teacher
 *    transaction tables — the catalog layer cannot cascade into any
 *    commercial ledger (grep-verifiable).
 */
import { type PlanFieldPatch, PlanRepository } from "@/backend/db/repo";
import { ConflictError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type {
  ApiFieldErrorType,
  DBTransaction,
  PlanInsertType,
  PlanReturnType,
  PlanSelectType,
  PlanSubmitInput,
  PlanUpdateInput,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Entity label passed to `NotFoundError` — the code is auto-generated as
 * `${entity}_NOT_FOUND` → `PLAN_NOT_FOUND` (entity name, NOT the full code).
 */
const PLAN_ENTITY = "PLAN";

/** PostgreSQL `check_violation` SQLSTATE carried by driver errors. */
const PG_CHECK_VIOLATION_CODE = "23514";

/** Maximum accepted plan-title length, enforced after trimming. */
const PLAN_TITLE_MAX_LENGTH = 255;

/** Decimal-string price shape: up to 8 integer digits, at most 2 fraction digits. */
const PLAN_PRICE_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

/** ISO-4217-like uppercase currency code shape. */
const PLAN_CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Localized error-translation slice consumed by this service. */
type PlanErrorTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/**
 * Machine-readable field codes raised by plan validation. Each code's
 * lowercase camelCase form is the matching `errorsTranslations` key.
 */
type PlanFieldErrorCode =
  | "PLAN_TITLE_REQUIRED"
  | "PLAN_TITLE_TOO_LONG"
  | "PLAN_SESSION_COUNT_INVALID"
  | "PLAN_PRICE_INVALID"
  | "PLAN_CURRENCY_INVALID"
  | "PLAN_INTERVAL_DAYS_INVALID";

/** Field-level validation entry before projection onto `ApiFieldErrorType`. */
interface PlanFieldError {
  readonly field: string;
  readonly code: PlanFieldErrorCode;
  readonly message: string;
}

/** Machine code → localized message resolver (camelCase key of the code). */
const PLAN_FIELD_ERROR_MESSAGES: Record<PlanFieldErrorCode, (t: PlanErrorTranslations) => string> = {
  PLAN_TITLE_REQUIRED: t => t.planTitleRequired,
  PLAN_TITLE_TOO_LONG: t => t.planTitleTooLong,
  PLAN_SESSION_COUNT_INVALID: t => t.planSessionCountInvalid,
  PLAN_PRICE_INVALID: t => t.planPriceInvalid,
  PLAN_CURRENCY_INVALID: t => t.planCurrencyInvalid,
  PLAN_INTERVAL_DAYS_INVALID: t => t.planIntervalDaysInvalid,
};

/**
 * Emits one expected domain rejection. Payloads stay limited to the plan id
 * and the machine code — no field values, no messages, no SQL fragments.
 */
function logPlanRejection(code: string, message: string, entityId?: number): void {
  logger.logDomainError(message, {
    code,
    entity: "plans",
    ...(entityId !== undefined ? { entityId } : {}),
  });
}

/**
 * Emits the audit hook seam after a successful catalog mutation. The DEV3-020
 * audit-log integration attaches here (sanctioned deferral D1): this ticket
 * emits the structured transition marker only and performs NO audit_logs
 * writes.
 */
function emitPlanAuditSeam(code: string, planId: number): void {
  logger.info(`Plan catalog transition: ${code}`, { code, entityId: planId });
}

/**
 * Coerces and guards a caller-supplied plan id: only positive integers may
 * reach the repository. Any other shape cannot reference a plan, so it
 * rejects with the localized plan-not-found validation message.
 */
function parsePlanId(id: number, t: PlanErrorTranslations): number {
  if (!Number.isInteger(id) || id <= 0) {
    logPlanRejection("PLAN_ID_INVALID", "Plan mutation rejected: id is not a positive integer", id);
    throw new ValidationError(t.planNotFound);
  }
  return id;
}

/**
 * Judges the plan title against its validation rule. With `requireAll` the
 * caller asserts a full creation payload, so an absent title is itself a
 * violation; without it, an absent title is simply not supplied. Returns
 * `null` when the title is acceptable or not supplied.
 */
function titlePlanFieldError(
  value: string | undefined,
  requireAll: boolean,
  t: PlanErrorTranslations
): PlanFieldError | null {
  if (value === undefined && !requireAll) {
    return null;
  }
  const title = value?.trim() ?? "";
  if (title.length === 0) {
    return { field: "title", code: "PLAN_TITLE_REQUIRED", message: t.planTitleRequired };
  }
  if (title.length > PLAN_TITLE_MAX_LENGTH) {
    return { field: "title", code: "PLAN_TITLE_TOO_LONG", message: t.planTitleTooLong };
  }
  return null;
}

/**
 * Judges one positive-integer plan value (`sessionCount` / `intervalDays`)
 * under the same requireAll contract as the title judge.
 */
function countPlanFieldError(
  field: "sessionCount" | "intervalDays",
  value: number | undefined,
  requireAll: boolean,
  code: PlanFieldErrorCode,
  message: string
): PlanFieldError | null {
  if (value === undefined && !requireAll) {
    return null;
  }
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    return { field, code, message };
  }
  return null;
}

/**
 * Judges one pattern-shaped plan value (`price` / `currency`) under the
 * same requireAll contract as the title judge.
 */
function patternPlanFieldError(
  field: "price" | "currency",
  value: string | undefined,
  pattern: RegExp,
  requireAll: boolean,
  code: PlanFieldErrorCode,
  message: string
): PlanFieldError | null {
  if (value === undefined && !requireAll) {
    return null;
  }
  if (value === undefined || !pattern.test(value)) {
    return { field, code, message };
  }
  return null;
}

/**
 * Pure collector: walks the submitted (or patched) plan values in field
 * order and returns one entry per offending field. With `requireAll` the
 * caller asserts a full creation payload (absent fields are violations);
 * without it, only fields actually supplied are judged — the
 * partial-update contract.
 */
function collectPlanFieldErrors(
  values: PlanUpdateInput,
  requireAll: boolean,
  t: PlanErrorTranslations
): PlanFieldError[] {
  const judged: readonly (PlanFieldError | null)[] = [
    titlePlanFieldError(values.title, requireAll, t),
    countPlanFieldError(
      "sessionCount",
      values.sessionCount,
      requireAll,
      "PLAN_SESSION_COUNT_INVALID",
      t.planSessionCountInvalid
    ),
    patternPlanFieldError(
      "price",
      values.price,
      PLAN_PRICE_PATTERN,
      requireAll,
      "PLAN_PRICE_INVALID",
      t.planPriceInvalid
    ),
    patternPlanFieldError(
      "currency",
      values.currency,
      PLAN_CURRENCY_PATTERN,
      requireAll,
      "PLAN_CURRENCY_INVALID",
      t.planCurrencyInvalid
    ),
    countPlanFieldError(
      "intervalDays",
      values.intervalDays,
      requireAll,
      "PLAN_INTERVAL_DAYS_INVALID",
      t.planIntervalDaysInvalid
    ),
  ];
  return judged.filter((error): error is PlanFieldError => error !== null);
}

/** Projects collected field errors onto the transport field payload. */
function planFieldErrorsToApiFields(fieldErrors: readonly PlanFieldError[]): readonly ApiFieldErrorType[] {
  return fieldErrors.map(error => ({ field: error.field, code: error.code, message: error.message }));
}

/**
 * Throws ONE aggregated `ValidationError` for the collected field-error map:
 * the top-level message is the first offending field's localized message and
 * `extensions.fields[]` carries every `{field, code, message}` entry.
 *
 * @throws ValidationError with code `VALIDATION` when the map is non-empty.
 */
function throwPlanFieldErrors(fieldErrors: readonly PlanFieldError[]): void {
  const [firstFieldError] = fieldErrors;
  if (firstFieldError) {
    throw new ValidationError(firstFieldError.message, planFieldErrorsToApiFields(fieldErrors));
  }
}

/**
 * Module-scope pure validator for a full creation payload: collects the
 * field-error map (every field is required) and throws the aggregated
 * `ValidationError` for the whole map at once.
 *
 * @throws ValidationError with code `VALIDATION` when any field is invalid.
 */
function validatePlanInput(input: PlanSubmitInput, t: PlanErrorTranslations): void {
  throwPlanFieldErrors(collectPlanFieldErrors(input, true, t));
}

/**
 * Copies the caller's patch onto the repository whitelist key-by-key. The
 * explicit conditional mapping is the BOPLA boundary for updates: lifecycle
 * and identity keys are structurally unrepresentable in `PlanFieldPatch`
 * AND skipped at runtime, no matter what the caller's object carries.
 */
function whitelistPlanPatch(patch: PlanUpdateInput): PlanFieldPatch {
  return {
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.sessionCount !== undefined ? { sessionCount: patch.sessionCount } : {}),
    ...(patch.price !== undefined ? { price: patch.price } : {}),
    ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
    ...(patch.intervalDays !== undefined ? { intervalDays: patch.intervalDays } : {}),
  };
}

/**
 * Walks the driver cause chain (Drizzle wraps the raw `pg.Error` in a
 * generic query error) looking for a 23514 check violation, returning the
 * violated constraint's name — or `null` when the error is anything else.
 * Uses `in`-narrowing throughout; no error shape is assumed or cast.
 */
function findCheckViolationConstraint(error: unknown): string | null {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (
      "code" in current &&
      current.code === PG_CHECK_VIOLATION_CODE &&
      "constraint" in current &&
      typeof current.constraint === "string"
    ) {
      return current.constraint;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Maps a violated CHECK constraint onto the matching field error code. The
 * constraint NAME is matched internally only — it never surfaces in any
 * message. An unrecognized constraint means schema drift beyond this
 * service's validation contract; the caller rethrows it untranslated so the
 * masking boundary handles the truly unexpected.
 */
function planCheckViolationCode(constraint: string): PlanFieldErrorCode | null {
  if (constraint.includes("session_count")) {
    return "PLAN_SESSION_COUNT_INVALID";
  }
  if (constraint.includes("price")) {
    return "PLAN_PRICE_INVALID";
  }
  if (constraint.includes("interval_days")) {
    return "PLAN_INTERVAL_DAYS_INVALID";
  }
  return null;
}

/**
 * Catch-path translation for plan persistence: a recognized 23514 check
 * violation becomes the matching localized field `ValidationError`
 * (defense-in-depth for schema/validation drift — the validation layer
 * already mirrors every catalog CHECK). Anything else is logged as
 * unexpected and rethrown untouched so the masking boundary owns it.
 *
 * @returns The error the caller must (re)throw.
 */
function translatePlanPersistenceError(error: unknown, t: PlanErrorTranslations): unknown {
  const constraint = findCheckViolationConstraint(error);
  if (constraint !== null) {
    const code = planCheckViolationCode(constraint);
    if (code !== null) {
      logPlanRejection(code, "Plan rejected by a database check constraint");
      return new ValidationError(code, PLAN_FIELD_ERROR_MESSAGES[code](t));
    }
  }
  logger.error("Plan persistence failed with an unexpected database error");
  return error;
}

export namespace PlanCatalogService {
  /**
   * Creates one plan-catalog row from a fully validated submission.
   *
   * Validation runs BEFORE any write; the insert is mapped field-by-field
   * (never spread), so lifecycle columns and timestamps stay server-owned.
   * Duplicate titles are tolerated by design — a double-submitted create
   * yields two distinct rows (no unique key exists on `plans.title`).
   *
   * @param tx  Optional transaction — propagated verbatim so a caller-owned
   *     atomic flow stays atomic.
   * @returns The persisted plan row, active by construction.
   * @throws ValidationError with code `VALIDATION` carrying the aggregated
   *     field payload when any submitted field is invalid.
   */
  export async function createPlan(
    input: PlanSubmitInput,
    locale: string,
    tx?: DBTransaction
  ): Promise<PlanReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    try {
      validatePlanInput(input, t);
    } catch (error) {
      logPlanRejection("VALIDATION", "Plan create rejected: input failed validation");
      throw error;
    }

    const insert: PlanInsertType = {
      title: input.title.trim(),
      sessionCount: input.sessionCount,
      price: input.price,
      currency: input.currency,
      intervalDays: input.intervalDays,
    };

    let row: PlanSelectType;
    try {
      row = await PlanRepository.insertPlan(insert, tx);
    } catch (error) {
      throw translatePlanPersistenceError(error, t);
    }

    emitPlanAuditSeam("PLAN_CREATED", row.id);
    return row;
  }

  /**
   * Edits the whitelisted commercial fields of one plan.
   *
   * Guard order: id coercion → empty-patch reject → per-field validation of
   * every supplied field → key-by-key whitelisting → single guarded UPDATE.
   * Lifecycle columns can never pass through this surface, and a `null`
   * repository result (zero rows matched) maps to `PLAN_NOT_FOUND`.
   *
   * @throws ValidationError when the id is not a positive integer, the patch
   *     is empty (`planPatchEmpty`), or a supplied field is invalid.
   * @throws NotFoundError with code `PLAN_NOT_FOUND` when the plan is missing.
   */
  export async function updatePlan(
    id: number,
    patch: PlanUpdateInput,
    locale: string,
    tx?: DBTransaction
  ): Promise<PlanReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;
    const planId = parsePlanId(id, t);

    const hasSuppliedFields =
      patch.title !== undefined ||
      patch.sessionCount !== undefined ||
      patch.price !== undefined ||
      patch.currency !== undefined ||
      patch.intervalDays !== undefined;
    if (!hasSuppliedFields) {
      logPlanRejection("PLAN_PATCH_EMPTY", "Plan update rejected: patch carries no fields", planId);
      throw new ValidationError(t.planPatchEmpty);
    }

    const fieldErrors = collectPlanFieldErrors(patch, false, t);
    if (fieldErrors.length > 0) {
      logPlanRejection("VALIDATION", "Plan update rejected: supplied fields failed validation", planId);
      throwPlanFieldErrors(fieldErrors);
    }

    const updated = await PlanRepository.updatePlanFields(planId, whitelistPlanPatch(patch), tx);
    if (!updated) {
      // The UPDATE carries no state guard, so zero rows can only mean the
      // plan does not exist — no further probe needed.
      logPlanRejection("PLAN_NOT_FOUND", "Plan update rejected: plan does not exist", planId);
      throw new NotFoundError(PLAN_ENTITY, t.planNotFound);
    }

    emitPlanAuditSeam("PLAN_UPDATED", updated.id);
    return updated;
  }

  /**
   * Transitions one plan's lifecycle state (activate ↔ deactivate) through
   * the repository's guarded conditional UPDATE — the only state-transition
   * mechanism in the catalog domain.
   *
   * A `null` transition result is disambiguated by the `existsById` probe:
   * a missing row rejects with `PLAN_NOT_FOUND`; a row already in the target
   * state rejects with the matching idempotency conflict.
   *
   * @throws ValidationError when the id is not a positive integer.
   * @throws NotFoundError with code `PLAN_NOT_FOUND` when the plan is missing.
   * @throws ConflictError with code `PLAN_ALREADY_ACTIVE` when activating an
   *     already-active plan, or `PLAN_ALREADY_INACTIVE` when deactivating an
   *     already-inactive plan.
   */
  export async function setPlanActiveStatus(
    id: number,
    isActive: boolean,
    locale: string,
    tx?: DBTransaction
  ): Promise<PlanReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;
    const planId = parsePlanId(id, t);

    const transitioned = await PlanRepository.setActiveStatusOnce(planId, isActive, tx);
    if (!transitioned) {
      const exists = await PlanRepository.existsById(planId, tx);
      if (!exists) {
        logPlanRejection("PLAN_NOT_FOUND", "Plan status change rejected: plan does not exist", planId);
        throw new NotFoundError(PLAN_ENTITY, t.planNotFound);
      }
      const conflictCode = isActive ? "PLAN_ALREADY_ACTIVE" : "PLAN_ALREADY_INACTIVE";
      logPlanRejection(conflictCode, "Plan status change rejected: plan already in target state", planId);
      throw new ConflictError(conflictCode, isActive ? t.planAlreadyActive : t.planAlreadyInactive);
    }

    emitPlanAuditSeam(isActive ? "PLAN_ACTIVATED" : "PLAN_DEACTIVATED", transitioned.id);
    return transitioned;
  }

  /**
   * The consumer-facing catalog: active plans only, oldest first. Visibility
   * filtering happens exclusively inside `PlanRepository.listActive` — this
   * method adds no predicate of its own. The `locale` argument keeps the
   * resolver call contract uniform across the service surface.
   *
   * @returns Every active plan row.
   */
  export async function listActiveCatalog(_locale: string, tx?: DBTransaction): Promise<PlanReturnType[]> {
    return PlanRepository.listActive(tx);
  }

  /**
   * The admin catalog view: every row when `includeInactive` is set,
   * otherwise the same active-only slice consumers see.
   *
   * @returns The requested plan rows, oldest first.
   */
  export async function listForAdmin(
    includeInactive: boolean,
    _locale: string,
    tx?: DBTransaction
  ): Promise<PlanReturnType[]> {
    if (!includeInactive) {
      return PlanRepository.listActive(tx);
    }
    return PlanRepository.listAll(tx);
  }
}
