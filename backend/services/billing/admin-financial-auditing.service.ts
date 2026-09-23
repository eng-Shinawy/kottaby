/**
 * AdminFinancialAuditingService — the admin control room over the two money
 * ledgers (`student_payments` + `teacher_transaction`): the payments audit
 * view, the teacher wallet inspection, the pending-withdrawal settlement
 * queue, and the three financial mutations (approve / reject / adjust).
 *
 * File layout: the read path (the three list surfaces, the consistent-
 * snapshot wrapper, and the pagination plumbing) lives in the sibling
 * `admin-financial-auditing.service.read.helpers.ts` module (extracted
 * verbatim); every list method below is a one-to-one delegation wrapper,
 * so the public API (names, signatures, behavior) is unchanged.
 *
 * The three list surfaces are pure paginated reads: the admin gate first,
 * then the paired count + listing inside ONE repeatable-read transaction
 * (the audit-trail precedent) so `totalCount` and `items` can never tear
 * across a concurrent producer commit. When no outer transaction is
 * supplied, the count + page pair shares its own snapshot — and the wallet
 * inspection's wallet probe + teacher-name resolution share the SAME
 * snapshot, so the rendered balance can never be older than the ledger
 * rows beside it. The settlement probes (mutation-path error
 * disambiguation) run on a SEPARATE top-level transaction and are
 * best-effort, non-authoritative reads outside that snapshot — no write
 * decision ever trusts them. The payments view never writes; inspection never fabricates
 * a wallet row — a wallet-less teacher renders the honest null-pair state
 * with the teacher identity still resolved.
 *
 * The three mutations compose a guarded ledger/wallet write with an audit
 * insert in ONE transaction:
 *  - approve settles a pending withdrawal (`completed`) via the guarded
 *    `settleWithdrawalOnce` predicate — the debit already happened at
 *    request time, so the balance NEVER moves again;
 *  - reject settles the same row to `failed` AND restores the reserved
 *    debit to the wallet balance in the same transaction;
 *  - adjust books a bonus (credit) or a marked withdrawal (debit) with a
 *    mandatory reason; `total_earning` is NEVER touched by an adjustment.
 * Every mutation writes exactly ONE audit row through the single writer
 * `AuditService.createAuditLog`, sharing the transaction's commit/rollback
 * fate — a rolled-back mutation leaves no ledger row and no audit row.
 *
 * Conventions per `backend/services/AGENTS.md` (mirroring `WalletService`):
 * every user-facing message resolves through `getServerTranslations(locale)`;
 * expected rejections log via `logger.logDomainError` with bounded context
 * only — never amounts, never other users' wallet ids, never reason text;
 * rejections are typed DomainErrors whose `extensions.code` propagates
 * uncaught to the masking boundary. `assertActorAdminActive` — the strict
 * governance gate, not the role-only gate — runs FIRST inside the
 * transaction: anonymous callers (`actorId = 0`) receive
 * `UnauthorizedError`, non-admins `ForbiddenError`, and governed admins
 * (deleted → blocked → suspended, in that deterministic order) fail closed
 * with `ForbiddenError`. Denials write ZERO audit rows. No `{ ...input }`
 * spreads anywhere — every repo payload is a
 * field-by-field copy. No module-level mutable state; no swallowed catches.
 */

import { TeacherRepository, WalletRepository } from "@/backend/db/repo";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { WalletAdjustmentDirection } from "@/backend/enum/billing/wallet-adjustment-direction.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActorAdminActive } from "@/backend/services/admin/admin-gate.helpers";
import { AuditService } from "@/backend/services/admin/audit.service";
import {
  assertValidAdjustmentAmount,
  buildWalletAdjustmentAuditContract,
  buildWithdrawalSettleAuditContract,
  composeCreditDescription,
  composeDebitDescription,
  normalizeAdjustmentReason,
} from "@/backend/services/billing/admin-financial-auditing.service.helpers";
import {
  getTeacherWalletForAdmin as getTeacherWalletForAdminImpl,
  listPendingWithdrawalsForAdmin as listPendingWithdrawalsForAdminImpl,
  listStudentPaymentsForAdmin as listStudentPaymentsForAdminImpl,
  readWalletById,
} from "@/backend/services/billing/admin-financial-auditing.service.read.helpers";
import type {
  AdminStudentPaymentPageReturnType,
  AdminTeacherWalletReturnType,
  AdminWalletAdjustmentSubmitInput,
  AdminWalletTransactionFilters,
  AdminWithdrawalQueuePageReturnType,
  DBTransaction,
  NormalizedAdminPaymentFilters,
  TeacherTransactionSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

export namespace AdminFinancialAuditingService {
  /**
   * REQ-1 — the student payments ledger audit view: newest-first page over
   * `student_payments` joined with each student's display identity, filtered
   * by student / name search / status / gateway / date window — one-to-one
   * delegation to the read module (same signature and behavior).
   *
   * @param actorUserId  The acting admin's user id (never client input).
   * @param filters  Filter input copied field-by-field from the resolver
   *     (closed whitelist — nulls express "clear this filter").
   * @param page  1-based page number (`null` → 1).
   * @param pageSize Rows per page (`null` → the default 25).
   * @param locale  Locale for the localized validation message.
   * @param outerTx  Optional caller transaction to join for the reads.
   * @returns One honest page of typed payment rows.
   */
  export function listStudentPaymentsForAdmin(
    actorUserId: number,
    filters: NormalizedAdminPaymentFilters,
    page: number | null,
    pageSize: number | null,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminStudentPaymentPageReturnType> {
    return listStudentPaymentsForAdminImpl(actorUserId, filters, page, pageSize, locale, outerTx);
  }

  /**
   * REQ-2 — inspects any teacher's wallet: the wallet row (`balance`,
   * `totalEarning` as decimal strings) plus one newest-first ledger page
   * with optional type/status/date-window filters — one-to-one delegation
   * to the read module (same signature and behavior).
   *
   * READ-ONLY by contract: creating/ensuring rows on read is forbidden — a
   * teacher without a wallet row renders the honest null-pair empty state
   * (both amounts `null`), NOT an error and NOT a fabricated wallet. The
   * teacher identity resolves from the wallet probe when a wallet exists,
   * else via a teacher → user fallback lookup; a teacher whose profile row
   * itself is missing is a genuine not-found (the wallet FK targets the
   * teacher table, so no wallet could ever exist for it).
   */
  export function getTeacherWalletForAdmin(
    actorUserId: number,
    teacherId: number,
    txFilters: AdminWalletTransactionFilters,
    page: number | null,
    pageSize: number | null,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminTeacherWalletReturnType> {
    return getTeacherWalletForAdminImpl(actorUserId, teacherId, txFilters, page, pageSize, locale, outerTx);
  }

  /**
   * REQ-3 — the pending-withdrawal settlement queue: every
   * `type=withdrawal ∧ status=pending` ledger row (analytics-counter parity)
   * joined with the teacher's display name and the wallet's current
   * balance, oldest first (longest-waiting first) — one-to-one delegation
   * to the read module (same signature and behavior).
   *
   * Pure read: zero writes, zero audit rows. The paired count + listing
   * share ONE repeatable-read snapshot (same contract as the other lists);
   * the probe reads around it remain best-effort, non-authoritative reads
   * outside that snapshot (see the read module's `readInSnapshot`).
   */
  export function listPendingWithdrawalsForAdmin(
    actorUserId: number,
    page: number | null,
    pageSize: number | null,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminWithdrawalQueuePageReturnType> {
    return listPendingWithdrawalsForAdminImpl(actorUserId, page, pageSize, locale, outerTx);
  }

  /**
   * REQ-4 — approves (settles) a pending withdrawal: the row flips to
   * `completed` via ONE guarded UPDATE inside one transaction; the wallet
   * balance NEVER moves again (the debit happened at request time — the
   * reserve is settled, not re-charged).
   *
   * Exactly ONE audit row (`Override` on `teacher_transaction`) is written
   * in the same transaction, carrying the D-4 details vocabulary
   * `{action:"withdrawal_approved", amount, walletId, teacherId}`. A
   * non-pending / non-withdrawal / unknown id fails closed with the
   * localized conflict, rolling back everything (including the audit
   * candidate). Concurrent settles: exactly one wins the guarded UPDATE,
   * the loser receives the not-pending conflict.
   *
   * @param actorUserId  The acting admin's user id (never client input).
   * @param transactionId  The pending withdrawal ledger row's id.
   * @param locale  Locale for the localized error messages.
   * @param outerTx  Optional caller transaction (test path: SAVEPOINT).
   * @returns The settled ledger row.
   */
  export async function approveWithdrawal(
    actorUserId: number,
    transactionId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<TeacherTransactionSelectType> {
    const t = getServerTranslations(locale).errorsTranslations;

    return withTransaction(outerTx, async tx => {
      await assertActorAdminActive(actorUserId, locale, tx);

      // Probe read: HUMAN-READABLE error disambiguation only — the write
      // decision is the guarded repo primitive, never this snapshot.
      const probe = await WalletRepository.findSettlementProbe(transactionId, tx);
      if (!probe) {
        logger.logDomainError("Withdrawal approval denied: transaction not found", {
          code: "NOT_FOUND",
          entity: "teacher_transaction",
          entityId: transactionId,
        });
        throw new NotFoundError("WITHDRAWAL_REQUEST", t.withdrawalRequestNotFound);
      }
      if (probe.type !== TransactionType.Withdrawal || probe.status !== TransactionStatus.Pending) {
        logger.logDomainError("Withdrawal approval denied: transaction is not a pending withdrawal", {
          code: "CONFLICT",
          entity: "teacher_transaction",
          entityId: transactionId,
        });
        throw new ConflictError("WITHDRAWAL_NOT_PENDING", t.withdrawalNotPending);
      }

      // The guarded single UPDATE is the write decision: it re-asserts the
      // pending-withdrawal state in its WHERE predicate, so a concurrent
      // settle loses the race here (null) instead of double-settling.
      const settled = await WalletRepository.settleWithdrawalOnce(
        { transactionId, nextStatus: TransactionStatus.Completed },
        tx
      );
      if (!settled) {
        logger.logDomainError("Withdrawal approval denied: guarded settle missed (not pending)", {
          code: "CONFLICT",
          entity: "teacher_transaction",
          entityId: transactionId,
        });
        throw new ConflictError("WITHDRAWAL_NOT_PENDING", t.withdrawalNotPending);
      }

      const walletRow = await readWalletById(settled.walletId, tx);
      await AuditService.createAuditLog(
        buildWithdrawalSettleAuditContract({
          actorId: actorUserId,
          transactionId: settled.id,
          walletId: settled.walletId,
          teacherId: walletRow.teacherId,
          amount: settled.amount,
          action: "withdrawal_approved",
        }),
        tx
      );

      return settled;
    });
  }

  /**
   * REQ-5 — rejects a pending withdrawal: the row flips to `failed` (the
   * same guarded UPDATE as approval) AND the reserved debit is restored to
   * the wallet balance, atomically in ONE transaction.
   *
   * The reason is normalized (trim + length cap) BEFORE any database work;
   * the audit details record a `reasonPresent` BOOLEAN — the raw reason
   * text is NEVER persisted in the audit trail. Exactly ONE audit row
   * (`Override`) shares the transaction's fate; a non-pending row fails
   * closed exactly as approval does.
   *
   * @param actorUserId  The acting admin's user id (never client input).
   * @param transactionId  The pending withdrawal ledger row's id.
   * @param reason  The rejection reason (normalized here; recorded as a
   *     `reasonPresent` boolean in the audit details, never as raw text).
   * @param locale  Locale for the localized error messages.
   * @param outerTx  Optional caller transaction (test path: SAVEPOINT).
   * @returns The failed ledger row.
   */
  export async function rejectWithdrawal(
    actorUserId: number,
    transactionId: number,
    reason: string,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<TeacherTransactionSelectType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB validation FIRST — a malformed reason never reaches SQL.
    normalizeAdjustmentReason(reason, t);

    return withTransaction(outerTx, async tx => {
      await assertActorAdminActive(actorUserId, locale, tx);

      const probe = await WalletRepository.findSettlementProbe(transactionId, tx);
      if (!probe) {
        logger.logDomainError("Withdrawal rejection denied: transaction not found", {
          code: "NOT_FOUND",
          entity: "teacher_transaction",
          entityId: transactionId,
        });
        throw new NotFoundError("WITHDRAWAL_REQUEST", t.withdrawalRequestNotFound);
      }
      if (probe.type !== TransactionType.Withdrawal || probe.status !== TransactionStatus.Pending) {
        logger.logDomainError("Withdrawal rejection denied: transaction is not a pending withdrawal", {
          code: "CONFLICT",
          entity: "teacher_transaction",
          entityId: transactionId,
        });
        throw new ConflictError("WITHDRAWAL_NOT_PENDING", t.withdrawalNotPending);
      }

      const settled = await WalletRepository.settleWithdrawalOnce(
        { transactionId, nextStatus: TransactionStatus.Failed },
        tx
      );
      if (!settled) {
        logger.logDomainError("Withdrawal rejection denied: guarded settle missed (not pending)", {
          code: "CONFLICT",
          entity: "teacher_transaction",
          entityId: transactionId,
        });
        throw new ConflictError("WITHDRAWAL_NOT_PENDING", t.withdrawalNotPending);
      }

      // The request-time debit is compensated: the reserved amount returns
      // to the balance (strictly additive — the >= 0 CHECK cannot fire).
      const walletRow = await readWalletById(settled.walletId, tx);
      await WalletRepository.restoreWithdrawalDebitOnce({ walletId: settled.walletId, amount: settled.amount }, tx);

      await AuditService.createAuditLog(
        buildWithdrawalSettleAuditContract({
          actorId: actorUserId,
          transactionId: settled.id,
          walletId: settled.walletId,
          teacherId: walletRow.teacherId,
          amount: settled.amount,
          action: "withdrawal_rejected",
          reasonPresent: true,
        }),
        tx
      );

      return settled;
    });
  }

  /**
   * REQ-6 — manual wallet adjustment: a bonus credit (balance up,
   * `total_earning` UNCHANGED) or a recorded debit (marked
   * `withdrawal/completed` ledger row + guarded balance decrement). Any
   * direction that is not exactly Credit or Debit fails closed with the
   * pre-DB VALIDATION denial — never the money-removing debit branch.
   *
   * The amount is validated against the decimal grammar + positivity and
   * the reason normalized BEFORE any database work. A wallet-less teacher
   * lazily `ensureWalletOnce`s (idempotent) — a wallet-less teacher CAN
   * receive a bonus. The debit's guarded UPDATE (`balance >= amount` in the
   * predicate) misses on insufficient funds: the flow rolls back whole
   * (the already-inserted ledger row dies with the transaction) and
   * surfaces the localized insufficient-balance conflict. Exactly ONE audit
   * row (`Adjust`) with the `balanceAfter` re-read shares the transaction's
   * fate.
   *
   * @param actorUserId  The acting admin's user id (never client input).
   * @param input  The adjustment payload copied field-by-field from the
   *     resolver (closed whitelist — no spread reaches the repo).
   * @param locale  Locale for the localized error messages.
   * @param outerTx  Optional caller transaction (test path: SAVEPOINT).
   * @returns The inserted ledger row.
   */
  export async function adjustTeacherWallet(
    actorUserId: number,
    input: AdminWalletAdjustmentSubmitInput,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<TeacherTransactionSelectType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB validation FIRST — a malformed amount or reason never
    // reaches SQL.
    const amount = assertValidAdjustmentAmount(input.amount, t);
    const normalizedReason = normalizeAdjustmentReason(input.reason, t);

    return withTransaction(outerTx, async tx => {
      await assertActorAdminActive(actorUserId, locale, tx);

      // The teacher row must exist — the wallet FK targets the teacher
      // table, so an adjustment can never fabricate a teacher.
      const teacherProfile = await TeacherRepository.findById(input.teacherId, tx);
      if (!teacherProfile) {
        logger.logDomainError("Wallet adjustment denied: teacher not found", {
          code: "NOT_FOUND",
          entity: "teacher",
          entityId: input.teacherId,
        });
        throw new NotFoundError("TEACHER", t.teacherNotFound);
      }

      const walletRow = await WalletRepository.ensureWalletOnce(input.teacherId, tx);

      if (input.direction === WalletAdjustmentDirection.Credit) {
        // Credit: bonus/completed ledger row + strictly additive balance
        // increment (total_earning UNTOUCHED — a bonus is not teaching
        // earnings). The description marker carries the normalized reason.
        const ledger = await WalletRepository.creditBonusOnce(
          { walletId: walletRow.id, amount, description: composeCreditDescription(normalizedReason) },
          tx
        );

        const balanceAfter = await readWalletById(walletRow.id, tx);
        await AuditService.createAuditLog(
          buildWalletAdjustmentAuditContract({
            actorId: actorUserId,
            transactionId: ledger.id,
            walletId: walletRow.id,
            teacherId: input.teacherId,
            amount,
            direction: WalletAdjustmentDirection.Credit,
            balanceAfter: balanceAfter.balance,
            reasonPresent: true,
          }),
          tx
        );

        return ledger;
      } else if (input.direction === WalletAdjustmentDirection.Debit) {
        // Debit: the withdrawal/completed ledger row lands FIRST (the
        // description marker machine-distinguishes it from a payout), then
        // the GUARDED decrement (`balance >= amount` in the predicate). A
        // zero-row miss rolls the whole flow back — the orphan ledger row
        // dies with the transaction — and surfaces the localized
        // insufficient-balance conflict.
        const ledger = await WalletRepository.debitAdjustmentOnce(
          { walletId: walletRow.id, amount, description: composeDebitDescription(normalizedReason) },
          tx
        );
        if (!ledger) {
          logger.logDomainError("Wallet adjustment denied: insufficient wallet balance", {
            code: "CONFLICT",
            entity: "wallet",
            entityId: walletRow.id,
          });
          throw new ConflictError("WALLET_INSUFFICIENT_FUNDS", t.insufficientBalance);
        }

        const balanceAfter = await readWalletById(walletRow.id, tx);
        await AuditService.createAuditLog(
          buildWalletAdjustmentAuditContract({
            actorId: actorUserId,
            transactionId: ledger.id,
            walletId: walletRow.id,
            teacherId: input.teacherId,
            amount,
            direction: WalletAdjustmentDirection.Debit,
            balanceAfter: balanceAfter.balance,
            reasonPresent: true,
          }),
          tx
        );

        return ledger;
      } else {
        // Fail closed: anything that is not exactly Credit or Debit is a
        // caller-contract violation (a non-GraphQL caller passing garbage)
        // — never the money-removing debit branch. The pre-DB VALIDATION
        // denial fires before any ledger row or balance movement.
        throw new ValidationError(t.invalidAdjustmentDirection);
      }
    });
  }
}
