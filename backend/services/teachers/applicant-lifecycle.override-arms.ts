/**
 * Applicant-lifecycle override write-arms — the three per-direction write
 * units behind `ApplicantLifecycleService.overrideApplicantEvaluation`
 * (certify / reject / grant-re-evaluation), extracted verbatim from
 * `applicant-lifecycle.service.ts` (size-budget split, zero behavior
 * change: same logic, same order of operations, same error handling).
 *
 * The arms are module-private write units in the original module and stay
 * transaction-bound here: each receives the shared per-direction context
 * (the caller's transaction + the guard-read pre-state) and returns the
 * audit `details` it composed. The BFLA actor gate, the status-guard read,
 * the audit-row persistence and the notification emit remain with the
 * service orchestrator.
 *
 * One deliberate post-extraction delta: the CERTIFY arm additionally
 * restores the `teacher` role of a previously converted (failed → student)
 * applicant through the shared conversion seam (see `applyCertifyOverride`)
 * — the same restore leg the rubric pass finalization composes.
 */
import { ApplicantRepository, TeacherRepository } from "@/backend/db/repo";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { ConflictError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { isUniqueViolation } from "@/backend/services/shared";
import { ApplicantConversionService } from "@/backend/services/teachers/applicant-conversion.service";
import {
  COOLDOWN_EXTENSION_MAX_DAYS,
  COOLDOWN_EXTENSION_MIN_DAYS,
  denyAlreadyCertified,
  MS_PER_DAY,
} from "@/backend/services/teachers/applicant-lifecycle.helpers";
import type { ApplicantOverrideAudit, DBTransaction } from "@/backend/types";
import type { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * The shared per-direction context the three override write-arms receive —
 * one object instead of five positional parameters, and the arms stay
 * module-private (they are transaction-bound write units, never API).
 */
export interface OverrideArmContext {
  readonly tx: DBTransaction;
  readonly applicantId: number;
  readonly locale: string;
  readonly t: ReturnType<typeof getServerTranslations>["errorsTranslations"];
}

/**
 * CERTIFY arm — the insert-or-elevate teacher write + the applicant
 * finalize. Certification is terminal: an already-certified applicant is
 * denied before any write.
 *
 * The SAME insert-or-elevate teacher arm the rubric pass finalization
 * composes: the collision-prone insert runs on a nested savepoint (a
 * `23505` rolls back TO the savepoint and rethrows here, leaving the
 * caller's transaction alive for the elevate arm below — PostgreSQL aborts
 * a transaction on ANY statement error); a pre-existing row is elevated
 * with the LOCKED row's OWN evaluator flag, never a blind `false`.
 *
 * After the finalize matches, the `teacher` role of a previously converted
 * (failed → student) applicant is restored on the SAME transaction through
 * the shared conversion helper — the guarded `student` → `teacher` flip,
 * a silent no-op for a never-converted applicant (already `teacher`). The
 * historical `students` row is never touched.
 *
 * @returns The audit `details` the applied override composed.
 */
export async function applyCertifyOverride(
  ctx: OverrideArmContext,
  fromStatus: ApplicantStatus
): Promise<ApplicantOverrideAudit> {
  const { tx, applicantId, locale, t } = ctx;
  if (fromStatus === ApplicantStatus.Passed) {
    denyAlreadyCertified(applicantId, locale, t.applicantAlreadyCertified);
  }

  try {
    await tx.transaction(sp => TeacherRepository.insertColdStartCertified(applicantId, false, sp));
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const locked = await TeacherRepository.findForEvaluationGateById(applicantId, tx);
    if (locked?.isApproved !== true) {
      if ((await TeacherRepository.elevateToCertified(applicantId, locked?.isEvaluator === true, tx)) === null) {
        // The FOR UPDATE read above pinned the row's unapproved state
        // — a zero-row elevate against that pin is an internal
        // inconsistency.
        throw new Error("ApplicantLifecycleService: teacher elevation matched zero rows for an unapproved row", {
          cause: error,
        });
      }
    }
  }

  // Finalize the applicant (`passed`, cooldown cleared). `false` is
  // practically unreachable post-guard (the row was just read and
  // guarded) — the fail-closed arm mirrors the rubric path instead of
  // widening the contract.
  const finalized = await ApplicantRepository.finalizeOnCertification(applicantId, tx);
  if (!finalized) {
    logger.logDomainError("Applicant override denied: already finalized", {
      code: "APPLICANT_ALREADY_FINALIZED",
      entity: "applicants",
      entityId: applicantId,
    });
    throw new ConflictError("APPLICANT_ALREADY_FINALIZED", t.applicantAlreadyFinalized);
  }

  // The finalize has committed its authoritative pre-state; restore the
  // teacher role of a previously converted (failed → student) applicant on
  // the SAME transaction, mirroring the rubric pass finalization. A
  // never-converted applicant is already `teacher`, so the guarded flip
  // matches zero rows — the documented silent no-op. The historical
  // `students` row is never touched.
  await ApplicantConversionService.restoreTeacherRole(applicantId, tx);

  return {
    action: "certify",
    field: "status",
    from: fromStatus,
    to: ApplicantStatus.Passed,
  };
}

/**
 * REJECT arm — the best-effort teacher demotion + the guarded applicant
 * flip with a stamped cooldown. Only a CERTIFIED applicant can be manually
 * rejected; the reject-direction length follows the
 * `adminSetUserSuspended` `periodDays` precedent (validated on the
 * rejecting direction, bounds `1..3650` whole days).
 *
 * @returns The audit `details` the applied override composed.
 */
export async function applyRejectOverride(
  ctx: OverrideArmContext,
  fromStatus: ApplicantStatus,
  cooldownDays: number | null
): Promise<ApplicantOverrideAudit> {
  const { tx, applicantId, locale, t } = ctx;
  if (fromStatus !== ApplicantStatus.Passed) {
    logger.logDomainError("Applicant override denied: applicant not certified", {
      code: "APPLICANT_OVERRIDE_NOT_PASSED",
      entity: "applicants",
      entityId: applicantId,
      locale,
    });
    throw new ValidationError("APPLICANT_OVERRIDE_NOT_PASSED", t.applicantOverrideNotPassed);
  }

  // Bounds validation — the reject-direction length (the
  // `adminSetUserSuspended` precedent: validated on the rejecting
  // direction, ignored elsewhere).
  if (
    cooldownDays === null ||
    !Number.isInteger(cooldownDays) ||
    cooldownDays < COOLDOWN_EXTENSION_MIN_DAYS ||
    cooldownDays > COOLDOWN_EXTENSION_MAX_DAYS
  ) {
    throw new ValidationError("APPLICANT_OVERRIDE_COOLDOWN_INVALID", t.applicantOverrideCooldownInvalid);
  }

  // Captured-now discipline — one instant joins the cooldown
  // arithmetic; the derived instant is stored verbatim downstream.
  const now = new Date();
  const cooldownUntil = new Date(now.getTime() + cooldownDays * MS_PER_DAY);

  // The demotion is the ONLY teacher-table write and only on reject —
  // best-effort by contract (a missing or already-unapproved row is a
  // legitimate no-op, never an error). No role flips anywhere.
  await TeacherRepository.demoteToUncertified(applicantId, tx);

  // Guarded write — the certified pre-state is re-evaluated atomically
  // at write time, so a concurrent certification collapses onto the
  // typed certified rejection instead of an illegal rejection.
  const rejected = await ApplicantRepository.overrideRejectOnce(applicantId, cooldownUntil, tx);
  if (rejected === null) {
    denyAlreadyCertified(applicantId, locale, t.applicantAlreadyCertified);
  }

  return {
    action: "reject",
    field: "status",
    from: fromStatus,
    to: ApplicantStatus.Failed,
    cooldownUntil: cooldownUntil.toISOString(),
    cooldownDays,
  };
}

/**
 * GRANT-RE-EVALUATION arm — the guarded cooldown clearance (status
 * untouched). Certification is terminal here too (a certified applicant
 * has no cooldown left to clear) and the terminal guard outranks the
 * no-cooldown check — the typed certified rejection wins for a passed
 * applicant even when its cooldown is also absent.
 *
 * @returns The audit `details` the applied override composed.
 */
export async function applyGrantReEvaluationOverride(
  ctx: OverrideArmContext,
  fromStatus: ApplicantStatus,
  fromCooldown: Date | null
): Promise<ApplicantOverrideAudit> {
  const { tx, applicantId, locale, t } = ctx;
  if (fromStatus === ApplicantStatus.Passed) {
    denyAlreadyCertified(applicantId, locale, t.applicantAlreadyCertified);
  }
  if (fromCooldown === null) {
    logger.logDomainError("Applicant override denied: no active cooldown to clear", {
      code: "APPLICANT_NO_ACTIVE_COOLDOWN",
      entity: "applicants",
      entityId: applicantId,
      locale,
    });
    throw new ValidationError("APPLICANT_NO_ACTIVE_COOLDOWN", t.applicantNoActiveCooldown);
  }

  // Guarded write — the non-terminal pre-states WITH a stamped
  // cooldown are re-evaluated atomically at write time, so a
  // concurrent certification (whose supersede NULLs the instant)
  // collapses onto the typed certified rejection.
  const cleared = await ApplicantRepository.clearCooldownOnce(applicantId, tx);
  if (cleared === null) {
    denyAlreadyCertified(applicantId, locale, t.applicantAlreadyCertified);
  }

  return {
    action: "grant_re_evaluation",
    field: "cooldown_until",
    from: fromCooldown.toISOString(),
    to: null,
  };
}
