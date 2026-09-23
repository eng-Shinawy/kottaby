/**
 * Lesson helpers — pure validation, write-error translation, and
 * audit-contract composition for the lesson service (field-by-field input
 * validation, patch projection, and the lesson audit-log write contract).
 *
 * Mirrors `backend/services/billing/plan-catalog.helpers.ts`: consumed
 * directly by the sibling service via the sibling path — helpers stay out
 * of the domain barrel because they are service-internal.
 *
 * Every validator follows the same contract: an absent field (`undefined`)
 * skips validation, a valid value is returned in `value`, and an invalid
 * value is returned as an `ApiFieldErrorType` the caller aggregates into a
 * single localized `ValidationError`. No I/O happens here — the service owns
 * orchestration, persistence, and logging.
 *
 * Disciplines enforced here:
 *  - BOPLA: patch projection is field-by-field (never a spread of transport
 *    input) so server-controlled fields are structurally absent from the
 *    write payload.
 *  - Audit contract: `details` carries lesson field names + primitive values
 *    only — never contact-PII, never credentials.
 */

import type { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { ConflictError, isPgUniqueViolation, ValidationError } from "@/backend/lib/errors";
import type { ApiFieldErrorType, AuditLogWriteContract, LessonSubmitInput, LessonUpdateInput } from "@/backend/types";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * The shared cycle-safe `Error.cause` chain walker behind both local
 * translation legs (Drizzle wraps the driver error, so the code lives on a
 * cause). A visited set guarantees a self-referential chain terminates, not
 * spins. The UNIQUE-violation (23505) leg is NOT reimplemented here — it
 * delegates to the shared `isPgUniqueViolation` from `@/backend/lib/errors`
 * so every service-layer translation walks the identical code path.
 */
function pgCauseChainMatches(
  error: unknown,
  matches: (candidate: { code?: unknown; constraint?: unknown }) => boolean
): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && matches(current)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Defensive classifier, kept for parity with the plan-catalog lineage
 * (`plan-catalog.helpers.ts`) and for any future constraint additions:
 * `lessons` carries no CHECK constraint today, so no live write path can
 * surface `23514` — the leg is exercised only by the synthetic error probes
 * in `lesson.service.test.ts`. True when any error on the cause chain
 * carries the `23514` code.
 */
function isPgCheckViolation(error: unknown): boolean {
  return pgCauseChainMatches(error, candidate => candidate.code === "23514");
}

/**
 * The FK-violation (23503) leg of the lesson-write translation — answers
 * true only when a driver error on the cause chain carries BOTH the `23503`
 * code AND the `lessons_plan_id_plans_id_fkey` constraint name. An unrelated
 * foreign-key failure is passthrough, not a planId field error — only a
 * dangling lesson plan reference folds into the SAME `ValidationError` the
 * pre-write existence check throws (defense-in-depth parity, REQ-044).
 */
function isPgLessonPlanForeignViolation(error: unknown): boolean {
  return pgCauseChainMatches(
    error,
    candidate => candidate.code === "23503" && candidate.constraint === LESSON_PLAN_FK_CONSTRAINT
  );
}

/**
 * The `lessons_plan_id_plans_id_fkey` constraint the FK-violation leg maps
 * onto the planId field error — a write whose plan reference is dangling
 * folds into the same planId-field rejection the pre-write existence check
 * throws (REQ-044).
 */
const LESSON_PLAN_FK_CONSTRAINT = "lessons_plan_id_plans_id_fkey";

/**
 * Maps PostgreSQL violations from lesson writes onto their canonical domain
 * errors: uniqueness conflicts (the shared `23505` walker) become
 * `ConflictError`, plan-FK violations (`23503` on the lessons constraint)
 * become a `ValidationError` carrying the planId field error, and
 * check-constraint failures (the local `23514` walker) become
 * `ValidationError`. Any other failure is returned untouched so the caller
 * rethrows it verbatim.
 */
export function toLessonWriteDomainError(error: unknown, tErrors: ErrorsLabels): unknown {
  if (isPgUniqueViolation(error)) {
    return new ConflictError(tErrors.conflict, { cause: error });
  }
  if (isPgLessonPlanForeignViolation(error)) {
    return new ValidationError("VALIDATION", tErrors.validation, { cause: error }, [buildPlanIdFieldError(tErrors)]);
  }
  if (isPgCheckViolation(error)) {
    return new ValidationError("VALIDATION", tErrors.validation, { cause: error });
  }
  return error;
}

/**
 * The planId field error shared by the pre-write existence check (service
 * layer) and the FK-violation fold (this module) — the SAME
 * `ValidationError` payload for both defense-in-depth legs (REQ-044).
 */
export function buildPlanIdFieldError(tErrors: ErrorsLabels): ApiFieldErrorType {
  return {
    field: "planId",
    code: "LESSON_PLAN_NOT_FOUND",
    message: tErrors.lessonCatalog.lessonPlanNotFound,
  };
}

/**
 * The `entity_type` label minted into every lesson audit row.
 */
export const LESSON_AUDIT_ENTITY_TYPE = "lesson";

/**
 * Composes the audit-log write contract for a lesson create / update /
 * delete. The `details` payload carries lesson field names and primitive
 * values only (title, planId, changed-field names) — never contact-PII or
 * credentials. Delete callers snapshot `{ planId, title }` from the removed
 * row BEFORE it disappears. The composed row is persisted by
 * `AuditService.createAuditLog` inside the caller's transaction so it can
 * never outlive a rolled-back mutation.
 */
export function buildLessonAuditContract(
  actorId: number,
  actionType: AuditActionType,
  entityId: number,
  details: Record<string, unknown>
): AuditLogWriteContract {
  return {
    actorId,
    actionType,
    entityType: LESSON_AUDIT_ENTITY_TYPE,
    entityId,
    details: JSON.stringify(details),
  };
}

function validateTitleField(
  title: string | null | undefined,
  tErrors: ErrorsLabels
): { value?: string; error?: ApiFieldErrorType } {
  if (title === undefined) return {};
  const trimmed = (title ?? "").trim();
  if (trimmed.length === 0) {
    return {
      error: {
        field: "title",
        code: "LESSON_TITLE_REQUIRED",
        message: tErrors.lessonCatalog.lessonTitleRequired,
      },
    };
  }
  if (trimmed.length > 255) {
    return {
      error: {
        field: "title",
        code: "LESSON_TITLE_TOO_LONG",
        message: tErrors.lessonCatalog.lessonTitleTooLong,
      },
    };
  }
  return { value: trimmed };
}

function validatePlanIdField(
  planId: number | undefined,
  tErrors: ErrorsLabels
): { value?: number; error?: ApiFieldErrorType } {
  if (planId === undefined) return {};
  if (!Number.isInteger(planId) || planId < 1) {
    return { error: buildPlanIdFieldError(tErrors) };
  }
  return { value: planId };
}

/**
 * Validates lesson submit/create input fields: the title is trimmed
 * non-empty and within the DB `varchar(255)` ceiling, and the planId is an
 * integer ≥ 1 (existence itself is verified against the `plans` table by
 * the service BEFORE any write — this validator only guards the shape).
 */
export function validateLessonInput(input: LessonSubmitInput, tErrors: ErrorsLabels): void {
  const fields: ApiFieldErrorType[] = [];

  const titleResult = validateTitleField(input.title, tErrors);
  if (titleResult.error) fields.push(titleResult.error);

  const planResult = validatePlanIdField(input.planId, tErrors);
  if (planResult.error) fields.push(planResult.error);

  if (fields.length > 0) {
    throw new ValidationError(tErrors.validation, fields);
  }
}

interface ValidatedPatchResult {
  updatePatch: LessonUpdateInput;
  fields: ApiFieldErrorType[];
}

/**
 * Validates and projects supplied patch fields for updating a lesson.
 * Absent fields skip validation and stay out of the patch; a supplied field
 * is validated per the create rules (a re-assignment to another existing
 * plan is allowed — existence itself is verified by the service) and
 * projected into the patch field-by-field (never a spread of transport
 * input).
 */
export function validateAndExtractLessonPatch(patch: LessonUpdateInput, tErrors: ErrorsLabels): ValidatedPatchResult {
  const fields: ApiFieldErrorType[] = [];

  const titleResult = validateTitleField(patch.title, tErrors);
  if (titleResult.error) fields.push(titleResult.error);

  const planResult = validatePlanIdField(patch.planId, tErrors);
  if (planResult.error) fields.push(planResult.error);

  const updatePatch: LessonUpdateInput = {
    ...(titleResult.value !== undefined && { title: titleResult.value }),
    ...(planResult.value !== undefined && { planId: planResult.value }),
  };

  return { updatePatch, fields };
}
