/**
 * Password length bounds — the single source shared by every
 * credential-SET surface (public registration, admin user creation, the
 * self-service change, the admin set) and the login-side verify bound.
 *
 * bcrypt consumes only the first 72 UTF-8 bytes of its input, so password
 * CONTENT beyond that boundary is cryptographically irrelevant — the
 * ceiling is payload hygiene (keeping megabyte-scale arguments off the
 * bcrypt hash/compare), NOT a password policy. Its load-bearing property
 * is AGREEMENT: a password accepted at set-time must never be one the
 * login argument bound silently denies — bcrypt would have verified the
 * truncated prefix, yet the login-side rejection answers with the generic
 * invalid-credentials error, locking the account out with a misleading
 * message. Set-time surfaces reject over-ceiling replacements with a
 * field-targeted `PASSWORD_TOO_LONG` validation error (the caller is told
 * how to fix it); the login resolver folds its check into the generic
 * invalid-credentials denial (no oracle on the wire).
 */

/** Maximum accepted password length, in UTF-16 code units. */
export const MAX_PASSWORD_LENGTH = 1_024;
