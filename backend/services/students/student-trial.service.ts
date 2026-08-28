import { StudentRepository, UserRepository } from "@/backend/db/repo";
import { ConflictError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type { DBTransaction } from "@/backend/types";
import { FREE_TRIAL_SESSION_COUNT } from "@/shared/constants/free-trial.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Student trial provisioning domain service.
 *
 * Owns the one-time free-trial grant: invokes the atomic guarded UPDATE on the
 * students table, logs re-grant attempts as domain errors, and surfaces a
 * localized ConflictError when the grant-once marker is already set. This is
 * the single entry point used by registration today and by downstream student
 * creation flows (failed-applicant conversion, direct admin onboarding) in the
 * future — never call the repository method directly from outside this service.
 */
export namespace StudentTrialService {
  /**
   * Grants the free trial session credit to a student exactly once.
   *
   * The grant is atomic at the SQL level (single conditional UPDATE gated by
   * the trial_granted_at marker). On the happy path this method resolves
   * silently; on a re-grant attempt it logs structured context and throws a
   * localized ConflictError. The caller is responsible for ensuring the
   * studentId is server-derived (the primary key of a freshly inserted
   * students row inside the surrounding transaction).
   */
  export async function grantFreeTrial(studentId: number, locale: string, tx?: DBTransaction): Promise<void> {
    const granted = await StudentRepository.grantFreeTrialOnce(studentId, FREE_TRIAL_SESSION_COUNT, tx);
    if (!granted) {
      logger.logDomainError("Trial grant rejected: already granted", {
        code: "TRIAL_ALREADY_GRANTED",
        entity: "students",
        entityId: studentId,
        attempt: "1",
      });
      const translations = getServerTranslations(locale);
      throw new ConflictError(translations.errorsTranslations.trialAlreadyGranted);
    }
  }

  /**
   * Looks up the current trial-grant state for a student identified by their
   * login email. Resolves the user row by email, then reads the student row's
   * `trialGrantedAt` marker so the caller can decide whether to invoke the
   * grant. Used by idempotent bootstrap paths (e.g. seed factories) that must
   * avoid invoking the grant a second time on rows that already carry the
   * marker.
   *
   * @returns `{ studentId, trialGrantedAt }` when the email belongs to an
   *     existing student, otherwise `null` (no user, non-student role, or no
   *     student row).
   */
  export async function findTrialGrantStateByEmail(
    email: string,
    tx?: DBTransaction
  ): Promise<{ studentId: number; trialGrantedAt: Date | null } | null> {
    // `tx` is propagated to both lookups so the read can run inside a caller's
    // transaction scope (tests via `runInRollback`, future transactional seeds).
    // When `tx` is omitted, both repositories fall back to the global Drizzle
    // handle — required for the seed bootstrap path where rows are already
    // committed by the prior user-seed step.
    const user = await UserRepository.findByEmail(email, tx);
    if (!user) {
      return null;
    }
    const student = await StudentRepository.findById(user.id, tx);
    if (!student) {
      return null;
    }
    return { studentId: student.id, trialGrantedAt: student.trialGrantedAt };
  }
}
