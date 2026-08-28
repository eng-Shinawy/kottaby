/**
 * DomainError hierarchy — extends GraphQLError with `extensions.code`.
 *
 * Every backend service/repository error MUST be a `DomainError` subclass so
 * the `extensions.code` propagates through Apollo Server to the GraphQL
 * response's `errors[].extensions.code` field. Clients distinguish error types
 * by code (CONFLICT, VALIDATION, FORBIDDEN, UNAUTHORIZED, *_NOT_FOUND).
 *
 * @see docs/graphql/domain-error-extensions-code.md
 */

import { GraphQLError, type GraphQLErrorOptions } from "graphql";
import type { ApiFieldErrorType } from "@/backend/types";

/**
 * Base class for all domain errors. Sets `extensions.code` so Apollo Server
 * propagates it to the client.
 */
export class DomainError extends GraphQLError {
  constructor(
    public readonly code: string,
    message: string,
    options?: GraphQLErrorOptions
  ) {
    super(message, { ...options, extensions: { ...options?.extensions, code } });
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Resource not found. Code auto-generated as `${entity}_NOT_FOUND`.
 *
 * @example throw new NotFoundError("USER", "User not found")
 * // → extensions.code = "USER_NOT_FOUND"
 */
export class NotFoundError extends DomainError {
  constructor(entity: string, message: string, options?: GraphQLErrorOptions) {
    super(`${entity.toUpperCase()}_NOT_FOUND`, message, options);
  }
}

/** Authentication required (no session / invalid token). Code: `UNAUTHORIZED`. */
export class UnauthorizedError extends DomainError {
  constructor(message: string, options?: GraphQLErrorOptions) {
    super("UNAUTHORIZED", message, options);
  }
}

/** Authenticated but lacking permission. Code: `FORBIDDEN`. */
export class ForbiddenError extends DomainError {
  constructor(message: string, options?: GraphQLErrorOptions) {
    super("FORBIDDEN", message, options);
  }
}

/**
 * Input validation failure. Overloaded constructor:
 *
 * @example new ValidationError(message) // code = "VALIDATION"
 * @example new ValidationError("PASSWORD_TOO_SHORT", message) // custom code
 * @example new ValidationError(message, fields) // + field payload
 * @example new ValidationError("CODE", message, options, fields) // full form
 */
export class ValidationError extends DomainError {
  /**
   * Optional field-level payload: whitelist-projected entries built explicitly
   * by the producer — NEVER a spread/echo of client input; every property must
   * be property-mapped `{field, code, message}`.
   *
   * Presence semantics (consumed by the boundary finalizer/envelope layers):
   * `undefined` = absent → the transport omits `fields` entirely; an EMPTY
   * array is a deliberate present-but-empty payload and must survive to the
   * client unchanged. Entries are never null.
   */
  public readonly fields?: readonly ApiFieldErrorType[];

  constructor(message: string);
  constructor(code: string, message: string, options?: GraphQLErrorOptions);
  constructor(message: string, fields: readonly ApiFieldErrorType[]);
  constructor(
    code: string,
    message: string,
    options: GraphQLErrorOptions | undefined,
    fields: readonly ApiFieldErrorType[] | undefined
  );
  constructor(
    codeOrMessage: string,
    messageOrFieldsOrOptions?: string | readonly ApiFieldErrorType[] | GraphQLErrorOptions,
    optionsOrFields?: GraphQLErrorOptions | readonly ApiFieldErrorType[],
    fieldsArg?: readonly ApiFieldErrorType[]
  ) {
    let code: string;
    let message: string;
    let options: GraphQLErrorOptions | undefined;
    let fields: readonly ApiFieldErrorType[] | undefined;

    const second = messageOrFieldsOrOptions;
    if (typeof second === "string") {
      // Forms: (code, message) · (code, message, options) · (code, message, options?, fields?)
      code = codeOrMessage;
      message = second;
      if (optionsOrFields === undefined) {
        fields = fieldsArg;
      } else if (isFieldsPayload(optionsOrFields)) {
        fields = optionsOrFields;
      } else {
        options = optionsOrFields;
        fields = fieldsArg;
      }
    } else if (second === undefined) {
      // Form: () is unreachable — first param required; defensive defaults.
      code = "VALIDATION";
      message = codeOrMessage;
    } else if (isFieldsPayload(second)) {
      // Form: (message, fields)
      code = "VALIDATION";
      message = codeOrMessage;
      fields = second;
    } else {
      // Form: (message) · (message, options)
      code = "VALIDATION";
      message = codeOrMessage;
      options = second;
    }

    super(code, message, mergeFieldsIntoExtensions(options, fields));
    this.fields = fields;
  }
}

/**
 * Native discriminator for the field-payload branches. A locally-declared
 * predicate keeps `readonly ApiFieldErrorType[]` removal sound at BOTH call
 * sites (`Array.isArray` alone leaks `readonly` unions through its
 * `arg is any[]` signature) while staying assertion-free.
 */
function isFieldsPayload(value: unknown): value is readonly ApiFieldErrorType[] {
  return Array.isArray(value);
}

/**
 * Mirrors an explicit `fields` payload into `extensions.fields` so the
 * GraphQL transport carries it without per-boundary re-wiring while callers'
 * pre-existing extensions survive untouched. A ctor-supplied `fields` param
 * overrides any same-key extension entry passed by the caller.
 */
function mergeFieldsIntoExtensions(
  options: GraphQLErrorOptions | undefined,
  fields: readonly ApiFieldErrorType[] | undefined
): GraphQLErrorOptions {
  if (fields === undefined) {
    return options ?? {};
  }
  return { ...options, extensions: { ...options?.extensions, fields } };
}

/**
 * Conflict (duplicate email, handshake collision exhausted, etc.).
 * Overloaded constructor mirroring `ValidationError`:
 *
 * @example new ConflictError(message) // code = "CONFLICT" (default preserved)
 * @example new ConflictError("PLAN_ALREADY_ACTIVE", message) // custom code
 */
export class ConflictError extends DomainError {
  constructor(message: string, options?: GraphQLErrorOptions);
  constructor(code: string, message: string, options?: GraphQLErrorOptions);
  constructor(codeOrMessage: string, messageOrOptions?: string | GraphQLErrorOptions, options?: GraphQLErrorOptions) {
    if (typeof messageOrOptions === "string") {
      // Forms: (code, message) · (code, message, options)
      super(codeOrMessage, messageOrOptions, options);
    } else {
      // Forms: (message) · (message, options)
      super("CONFLICT", codeOrMessage, messageOrOptions);
    }
  }
}

/** Rate limit exceeded. Code: `RATE_LIMIT_EXCEEDED`. */
export class RateLimitExceededError extends DomainError {
  constructor(message: string, options?: GraphQLErrorOptions) {
    super("RATE_LIMIT_EXCEEDED", message, options);
  }
}

/**
 * Translates a raw database error into a DomainError when appropriate.
 *
 * PostgreSQL unique-violation (23505) → ConflictError.
 * SQLite UNIQUE constraint → ConflictError (best-effort code match).
 * Drizzle wraps PG errors in `DrizzleQueryError` with the original error in
 * `.cause` — we traverse the cause chain to find the PG error code.
 * Other errors pass through unchanged.
 */
export function translateDbError(error: unknown, conflictMessage: string): unknown {
  if (error instanceof DomainError) {
    return error;
  }
  if (hasPgCode(error, "23505") || hasSqliteUnique(error)) {
    return new ConflictError(conflictMessage, { cause: error instanceof Error ? error : undefined });
  }
  return error;
}

/**
 * Traverses the error + cause chain looking for a PG error with the given code.
 * Drizzle wraps PG errors in `DrizzleQueryError`; the original `pg.Error` (with
 * `.code === "23505"`) lives in `.cause`.
 */
function hasPgCode(error: unknown, code: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === code) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Traverses the error + cause chain looking for a SQLite UNIQUE constraint
 * violation (libsql / better-sqlite3).
 */
function hasSqliteUnique(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const message = current.message;
    if (message.includes("UNIQUE constraint failed") || message.includes("SQLITE_CONSTRAINT_UNIQUE")) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

// ─── Error-code taxonomy re-export ──────────────────────────────────────────
// The `backend/lib/errors/` directory hosts the error-boundary contract
// modules (taxonomy, masking/envelope helpers). Consumers keep importing
// everything from this flat module — `@/backend/lib/errors` resolves to THIS
// file (exact-file beats same-named directory in TS/bun resolution), so the
// taxonomy symbols flow through the established single barrel surface:
// `import { ERROR_CODE_HTTP_STATUS, isErrorCode } from "@/backend/lib/errors"`.
export * from "./errors/error-code-taxonomy";

// ─── Error masking & log-redaction re-export ────────────────────────────────
// Pure boundary finalizer utilities (`isDomainError`, `maskInternalError`,
// `redactLogContext`, `finalizeGraphqlErrors`) join the SAME single barrel:
// `import { finalizeGraphqlErrors } from "@/backend/lib/errors"`.
export * from "./errors/error-masking";
