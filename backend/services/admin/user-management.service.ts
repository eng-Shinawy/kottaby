/**
 * AdminUserManagementService — business-logic hub for the admin user-management
 * surface (Workflow 05 identity-and-governance core).
 *
 * The service orchestrates seven operations against the `users` directory:
 *  - `listDirectory` — paginated directory with role-child headline projection.
 *  - `getUserDetail` — single-row detail with role-child snapshot assembly.
 *  - `createUser` — admin-provisioned user creation (student / teacher / parent
 *    roles only; `admin` is rejected via a runtime role pre-guard).
 *  - `updateUser` — whitelisted profile patch (five fields only).
 *  - `setUserDeleted` — soft-delete / reactivate via a single guarded UPDATE.
 *  - `setUserSuspended` — suspend / release-suspension via a single guarded
 *    UPDATE that also stamps the suspension window
 *    (`suspended_at` + `suspended_period_days`).
 *  - `setUserBlocked` — block / unblock via a single guarded UPDATE.
 *
 * Plus two pure-read companions: `getStats` (directory-wide aggregate counters)
 * and `getUserActivity` (per-user audit-timeline read-back).
 *
 * Disciplines enforced here:
 *  - Defense-in-depth BFLA: every method re-validates that the `actorId`
 *    resolves to a real `admin`-role user BEFORE any work — the actor gate
 *    lives in `admin-guards.helpers.ts` (`assertActorAdmin`). Anonymous
 *    callers (`actorId = 0`) receive `UnauthorizedError`; authenticated
 *    non-admins receive `ForbiddenError`. Denial paths emit ZERO audit
 *    rows and perform ZERO writes — the actor check happens BEFORE any
 *    transaction opens.
 *    Governance mutations (`setUserSuspended` / `setUserBlocked`) use the
 *    STRICT variant (`assertActiveActorAdmin`) which additionally rejects
 *    governed actors (deleted / blocked / actively-suspended) — the
 *    blast radius of a governance mutation is high enough to warrant
 *    re-validating the actor's governance state. The legacy CRUD methods
 *    (list / detail / create / update / soft-delete) keep the relaxed
 *    variant per REQ-031 (no behavior change to DEV3-016).
 *  - BOPLA: `createUser` and `updateUser` build their payloads field-by-field
 *    (never `{ ...input }` spreads) via `user-management.helpers.ts`.
 *    Transport-tampered extra fields are ignored by construction.
 *    Server-controlled fields (`id`, governance flags, timestamps, balances,
 *    `passwordHash`, `parentId`, handshake code) are structurally absent
 *    from the input whitelist and never appear in the `SET` clause.
 *  - Atomicity: every mutation runs inside a single `withTransaction`
 *    block — the `users` insert / update, the role-child insert, and the
 *    audit-log row share the same commit/rollback fate. A failure
 *    mid-flow rolls back ALL writes (zero residual rows).
 *  - Audit emission: a successful mutation appends exactly one
 *    `audit_logs` row INSIDE the same transaction, composed via the
 *    `AuditLogWriteContract` (composition-only — the contract is built
 *    by this service, never by the writer). Denial paths emit ZERO
 *    audit rows (no-trail-pollution).
 *  - Self-protection: `setUserDeleted(id, deleted=true)` with `id === actorId`
 *    throws `ConflictError(USER_SELF_DEACTIVATION_FORBIDDEN)` BEFORE any
 *    write — zero rows mutated, zero audit rows appended. The same guard
 *    applies to `setUserSuspended` (`USER_SELF_SUSPENSION_FORBIDDEN`) and
 *    `setUserBlocked` (`USER_SELF_BLOCK_FORBIDDEN`).
 *  - Logging: expected rejections via `logger.logDomainError` carrying
 *    `{ code, entity: "user", entityId }` (ids + codes only — no PII);
 *    unexpected failures via `logger.error`. NEVER `console.*`.
 *  - i18n: all user-facing messages resolve through
 *    `getServerTranslations(locale).errorsTranslations` (and the
 *    `adminUsers` sub-block); property access only, never `t('key')`
 *    string-concatenated lookup.
 *  - `passwordHash` is structurally absent from every output shape
 *    (`AdminUserSafeSelect = Omit<UserSelectType, "passwordHash">`); the
 *    actor-check read fetches the row but only the `role` field is
 *    accessed — the hash is never logged, returned, or compared here.
 *  - Trial grant: the student-creation branch OMITS the trial-grant call
 *    entirely (the trial lane is dormant — no `balance_trial` column
 *    exists on `students` yet). When the trial lane lands in a future
 *    schema delta, the conditional `StudentTrialService.grantFreeTrial`
 *    call will be wired into the student-creation flow.
 */
import { AdminUserRepository, UserRepository } from "@/backend/db/repo";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { hashPassword } from "@/backend/lib/auth/password";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, NotFoundError, translateDbError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActiveActorAdmin, assertActorAdmin } from "@/backend/services/admin/admin-guards.helpers";
import { AuditService } from "@/backend/services/admin/audit.service";
import {
  buildAuditContract,
  buildCreateUserInsert,
  buildUpdatePatch,
  isPositiveSafeInteger,
  normalizeFilters,
  resolveActivityLimit,
  resolvePageBounds,
  validateCreateInput,
  validateUpdatePatch,
} from "@/backend/services/admin/user-management.helpers";
import {
  assembleDetail,
  mapActivityRow,
  mapDirectoryRow,
  mapStatsRow,
} from "@/backend/services/admin/user-management.mappers";
import { createRoleChild, createStudentWithHandshakeRetry } from "@/backend/services/shared";
import type {
  AdminCreateUserSubmitInput,
  AdminUpdateUserPatchInput,
  AdminUserActivityEntryReturnType,
  AdminUserDetailReturnType,
  AdminUserFiltersSubmitInput,
  AdminUserPageReturnType,
  AdminUserStatsReturnType,
  DBTransaction,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Entity label passed to `NotFoundError` — yields code `USER_NOT_FOUND`. */
const USER_ENTITY = "USER";

/** Inclusive lower bound on `setUserSuspended`'s `periodDays` parameter. */
const SUSPENSION_PERIOD_MIN_DAYS = 1;

/** Inclusive upper bound on `setUserSuspended`'s `periodDays` parameter (~10 years). */
const SUSPENSION_PERIOD_MAX_DAYS = 3650;

export namespace AdminUserManagementService {
  /**
   * Lists the user directory by filter + page bounds.
   *
   * Pre-DB pagination bounds: `page >= 1`, `pageSize in 1..100`, default
   * `pageSize = 25`. Out-of-range values reject with `VALIDATION`. An
   * out-of-range page (e.g. page 999 on a 10-page directory) returns
   * `{ items: [], totalCount, page, pageSize }` honestly — never an
   * error, never clamped.
   */
  export async function listDirectory(
    filters: AdminUserFiltersSubmitInput,
    page: number,
    pageSize: number | undefined,
    locale: string,
    actorId: number,
    outerTx?: DBTransaction
  ): Promise<AdminUserPageReturnType> {
    await assertActorAdmin(actorId, locale, outerTx);

    const { resolvedPage, resolvedPageSize, offset } = resolvePageBounds(page, pageSize, locale);

    const normalized = normalizeFilters(filters);
    const [rows, totalCount] = await Promise.all([
      AdminUserRepository.listDirectory(normalized, resolvedPageSize, offset, outerTx),
      AdminUserRepository.countDirectory(normalized, outerTx),
    ]);

    const items = rows.map(row => mapDirectoryRow(row, locale));

    return {
      items,
      totalCount,
      page: resolvedPage,
      pageSize: resolvedPageSize,
    };
  }

  /**
   * Resolves the directory-wide aggregate counters for the admin overview
   * strip. Pure read: ZERO audit rows (reads never audit — matches
   * `listDirectory`/`getUserDetail`), zero writes, one aggregate
   * round-trip via `AdminUserRepository.getStats`. Defense-in-depth BFLA
   * applies as everywhere else (anonymous → `UnauthorizedError`,
   * authenticated non-admin → `ForbiddenError`, both BEFORE any DB read
   * beyond the actor probe).
   *
   * Governance counters mirror the directory governance-filter resolution
   * (null-safe: legacy NULL-state columns read as "active"); role counters
   * partition `totalCount` exactly; `newThisWeekCount` counts rows created
   * within the trailing 7 days (cutoff bound as a parameter).
   */
  export async function getStats(
    locale: string,
    actorId: number,
    outerTx?: DBTransaction
  ): Promise<AdminUserStatsReturnType> {
    await assertActorAdmin(actorId, locale, outerTx);
    const row = await AdminUserRepository.getStats(outerTx);
    return mapStatsRow(row);
  }

  /**
   * Resolves the per-user "recent activity" timeline: the newest-first
   * `audit_logs` rows recorded ABOUT the target user
   * (`entity_type = 'user' AND entity_id = :userId`), with the acting
   * admin's display name and the defensively projected `changedFields`
   * list per entry.
   *
   * Pure read: ZERO audit rows (reads never audit — matches
   * `listDirectory`/`getUserDetail`/`getStats`), zero writes. Defense-in-
   * depth BFLA applies as everywhere else (anonymous →
   * `UnauthorizedError`, authenticated non-admin → `ForbiddenError`, both
   * BEFORE any DB read beyond the actor probe).
   *
   * `userId` is re-asserted defensively (positive safe integer) and must
   * resolve to an existing row — a missing id yields
   * `NotFoundError("USER", …)` → `USER_NOT_FOUND` (same contract as
   * `getUserDetail`). `limit` CLAMPS into `1..50` (default 10) — the
   * timeline is a bounded read surface, so an out-of-range limit is never
   * an error (read-path leniency, mirroring pagination defaulting).
   *
   * Scoped read-back discipline: this surfaces ONE user's governance
   * timeline only. The global audit-trail browsing surface remains owned
   * by DEV3-020 (deferred-items ledger D1).
   */
  export async function getUserActivity(
    userId: number,
    locale: string,
    actorId: number,
    limit?: number | null,
    outerTx?: DBTransaction
  ): Promise<AdminUserActivityEntryReturnType[]> {
    await assertActorAdmin(actorId, locale, outerTx);

    const tErrors = getServerTranslations(locale).errorsTranslations;

    if (!isPositiveSafeInteger(userId)) {
      throw new ValidationError(tErrors.validation);
    }

    // Clamp-first limit resolution happens inside `resolveActivityLimit`:
    // `undefined`/`null`/non-finite → default; finite values clamp 1..50.
    const resolvedLimit = resolveActivityLimit(limit);

    const userExists = await AdminUserRepository.existsById(userId, outerTx);
    if (!userExists) {
      logger.logDomainError("Admin user activity lookup: user not found", {
        code: "USER_NOT_FOUND",
        entity: "user",
        entityId: userId,
      });
      throw new NotFoundError(USER_ENTITY, tErrors.adminUsers.userNotFound);
    }

    const rows = await AdminUserRepository.getActivity(userId, resolvedLimit, outerTx);
    return rows.map(row => mapActivityRow(row));
  }

  /**
   * Resolves the full admin detail for one user by id. ID is re-asserted
   * defensively (positive safe integer); missing id yields
   * `NotFoundError("USER", …)` → `USER_NOT_FOUND`. Role-child snapshots
   * are assembled per the user's role; absent role-child rows stay `null`.
   */
  export async function getUserDetail(
    userId: number,
    locale: string,
    actorId: number,
    outerTx?: DBTransaction
  ): Promise<AdminUserDetailReturnType> {
    await assertActorAdmin(actorId, locale, outerTx);

    const tErrors = getServerTranslations(locale).errorsTranslations;

    if (!isPositiveSafeInteger(userId)) {
      throw new ValidationError(tErrors.validation);
    }

    const row = await AdminUserRepository.findDetailById(userId, outerTx);
    if (row === null) {
      logger.logDomainError("Admin user detail lookup: user not found", {
        code: "USER_NOT_FOUND",
        entity: "user",
        entityId: userId,
      });
      throw new NotFoundError(USER_ENTITY, tErrors.adminUsers.userNotFound);
    }
    return assembleDetail(row, locale);
  }

  /**
   * Admin-provisioned user creation. Role pre-guard rejects
   * `role === "admin"` (transport-tamper defense beyond the
   * `RegisterPublicRole` type union). Field-by-field insert payload
   * mapping; password hashed via `hashPassword` BEFORE the transaction
   * opens. Inside a single `withTransaction`: `UserRepository.create` →
   * role-child create (`StudentRepository.createForRegistration` with
   * handshake retry; `ApplicantRepository.create` for teacher — NEVER a
   * `teacher` row; `ParentRepository.createForRegistration` for parent) →
   * `AuditService.createAuditLog` → return `getUserDetail(newId)`.
   *
   * Duplicate email (23505 on `users.email`) is translated via the
   * cause-chain traversal into a localized `ConflictError`.
   */
  export async function createUser(
    input: AdminCreateUserSubmitInput,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminUserDetailReturnType> {
    await assertActorAdmin(actorId, locale, outerTx);

    const t = getServerTranslations(locale);
    const tErrors = t.errorsTranslations;

    // Role pre-guard — `admin` is structurally excluded by the
    // `RegisterPublicRole` input type; this runtime guard defends against
    // transport-tamper that bypasses the GraphQL schema validator. The
    // local widening to `string` keeps the runtime check sound under
    // TypeScript's no-overlap rule for unions that exclude `"admin"`.
    const roleString: string = input.role;
    if (roleString === "admin") {
      logger.logDomainError("Admin user creation denied: tampered role=admin", {
        code: "ADMIN_ROLE_CREATION_FORBIDDEN",
        entity: "user",
        entityId: actorId,
      });
      throw new ConflictError("ADMIN_ROLE_CREATION_FORBIDDEN", tErrors.adminUsers.adminRoleCreationForbidden);
    }

    validateCreateInput(input, locale);

    // Hash BEFORE the transaction opens — plaintext never enters the tx.
    const passwordHash = await hashPassword(input.password);

    try {
      return await withTransaction(outerTx, async tx => {
        const insert = buildCreateUserInsert(input, passwordHash);
        const created = await UserRepository.create(insert, tx);

        await createRoleChild(created.id, input.role, tx, async (userId, childTx) => {
          // Trial lane stays dormant on the admin surface — no grant call.
          await createStudentWithHandshakeRetry(
            userId,
            childTx,
            "admin user creation",
            cause => new ConflictError("HANDSHAKE_EXHAUSTED", tErrors.adminUsers.handshakeExhausted, { cause })
          );
        });

        // Audit row shares the caller's transaction fate.
        await AuditService.createAuditLog(
          buildAuditContract(actorId, AuditActionType.Create, created.id, {
            role: input.role,
          }),
          tx
        );

        return getUserDetail(created.id, locale, actorId, tx);
      });
    } catch (error) {
      // Map 23505 on `users.email` → localized ConflictError.
      throw translateDbError(error, t.authTranslations.emailAlreadyExists);
    }
  }

  /**
   * Admin profile patch. Empty patch rejects with `USER_PATCH_EMPTY` BEFORE
   * any DB read. Each supplied field is validated; the `AdminUserUpdateDbPatch`
   * is built field-by-field (BOPLA — never a spread). Inside a single
   * `withTransaction`: `updateProfileFields(id, patch, tx)` → null →
   * `USER_NOT_FOUND`; audit `Update` with `details = { changedFields: [...] }`
   * (field NAMES only — never values); return post-write detail.
   */
  export async function updateUser(
    id: number,
    patch: AdminUpdateUserPatchInput,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminUserDetailReturnType> {
    await assertActorAdmin(actorId, locale, outerTx);

    const tErrors = getServerTranslations(locale).errorsTranslations;

    if (!isPositiveSafeInteger(id)) {
      throw new ValidationError(tErrors.validation);
    }

    const dbPatch = buildUpdatePatch(patch);
    if (Object.keys(dbPatch).length === 0) {
      logger.logDomainError("Admin user update denied: empty patch", {
        code: "USER_PATCH_EMPTY",
        entity: "user",
        entityId: id,
      });
      throw new ValidationError("USER_PATCH_EMPTY", tErrors.adminUsers.userPatchEmpty);
    }

    validateUpdatePatch(dbPatch, locale);

    return withTransaction(outerTx, async tx => {
      const updated = await AdminUserRepository.updateProfileFields(id, dbPatch, tx);
      if (updated === null) {
        logger.logDomainError("Admin user update: user not found", {
          code: "USER_NOT_FOUND",
          entity: "user",
          entityId: id,
        });
        throw new NotFoundError(USER_ENTITY, tErrors.adminUsers.userNotFound);
      }

      const changedFields = Object.keys(dbPatch);
      await AuditService.createAuditLog(buildAuditContract(actorId, AuditActionType.Update, id, { changedFields }), tx);

      return getUserDetail(id, locale, actorId, tx);
    });
  }

  /**
   * Soft-delete / reactivate via a single guarded UPDATE. Self-protection
   * FIRST: `id === actorId` → `ConflictError(USER_SELF_DEACTIVATION_FORBIDDEN)`,
   * zero writes, zero audit. `setDeletedOnce` returns null on zero-row
   * match → `existsById` probe disambiguates `USER_NOT_FOUND` vs the
   * typed conflict (`USER_ALREADY_DELETED` / `USER_NOT_DELETED`). Success
   * → audit (`Delete` | `Reactivate`) → return detail.
   */
  export async function setUserDeleted(
    id: number,
    deleted: boolean,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminUserDetailReturnType> {
    await assertActorAdmin(actorId, locale, outerTx);

    const tErrors = getServerTranslations(locale).errorsTranslations;

    if (!isPositiveSafeInteger(id)) {
      throw new ValidationError(tErrors.validation);
    }

    return withTransaction(outerTx, async tx => {
      // Self-protection FIRST — zero writes, zero audit on denial.
      if (id === actorId) {
        logger.logDomainError("Admin self-deactivation denied", {
          code: "USER_SELF_DEACTIVATION_FORBIDDEN",
          entity: "user",
          entityId: id,
        });
        throw new ConflictError("USER_SELF_DEACTIVATION_FORBIDDEN", tErrors.adminUsers.userSelfDeactivationForbidden);
      }

      const updated = await AdminUserRepository.setDeletedOnce(id, deleted, tx);
      if (updated === null) {
        // Zero rows matched — disambiguate via the cold-path existence probe.
        const exists = await AdminUserRepository.existsById(id, tx);
        if (!exists) {
          logger.logDomainError("Admin user delete/reactivate: user not found", {
            code: "USER_NOT_FOUND",
            entity: "user",
            entityId: id,
          });
          throw new NotFoundError(USER_ENTITY, tErrors.adminUsers.userNotFound);
        }
        // User exists but is in the wrong state for the requested transition.
        const code = deleted ? "USER_ALREADY_DELETED" : "USER_NOT_DELETED";
        const message = deleted ? tErrors.adminUsers.userAlreadyDeleted : tErrors.adminUsers.userNotDeleted;
        logger.logDomainError("Admin user delete/reactivate: state conflict", {
          code,
          entity: "user",
          entityId: id,
        });
        throw new ConflictError(code, message);
      }

      await AuditService.createAuditLog(
        buildAuditContract(actorId, deleted ? AuditActionType.Delete : AuditActionType.Reactivate, id, { deleted }),
        tx
      );

      return getUserDetail(id, locale, actorId, tx);
    });
  }

  /**
   * Suspend / release-suspension via a single guarded UPDATE that also
   * stamps the suspension window (`suspended_at` + `suspended_period_days`).
   *
   * Pipeline mirrors `setUserDeleted` with the suspend axis + window
   * metadata: (1) strict active-admin actor guard
   * (`assertActiveActorAdmin`) pre-transaction when no `outerTx`; (2) `id`
   * positive-safe-int re-assertion; (3) `suspended === true` ⇒ `periodDays`
   * validated as a whole number in `1..3650` (else `ValidationError`
   * naming `periodDays`); `suspended === false` ⇒ `periodDays` IGNORED;
   * (4) `withTransaction(outerTx, …)`: self-check `id === actorId` →
   * `USER_SELF_SUSPENSION_FORBIDDEN` BEFORE any write; guarded repo call
   * → row ⇒ proceed; `null` ⇒ classifier via `findGovernanceState(id, tx)`
   * → `null` ⇒ `USER_NOT_FOUND`; `isDeleted === true` →
   * `USER_ALREADY_DELETED`; axis already in requested state →
   * `USER_ALREADY_SUSPENDED` / `USER_NOT_SUSPENDED` per direction; (5) ONE
   * in-tx audit row via `buildAuditContract` (suspend → `AuditActionType.Suspend`
   * + `{ changedFields, suspended: true, suspendedPeriodDays }`; unsuspend →
   * `AuditActionType.Reactivate` + `{ changedFields, suspended: false }`);
   * (6) return `getUserDetail(id, locale, actorId, tx)` (composition reuse —
   * the relaxed inner re-check pass is defense-in-depth; the strict guard
   * is the authoritative actor gate).
   *
   * Denials: EXACTLY ONE `logger.logDomainError(message, { code, entity,
   * entityId, locale })`; ZERO audit rows; ZERO notification rows; happy
   * path SILENT (REQ-053). Zero PII in audit `details`.
   */
  export async function setUserSuspended(
    id: number,
    suspended: boolean,
    periodDays: number | null,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminUserDetailReturnType> {
    await assertActiveActorAdmin(actorId, locale, outerTx);

    const tErrors = getServerTranslations(locale).errorsTranslations;

    if (!isPositiveSafeInteger(id)) {
      throw new ValidationError(tErrors.validation);
    }

    // periodDays validated ONLY on suspend; unsuspend IGNORES it.
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

    return withTransaction(outerTx, async tx => {
      if (id === actorId) {
        logger.logDomainError("Admin self-suspension denied", {
          code: "USER_SELF_SUSPENSION_FORBIDDEN",
          entity: "user",
          entityId: id,
          locale,
        });
        throw new ConflictError("USER_SELF_SUSPENSION_FORBIDDEN", tErrors.adminUsers.userSelfSuspensionForbidden);
      }

      const updated = await AdminUserRepository.setSuspendedOnce(id, suspended, suspended ? periodDays : null, tx);

      if (updated === null) {
        const governanceState = await AdminUserRepository.findGovernanceState(id, tx);
        if (governanceState === null) {
          logger.logDomainError("Admin user suspend/reactivate: user not found", {
            code: "USER_NOT_FOUND",
            entity: "user",
            entityId: id,
            locale,
          });
          throw new NotFoundError(USER_ENTITY, tErrors.adminUsers.userNotFound);
        }
        if (governanceState.isDeleted === true) {
          logger.logDomainError("Admin user suspend/reactivate: target already deleted", {
            code: "USER_ALREADY_DELETED",
            entity: "user",
            entityId: id,
            locale,
          });
          throw new ConflictError("USER_ALREADY_DELETED", tErrors.adminUsers.userAlreadyDeleted);
        }
        const code = suspended ? "USER_ALREADY_SUSPENDED" : "USER_NOT_SUSPENDED";
        const message = suspended ? tErrors.adminUsers.userAlreadySuspended : tErrors.adminUsers.userNotSuspended;
        logger.logDomainError("Admin user suspend/reactivate: state conflict", {
          code,
          entity: "user",
          entityId: id,
          locale,
        });
        throw new ConflictError(code, message);
      }

      const changedFields = ["suspended", "suspendedAt", "suspendedPeriodDays"];
      const actionType = suspended ? AuditActionType.Suspend : AuditActionType.Reactivate;
      const details = suspended
        ? { changedFields, suspended: true, suspendedPeriodDays: periodDays }
        : { changedFields, suspended: false };
      await AuditService.createAuditLog(buildAuditContract(actorId, actionType, id, details), tx);

      return getUserDetail(id, locale, actorId, tx);
    });
  }

  /**
   * Block / unblock via a single guarded UPDATE that stamps `blocked_at`
   * on the block direction and clears it on the unblock direction. Block
   * is an indefinite administrative deny (no lapse window — the column
   * pair carries no period-days companion).
   *
   * Pipeline mirrors `setUserSuspended` with the blocked axis + axis
   * codes. Audit `details` carries the block field names + axis state
   * only (zero PII):
   *   block   → `AuditActionType.Suspend` + `{ changedFields: ["isBlocked","blockedAt"], blocked: true }`
   *   unblock → `AuditActionType.Reactivate` + `{ …, blocked: false }`
   *
   * Denials: EXACTLY ONE `logger.logDomainError`; ZERO audit rows; ZERO
   * notification rows; happy path SILENT (REQ-053).
   */
  export async function setUserBlocked(
    id: number,
    blocked: boolean,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminUserDetailReturnType> {
    await assertActiveActorAdmin(actorId, locale, outerTx);

    const tErrors = getServerTranslations(locale).errorsTranslations;

    if (!isPositiveSafeInteger(id)) {
      throw new ValidationError(tErrors.validation);
    }

    return withTransaction(outerTx, async tx => {
      if (id === actorId) {
        logger.logDomainError("Admin self-block denied", {
          code: "USER_SELF_BLOCK_FORBIDDEN",
          entity: "user",
          entityId: id,
          locale,
        });
        throw new ConflictError("USER_SELF_BLOCK_FORBIDDEN", tErrors.adminUsers.userSelfBlockForbidden);
      }

      const updated = await AdminUserRepository.setBlockedOnce(id, blocked, tx);

      if (updated === null) {
        const governanceState = await AdminUserRepository.findGovernanceState(id, tx);
        if (governanceState === null) {
          logger.logDomainError("Admin user block/unblock: user not found", {
            code: "USER_NOT_FOUND",
            entity: "user",
            entityId: id,
            locale,
          });
          throw new NotFoundError(USER_ENTITY, tErrors.adminUsers.userNotFound);
        }
        if (governanceState.isDeleted === true) {
          logger.logDomainError("Admin user block/unblock: target already deleted", {
            code: "USER_ALREADY_DELETED",
            entity: "user",
            entityId: id,
            locale,
          });
          throw new ConflictError("USER_ALREADY_DELETED", tErrors.adminUsers.userAlreadyDeleted);
        }
        const code = blocked ? "USER_ALREADY_BLOCKED" : "USER_NOT_BLOCKED";
        const message = blocked ? tErrors.adminUsers.userAlreadyBlocked : tErrors.adminUsers.userNotBlocked;
        logger.logDomainError("Admin user block/unblock: state conflict", {
          code,
          entity: "user",
          entityId: id,
          locale,
        });
        throw new ConflictError(code, message);
      }

      const actionType = blocked ? AuditActionType.Suspend : AuditActionType.Reactivate;
      const details = blocked
        ? { changedFields: ["isBlocked", "blockedAt"], blocked: true }
        : { changedFields: ["isBlocked", "blockedAt"], blocked: false };
      await AuditService.createAuditLog(buildAuditContract(actorId, actionType, id, details), tx);

      return getUserDetail(id, locale, actorId, tx);
    });
  }
}
