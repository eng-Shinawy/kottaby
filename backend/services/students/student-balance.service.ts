/**
 * StudentBalanceService — read-only domain service for the student-facing
 * session-credit balance read.
 *
 * Responsibilities:
 *  - `getMySessionBalance` — the caller's own prepaid session-credit lanes,
 *    derived EXCLUSIVELY from the supplied user id (the GraphQL resolver
 *    passes `ctx.user.id`; the query is zero-argument by construction). The
 *    `students` row shares its primary key with `users.id`, so the read is
 *    a single equality lookup on the shared PK. A user id with no
 *    `students` row (a registration-defect edge — e.g. a non-student id)
 *    rejects with a localized `NotFoundError` (`STUDENT_NOT_FOUND`).
 *
 * Domain context: each `balance_*` column counts PRE-PAID session credits
 * for one booking lane. The booking flow spends those credits through the
 * debit ladder — the trial lane is drawn first, then the intent lane —
 * while subscription activation credits and refunds replenish them. THIS
 * service is a plain row read: it projects the stored counters verbatim and
 * carries NONE of the ladder logic (no spendability computation, no lane
 * preference, no arithmetic).
 *
 * Disciplines enforced here:
 *  - Zero writes, zero locks, zero audit/notification rows, zero side
 *    effects — a pure read; no caching, no module-level state.
 *  - Logging: `logger.logDomainError` fires ONLY on the one enumerated
 *    expected rejection (missing own student row), with a bounded context
 *    bag (`code`, `entity`, the entity id, `locale`). Every happy path
 *    emits NOTHING. Unexpected internals are never caught here: they bubble
 *    up unswallowed to the GraphQL masking boundary, which owns the single
 *    correlated `logger.error` line.
 *  - All user-facing messages resolve through
 *    `getServerTranslations(locale).errorsTranslations` (property access
 *    only); never hardcoded strings, never `console.*`. The rejection
 *    reuses the repo's shared no-student-record message — the same
 *    localized sentence the booking pipeline's student-missing denial
 *    surfaces — so one situation reads identically wherever it can arise.
 *  - The payload is closed by construction (`balanceTrial` + `balanceHifz`
 *    + `balanceTajweed` + `balanceReviews`): no identifiers, no contact
 *    fields, no governance state — the four lane counters only, with the
 *    honest column nullability preserved (the nullable purchased lanes are
 *    surfaced as `null`, never fabricated into zeros).
 */
import { StudentRepository } from "@/backend/db/repo";
import { NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type { StudentSessionBalanceReturnType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Entity label passed to `NotFoundError` — the code is auto-generated as
 * `STUDENT_NOT_FOUND` (entity name, never the full code).
 */
const STUDENT_ENTITY = "STUDENT";

export namespace StudentBalanceService {
  /**
   * Returns the caller's own prepaid session-credit lanes.
   *
   * Identity comes only from the argument — the resolver passes
   * `ctx.user.id`, and the GraphQL query accepts no input, so there is no
   * caller-supplied identity surface. The read is a single primary-key
   * equality lookup (`students.id` ≡ `users.id`); it acquires no locks.
   *
   * @param studentUserId  The authenticated caller's user id (shared PK).
   * @param locale         Active request locale (for the localized message).
   * @returns The four lane counters with the honest column nullability —
   *     `balanceTrial` is the NOT NULL lane; the three purchased lanes pass
   *     their nullable columns through verbatim.
   * @throws NotFoundError  code `STUDENT_NOT_FOUND` when no `students` row
   *     exists for the id (localized message; logged once as a domain
   *     rejection).
   */
  export async function getMySessionBalance(
    studentUserId: number,
    locale: string
  ): Promise<StudentSessionBalanceReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    const row = await StudentRepository.findById(studentUserId);
    if (row === null) {
      logger.logDomainError("Balance self-read rejected: no student record for caller", {
        code: "STUDENT_NOT_FOUND",
        entity: "students",
        entityId: studentUserId,
        locale,
      });
      throw new NotFoundError(STUDENT_ENTITY, t.studentHandshakeNotFound);
    }
    return {
      balanceTrial: row.balanceTrial,
      balanceHifz: row.balanceHifz,
      balanceTajweed: row.balanceTajweed,
      balanceReviews: row.balanceReviews,
    };
  }
}
