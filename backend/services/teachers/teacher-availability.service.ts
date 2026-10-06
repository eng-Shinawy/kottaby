/**
 * TeacherAvailabilityService — the teacher-facing availability toggle.
 *
 * Responsibilities:
 *  - `getAvailability` — read the closed three-field availability
 *    projection (`id`, `isOnline`, `isApproved`) for the calling teacher.
 *  - `setAvailability` — write the MANUAL availability toggle inside ONE
 *    transaction and stamp the acting teacher's `last_active_at` inside
 *    that SAME transaction (the fresh toggle carries fresh activity).
 *    The certification gate and the in-session gate fire on
 *    the Available direction ONLY; the Unavailable direction is always
 *    allowed (an uncertified teacher may still go offline, and a teacher
 *    inside a session is already offline by the lifecycle lock).
 *
 * Disciplines enforced here:
 *  - Single-writer composition: the service composes WHEN to flip
 *    `teacher.is_online` for the MANUAL toggle. The direction-guarded
 *    `UPDATE … RETURNING` primitive
 *    (`TeacherRepository.setAvailabilityIntent`) is the write; this
 *    service decides whether it should fire. The transaction's
 *    certification-check `FOR UPDATE` teacher-row lock is the PRIMARY
 *    toggle-vs-start serialization; the Available direction's write-time
 *    guard is the defense-in-depth backstop for the race window the
 *    pre-check gate cannot cover.
 *  - Pre-DB shape validation: the caller-supplied teacher id is
 *    shape-checked (`Number.isSafeInteger(teacherId) && teacherId > 0`)
 *    before any database read, and the `isOnline` flag is checked as a
 *    strict boolean. A garbage shape denies with the localized
 *    `ValidationError` (`VALIDATION` code, HTTP 422) and touches ZERO
 *    rows — no repository call ever fires for a malformed input.
 *  - Transaction composition: every write path composes lock → gates →
 *    write → activity stamp inside ONE `withTransaction(tx, async innerTx
 *    => …)` call, with ONE captured `now` for the whole transaction.
 *    The caller's outer transaction is joined, never bypassed, and the
 *    global `db` handle is never touched inside the write path.
 *  - Gate order: on the Available (`isOnline === true`) direction, the
 *    certification gate (`isApproved !== true` → `ForbiddenError`/403) runs
 *    BEFORE the in-session gate (the reused seam →
 *    `ConflictError`/409). A non-certified teacher who also happens to be
 *    in a session sees the certification denial, not the state conflict.
 *    The Unavailable direction (`isOnline === false`) skips BOTH gates.
 *  - Logging: the happy path emits NOTHING. Each service-owned denial
 *    (certification gate, not-found, the post-write zero-row guards —
 *    the vanished-row 404 on the Unavailable direction and the
 *    race-closed 409 backstop on the Available direction) emits exactly
 *    ONE bounded `logger.logDomainError` call carrying
 *    `{ code, entity, entityId, locale }` only — never PII, never the
 *    submitted payload. The reused in-session gate owns its OWN bounded
 *    log call (it is consumed verbatim, never re-logged here).
 *  - Field-by-field projection: the returned object is built member by
 *    member, never a spread of the raw row. The nullable `isOnline` and
 *    `isApproved` columns are coerced to total booleans at this boundary
 *    (a stored `null` reads as `false`).
 *  - All user-facing strings resolve through
 *    `getServerTranslations(locale).errorsTranslations` (the one-arg
 *    bundle + property access); no hardcoded messages, no `console.*`.
 */

import { TeacherRepository, UserRepository } from "@/backend/db/repo";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertTeacherNotInActiveSession } from "@/backend/services/classes/session-lifecycle.enforcement";
import type { DBQueryExecutor, DBTransaction, TeacherAvailabilityReturnType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Pre-DB shape guard for the caller-supplied teacher id. A NaN, fractional,
 * out-of-safe-range, or non-positive identifier fails closed before any
 * database work — the id never reaches SQL.
 */
function isPositiveSafeTeacherId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Field-by-field projection of the stored teacher row into the closed
 * availability return shape. The nullable `isOnline` / `isApproved`
 * columns are coerced to total booleans at this boundary — a stored
 * `null` reads as `false` for both flags. The function never spreads the
 * raw row; only the three whitelisted members are mapped.
 */
function toAvailabilityReturnType(
  id: number,
  isOnline: boolean | null,
  isApproved: boolean | null
): TeacherAvailabilityReturnType {
  return {
    id,
    isOnline: isOnline ?? false,
    isApproved: isApproved ?? false,
  };
}

export namespace TeacherAvailabilityService {
  /**
   * Reads the calling teacher's availability projection.
   *
   * The caller-supplied teacher id is shape-checked as a positive safe
   * integer before any database read; a garbage shape denies with the
   * localized `ValidationError` (`VALIDATION` code, HTTP 422) and touches
   * zero rows. A missing teacher row logs one bounded domain-error entry
   * and surfaces the localized `NotFoundError` (`TEACHER_NOT_FOUND`,
   * HTTP 404). The happy path emits NOTHING — no log line on the success
   * branch.
   *
   * @param teacherId  The acting teacher's id (shared PK with `users.id`;
   *     at the resolver the id is derived from the verified access token,
   *     never a client-supplied argument).
   * @param locale  Active request locale (for the localized denial copy).
   * @returns The closed three-field availability projection.
   */
  export async function getAvailability(
    teacherId: number,
    locale: string,
    tx?: DBQueryExecutor
  ): Promise<TeacherAvailabilityReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;
    if (!isPositiveSafeTeacherId(teacherId)) {
      throw new ValidationError(t.validation);
    }

    const row = await TeacherRepository.findById(teacherId, tx);
    if (row === null) {
      logger.logDomainError("Teacher not found for availability read", {
        code: "TEACHER_NOT_FOUND",
        entity: "teacher",
        entityId: teacherId,
        locale,
      });
      throw new NotFoundError("TEACHER", t.teacherNotFound);
    }

    return toAvailabilityReturnType(row.id, row.isOnline, row.isApproved);
  }

  /**
   * Writes the manual availability toggle inside ONE transaction.
   *
   * The caller-supplied teacher id and the boolean flag are shape-checked
   * BEFORE any database read — a garbage shape denies with the localized
   * `ValidationError` (`VALIDATION` code, HTTP 422) and touches zero rows.
   * Inside the transaction the teacher row is locked for the
   * certification check, the ordered gates run on the Available direction
   * ONLY, and the guarded `UPDATE … RETURNING` primitive writes the flag.
   *
   * Gate order on the Available direction (`isOnline === true`):
   *  1. certification gate — `isApproved !== true` (including `null`) →
   *     `ForbiddenError` (`FORBIDDEN` code, HTTP 403). This is the
   *     ticket-accurate 403 "Not certified" outcome, distinct from the
   *     booking/rubric `TEACHER_NOT_CERTIFIED` validation toast (which
   *     lives on a different surface and CANNOT yield 403 — only
   *     `ForbiddenError` produces HTTP 403; a custom SCREAMING code
   *     normalizes to `null` in the taxonomy).
   *  2. in-session gate — the reused `assertTeacherNotInActiveSession`
   *     seam throws `ConflictError` (`TEACHER_IN_ACTIVE_SESSION`,
   *     HTTP 409) when a `started` session exists. The gate is consumed
   *     verbatim — it owns its OWN bounded log call, and the service
   *     adds no duplicate log.
   *
   * The Unavailable direction (`isOnline === false`) skips BOTH gates —
   * an uncertified teacher may still go offline, and a teacher inside a
   * session is already offline by the lifecycle lock. Same-value writes
   * are idempotent by construction (the guarded UPDATE returns the row
   * for a redundant same-value write).
   *
   * Race mechanics on the Available direction: the certification-check
   * `FOR UPDATE` teacher-row lock taken at the top of the transaction is
   * the PRIMARY serialization — every other teacher-row writer (a session
   * start's lock capture included) queues behind it for the whole toggle,
   * so the pre-check gates and the write observe one consistent ordering
   * and the lock — not the write — closes the toggle-vs-start race window
   * the pre-check gate alone cannot cover. The direction-guarded
   * primitive (`TeacherRepository.setAvailabilityIntent`) is the
   * defense-in-depth backstop: its `NOT EXISTS (started)` probe rides the
   * UPDATE's WHERE clause, and zero rows on that direction signal the
   * guard fired at write time (or the row vanished) — the teacher row's
   * existence is already proven in-transaction by the certification lock
   * — so the service raises the SAME localized `ConflictError`
   * (`TEACHER_IN_ACTIVE_SESSION`) the gate raises, sharing its message
   * source (one bounded log marks the service-owned backstop). Zero rows
   * on the Unavailable direction mean the row vanished mid-transaction —
   * the localized `NotFoundError` (`TEACHER_NOT_FOUND`).
   *
   * Activity stamp — after the guarded write lands (and the post-write
   * zero-row guard holds), the flow stamps the acting teacher's
   * `users.last_active_at` with ONE captured `now` inside the SAME
   * transaction, so the toggle and the freshness signal commit — or roll
   * back — atomically. The stamp is the repository's monotonic guarded
   * write; a boolean miss (an equal-or-fresher stored stamp) is a safe
   * no-op here, never a toggle failure.
   *
   * The happy path emits NOTHING. Each service-owned denial
   * (certification gate, not-found, the post-write zero-row guards) emits
   * exactly ONE bounded `logger.logDomainError` call carrying
   * `{ code, entity, entityId, locale }` only — never PII, never the
   * submitted payload.
   *
   * @param teacherId  The acting teacher's id (shared PK with `users.id`;
   *     at the resolver the id is derived from the verified access token,
   *     never a client-supplied argument).
   * @param isOnline  The target flag value (`true` = Available,
   *     `false` = Unavailable).
   * @param locale  Active request locale (for the localized denial copy).
   * @param tx  Optional outer transaction. When provided, the flow runs
   *     inside a SAVEPOINT on it; production callers omit it and the
   *     service opens its own transaction. The caller's outer transaction
   *     is joined, never bypassed, and the global `db` handle is never
   *     touched inside the write path.
   * @returns The closed three-field availability projection (the
   *     certification flag carried back is the value the write committed
   *     against — read off the locked row).
   */
  export async function setAvailability(
    teacherId: number,
    isOnline: boolean,
    locale: string,
    tx?: DBTransaction
  ): Promise<TeacherAvailabilityReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;
    if (!isPositiveSafeTeacherId(teacherId) || typeof isOnline !== "boolean") {
      throw new ValidationError(t.validation);
    }

    return withTransaction(tx, async innerTx => {
      const locked = await TeacherRepository.lockForCertificationCheck(teacherId, innerTx);
      if (locked === null) {
        logger.logDomainError("Teacher not found for availability toggle", {
          code: "TEACHER_NOT_FOUND",
          entity: "teacher",
          entityId: teacherId,
          locale,
        });
        throw new NotFoundError("TEACHER", t.teacherNotFound);
      }

      if (isOnline) {
        // Certification gate — a teacher row whose `isApproved` flag is
        // not strictly `true` (including a stored `null`) cannot be
        // toggled Available. Only `ForbiddenError` produces HTTP 403
        // (a custom SCREAMING code normalizes to `null` and cannot);
        // the denial is therefore the ticket-accurate 403 "Not
        // certified" outcome, distinct from the booking/rubric
        // `TEACHER_NOT_CERTIFIED` validation toast (different surface).
        if (locked.isApproved !== true) {
          logger.logDomainError("Teacher availability denied: not certified", {
            code: "FORBIDDEN",
            entity: "teacher",
            entityId: teacherId,
            locale,
          });
          throw new ForbiddenError(t.teacherNotCertified);
        }

        // In-session gate — a teacher inside a `started` session cannot
        // be toggled Available. The shipped seam gate is reused verbatim:
        // it owns its OWN bounded log call and throws the typed
        // conflict. The service adds no duplicate log.
        await assertTeacherNotInActiveSession(teacherId, innerTx, t);
      }

      // The service composes WHEN the flag is driven; the repo primitive
      // is the direction-guarded `UPDATE … RETURNING`. The FOR UPDATE
      // teacher-row lock held since the top of the transaction is the
      // primary toggle-vs-start serialization; the write-time direction
      // guard is the defense-in-depth backstop that the zero-row mapping
      // below translates into the conflict denial. A redundant same-value
      // write returns the row unchanged (idempotent under retry).
      const updated = await TeacherRepository.setAvailabilityIntent(teacherId, isOnline, innerTx);
      if (updated === null) {
        if (isOnline) {
          // Race-closed backstop — the Available direction matched zero
          // rows. The PRIMARY serialization is the certification-check
          // `FOR UPDATE` lock taken at the top of this transaction: it
          // serializes every teacher-row writer (a concurrent session
          // start included) for the whole toggle. This mapping is the
          // backstop on top of that lock — zero rows signal the
          // write-time guard fired (or the row vanished) while the row's
          // existence is already proven in-tx by the lock itself: the
          // SAME denial the gate itself raises, sharing its localized
          // message source (never a duplicate copy).
          logger.logDomainError("Teacher availability denied: in-session race detected at write", {
            code: "TEACHER_IN_ACTIVE_SESSION",
            entity: "teacher",
            entityId: teacherId,
            locale,
          });
          throw new ConflictError("TEACHER_IN_ACTIVE_SESSION", t.teacherInActiveSession);
        }
        // Unavailable direction — the row vanished mid-transaction; the
        // contract is defended: never return a phantom projection.
        logger.logDomainError("Teacher not found for availability toggle write", {
          code: "TEACHER_NOT_FOUND",
          entity: "teacher",
          entityId: teacherId,
          locale,
        });
        throw new NotFoundError("TEACHER", t.teacherNotFound);
      }

      // One captured now for the whole transaction (one-now discipline).
      const activityNow = new Date();
      await UserRepository.updateLastActiveAt(teacherId, activityNow, innerTx);

      return toAvailabilityReturnType(updated.id, updated.isOnline, locked.isApproved);
    });
  }
}
