/**
 * StudentHandshakeService — read-only domain service for the two
 * handshake-code surfaces: the student self-read and the parent discovery
 * lookup.
 *
 * Responsibilities:
 *  1. `getMyHandshakeCode` — the caller's own handshake code, derived
 *     EXCLUSIVELY from the supplied user id (the GraphQL resolver passes
 *     `ctx.user.id`; the query is zero-argument by construction). A user id
 *     with no `students` row (a registration-defect edge — e.g. a non-student
 *     id) rejects with a localized `NotFoundError` (`STUDENT_NOT_FOUND`).
 *  2. `findStudentByHandshakeCode` — parent discovery by the code itself,
 *     treated as the out-of-band capability (the legitimate parent learned it
 *     from the child). Strictly ordered: normalize then validate the input
 *     (a malformed code rejects with a localized `ValidationError` BEFORE any
 *     database read), read the discovery row (transaction propagated when the
 *     caller owns one), collapse governed children into `null` (byte-identical
 *     to a code that never existed), and answer with the minimal two-key
 *     payload — masked confirmation plus the linkable signal, nothing else.
 *
 * Disciplines enforced here:
 *  - Not-found is a nullable payload, never an error, on the discovery path:
 *    a valid-format code matching no eligible student answers `null` — a
 *    first-class UI state, and the same null channel hides governance
 *    exclusions so "never existed" and "governed" stay indistinguishable.
 *  - Logging: `logger.logDomainError` fires ONLY on the two enumerated
 *    expected rejections (malformed code, missing own student row), with a
 *    bounded context bag (`code`, `entity: "students"`, the entity id when
 *    known, `locale`). The SUBMITTED code string is never logged — not even
 *    after validation. Every happy path — including discovery misses and
 *    governance collapses — emits NOTHING. Unexpected internals are never
 *    caught here: they bubble up unswallowed to the GraphQL masking boundary,
 *    which owns the single correlated `logger.error` line.
 *  - Zero writes, zero audit/notification rows, zero side effects — both
 *    flows are pure reads; no locks, no caching, no module-level state.
 *  - All user-facing messages resolve through
 *    `getServerTranslations(locale).errorsTranslations` (property access
 *    only); never hardcoded strings, never `console.*`.
 *  - The discovery payload is closed by construction (`maskedName` +
 *    `linkable`): no database identifiers, no contact fields, no governance
 *    state, no raw `parentId` — the linkable signal is computed server-side.
 */
import { StudentRepository } from "@/backend/db/repo";
import { NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { isGovernanceExcludedFromDiscovery } from "@/backend/services/students/student-handshake.helpers";
import type { DBTransaction, HandshakeCodeLookupReturnType } from "@/backend/types";
import { isHandshakeCode, normalizeHandshakeCode } from "@/shared/constants/handshake-code.constants";
import { maskFullName } from "@/shared/lib/mask-full-name";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Entity label passed to `NotFoundError` — the code is auto-generated as
 * `STUDENT_NOT_FOUND` (entity name, never the full code).
 */
const STUDENT_ENTITY = "STUDENT";

export namespace StudentHandshakeService {
  /**
   * Returns the caller's own handshake code.
   *
   * Identity comes only from the argument — the resolver passes
   * `ctx.user.id`, and the GraphQL query accepts no input, so there is no
   * caller-supplied identity surface. The read is a single-column equality
   * lookup on the shared primary key (`students.id` ≡ `users.id`).
   *
   * @param studentUserId  The authenticated caller's user id (shared PK).
   * @param locale         Active request locale (for the localized message).
   * @returns The stored handshake code, verbatim.
   * @throws NotFoundError  code `STUDENT_NOT_FOUND` when no `students` row
   *     exists for the id (localized message; logged once as a domain
   *     rejection).
   */
  export async function getMyHandshakeCode(studentUserId: number, locale: string): Promise<string> {
    const t = getServerTranslations(locale).errorsTranslations;

    const handshakeCode = await StudentRepository.findHandshakeCodeByStudentId(studentUserId);
    if (handshakeCode === null) {
      logger.logDomainError("Handshake self-read rejected: no student record for caller", {
        code: "STUDENT_NOT_FOUND",
        entity: "students",
        entityId: studentUserId,
        locale,
      });
      throw new NotFoundError(STUDENT_ENTITY, t.studentHandshakeNotFound);
    }
    return handshakeCode;
  }

  /**
   * Parent discovery by handshake code — the code IS the capability.
   *
   * Ordered contract (each step strictly before the next):
   *  1. Normalize (trim, then uppercase) and validate against the canonical
   *     pattern — a malformed input rejects with a localized
   *     `ValidationError` BEFORE any database read, and the submitted string
   *     is never logged.
   *  2. Read the discovery row (students⋈users on the shared PK); the caller's
   *     transaction is propagated verbatim when one is supplied.
   *  3. A miss answers `null` (never an error) — a first-class UI state.
   *  4. A governed child (deleted, blocked, actively suspended — evaluated
   *     fail-closed against one captured instant) collapses to the SAME
   *     `null`: no observer can distinguish "never existed" from "governed".
   *  5. The payload is exactly `{ maskedName, linkable }` — the deterministic
   *     name mask plus the server-computed linkable signal; the raw
   *     `parentId` never leaves this service.
   *
   * @param code    The submitted handshake code (normalized before use).
   * @param locale  Active request locale (for the localized message).
   * @param tx      Optional caller-owned transaction — propagated to the
   *     repository read so a caller's atomic flow stays atomic.
   * @returns The minimal confirmation payload, or `null` when the code is
   *     valid but matches no eligible student.
   * @throws ValidationError  code `VALIDATION` when the normalized input does
   *     not match the canonical code shape (localized message; logged once
   *     as a domain rejection, without the submitted value).
   */
  export async function findStudentByHandshakeCode(
    code: string,
    locale: string,
    tx?: DBTransaction
  ): Promise<HandshakeCodeLookupReturnType | null> {
    const t = getServerTranslations(locale).errorsTranslations;

    // 1. Normalize THEN validate — strictly before any database read.
    const normalized = normalizeHandshakeCode(code);
    if (!isHandshakeCode(normalized)) {
      logger.logDomainError("Handshake discovery rejected: malformed code submitted", {
        code: "VALIDATION",
        entity: "students",
        locale,
      });
      throw new ValidationError(t.handshakeCodeInvalid);
    }

    // 2. Discovery read — transaction propagated when the caller owns one.
    const row = await StudentRepository.findDiscoveryByHandshakeCode(normalized, tx);

    // 3. Miss → the nullable payload (never an error).
    if (row === null) {
      return null;
    }

    // 4. Governance collapse → indistinguishable from a nonexistent code.
    if (isGovernanceExcludedFromDiscovery(row, new Date())) {
      return null;
    }

    // 5. Minimal two-key payload — closed by the canonical return type.
    return {
      maskedName: maskFullName(row.fullName),
      linkable: row.parentId === null,
    };
  }
}
