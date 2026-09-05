/**
 * Shared user-provisioning helpers composed by BOTH the public registration
 * flow (`RegistrationService`) and the admin user-creation flow
 * (`AdminUserManagementService.createUser`). Extracted so the two write
 * paths keep composing the SAME DEV1-002 primitives (single-source rule —
 * see `docs/admin/user-management.md` "DO NOT touch the registration write
 * path" and `docs/auth/user-registration.md` §2 handshake contract):
 *
 *  - `isValidEmail` — RFC-5322-lite email shape guard (the DB unique
 *    constraint on `users.email` remains the authoritative guard).
 *  - `generateHandshakeCode` / `isUniqueViolation` /
 *    `createStudentWithHandshakeRetry` — `KSB-<8 uppercase alphanumeric>`
 *    generation, PG `23505` / SQLite cause-chain detection, and the bounded
 *    in-transaction collision retry (`HANDSHAKE_RETRY_LIMIT = 5`).
 *  - `createRoleChild` — the role→child-table dispatch (`students` /
 *    `applicants` / `parents`). The student branch is injected per caller
 *    because the surfaces diverge there BY CONTRACT: registration appends
 *    the one-time free-trial grant (`StudentTrialService.grantFreeTrial`)
 *    in the same transaction, while the admin path deliberately omits it
 *    (trial lane dormant), and each surface throws its own ConflictError
 *    shape on retry-budget exhaustion.
 */

import { randomUUID } from "node:crypto";
import { ApplicantRepository, ParentRepository, StudentRepository } from "@/backend/db/repo";
import { logger } from "@/backend/lib/logger";
import type { DBTransaction, RegisterPublicRole } from "@/backend/types";

/** Bounded retry budget for handshake-code collision on student creation. */
const HANDSHAKE_RETRY_LIMIT = 5;

import { isValidEmail } from "@/shared/lib/email";

export { isValidEmail };

/**
 * Generates a fresh `handshake_code` of the form `KSB-<8 uppercase alphanumeric>`.
 *
 * Uses `crypto.randomUUID()` for entropy (matching the `varchar(50)` column
 * constraint with comfortable headroom). Pure — no I/O, no module-level
 * mutable state.
 */
export function generateHandshakeCode(): string {
  const hex = randomUUID().replace(/-/g, "").toUpperCase();
  return `KSB-${hex.slice(0, 8)}`;
}

/**
 * Detects a PostgreSQL unique-violation (`23505`) or SQLite equivalent on a
 * thrown error. Traverses the Drizzle `DrizzleQueryError.cause` chain to
 * find the original PG error code. Used by the handshake retry loop to
 * decide whether to retry vs. surface the error.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === "23505") {
      return true;
    }
    const message = current.message;
    if (message.includes("UNIQUE constraint failed") || message.includes("SQLITE_CONSTRAINT_UNIQUE")) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Inserts the role-specific child row inside the caller's transaction.
 *  - student → delegated to the caller-injected `insertStudentRows` hook
 *    (registration appends the free-trial grant; the admin path omits it).
 *  - teacher → `applicants` row with `status='pending'` (NO `teacher` row —
 *    the certification step belongs to the verification loop; INV-TV1).
 *  - parent → `parents` row (PK only).
 */
export async function createRoleChild(
  userId: number,
  role: RegisterPublicRole,
  tx: DBTransaction,
  insertStudentRows: (userId: number, tx: DBTransaction) => Promise<void>
): Promise<void> {
  switch (role) {
    case "student": {
      await insertStudentRows(userId, tx);
      return;
    }
    case "teacher": {
      await ApplicantRepository.create(userId, tx);
      return;
    }
    case "parent": {
      await ParentRepository.createForRegistration(userId, tx);
      return;
    }
    default: {
      // Exhaustiveness guard — the type union guarantees this is unreachable.
      const exhaustive: never = role;
      throw new Error(`Unexpected role: ${String(exhaustive)}`);
    }
  }
}

/**
 * Inserts the `students` row, retrying handshake-code generation on
 * unique-violation up to `HANDSHAKE_RETRY_LIMIT` times. On exhaustion,
 * throws the caller-built `ConflictError` and logs via
 * `logger.logDomainError` (never `console.*`).
 *
 * Per-surface differences stay with the caller and arrive as parameters:
 *  - `boundary` — the log-message boundary label (`"registration"` /
 *    `"admin user creation"`) so the emitted strings stay byte-identical.
 *  - `buildExhaustedError` — builds the exact error contract each surface
 *    throws when the retry budget is exhausted.
 */
export async function createStudentWithHandshakeRetry(
  userId: number,
  tx: DBTransaction,
  boundary: string,
  buildExhaustedError: (cause: Error | undefined) => Error
): Promise<void> {
  // Recursive helper — avoids `no-await-in-loop` (sequential retry is
  // intentional: each attempt depends on the prior failing). Recursion
  // depth is bounded by `HANDSHAKE_RETRY_LIMIT` (5) so stack safety is a
  // non-issue.
  const attemptInsert = async (attempt: number, lastError: unknown): Promise<void> => {
    if (attempt > HANDSHAKE_RETRY_LIMIT) {
      // Budget exhausted — surface via the per-surface error contract.
      logger.logDomainError(`Handshake code retry budget exhausted during ${boundary}`, {
        code: "HANDSHAKE_EXHAUSTED",
        entity: "students",
        entityId: userId,
        attempts: String(HANDSHAKE_RETRY_LIMIT),
      });
      throw buildExhaustedError(lastError instanceof Error ? lastError : undefined);
    }
    const handshakeCode = generateHandshakeCode();
    try {
      await StudentRepository.createForRegistration(userId, handshakeCode, tx);
      return;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        // Non-collision error — surface immediately; the outer translateDbError
        // will decide if it's a 23505 on email or another failure.
        throw error;
      }
      // Collision on handshake_code — retry within the same tx.
      logger.logDomainError(`Handshake code collision during ${boundary}`, {
        code: "HANDSHAKE_COLLISION",
        entity: "students",
        entityId: userId,
        attempt: String(attempt),
      });
      return attemptInsert(attempt + 1, error);
    }
  };
  return attemptInsert(1, null);
}
