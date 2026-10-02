/**
 * ApplicantConversionService — the role-child conversion seam of the
 * applicant lifecycle.
 *
 * `convertToStudent` is the effect a failed rubric finalization applies to
 * the evaluated applicant: a `students` role-child row for the applicant's
 * user id (shared PK) with zeroed balances, no parent linkage, and a fresh
 * unique `KSB-XXXXXXXX` handshake code, plus the guarded
 * `teacher` → `student` role flip that makes every student-gated surface
 * reachable while the applicant serves their re-application cooldown. The
 * `applicants` row is NEVER touched here — the verdict write owns it.
 *
 * `restoreTeacherRole` is the effect a re-certification pass applies: the
 * guarded `student` → `teacher` role flip. The `students` row is never
 * touched — the historical record of the conversion survives
 * re-certification — and a never-converted applicant (role already
 * `teacher`) makes the guarded flip match zero rows, which is the
 * documented silent no-op.
 *
 * Both operations join the CALLER's transaction: every read and write runs
 * on the supplied `tx` and no transaction is ever opened here, so the
 * verdict and the conversion commit — or roll back — as one atomic unit.
 *
 * Idempotency: the conversion probes for an existing `students` row first.
 * A row present means this user has already been converted (a replayed
 * finalization, or a re-failure after a re-certification), so the insert is
 * skipped and only the role coherence is re-ensured — the replay is a safe
 * no-op. The role flip itself is a guarded single-statement UPDATE that
 * pins the expected source role, so a replay can never double-apply.
 *
 * The guarded flip reports a zero-row match as `false`; the service tier
 * decides what that means. For the conversion direction a `false` with no
 * prior `students` row contradicts the applicant invariant (a failing
 * applicant IS a teacher at evaluation time) — an internal server-side
 * consistency failure surfaced as a plain `Error`, not a localized
 * user-facing denial. The `students` insert reuses the shared provisioning
 * helper (single generation + bounded collision-retry implementation), so
 * the retry budget exhaustion surfaces the localized conflict and rolls the
 * caller's whole transaction back.
 */

import { StudentRepository, UserRepository } from "@/backend/db/repo";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ConflictError } from "@/backend/lib/errors";
import { createStudentWithHandshakeRetry } from "@/backend/services/shared";
import type { DBTransaction } from "@/backend/types";
import type { getServerTranslations } from "@/shared/locale/server-graphql";

/** The localized errors handle threaded from the caller. */
type ErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

export namespace ApplicantConversionService {
  /**
   * Converts a failed teacher applicant into a student, atomically with the
   * caller's transaction: the zeroed `students` row (fresh unique handshake
   * code, no parent) plus the guarded `teacher` → `student` role flip.
   *
   * Idempotent: an existing `students` row short-circuits the insert and
   * only the role coherence is re-ensured. A flip that matches zero rows
   * with no prior `students` row means the user was never a `teacher` —
   * an internal invariant violation thrown as a plain `Error` (the caller's
   * transaction rolls back, so no half-converted state can persist).
   *
   * @param applicantUserId the server-resolved applicant user id (never a
   *                        wire-supplied value — the evaluated session's
   *                        applicant, or the admin certification target).
   * @param tx              the caller's transaction — REQUIRED, joined, never opened.
   * @param t               the localized errors bundle threaded from the caller.
   * @throws ConflictError when the handshake-code retry budget is exhausted
   *                       (localized, carries the collision cause).
   * @throws Error         (plain, internal) when the guarded flip matches
   *                       zero rows on a first conversion — the user's role
   *                       was not `teacher`.
   */
  export async function convertToStudent(
    applicantUserId: number,
    tx: DBTransaction,
    t: ErrorsTranslations
  ): Promise<void> {
    // Idempotency probe: a `students` row for this id means the conversion
    // already happened — skip the insert, keep the historical row (its
    // handshake code is never regenerated), and only re-ensure the role.
    const existingHandshakeCode = await StudentRepository.findHandshakeCodeByStudentId(applicantUserId, tx);

    if (existingHandshakeCode === null) {
      // First conversion: the shared provisioning helper owns the
      // `KSB-XXXXXXXX` generation, the bounded collision retry, and the
      // exhaustion contract. The row lands with zeroed balances and no
      // parent linkage; the localized conflict on budget exhaustion rolls
      // the caller's whole transaction back.
      await createStudentWithHandshakeRetry(
        applicantUserId,
        tx,
        "applicant conversion",
        cause => new ConflictError("HANDSHAKE_EXHAUSTED", t.adminUsers.handshakeExhausted, { cause })
      );
    }

    // The role coherence runs on EVERY path (fresh conversion, idempotent
    // replay, re-conversion after re-certification): the flip is guarded on
    // the stored role, so a replay on an already-converted user matches
    // zero rows harmlessly.
    const flipped = await UserRepository.transitionRoleOnce(applicantUserId, UserRole.Teacher, UserRole.Student, tx);
    if (!flipped && existingHandshakeCode === null) {
      // No prior row and the flip matched zero rows — the stored role was
      // not `teacher`, contradicting the applicant invariant. Internal
      // consistency failure: a plain Error, not a localized denial (the
      // caller's transaction rolls back — no half-converted state).
      throw new Error("ApplicantConversionService: role flip matched zero rows for a non-teacher applicant");
    }
  }

  /**
   * Restores the teacher role of a re-certified applicant: the guarded
   * `student` → `teacher` role flip on the caller's transaction.
   *
   * A never-converted applicant (role already `teacher`) makes the guarded
   * flip match zero rows — the documented silent no-op, the return value is
   * intentionally discarded. The `students` row is never touched: the
   * historical record of the conversion survives re-certification.
   *
   * @param applicantUserId the server-resolved applicant user id.
   * @param tx              the caller's transaction — REQUIRED, joined, never opened.
   */
  export async function restoreTeacherRole(applicantUserId: number, tx: DBTransaction): Promise<void> {
    await UserRepository.transitionRoleOnce(applicantUserId, UserRole.Student, UserRole.Teacher, tx);
  }
}
