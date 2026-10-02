/**
 * Auth service types — login + me + refreshToken DTOs.
 *
 * Design:
 *  - `AuthSession` is the service return shape for `login` — `user` (with
 *    `passwordHash` stripped) + the JWT pair (`accessToken`,
 *    `refreshToken`) + the opaque `sessionId`. The GraphQL `LoginPayload`
 *    exposes `user` + `accessToken` + `refreshToken` (NOT `sessionId` — the
 *    server controls the cookie; the client doesn't need the correlation id).
 *  - `RefreshResult` is the service return shape for `refreshToken` — the
 *    fresh JWT pair only (no user payload — the client already has the user
 *    in React memory; if it doesn't, it follows up with a `me` query).
 *  - The `accessToken`/`refreshToken` fields here are the raw JWT strings,
 *    not the `jose` payload objects. The route handler sets the
 *    `refreshToken` + `sessionId` as httpOnly cookies; the `accessToken`
 *    is returned in the mutation payload (React memory only).
 *
 * @see `docs/auth/REDIRECT_LOOP_FIX.md` for the token architecture rationale.
 */
import type { RegistrationReturnType } from "@/backend/types/users/registration.types";

/**
 * Submit input for the self-service password change
 * (`AuthService.changeMyPassword`).
 *
 * Closed two-key shape (property-mapped by callers — never a spread/echo of
 * transport payloads). Both members are PLAINTEXT passwords: they exist only
 * for the duration of the service call, are hashed before persistence, and
 * are never stored, logged, audited, or returned by any layer.
 */
export interface ChangeMyPasswordSubmitInput {
  /** The caller's current plaintext password — verified against the stored hash. */
  readonly currentPassword: string;
  /** The replacement plaintext password — policy-validated, then hashed. */
  readonly newPassword: string;
}

/**
 * Full authenticated session — returned by `AuthService.login`.
 *
 * The `user` field mirrors `RegistrationReturnType` (`UserSelectType` with
 * `passwordHash` omitted) so the same `UserPothosObject` serves both the
 * registration and login mutations.
 */
export interface AuthSession {
  /** Authenticated user with `passwordHash` stripped. */
  readonly user: RegistrationReturnType;
  /** Short-lived access token (15 min). Returned in the mutation payload. */
  readonly accessToken: string;
  /** Long-lived refresh token (7 days). Set as httpOnly cookie + returned in payload. */
  readonly refreshToken: string;
  /** Opaque session id (correlation handle). Set as httpOnly cookie. */
  readonly sessionId: string;
}

/**
 * Result of a `refreshToken` call — fresh JWT pair + new session id.
 *
 * Token rotation: every successful refresh issues a NEW refresh token (and
 * a new `sessionId`), invalidating the prior pair. The route handler sets
 * the new `refreshToken` + `sessionId` as httpOnly cookies; the
 * `accessToken` is returned in the payload (React memory only).
 */
export interface RefreshResult {
  /** Fresh short-lived access token. Returned in the mutation payload. */
  readonly accessToken: string;
  /** Fresh long-lived refresh token. Set as httpOnly cookie + returned in payload. */
  readonly refreshToken: string;
  /** New opaque session id. Set as httpOnly cookie. */
  readonly sessionId: string;
}
