/**
 * AuthService — domain service for login + refreshToken.
 *
 * Sister module to `RegistrationService` (which handles the public
 * `registerUser` flow). This service owns the JWT-issuing auth path:
 *
 *  - `login(email, password, locale)` — verifies credentials, checks
 *    governance flags (`isDeleted` / `isBlocked` / `suspended`), signs the
 *    access + refresh token pair, generates a `sessionId`, returns the full
 *    `AuthSession` (`user` + tokens). The mutation resolver extracts
 *    `accessToken` + `refreshToken` for the payload and pushes
 *    `refreshToken` + `sessionId` into the per-request cookie accumulator.
 *  - `refreshToken(refreshToken, locale)` — verifies the refresh token,
 *    rotates the pair (issues a NEW refresh token + session id), returns the
 *    fresh `RefreshResult`.
 *  - `updateMyLocale(userId, locale, requestLocale, tx?)` — persists the
 *    caller's UI/copy locale preference on `users.locale` (the D2 column).
 *    Validates the closed locale set (defense-in-depth — the GraphQL enum
 *    already constrains it), writes inside a transaction, and returns the
 *    updated user with `passwordHash` stripped. Throws `ValidationError`
 *    (localized `invalidLocale`) for a non-locale string and
 *    `UnauthorizedError` when the caller's row no longer exists.
 *  - `changeMyPassword(userId, input, locale, tx?)` — the self-service
 *    credential change. Verifies `input.currentPassword` against the stored
 *    hash (constant-time bcrypt compare), rejects a no-op change
 *    (new == current) and short/empty replacements via the shared password
 *    policy, hashes the replacement BEFORE the transaction, then persists
 *    the new hash and clears the force-reset flag (`mustChangePassword: false`)
 *    in ONE write — a successful self-service change is the only operation
 *    that clears a pending credential reset. Returns the updated user with
 *    `passwordHash` stripped. Denials never disclose whether the identity
 *    exists or is governed: a vanished caller row, a soft-deleted principal,
 *    a wrong current password, and a credential rotated concurrently by an
 *    admin (the write is fenced on the observed hash) all produce the SAME
 *    single `CURRENT_PASSWORD_INVALID` shape (field-targeted, so the UI can
 *    render it inline on the current-password field).
 *
 * i18n: all messages resolve through `getServerTranslations(locale)` — never
 * hardcoded strings, never `console.*` (uses `logger.logDomainError` for
 * security-audit events like failed login attempts).
 *
 * Security notes:
 *  - Login failures return a generic "invalid credentials" message — they do
 *    NOT distinguish "email doesn't exist" from "wrong password". This
 *    prevents user-enumeration attacks (an attacker can't probe which emails
 *    are registered by observing different error messages).
 *  - Failed login attempts are logged via `logger.logDomainError` (with the
 *    email redacted to a prefix) for security audit.
 *  - Governance check: if the user is deleted / blocked / suspended, we
 *    throw `ForbiddenError` with a localized "account blocked" message.
 */

import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { UserRepository } from "@/backend/db/repo";
import { users } from "@/backend/db/schema/users/users";
import { generateSessionId, signAccessToken, signRefreshToken, verifyRefreshToken } from "@/backend/lib/auth/jwt";
import { comparePassword, hashPassword } from "@/backend/lib/auth/password";
import { isSuspensionActive } from "@/backend/lib/auth/suspension-window";
import { ForbiddenError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { validatePasswordPolicy } from "@/backend/services/admin/user-management.helpers";
import type {
  AuthSession,
  ChangeMyPasswordSubmitInput,
  DBTransaction,
  RefreshResult,
  RegistrationReturnType,
  UserSelectType,
} from "@/backend/types";
import { isAppLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Truncates an email for log redaction (preserves the first 2 chars + domain). */
function redactEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) {
    return "[redacted]";
  }
  const prefix = local.slice(0, 2);
  return `${prefix}***@${domain}`;
}

/**
 * Strips `passwordHash` from a user row to form the return payload.
 *
 * The input type is `UserSelectType` (the canonical Drizzle `$inferSelect`
 * shape) so this works for both the Drizzle-select path (tx) and the
 * raw-SQL `queryDb` path (which casts the result to `UserSelectType`).
 */
function stripPasswordHash(user: UserSelectType): RegistrationReturnType {
  // Omit passwordHash so it can never leak to resolvers or logs.
  // preferredRecitation is null for the login/me path (only registration
  // echoes the validated selection as contract metadata).
  const { passwordHash: _omitted, ...rest } = user;
  return { ...rest, preferredRecitation: null };
}

/**
 * Checks the governance flags on a user row. Throws `ForbiddenError` (with
 * a localized message) if the user is deleted, blocked, or has an ACTIVE
 * suspension window. A LAPSED suspension no longer denies — the
 * suspension-window predicate (`isSuspensionActive`) is the single source
 * of truth for window liveness, shared with the SSR boundary
 * (`getServerUserContext`). Deleted/blocked are always-denied (no lapse
 * concept for either).
 *
 * Called by `login` (after password verification) and `refreshToken`
 * (after token verification). Both call sites pass the SAME fetched row
 * — ZERO call-site signature churn; only the user shape widens to include
 * the suspension-window metadata columns already returned by
 * `UserRepository.findById` / `findByEmail` (full `UserSelectType`).
 */
function assertUserActive(
  user: {
    isDeleted: boolean | null;
    isBlocked: boolean | null;
    suspended: boolean | null;
    suspendedAt: Date | null;
    suspendedPeriodDays: number | null;
  },
  message: string
): void {
  if (
    user.isDeleted ||
    user.isBlocked ||
    isSuspensionActive(
      {
        suspended: user.suspended,
        suspendedAt: user.suspendedAt,
        suspendedPeriodDays: user.suspendedPeriodDays,
      },
      new Date()
    )
  ) {
    throw new ForbiddenError(message);
  }
}

/**
 * Runs `fn` inside a transaction. If `outerTx` is provided (test path), opens
 * a SAVEPOINT on the outer transaction — failures roll back only the
 * savepoint, leaving the outer transaction usable for further queries. If
 * `outerTx` is undefined (production path), opens a new top-level
 * `db.transaction`.
 *
 * Same shape as the `RegistrationService` / `NotificationEngine` helpers so
 * the transaction conventions stay identical across the auth domain.
 */
async function withTransaction<T>(
  outerTx: DBTransaction | undefined,
  fn: (tx: DBTransaction) => Promise<T>
): Promise<T> {
  if (outerTx) {
    return outerTx.transaction(fn);
  }
  return db.transaction(fn);
}

export namespace AuthService {
  /**
   * Login entry point — verifies credentials + governance, issues the JWT
   * pair, returns the full `AuthSession`.
   *
   * @throws UnauthorizedError  bad email/password (generic message — no
   *     user-enumeration leak).
   * @throws ForbiddenError     account is deleted/blocked/suspended.
   */
  export async function login(email: string, password: string, locale: string): Promise<AuthSession> {
    const t = getServerTranslations(locale).authTranslations;

    const user = await UserRepository.findByEmail(email);
    if (!user) {
      // Generic "invalid credentials" — do NOT reveal "email doesn't exist".
      logger.logDomainError("Failed login: user not found", {
        code: "LOGIN_USER_NOT_FOUND",
        entity: "users",
        entityId: redactEmail(email),
        locale,
      });
      throw new UnauthorizedError(t.invalidCredentials);
    }

    const passwordMatches = await comparePassword(password, user.passwordHash);
    if (!passwordMatches) {
      logger.logDomainError("Failed login: password mismatch", {
        code: "LOGIN_PASSWORD_MISMATCH",
        entity: "users",
        entityId: redactEmail(email),
        locale,
      });
      throw new UnauthorizedError(t.invalidCredentials);
    }

    // Governance: deleted / blocked / suspended accounts can't log in.
    assertUserActive(user, t.accountBlocked);

    // Sign the JWT pair + generate a fresh session id.
    const sessionId = generateSessionId();
    const accessToken = await signAccessToken({ userId: user.id, role: user.role });
    const newRefreshToken = await signRefreshToken({ userId: user.id, sessionId });

    // Fire-and-forget: bump `lastActiveAt` so the dashboard "last seen"
    // indicator stays current. We don't block login on this — a transient
    // DB error here shouldn't fail authentication.
    void touchLastActiveAt(user.id).catch(error => {
      logger.logDomainError("Failed to update lastActiveAt on login", {
        code: "LOGIN_LAST_ACTIVE_UPDATE_FAILED",
        entity: "users",
        entityId: user.id,
        locale,
        // Surface the error name (not the full error — could contain DB
        // internals that we'd rather not log).
        errorName: error instanceof Error ? error.name : "unknown",
      });
    });

    return {
      user: stripPasswordHash(user),
      accessToken,
      refreshToken: newRefreshToken,
      sessionId,
    };
  }

  /**
   * Refresh-token rotation entry point — verifies the supplied refresh
   * token, issues a NEW access + refresh token pair + new session id.
   *
   * Token rotation: every successful refresh INVALIDATES the prior refresh
   * token (a new one is issued). The route handler sets the new
   * `refreshToken` + `sessionId` as httpOnly cookies; the `accessToken` is
   * returned in the payload (React memory only).
   *
   * @throws UnauthorizedError  invalid/expired/malformed refresh token, OR
   *     the user no longer exists (deleted between refresh-token issuance
   *     and the refresh call).
   */
  export async function refreshToken(token: string, locale: string): Promise<RefreshResult> {
    const t = getServerTranslations(locale).authTranslations;

    const payload = await verifyRefreshToken(token);
    if (!payload) {
      logger.logDomainError("Failed refreshToken: invalid token", {
        code: "REFRESH_TOKEN_INVALID",
        entity: "users",
        locale,
      });
      throw new UnauthorizedError(t.invalidCredentials);
    }

    // Trust the token signature — no server-side session store yet; the
    // session lookup by `payload.sessionId` (rejecting rotated/revoked
    // tokens) is not yet implemented. We DO fetch the user to (a) confirm
    // they still exist + are active, and (b) pick up any role changes
    // since the refresh token was issued.
    const user = await UserRepository.findById(payload.userId);
    if (!user) {
      logger.logDomainError("Failed refreshToken: user not found", {
        code: "REFRESH_USER_NOT_FOUND",
        entity: "users",
        entityId: payload.userId,
        locale,
      });
      throw new UnauthorizedError(t.invalidCredentials);
    }
    assertUserActive(user, t.accountBlocked);

    // Issue a fresh pair + new session id. The new refresh token replaces
    // the old one (rotation) — the prior `sessionId` cookie is overwritten
    // by the route handler.
    const sessionId = generateSessionId();
    const accessToken = await signAccessToken({ userId: user.id, role: user.role });
    const refreshTokenNew = await signRefreshToken({ userId: user.id, sessionId });

    return {
      accessToken,
      refreshToken: refreshTokenNew,
      sessionId,
    };
  }

  /**
   * Persists the caller's app locale preference (UI + notification-copy
   * language) on `users.locale` — the D2 column.
   *
   * The GraphQL `AppLocale!` argument already constrains the value at the
   * schema layer; the `isAppLocale` check here is defense-in-depth for
   * non-schema transports and future callers. The write runs inside a
   * transaction (SAVEPOINT when an outer `tx` is supplied — the test path).
   *
   * @throws ValidationError   `locale` is not a supported locale (localized
   *     `invalidLocale` message).
   * @throws UnauthorizedError the caller's user row no longer exists
   *     (deleted between access-token issuance and this call; the message
   *     never discloses existence).
   */
  export async function updateMyLocale(
    userId: number,
    locale: string,
    requestLocale: string,
    outerTx?: DBTransaction
  ): Promise<RegistrationReturnType> {
    const t = getServerTranslations(requestLocale).errorsTranslations;

    // Defense-in-depth closed-set gate (schema enum is the first gate).
    if (!isAppLocale(locale)) {
      throw new ValidationError(t.invalidLocale);
    }

    const updated = await withTransaction(outerTx, tx => UserRepository.updateLocale(userId, locale, tx));
    if (!updated) {
      // Zero rows matched — the verified caller vanished between the context
      // build and the write. Unauthenticated, no existence oracle.
      throw new UnauthorizedError(t.unauthorized);
    }
    return stripPasswordHash(updated);
  }

  /**
   * Self-service credential change — verifies the caller's current password
   * and rotates the credential pair in one write.
   *
   * Sequence: identity load → governance fold (soft-deleted principal →
   * same denial) + constant-time bcrypt compare of `input.currentPassword`
   * against the stored hash → effective no-op guard (new == current, or the
   * replacement still verifies against the observed hash — bcrypt consumes
   * only the first 72 UTF-8 bytes of its input, so a look-alike differing
   * solely beyond that boundary is the SAME live credential) → shared
   * password policy on `input.newPassword` → `hashPassword` BEFORE the
   * transaction opens (plaintext never enters the tx) → one
   * `withTransaction` persisting the new hash and clearing the force-reset
   * flag (`mustChangePassword: false`) through the FENCED write
   * (`expectedCurrentHash` = the hash observed at identity load), followed
   * by the in-transaction deleted-row guard: the written row is re-checked
   * for `isDeleted` BEFORE the transaction commits, mirroring the admin
   * path's post-write check — a governance soft delete commits only
   * `is_deleted`/`deleted_at`/`updated_at` and never touches
   * `password_hash`, so a deletion landing inside the proof window (after
   * the identity read, before the fenced write) leaves the fence's WHERE
   * satisfied and would otherwise rewrite a dead row's credential; the
   * in-tx throw rolls the write back. A successful self-service change is
   * the only operation that clears a pending credential reset. Returns the
   * password-stripped updated user so the client can proceed without a
   * re-login.
   *
   * The vanished-row case, the soft-deleted-principal case (folded at
   * identity load AND re-checked on the written row inside the write
   * transaction — the latter closes the mid-flight window where the delete
   * commits after the read but before the fenced write), the
   * wrong-current-password case, and the lost-race case (an admin rotation
   * landed between the identity read and the fenced write, zero rows
   * matched) all throw the SAME field-targeted `CURRENT_PASSWORD_INVALID`
   * denial — the caller cannot probe whether an id exists, is governed, or
   * was concurrently rotated (no existence / governance / race oracle);
   * every denial path performs zero writes (the fenced miss rolls the
   * savepoint/transaction back). Denials are logged via
   * `logger.logDomainError` with `{ code, entity, entityId }` (ids + codes
   * only — no credentials).
   *
   * @throws ValidationError  `CURRENT_PASSWORD_INVALID` (field
   *     `currentPassword`) when the identity is gone, the principal is
   *     soft-deleted (checked at identity load AND re-checked on the
   *     written row inside the write transaction — a deletion committing
   *     inside the proof window is rolled back before it can land), the
   *     current password does not match, or the fenced write matched zero
   *     rows (concurrent rotation — indistinguishable from a wrong
   *     password by design); `NEW_PASSWORD_SAME_AS_CURRENT`
   *     (field `newPassword`) on an effective no-op change — plaintext
   *     equality OR a replacement that still verifies against the stored
   *     hash (bcrypt's 72-byte input boundary); `PASSWORD_REQUIRED` /
   *     `PASSWORD_TOO_SHORT` (field `password`) when the replacement
   *     violates the shared credential policy.
   */
  export async function changeMyPassword(
    userId: number,
    input: ChangeMyPasswordSubmitInput,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<RegistrationReturnType> {
    const t = getServerTranslations(locale);
    const tErrors = t.errorsTranslations;

    // Identity load — reuses the caller's transaction handle when one is
    // supplied (the composed-write / test path) so the read shares the
    // caller's snapshot; production passes no `outerTx` and the read takes
    // the bare-read path. Same seam as the admin gates' actor read.
    const user = await UserRepository.findById(userId, outerTx);

    // Governance fold: a soft-deleted principal has no live credential to
    // replace (same ground as the admin path's deleted-target denial) — a
    // cheap boolean check on the already-loaded row, evaluated BEFORE the
    // bcrypt compare and folded into the single denial below, so a deleted
    // caller sees exactly what a wrong current password looks like (no
    // governance oracle; identity is always the caller itself).
    const callerIsDeleted = user?.isDeleted === true;

    if (!user || callerIsDeleted || !(await comparePassword(input.currentPassword, user.passwordHash))) {
      // Single denial shape: a vanished caller row, a soft-deleted
      // principal, and a wrong current password are indistinguishable to
      // the client (no existence / governance oracle). Zero writes.
      logger.logDomainError("Failed changeMyPassword: identity or current password rejected", {
        code: "CURRENT_PASSWORD_INVALID",
        entity: "users",
        entityId: userId,
        locale,
      });
      throw new ValidationError("CURRENT_PASSWORD_INVALID", tErrors.currentPasswordInvalid, undefined, [
        { field: "currentPassword", code: "CURRENT_PASSWORD_INVALID", message: tErrors.currentPasswordInvalid },
      ]);
    }

    // Fence seed — the credential the caller just proved knowledge of. The
    // write below only lands if THIS hash is still the stored one, so a
    // concurrent admin rotation inside the proof window cannot be silently
    // clobbered.
    const observedPasswordHash = user.passwordHash;

    if (
      input.newPassword === input.currentPassword ||
      (await comparePassword(input.newPassword, observedPasswordHash))
    ) {
      // An effective no-op "change" would silently clear the force-reset
      // flag while leaving the temporary credential live. Plaintext
      // equality alone cannot catch the boundary case: bcrypt consumes only
      // the first 72 UTF-8 bytes of its input, so a replacement differing
      // from the current credential solely beyond that boundary still
      // verifies against the stored hash (the temporary password would
      // keep authenticating after the flag cleared). Reject EVERY effective
      // no-op — plaintext equality OR a replacement that still verifies
      // against the observed hash — before hashing.
      throw new ValidationError("NEW_PASSWORD_SAME_AS_CURRENT", tErrors.newPasswordSameAsCurrent, undefined, [
        { field: "newPassword", code: "NEW_PASSWORD_SAME_AS_CURRENT", message: tErrors.newPasswordSameAsCurrent },
      ]);
    }

    // Shared credential policy: empty / whitespace-only ⇒ PASSWORD_REQUIRED,
    // below the shared minimum ⇒ PASSWORD_TOO_SHORT. The helper's field
    // entries (`field: "password"`) flow through verbatim — the same shape
    // every password-policy consumer projects for inline helperText.
    const passwordFieldErrors = validatePasswordPolicy(input.newPassword, t.authTranslations);
    if (passwordFieldErrors.length > 0) {
      throw new ValidationError(passwordFieldErrors[0].message, passwordFieldErrors);
    }

    // Hash BEFORE the transaction opens — plaintext never enters the tx.
    const passwordHash = await hashPassword(input.newPassword);

    const updated = await withTransaction(outerTx, async tx => {
      // Fenced write: `WHERE id = ? AND password_hash = <observed>` — the
      // TOCTOU guard against a concurrent adminSetUserPassword landing in
      // the compare/hash window.
      const written = await UserRepository.updatePassword(userId, passwordHash, false, tx, observedPasswordHash);
      // In-tx deleted-row guard — the self path's counterpart of the admin
      // path's returned-row check (`setUserPassword`). A soft delete sets
      // only `is_deleted`/`deleted_at`/`updated_at` — NEVER
      // `password_hash` — so a governance deletion committing INSIDE the
      // proof window (after the identity read, before this write) leaves
      // the fenced WHERE fully satisfied and the UPDATE would otherwise
      // rewrite a dead row's credential. Re-checking the RETURNING row
      // HERE — inside the tx, pre-commit — and throwing rolls the write
      // back (a check after `withTransaction` returns would be too late:
      // the top-level transaction has already committed by then). Net
      // effect: zero writes, and the SAME single denial — a mid-flight
      // deletion stays indistinguishable from a wrong current password
      // (identity is always the caller itself; no governance oracle).
      if (written !== null && written.isDeleted === true) {
        logger.logDomainError("Failed changeMyPassword: caller soft-deleted mid-flight (in-tx row check)", {
          code: "CURRENT_PASSWORD_INVALID",
          entity: "users",
          entityId: userId,
          locale,
        });
        throw new ValidationError("CURRENT_PASSWORD_INVALID", tErrors.currentPasswordInvalid, undefined, [
          { field: "currentPassword", code: "CURRENT_PASSWORD_INVALID", message: tErrors.currentPasswordInvalid },
        ]);
      }
      return written;
    });
    if (!updated) {
      // The fenced write matched zero rows: the verified caller's row
      // vanished, or its credential was rotated concurrently (admin
      // override — the admin's rotation survives untouched). Zero rows
      // touched; folded into the SAME single denial shape — no race oracle
      // (the concurrent-rotation case is indistinguishable from a wrong
      // current password by design).
      logger.logDomainError("Failed changeMyPassword: credential fence rejected the write", {
        code: "CURRENT_PASSWORD_INVALID",
        entity: "users",
        entityId: userId,
        locale,
      });
      throw new ValidationError("CURRENT_PASSWORD_INVALID", tErrors.currentPasswordInvalid, undefined, [
        { field: "currentPassword", code: "CURRENT_PASSWORD_INVALID", message: tErrors.currentPasswordInvalid },
      ]);
    }
    return stripPasswordHash(updated);
  }
}

/**
 * Updates `last_active_at` for a user. Fire-and-forget — failures are
 * swallowed + logged by the caller (login). Uses Drizzle's `update` API
 * directly (no service indirection) since this is a trivial touch.
 *
 * NOTE: the `role` claim on the rotated access token is set to a literal
 * "student" because we don't have the user's role in the refresh-token
 * payload. A future fix can either (a) include the role in the
 * refresh-token payload, or (b) fetch the user from the DB on refresh.
 * Today the role claim is unused (the context factory fetches the
 * user from DB by id), so this is a known cosmetic issue, not a security
 * regression.
 */
async function touchLastActiveAt(userId: number): Promise<void> {
  await db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, userId));
}
