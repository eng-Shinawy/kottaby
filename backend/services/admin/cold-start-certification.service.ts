/**
 * ColdStartCertificationService — admin-only direct certification of a
 * teacher-role user, bypassing the applicant evaluation pipeline (cold-start
 * bootstrapping of the founding cohort; see `docs/admin/user-management.md`
 * for the admin-surface contracts this service composes).
 *
 * One call executes ONE transaction whose stages are, in order:
 *  1. Teacher row assembly — the row is either INSERTed directly into the
 *     certified state (`{ isApproved: true, isEvaluator: <makeEvaluator> }`)
 *     or, when an unapproved row already exists, elevated via the guarded
 *     UPDATE. A duplicate-PK (`23505`) on the insert path and a zero-row
 *     RETURNING on the elevate path (proven concurrently-certified by a
 *     re-read) both resolve to the `TEACHER_ALREADY_CERTIFIED` conflict;
 *     no silent no-op is ever returned for the elevation path.
 *  2. Applicants finalization — any existing `applicants` row is moved to
 *     `passed` with its cooldown cleared, in the same statement; an absent
 *     row is tolerated and recorded in the audit details as `"absent"`.
 *  3. Audit — exactly ONE `audit_logs` row via the single canonical writer
 *     (`AuditService.createAuditLog`), action `override`, `entityType`
 *     `"teacher"`, details carrying ONLY the three metadata fields
 *     `{ makeEvaluator, applicantRow, elevation }` (no PII, ever).
 *  4. Notification — ONE `evaluation_result` row emitted in-tx through the
 *     `NotificationEngine` (the engine remains the ONLY writer of
 *     `notifications` rows); the returned receipt is published strictly
 *     AFTER the transaction commits. A mid-stage failure therefore makes
 *     the publish structurally unreachable: zero residual rows, zero pushed
 *     envelopes.
 *  5. Refreshed detail — the return payload is re-read through the existing
 *     `AdminUserManagementService.getUserDetail` (same `tx`) so the caller
 *     observes the just-written certified state; no forked assembler.
 *
 * Disciplines enforced here:
 *  - Actor gate: the FIRST action is the shared admin gate WITH governance
 *    (`assertActorAdminActive`) — anonymous → `UnauthorizedError`,
 *    non-admin or governed admin → `ForbiddenError`, BEFORE any transaction
 *    opens and with ZERO reads past the point of denial.
 *  - Denial ordering is deterministic: actor authentication → actor role →
 *    actor governance → `userId` shape → target existence → target role →
 *    target governance → already-certified state. Every denial is pre-write:
 *    zero row movement, zero audit rows (JR-C-1 parity), zero publishes.
 *  - `actorId` is a parameter (sourced from `ctx.user.id` by the resolver),
 *    NEVER part of the input payload; the input is a closed two-field shape
 *    and every DB payload is built field-by-field (BOPLA).
 *  - Error surface: existing `DomainError` subclasses ONLY (`ValidationError`,
 *    `NotFoundError`, `ConflictError` via its `(code, message)` overload);
 *    the only try/catch in the flow is the cause-checked `23505`
 *    translation on the insert path — everything else rethrows untouched.
 *  - Log hygiene: denials log ONCE each via `logger.logDomainError` with a
 *    bounded `{ code, entity, entityId, locale }` context — never target
 *    email/name, never the audit details payload; the happy path emits
 *    ZERO domain logs (silent-success parity).
 */
import { ApplicantRepository, TeacherRepository, UserRepository } from "@/backend/db/repo";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { toUserRole, UserRole } from "@/backend/enum/users/user-role.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActorAdminActive } from "@/backend/services/admin/admin-gate.helpers";
import { AuditService } from "@/backend/services/admin/audit.service";
import { isPositiveSafeInteger } from "@/backend/services/admin/user-management.helpers";
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import { NotificationEngine, type NotificationEngineCallOptions } from "@/backend/services/notifications";
import { isUniqueViolation } from "@/backend/services/shared";
import type {
  AdminUserDetailReturnType,
  DBTransaction,
  NotificationDeliveryReceipt,
  NotificationReturnType,
  TeacherColdStartCertificationInput,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Entity label passed to `NotFoundError` — yields code `USER_NOT_FOUND`. */
const USER_ENTITY = "USER";

/** Shared bounded log context builder — ids + code + locale only, never PII. */
function logCertificationDenial(code: string, entityId: number, locale: string): void {
  logger.logDomainError(`Cold-start certification denied: ${code}`, {
    code,
    entity: "user",
    entityId,
    locale,
  });
}

/**
 * Narrows the engine's `emitForUser` union to its receipt member. Emits
 * performed inside a caller-supplied transaction (the only branch this
 * service ever exercises) always return the persist-first receipt; the bare
 * notification row is returned only by the engine's self-committing branch.
 * The guard keeps the narrowing honest instead of relying on a cast.
 */
function asDeliveryReceipt(result: NotificationReturnType | NotificationDeliveryReceipt): NotificationDeliveryReceipt {
  if ("notifications" in result) {
    return result;
  }
  throw new Error("ColdStartCertificationService: in-transaction emit returned a bare row instead of a receipt");
}

/**
 * Assembles (or elevates) the certified `teacher` row for the target inside
 * the caller's transaction and reports which pathway committed. The raw
 * `23505` surfaces from the repository layer are translated here — and only
 * the `23505` branch is translated; any other failure rethrows untouched.
 */
async function certifyTeacherRow(
  userId: number,
  makeEvaluator: boolean,
  alreadyCertifiedMessage: string,
  locale: string,
  tx: DBTransaction
): Promise<"created" | "elevated"> {
  const existing = await TeacherRepository.findById(userId, tx);

  if (existing === null) {
    try {
      await TeacherRepository.insertColdStartCertified(userId, makeEvaluator, tx);
      return "created";
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // A concurrent certifier inserted the row between our existence read
      // and this insert — PK unique violation is the authoritative signal.
      logCertificationDenial("TEACHER_ALREADY_CERTIFIED", userId, locale);
      throw new ConflictError("TEACHER_ALREADY_CERTIFIED", alreadyCertifiedMessage, {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  if (existing.isApproved) {
    logCertificationDenial("TEACHER_ALREADY_CERTIFIED", userId, locale);
    throw new ConflictError("TEACHER_ALREADY_CERTIFIED", alreadyCertifiedMessage);
  }

  const elevated = await TeacherRepository.elevateToCertified(userId, makeEvaluator, tx);
  if (elevated !== null) {
    return "elevated";
  }

  // Zero-row RETURNING — disambiguate via a cold-path re-read: an approved
  // row means a concurrent certifier won the guarded-UPDATE race; anything
  // else is an internal inconsistency and must not masquerade as a conflict.
  const reRead = await TeacherRepository.findById(userId, tx);
  if (reRead?.isApproved === true) {
    logCertificationDenial("TEACHER_ALREADY_CERTIFIED", userId, locale);
    throw new ConflictError("TEACHER_ALREADY_CERTIFIED", alreadyCertifiedMessage);
  }
  throw new Error("ColdStartCertificationService: elevation matched zero rows for an unapproved teacher row");
}

export namespace ColdStartCertificationService {
  /**
   * Certifies an existing, non-governed, teacher-role user directly as an
   * approved teacher (cold-start bootstrapping). `makeEvaluator` defaults to
   * `true` when omitted (the founding cohort IS the evaluation committee).
   * Returns the freshly re-read admin detail for the target.
   */
  export async function certifyTeacherColdStart(
    actorId: number,
    input: TeacherColdStartCertificationInput,
    locale: string,
    options?: NotificationEngineCallOptions,
    outerTx?: DBTransaction
  ): Promise<AdminUserDetailReturnType> {
    // Actor gate FIRST — before validation, before any transaction opens.
    await assertActorAdminActive(actorId, locale, outerTx);

    const t = getServerTranslations(locale);
    const tErrors = t.errorsTranslations;

    if (!isPositiveSafeInteger(input.userId)) {
      throw new ValidationError(tErrors.validation);
    }

    const userId = input.userId;
    const makeEvaluator = input.makeEvaluator ?? true;

    const { detail, receipt } = await withTransaction(outerTx, async tx => {
      const target = await UserRepository.findById(userId, tx);
      if (target === null) {
        logCertificationDenial("USER_NOT_FOUND", userId, locale);
        throw new NotFoundError(USER_ENTITY, tErrors.adminUsers.userNotFound);
      }
      if (toUserRole(target.role) !== UserRole.Teacher) {
        logCertificationDenial("TEACHER_ROLE_REQUIRED", userId, locale);
        throw new ConflictError("TEACHER_ROLE_REQUIRED", tErrors.teacherRoleRequired);
      }
      if (target.isDeleted || target.isBlocked || target.suspended) {
        logCertificationDenial("TEACHER_ACCOUNT_GOVERNED", userId, locale);
        throw new ConflictError("TEACHER_ACCOUNT_GOVERNED", tErrors.teacherAccountGoverned);
      }

      const elevation = await certifyTeacherRow(userId, makeEvaluator, tErrors.teacherAlreadyCertified, locale, tx);

      const applicantFinalized = await ApplicantRepository.finalizeOnCertification(userId, tx);

      await AuditService.createAuditLog(
        {
          actorId,
          actionType: AuditActionType.Override,
          entityType: "teacher",
          entityId: userId,
          details: JSON.stringify({
            makeEvaluator,
            applicantRow: applicantFinalized ? "finalized" : "absent",
            elevation,
          }),
        },
        tx
      );

      const emitResult = await NotificationEngine.emitForUser(
        {
          userId,
          type: NotificationType.EvaluationResult,
          title: t.applicantTranslations.coldStartCertifiedTitle,
          body: t.applicantTranslations.coldStartCertifiedBody,
          relatedEntityType: "teacher",
          relatedEntityId: userId,
        },
        locale,
        tx,
        options
      );

      const refreshedDetail = await AdminUserManagementService.getUserDetail(userId, locale, actorId, tx);
      return { detail: refreshedDetail, receipt: asDeliveryReceipt(emitResult) };
    });

    // Publish strictly AFTER the commit — reachable only once the
    // transaction above has resolved; a throw anywhere inside leaves the
    // receipt unpushed and zero residual rows.
    await NotificationEngine.publishReceipts([receipt], locale, options);

    return detail;
  }
}
