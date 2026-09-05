/**
 * Shared resolver guards for GraphQL root-field resolvers.
 *
 * Centralizes the argument validation that used to be duplicated across the
 * admin user query and mutation files. Guards throw `ValidationError`
 * (a `DomainError` subclass) BEFORE any service call so it propagates with
 * `extensions.code` and boundary masking per
 * `docs/graphql/domain-error-extensions-code.md`.
 */
import { ValidationError } from "@/backend/lib/errors";

/**
 * Positive-safe-integer guard for ID arguments. Rejects `0`, negatives,
 * `NaN`, non-integers, and out-of-`Number.MAX_SAFE_INTEGER` values BEFORE
 * any DB round-trip.
 */
export function requirePositiveIntId(value: number | undefined | null, field: string): number {
  if (value === undefined || value === null) {
    throw new ValidationError(`${field} is required`);
  }
  if (!Number.isInteger(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new ValidationError(`${field} must be a positive safe integer`);
  }
  return value;
}
