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
 *  - `setUserDeleted` / `setUserSuspended` / `setUserBlocked` — governance
 *    mutations over the shared in-transaction pipeline
 *    (`runGovernanceMutation` in `user-governance.helpers.ts`: self-guard,
 *    governance ladder, audit row, detail re-read); each method owns only
 *    its actor-guard variant and axis-specific validations.
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
 *    transaction opens. Governance mutations use the STRICT variant
 *    (`assertActiveActorAdmin`, also rejecting governed actors); the
 *    legacy CRUD methods keep the relaxed variant per REQ-031.
 *  - BOPLA: `createUser` and `updateUser` build their payloads field-by-field
 *    (never `{ ...input }` spreads) via `user-management.helpers.ts`;
 *    server-controlled fields are structurally absent from the input
 *    whitelist and never appear in the `SET` clause.
 *  - Atomicity: every mutation runs inside a single `withTransaction`
 *    block — the `users` insert / update, the role-child insert, and the
 *    audit-log row share the same commit/rollback fate (zero residual rows).
 *  - Audit emission: a successful mutation appends exactly one
 *    `audit_logs` row INSIDE the same transaction; denial paths emit ZERO
 *    audit rows (no-trail-pollution).
 *  - Logging: expected rejections via `logger.logDomainError` carrying
 *    `{ code, entity: "user", entityId }` (ids + codes only — no PII);
 *    unexpected failures via `logger.error`. NEVER `console.*`.
 *  - i18n: all user-facing messages resolve through
 *    `getServerTranslations(locale).errorsTranslations` (and the
 *    `adminUsers` sub-block); property access only.
 *  - `passwordHash` is structurally absent from every output shape; the
 *    actor-check read fetches the row but only the `role` field is
 *    accessed — the hash is never logged, returned, or compared here.
 *  - Trial grant: the student-creation branch OMITS the trial-grant call
 *    entirely (the trial lane is dormant). When the trial lane lands in a
 *    future schema delta, the conditional `StudentTrialService.grantFreeTrial`
 *    call will be wired into the student-creation flow.
 */
import { AdminUserRepository, UserRepository } from "@/backend/db/repo";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { hashPassword } from "@/backend/lib/auth/password";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, NotFoundError, translateDbError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActorAdmin } from "@/backend/services/admin/admin-guards.helpers";
import { AuditService } from "@/backend/services/admin/audit.service";
import { setBlockedAxis, setDeletedAxis, setSuspendedAxis } from "@/backend/services/admin/user-governance.helpers";
import {
  buildAuditContract,
  buildCreateUserInsert,
  buildUpdatePatch,
  composeActivityCaption,
  isPositiveSafeInteger,
  normalizeFilters,
  resolveActivityLimit,
  resolveCountryBreakdownLimit,
  resolvePageBounds,
  validateCreateInput,
  validateUpdatePatch,
} from "@/backend/services/admin/user-management.helpers";
import {
  assembleDetail,
  buildCountryBreakdown,
  mapActivityRow,
  mapDirectoryRow,
  mapStatsRow,
} from "@/backend/services/admin/user-management.mappers";
import { createRoleChild, createStudentWithHandshakeRetry } from "@/backend/services/shared";
import type {
  AdminCooldownLifecycleStatsReturnType,
  AdminCreateUserSubmitInput,
  AdminUpdateUserPatchInput,
  AdminUserActivityEntryReturnType,
  AdminUserCountryBreakdownReturnType,
  AdminUserDetailReturnType,
  AdminUserFiltersSubmitInput,
  AdminUserPageReturnType,
  AdminUserStatsReturnType,
  DBTransaction,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Entity label passed to `NotFoundError` — yields code `USER_NOT_FOUND`. */
const USER_ENTITY = "USER";

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
   * Resolves the applicant-cooldown LIFECYCLE counters for the admin
   * dashboard's lifecycle panel (`AdminApplicantCooldownStats`). Pure read:
   * ZERO audit rows (reads never audit — matches `getStats`), zero writes,
   * one aggregate round-trip via `AdminUserRepository.getCooldownLifecycleStats`.
   * Defense-in-depth BFLA applies as everywhere else (anonymous →
   * `UnauthorizedError`, authenticated non-admin → `ForbiddenError`, both
   * BEFORE any DB read beyond the actor probe).
   *
   * The three returned counters partition the cooling-applicant population
   * exactly and share the canonical `COOLDOWN_EXPIRING_SOON_DAYS` window
   * with the directory's `cooldownExpiringSoon` filter arm — the KPI and
   * its deep-linked listing are the same vocabulary at the same boundary.
   */
  export async function getCooldownLifecycleStats(
    locale: string,
    actorId: number,
    outerTx?: DBTransaction
  ): Promise<AdminCooldownLifecycleStatsReturnType> {
    await assertActorAdmin(actorId, locale, outerTx);
    return AdminUserRepository.getCooldownLifecycleStats(outerTx);
  }

  /**
   * Resolves the "users by country" distribution for the admin directory
   * facet (`AdminUserCountryBreakdown`). Pure read: ZERO audit rows (reads
   * never audit — matches `getStats`), zero writes, two aggregate
   * round-trips via `AdminUserRepository.getCountryBreakdown`.
   * Defense-in-depth BFLA applies as everywhere else (anonymous →
   * `UnauthorizedError`, authenticated non-admin → `ForbiddenError`, both
   * BEFORE any DB read beyond the actor probe).
   *
   * The mapper (`buildCountryBreakdown`) owns the dataset vocabulary:
   * out-of-dataset codes and the NULL-code population fold into the honest
   * `unresolvedCount`, and the facet window caps at `limit` (clamped
   * 1..12, default 6 — the same clamp-first read-path discipline as the
   * activity timeline). Bucket labels resolve through the shared dataset
   * in the REQUEST locale, so the facet's copy matches the directory's
   * country chips and the broadcast audience summary — one country
   * vocabulary everywhere.
   */
  export async function getCountryBreakdown(
    locale: string,
    actorId: number,
    limit?: number | null,
    outerTx?: DBTransaction
  ): Promise<AdminUserCountryBreakdownReturnType> {
    await assertActorAdmin(actorId, locale, outerTx);
    const row = await AdminUserRepository.getCountryBreakdown(outerTx);
    return buildCountryBreakdown(row, locale, resolveCountryBreakdownLimit(limit));
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
   * by the audit-trail service (deferred-items ledger D1).
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
    // Locale-bound caption composition runs over the RAW details (the wire
    // never carries them — BOPLA): applicant lifecycle rows surface a human
    // caption, everything else stays captionless.
    const activityLabels = getServerTranslations(locale).adminUsersTranslations.activity;
    return rows.map(row => {
      const entry = mapActivityRow(row);
      // `Object.assign` builds the captioned entry (the no-map-spread-
      // compliant form of `{ ...entry, caption }` — identical keys/values,
      // one fresh object per row, the uncaptioned mapper output discarded).
      return Object.assign({}, entry, {
        caption: composeActivityCaption(row.details, entry.actionType, activityLabels),
      });
    });
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
   * Soft-delete / reactivate via a single guarded UPDATE. The shared
   * in-transaction pipeline (self-guard, governance ladder, audit row,
   * detail re-read) lives in `runGovernanceMutation`; this method owns the
   * relaxed actor guard (REQ-031) and the id re-assertion only.
   */
  export async function setUserDeleted(
    id: number,
    deleted: boolean,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminUserDetailReturnType> {
    return setDeletedAxis(id, deleted, actorId, locale, tx => getUserDetail(id, locale, actorId, tx), outerTx);
  }

  /**
   * Suspend / release-suspension via a single guarded UPDATE that also
   * stamps the suspension window (`suspended_at` + `suspended_period_days`).
   * The full axis body (STRICT actor guard, `periodDays` validation, the
   * shared pipeline) lives in `setSuspendedAxis` — this delegate keeps the
   * wire-identical contract.
   */
  export async function setUserSuspended(
    id: number,
    suspended: boolean,
    periodDays: number | null,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminUserDetailReturnType> {
    return setSuspendedAxis(
      id,
      suspended,
      periodDays,
      actorId,
      locale,
      tx => getUserDetail(id, locale, actorId, tx),
      outerTx
    );
  }

  /**
   * Block / unblock via a single guarded UPDATE that stamps `blocked_at`
   * on the block direction and clears it on the unblock direction. The
   * full axis body lives in `setBlockedAxis` — this delegate keeps the
   * wire-identical contract.
   */
  export async function setUserBlocked(
    id: number,
    blocked: boolean,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminUserDetailReturnType> {
    return setBlockedAxis(id, blocked, actorId, locale, tx => getUserDetail(id, locale, actorId, tx), outerTx);
  }
}
