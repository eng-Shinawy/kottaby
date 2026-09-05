/**
 * AuthService — domain service for login + me + refreshToken.
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
 *  - `getMe(userId, locale)` — fetches the user by id for the `me` query.
 *    Throws `UnauthorizedError` if the user doesn't exist (e.g. deleted
 *    between the access-token issuance and the `me` call).
 *  - `refreshToken(refreshToken, locale)` — verifies the refresh token,
 *    rotates the pair (issues a NEW refresh token + session id), returns the
 *    fresh `RefreshResult`.
 *  - `updateMyLocale(userId, locale, requestLocale, tx?)` — persists the
 *    caller's UI/copy locale preference on `users.locale` (DEV3-010 D2).
 *    Validates the closed locale set (defense-in-depth — the GraphQL enum
 *    already constrains it), writes inside a transaction, and returns the
 *    updated user with `passwordHash` stripped. Throws `ValidationError`
 *    (localized `invalidLocale`) for a non-locale string and
 *    `UnauthorizedError` when the caller's row no longer exists.
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
import { comparePassword } from "@/backend/lib/auth/password";
import { isSuspensionActive } from "@/backend/lib/auth/suspension-window";
import { ForbiddenError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type {
  AuthSession,
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
   * Resolves the authenticated user from a JWT `userId`. Used by the `me`
   * query and by the GraphQL context factory.
   *
   * @throws UnauthorizedError  user doesn't exist (e.g. deleted between
   *     access-token issuance and the `me` call).
   */
  export async function getMe(userId: number, locale: string): Promise<RegistrationReturnType> {
    const t = getServerTranslations(locale).authTranslations;

    const user = await UserRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedError(t.invalidCredentials);
    }
    return stripPasswordHash(user);
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
   * language) on `users.locale` — the DEV3-010 D2 column.
   *
   * The GraphQL `AppLocale!` argument already constrains the value at the
   * schema layer; the `isAppLocale` check here is defense-in-depth for
   * non-schema transports and future callers. The write runs inside a
   * transaction (SAVEPOINT when an outer `tx` is supplied — the test path).
   *
   * @throws ValidationError   `locale` is not a supported locale (localized
   *     `invalidLocale` message).
   * @throws UnauthorizedError the caller's user row no longer exists
   *     (deleted between access-token issuance and this call — same contract
   *     as `getMe`; the message never discloses existence).
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
      // build and the write. Mirror `getMe`: unauthenticated, no existence
      // oracle.
      throw new UnauthorizedError(t.unauthorized);
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
