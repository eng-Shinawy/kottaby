/**
 * TeacherReEvaluationService — the admin-ordered paid re-evaluation: an
 * admin moves a currently-certified teacher back through the five-session
 * evaluation loop and the re-evaluation fee is debited from the teacher's
 * own wallet (the teacher pays for the re-assessment).
 *
 * One call executes ONE transaction whose stages are, in order:
 *  1. Governance gate — the strict admin gate (`assertActorAdminActive`)
 *     re-asserts the caller is a real, admin-role, non-governed actor INSIDE
 *     the transaction (defense in depth behind the resolver's authScopes):
 *     deleted/blocked/suspended admins are denied even while holding a valid
 *     token.
 *  2. Subject eligibility — the teacher row must exist and be currently
 *     certified (`is_approved = true`); the subject is a certified teacher
 *     (a wallet-bearing teacher row), never a never-certified applicant.
 *  3. Loop re-entry eligibility — the subject's `applicants` row must be
 *     `passed`; an applicant already in the loop (or failed/pending) has
 *     nothing to re-open.
 *  4. Wallet provisioning — a teacher with no wallet history gets an honest
 *     zeroed wallet (idempotent `ensureWalletOnce`) before the debit.
 *  5. Guarded fee debit — the fee rides the EXISTING shared debit writer
 *     (`debitAdjustmentOnce`): ONE `UPDATE … WHERE balance >= amount`
 *     followed by ONE `withdrawal/completed` ledger row carrying the
 *     service-composed description. `total_earning` is never touched — a
 *     deduction spends the balance, it does not rewrite lifetime earnings.
 *     No forked debit primitive exists in this service.
 *  6. De-certification — the guarded `decertifyOnce` flips `is_approved`
 *     true → false, which structurally excludes the teacher from booking
 *     surfaces for the duration of the re-evaluation.
 *  7. Loop re-open — the guarded `reopenForReEvaluation` moves the
 *     applicant `passed → in_evaluation` and stamps a fresh cycle anchor.
 *  8. Post-debit read-back — the wallet is re-read so the response carries
 *     the converged balance without a client refetch.
 *  9. Audit — exactly ONE `audit_logs` row (action `override`, entity
 *     `teacher`) through the single canonical writer, sharing the
 *     transaction's commit/rollback fate.
 *  10. Return — the verbatim charged fee, the currency, the post-debit
 *      balance, and the fresh cycle anchor.
 *
 * Exactly-once ordering: the two guarded state transitions are the replay
 * arbiter. A concurrent duplicate order finds the pre-states already
 * consumed — the debit's funds guard and both state guards are fused into
 * their UPDATE predicates, so the loser matches zero rows, throws its typed
 * conflict, and its ALREADY-EXECUTED debit rolls back with its transaction:
 * net exactly one charge. No idempotency-key machinery is read.
 *
 * Denial posture: every denial is pre-commit — the transaction rolls back
 * and commits ZERO rows (no ledger row, no balance change, no
 * de-certification, no status change, no audit row). Each denial logs
 * exactly ONE bounded `logger.logDomainError` entry (code + entity + entity
 * id only — never the amount, never the reason text, never another user's
 * identity); happy paths log nothing. All user-facing messages resolve
 * through `getServerTranslations(locale)`. `actorId` is a parameter (sourced
 * from the caller's authenticated identity) — NEVER part of the input
 * payload; every DB payload is a field-by-field copy (no spreads). The
 * stage functions below are file-local single-purpose legs of the one
 * ordered pipeline — the write order is load-bearing, not incidental. No
 * module-level mutable state; no swallowed catches.
 */

import { ApplicantRepository, TeacherRepository, WalletRepository } from "@/backend/db/repo";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActorAdminActive } from "@/backend/services/admin/admin-gate.helpers";
import { AuditService } from "@/backend/services/admin/audit.service";
import { isPositiveSafeInteger } from "@/backend/services/admin/user-management.helpers";
import {
  composeReEvaluationDescription,
  normalizeReason,
} from "@/backend/services/teachers/teacher-re-evaluation.service.helpers";
import type { ApplicantSelectType, DBTransaction, TeacherReEvaluationOrderReturnType } from "@/backend/types";
import { RE_EVALUATION_FEE, RE_EVALUATION_FEE_CURRENCY } from "@/shared/constants/re-evaluation.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Entity label passed to `NotFoundError` — yields code `TEACHER_NOT_FOUND`. */
const TEACHER_ENTITY = "TEACHER";

/** The audit entity label for the order row (`audit_logs.entity_type`). */
const AUDIT_ENTITY_TYPE = "teacher";

/** Localized-error bundle type (the errorsTranslations namespace). */
type ErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/**
 * The ONE bounded denial-log entry a rejection emits: code, entity, entity
 * id. The `entityId` is the DENIED entity's id — the subject teacher for the
 * eligibility denials, the ensured wallet for the funds denial. Never the
 * reason text, never an amount, never a counterparty value. The pre-DB
 * shape guard passes the sentinel `0`: no validated entity id exists yet,
 * and an unvalidated client value is never logged.
 */
function logDenial(message: string, code: string, entity: string, entityId: number): void {
  logger.logDomainError(message, { code, entity, entityId });
}

/**
 * Subject eligibility legs (the order targets a currently-certified teacher
 * whose applicant row is back-orderable): an unknown teacher, an
 * un-certified teacher row, and an applicant that is absent or not `passed`
 * each deny pre-write with their typed conflict — zero rows have moved.
 */
async function assertOrderSubjectEligibility(
  teacherId: number,
  t: ErrorsTranslations,
  tx: DBTransaction
): Promise<void> {
  const teacherRow = await TeacherRepository.findById(teacherId, tx);
  if (!teacherRow) {
    logDenial("Re-evaluation order denied: teacher not found", "TEACHER_NOT_FOUND", AUDIT_ENTITY_TYPE, teacherId);
    throw new NotFoundError(TEACHER_ENTITY, t.teacherNotFound);
  }
  if (teacherRow.isApproved !== true) {
    logDenial(
      "Re-evaluation order denied: teacher not certified",
      "TEACHER_NOT_CERTIFIED",
      AUDIT_ENTITY_TYPE,
      teacherId
    );
    throw new ConflictError("TEACHER_NOT_CERTIFIED", t.teacherNotCertified);
  }
  const applicant = await ApplicantRepository.findByUserId(teacherId, tx);
  if (applicant?.status !== ApplicantStatus.Passed) {
    logDenial(
      "Re-evaluation order denied: applicant not awaiting a re-evaluation",
      "APPLICANT_NOT_AWAITING_RE_EVALUATION",
      AUDIT_ENTITY_TYPE,
      teacherId
    );
    throw new ConflictError("APPLICANT_NOT_AWAITING_RE_EVALUATION", t.applicantNotAwaitingReEvaluation);
  }
}

/**
 * The guarded fee debit: the funds guard lives in the UPDATE predicate, so a
 * zero-row miss surfaces the localized funds denial and the whole
 * transaction (including this service's own writes so far) rolls back. The
 * writer composes the EXISTING shared debit primitive — no forked debit
 * exists here — and the ledger row carries the machine-distinguishable
 * description marker with the normalized reason.
 */
async function debitReEvaluationFee(
  walletId: number,
  normalizedReason: string,
  t: ErrorsTranslations,
  tx: DBTransaction
): Promise<void> {
  const ledger = await WalletRepository.debitAdjustmentOnce(
    { walletId, amount: RE_EVALUATION_FEE, description: composeReEvaluationDescription(normalizedReason) },
    tx
  );
  if (!ledger) {
    logDenial("Re-evaluation order denied: wallet insufficient funds", "WALLET_INSUFFICIENT_FUNDS", "wallet", walletId);
    throw new ConflictError("WALLET_INSUFFICIENT_FUNDS", t.insufficientBalance);
  }
}

/** De-certification leg — the guarded flip is the FIRST replay arbiter. */
async function decertifySubject(teacherId: number, t: ErrorsTranslations, tx: DBTransaction): Promise<void> {
  const decertified = await TeacherRepository.decertifyOnce(teacherId, tx);
  if (!decertified) {
    logDenial(
      "Re-evaluation order denied: teacher not certified",
      "TEACHER_NOT_CERTIFIED",
      AUDIT_ENTITY_TYPE,
      teacherId
    );
    throw new ConflictError("TEACHER_NOT_CERTIFIED", t.teacherNotCertified);
  }
}

/**
 * Loop re-open leg — the guarded transition is the SECOND replay arbiter;
 * its zero-row miss rolls the debit and the flip back with the transaction.
 */
async function reOpenApplicant(
  teacherId: number,
  t: ErrorsTranslations,
  tx: DBTransaction
): Promise<ApplicantSelectType> {
  const reopened = await ApplicantRepository.reopenForReEvaluation(teacherId, tx);
  if (!reopened) {
    logDenial(
      "Re-evaluation order denied: applicant not awaiting a re-evaluation",
      "APPLICANT_NOT_AWAITING_RE_EVALUATION",
      AUDIT_ENTITY_TYPE,
      teacherId
    );
    throw new ConflictError("APPLICANT_NOT_AWAITING_RE_EVALUATION", t.applicantNotAwaitingReEvaluation);
  }
  return reopened;
}

/**
 * Post-debit wallet read-back for the response balance. The wallet was just
 * ensured and debited on this same transaction, so a miss here is an
 * internal invariant failure (masked generic internal), never a denial.
 */
async function readBackWalletBalance(walletId: number, tx: DBTransaction): Promise<string> {
  const walletRow = await WalletRepository.findById(walletId, tx);
  if (!walletRow) {
    throw new Error("TeacherReEvaluationService: wallet row vanished mid-transaction");
  }
  return walletRow.balance;
}

/** Narrows the re-open row's anchor to its guaranteed non-null instant. */
function requireCycleAnchor(reopened: ApplicantSelectType): Date {
  const anchor = reopened.reEvaluationStartedAt;
  if (!anchor) {
    throw new Error("TeacherReEvaluationService: re-open returned a row without its cycle anchor");
  }
  return anchor;
}

/**
 * The order's audit row: action `override` on the `teacher` entity, details
 * carrying field names + metadata only — never the reason text, never
 * contact PII. The append rides the caller's transaction, so a rolled-back
 * order leaves no audit row.
 */
async function appendOrderAudit(
  actorId: number,
  teacherId: number,
  walletId: number,
  balanceAfter: string,
  reEvaluationStartedAt: Date,
  tx: DBTransaction
): Promise<void> {
  await AuditService.createAuditLog(
    {
      actorId,
      actionType: AuditActionType.Override,
      entityType: AUDIT_ENTITY_TYPE,
      entityId: teacherId,
      details: JSON.stringify({
        action: "re_evaluation_ordered",
        amount: RE_EVALUATION_FEE,
        walletId,
        balanceAfter,
        reEvaluationStartedAt: reEvaluationStartedAt.toISOString(),
      }),
    },
    tx
  );
}

export namespace TeacherReEvaluationService {
  /**
   * Orders a paid re-evaluation of a currently-certified teacher: the fee is
   * debited from the teacher's wallet, the teacher is de-certified, and the
   * applicant is re-opened into the five-session evaluation loop with a
   * fresh cycle anchor — all inside ONE transaction with exactly one audit
   * row. Every denial (gate, eligibility, funds, lost arbitration race)
   * rolls the whole flow back: zero committed rows, honest localized
   * conflict, one bounded domain log.
   *
   * @param actorUserId  The acting admin's user id (never client input).
   * @param input  The order payload copied field-by-field from the resolver
   *     (closed two-field shape — the fee is server-owned and carries no
   *     request override).
   * @param locale  Locale for the localized error messages.
   * @param outerTx  Optional caller transaction (test path: SAVEPOINT).
   * @returns The order receipt: the verbatim charged fee, the currency, the
   *     post-debit wallet balance, and the fresh re-evaluation cycle anchor.
   */
  export async function orderReEvaluation(
    actorUserId: number,
    input: { readonly teacherId: number; readonly reason: string },
    locale: string,
    outerTx?: DBTransaction
  ): Promise<TeacherReEvaluationOrderReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    return withTransaction(outerTx, async tx => {
      // Actor gate FIRST — the actor posture (anonymous → UNAUTHORIZED,
      // missing/non-admin/governed → FORBIDDEN) is decided before any input
      // shape validation, matching every sibling admin service; the gate
      // resolves and classifies nonexistent actors itself.
      await assertActorAdminActive(actorUserId, locale, tx);

      // Pre-DB shape guards SECOND — a malformed subject id, or a
      // missing/over-limit reason, never reaches the domain's own SQL. The
      // malformed-id denial logs the sentinel entity id `0`: no validated
      // entity id exists yet, and an unvalidated client value is never
      // echoed into the log.
      if (!isPositiveSafeInteger(input.teacherId)) {
        logDenial("Re-evaluation order denied: malformed subject id", "VALIDATION", AUDIT_ENTITY_TYPE, 0);
        throw new ValidationError(t.validation);
      }
      let normalizedReason: string;
      try {
        normalizedReason = normalizeReason(input.reason, t);
      } catch (error) {
        logDenial(
          "Re-evaluation order denied: reason missing or over limit",
          "VALIDATION",
          AUDIT_ENTITY_TYPE,
          input.teacherId
        );
        throw error;
      }

      await assertOrderSubjectEligibility(input.teacherId, t, tx);

      const wallet = await WalletRepository.ensureWalletOnce(input.teacherId, tx);
      await debitReEvaluationFee(wallet.id, normalizedReason, t, tx);
      await decertifySubject(input.teacherId, t, tx);
      const reopened = await reOpenApplicant(input.teacherId, t, tx);

      const balanceAfter = await readBackWalletBalance(wallet.id, tx);
      const reEvaluationStartedAt = requireCycleAnchor(reopened);
      await appendOrderAudit(actorUserId, input.teacherId, wallet.id, balanceAfter, reEvaluationStartedAt, tx);

      return {
        teacherId: input.teacherId,
        amountCharged: RE_EVALUATION_FEE,
        currency: RE_EVALUATION_FEE_CURRENCY,
        walletBalance: balanceAfter,
        reEvaluationStartedAt,
      };
    });
  }
}
