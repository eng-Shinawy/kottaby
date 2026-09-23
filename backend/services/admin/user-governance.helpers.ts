/**
 * Governance-mutation pipeline — the shared in-transaction body of the
 * three `AdminUserManagementService` governance mutations
 * (`setUserDeleted` / `setUserSuspended` / `setUserBlocked`).
 *
 * Every mutation composes the same fixed pipeline inside its transaction:
 * the self-guard (`id === actorId` → typed conflict, zero writes), the
 * axis's guarded repo call whose `null` return is disambiguated by the
 * governance ladder (missing row → USER_NOT_FOUND; soft-deleted target →
 * USER_ALREADY_DELETED; axis already in the requested state → the axis's
 * already/not conflict), the in-transaction audit row, and the caller's
 * post-write detail re-read. Extracted here so the three mutations share
 * ONE pipeline — the denial codes, their precedence order, the log
 * attribution, and the audit shape cannot drift apart across the axes.
 *
 * Denial discipline: exactly ONE
 * `logger.logDomainError(message, { code, entity, entityId })` per denial;
 * ZERO audit rows on every denial; the happy path stays SILENT (REQ-053).
 * Log messages stay axis-specific via the caller's log stems — the codes
 * and precedence live here.
 */

import { AdminUserRepository } from "@/backend/db/repo";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActiveActorAdmin, assertActorAdmin } from "@/backend/services/admin/admin-guards.helpers";
import { AuditService } from "@/backend/services/admin/audit.service";
import { buildAuditContract, isPositiveSafeInteger } from "@/backend/services/admin/user-management.helpers";
import type { AdminUserDetailReturnType, DBTransaction } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Entity label passed to `NotFoundError` — yields code `USER_NOT_FOUND`. */
const USER_ENTITY = "USER";

/** The self-guard conflict copy per axis. */
interface SelfGuardCopy {
  /** Conflict code — `USER_SELF_DEACTIVATION_FORBIDDEN` / `..._SUSPENSION_...` / `..._BLOCK_...`. */
  readonly code: string;
  /** Localized conflict message resolved by the caller's translations bundle. */
  readonly message: string;
}

/** The axis conflict copy for the ladder's denials. */
interface AxisConflictCopy {
  /** Conflict code when the axis is ALREADY in the requested state (engage direction). */
  readonly alreadyCode: string;
  /** Localized message when the axis is ALREADY in the requested state. */
  readonly alreadyMessage: string;
  /** Conflict code when the axis is NOT in the requested state (release direction). */
  readonly notCode: string;
  /** Localized message when the axis is NOT in the requested state. */
  readonly notMessage: string;
  /** Localized `USER_NOT_FOUND` message resolved by the caller's translations bundle. */
  readonly notFoundMessage: string;
  /** Localized `USER_ALREADY_DELETED` message (the deleted-target branch is axis-independent). */
  readonly deletedMessage: string;
}

/**
 * Disambiguates a guarded repo call's `null` return. Precedence: a missing
 * row is `USER_NOT_FOUND`; a soft-deleted target is `USER_ALREADY_DELETED`;
 * otherwise the axis is already in the requested state (engage direction)
 * or not in it (release direction) — the axis's already/not conflict.
 * Exactly ONE log line per denial; every path throws (the caller's
 * transaction rolls back with zero writes).
 *
 * The governance-state read rides the caller's transaction — the
 * disambiguation runs INSIDE the mutation's unit, never a bare pool read.
 */
async function classifyNullOrThrow(options: {
  readonly id: number;
  readonly engage: boolean;
  readonly axis: AxisConflictCopy;
  /** The axis-specific log line stem (e.g. "Admin user delete/reactivate"). */
  readonly logStem: string;
  readonly tx: DBTransaction;
}): Promise<never> {
  const { id, engage, axis, logStem, tx } = options;
  const governanceState = await AdminUserRepository.findGovernanceState(id, tx);
  if (governanceState === null) {
    logger.logDomainError(`${logStem}: user not found`, {
      code: "USER_NOT_FOUND",
      entity: "user",
      entityId: id,
    });
    throw new NotFoundError(USER_ENTITY, axis.notFoundMessage);
  }
  if (governanceState.isDeleted === true) {
    logger.logDomainError(`${logStem}: target already deleted`, {
      code: "USER_ALREADY_DELETED",
      entity: "user",
      entityId: id,
    });
    throw new ConflictError("USER_ALREADY_DELETED", axis.deletedMessage);
  }
  const code = engage ? axis.alreadyCode : axis.notCode;
  const message = engage ? axis.alreadyMessage : axis.notMessage;
  logger.logDomainError(logStem, {
    code,
    entity: "user",
    entityId: id,
  });
  throw new ConflictError(code, message);
}

/**
 * The shared in-transaction governance pipeline. The caller owns
 * everything BEFORE the transaction (the actor guard, the id/period
 * validations) and the transaction wrapper itself (`withTransaction`) —
 * this composes the body INSIDE it:
 *
 *  1. the self-guard: `id === actorId` → the axis's typed conflict
 *     (zero writes, zero audit — JR-C-1);
 *  2. the axis's guarded repo call — its `null` return is disambiguated
 *     by the governance ladder (see {@linkcode classifyNullOrThrow});
 *  3. ONE in-transaction audit row (the axis's action type + details);
 *  4. the caller's post-write detail re-read (composition reuse).
 */
async function runGovernanceMutation(options: {
  /** The mutation target's id. */
  readonly id: number;
  /** The acting admin's id (the self-guard compares against the target). */
  readonly actorId: number;
  /** Whether the mutation requests the engaged direction (delete / suspend / block). */
  readonly engage: boolean;
  /** The axis's self-guard conflict copy. */
  readonly self: SelfGuardCopy;
  /** The axis's ladder conflict copy. */
  readonly axis: AxisConflictCopy;
  /** The self-guard log line (e.g. "Admin self-deactivation denied"). */
  readonly selfLogMessage: string;
  /** The axis-specific ladder log line stem (e.g. "Admin user delete/reactivate"). */
  readonly logStem: string;
  /** The axis's guarded repo call (its `null` return enters the ladder). */
  readonly runGuarded: (tx: DBTransaction) => Promise<unknown>;
  /** The audit row shape (action type + zero-PII details). */
  readonly audit: () => { readonly actionType: AuditActionType; readonly details: Record<string, unknown> };
  /** The caller's post-write detail re-read (rides the same transaction). */
  readonly resolveDetail: (tx: DBTransaction) => Promise<AdminUserDetailReturnType>;
  /** The mutation's transaction (the whole pipeline rides it). */
  readonly tx: DBTransaction;
}): Promise<AdminUserDetailReturnType> {
  const { id, actorId, engage, self, axis, selfLogMessage, logStem, runGuarded, audit, resolveDetail, tx } = options;

  // Self-protection FIRST — zero writes, zero audit on denial.
  if (id === actorId) {
    logger.logDomainError(selfLogMessage, {
      code: self.code,
      entity: "user",
      entityId: id,
    });
    throw new ConflictError(self.code, self.message);
  }

  const updated = await runGuarded(tx);
  if (updated === null) {
    await classifyNullOrThrow({ id, engage, axis, logStem, tx });
  }

  const { actionType, details } = audit();
  await AuditService.createAuditLog(buildAuditContract(actorId, actionType, id, details), tx);

  return resolveDetail(tx);
}

/** The suspension window's inclusive bounds (~10 years). */
const SUSPENSION_PERIOD_MIN_DAYS = 1;
const SUSPENSION_PERIOD_MAX_DAYS = 3650;

/**
 * The `setUserDeleted` axis — soft-delete / reactivate via a single
 * guarded UPDATE, over the shared pipeline with the relaxed actor guard
 * (REQ-031).
 */
export async function setDeletedAxis(
  id: number,
  deleted: boolean,
  actorId: number,
  locale: string,
  resolveDetailCallback: (tx: DBTransaction) => Promise<AdminUserDetailReturnType>,
  outerTx?: DBTransaction
): Promise<AdminUserDetailReturnType> {
  await assertActorAdmin(actorId, locale, outerTx);

  const tErrors = getServerTranslations(locale).errorsTranslations;

  if (!isPositiveSafeInteger(id)) {
    throw new ValidationError(tErrors.validation);
  }

  return withTransaction(outerTx, mutationTx =>
    runGovernanceMutation({
      id,
      actorId,
      engage: deleted,
      self: {
        code: "USER_SELF_DEACTIVATION_FORBIDDEN",
        message: tErrors.adminUsers.userSelfDeactivationForbidden,
      },
      axis: {
        alreadyCode: "USER_ALREADY_DELETED",
        alreadyMessage: tErrors.adminUsers.userAlreadyDeleted,
        notCode: "USER_NOT_DELETED",
        notMessage: tErrors.adminUsers.userNotDeleted,
        notFoundMessage: tErrors.adminUsers.userNotFound,
        deletedMessage: tErrors.adminUsers.userAlreadyDeleted,
      },
      selfLogMessage: "Admin self-deactivation denied",
      logStem: "Admin user delete/reactivate",
      runGuarded: guardTx => AdminUserRepository.setDeletedOnce(id, deleted, guardTx),
      audit: () => ({
        actionType: deleted ? AuditActionType.Delete : AuditActionType.Reactivate,
        details: { deleted },
      }),
      resolveDetail: resolveTx => resolveDetailCallback(resolveTx),
      tx: mutationTx,
    })
  );
}

/**
 * The `setUserSuspended` axis — suspend / release via a single guarded
 * UPDATE that also stamps the suspension window, over the shared pipeline
 * with the STRICT actor guard. `periodDays` is validated ONLY on suspend
 * (whole number in `1..3650`, else `ValidationError` naming `periodDays`);
 * release ignores it.
 */
export async function setSuspendedAxis(
  id: number,
  suspended: boolean,
  periodDays: number | null,
  actorId: number,
  locale: string,
  resolveDetailCallback: (tx: DBTransaction) => Promise<AdminUserDetailReturnType>,
  outerTx?: DBTransaction
): Promise<AdminUserDetailReturnType> {
  await assertActiveActorAdmin(actorId, locale, outerTx);

  const tErrors = getServerTranslations(locale).errorsTranslations;

  if (!isPositiveSafeInteger(id)) {
    throw new ValidationError(tErrors.validation);
  }

  if (
    suspended &&
    (periodDays === null ||
      !Number.isInteger(periodDays) ||
      periodDays < SUSPENSION_PERIOD_MIN_DAYS ||
      periodDays > SUSPENSION_PERIOD_MAX_DAYS)
  ) {
    throw new ValidationError("SUSPENSION_PERIOD_INVALID", tErrors.adminUsers.suspensionPeriodInvalid, undefined, [
      { field: "periodDays", code: "SUSPENSION_PERIOD_INVALID", message: tErrors.adminUsers.suspensionPeriodInvalid },
    ]);
  }

  return withTransaction(outerTx, mutationTx =>
    runGovernanceMutation({
      id,
      actorId,
      engage: suspended,
      self: {
        code: "USER_SELF_SUSPENSION_FORBIDDEN",
        message: tErrors.adminUsers.userSelfSuspensionForbidden,
      },
      axis: {
        alreadyCode: "USER_ALREADY_SUSPENDED",
        alreadyMessage: tErrors.adminUsers.userAlreadySuspended,
        notCode: "USER_NOT_SUSPENDED",
        notMessage: tErrors.adminUsers.userNotSuspended,
        notFoundMessage: tErrors.adminUsers.userNotFound,
        deletedMessage: tErrors.adminUsers.userAlreadyDeleted,
      },
      selfLogMessage: "Admin self-suspension denied",
      logStem: "Admin user suspend/reactivate",
      runGuarded: guardTx =>
        AdminUserRepository.setSuspendedOnce(id, suspended, suspended ? periodDays : null, guardTx),
      audit: () => {
        const changedFields = ["suspended", "suspendedAt", "suspendedPeriodDays"];
        return {
          actionType: suspended ? AuditActionType.Suspend : AuditActionType.Reactivate,
          details: suspended
            ? { changedFields, suspended: true, suspendedPeriodDays: periodDays }
            : { changedFields, suspended: false },
        };
      },
      resolveDetail: resolveTx => resolveDetailCallback(resolveTx),
      tx: mutationTx,
    })
  );
}

/**
 * The `setUserBlocked` axis — block / unblock via a single guarded UPDATE
 * that stamps `blocked_at` on the block direction and clears it on the
 * unblock direction (an indefinite administrative deny — no lapse
 * window), over the shared pipeline with the STRICT actor guard.
 */
export async function setBlockedAxis(
  id: number,
  blocked: boolean,
  actorId: number,
  locale: string,
  resolveDetailCallback: (tx: DBTransaction) => Promise<AdminUserDetailReturnType>,
  outerTx?: DBTransaction
): Promise<AdminUserDetailReturnType> {
  await assertActiveActorAdmin(actorId, locale, outerTx);

  const tErrors = getServerTranslations(locale).errorsTranslations;

  if (!isPositiveSafeInteger(id)) {
    throw new ValidationError(tErrors.validation);
  }

  return withTransaction(outerTx, mutationTx =>
    runGovernanceMutation({
      id,
      actorId,
      engage: blocked,
      self: {
        code: "USER_SELF_BLOCK_FORBIDDEN",
        message: tErrors.adminUsers.userSelfBlockForbidden,
      },
      axis: {
        alreadyCode: "USER_ALREADY_BLOCKED",
        alreadyMessage: tErrors.adminUsers.userAlreadyBlocked,
        notCode: "USER_NOT_BLOCKED",
        notMessage: tErrors.adminUsers.userNotBlocked,
        notFoundMessage: tErrors.adminUsers.userNotFound,
        deletedMessage: tErrors.adminUsers.userAlreadyDeleted,
      },
      selfLogMessage: "Admin self-block denied",
      logStem: "Admin user block/unblock",
      runGuarded: guardTx => AdminUserRepository.setBlockedOnce(id, blocked, guardTx),
      audit: () => ({
        actionType: blocked ? AuditActionType.Suspend : AuditActionType.Reactivate,
        details: blocked
          ? { changedFields: ["isBlocked", "blockedAt"], blocked: true }
          : { changedFields: ["isBlocked", "blockedAt"], blocked: false },
      }),
      resolveDetail: resolveTx => resolveDetailCallback(resolveTx),
      tx: mutationTx,
    })
  );
}
