/**
 * WalletService — the teacher's self-service wallet surface (DEV3-013,
 * R-301/R-302/R-303): the balance + ledger read and the payout
 * (withdrawal-request) write.
 *
 * `getMyWallet` composes the DEV3-012 `ensureWalletOnce` primitive (an
 * idempotent `ON CONFLICT DO NOTHING` ensure, so a brand-new certified
 * teacher gets an honest zeroed wallet instead of an error) with a
 * newest-first ledger page capped at `WALLET_LEDGER_PAGE_LIMIT` (50) rows —
 * the documented v1 surface cap (full pagination is a forward item, F10).
 *
 * `requestWithdrawal` is the debit-on-request payout slice: ONE `pending`
 * `withdrawal` ledger row plus a GUARDED balance debit in ONE transaction
 * (the funds guard lives in the statement's predicate — the same escrow
 * shape the session-fee hold uses). The ledger insert and the debit commit
 * atomically; a zero-row guarded miss rolls the whole flow back (the
 * orphan pending row dies with the transaction) and surfaces the
 * localized insufficient-funds denial. `total_earning` is NEVER touched by
 * a withdrawal — it is a lifetime counter, not an available balance.
 *
 * Money discipline: amounts are decimal STRINGS carried verbatim end-to-end.
 * No arithmetic is ever performed on a money value in this module — the
 * validation matrix is a pure string predicate (shape regex + a
 * contains-a-nonzero-digit check) and the debit is SQL-side arithmetic on
 * the bound decimal string.
 *
 * Conventions per `backend/services/AGENTS.md` (mirroring
 * `SessionLifecycleService`): every user-facing message resolves through
 * `getServerTranslations(locale)`; rejections log via `logger.logDomainError`
 * with `{code, entity, entityId}` only — never amounts or other users'
 * wallet ids; rejections are typed DomainErrors whose `extensions.code`
 * propagates uncaught to the masking boundary. The actor's governance state
 * is re-asserted as defense in depth (deleted/blocked/suspended callers are
 * denied even while holding a still-valid token). No module-level mutable
 * state; no swallowed catches; every flow is one transaction with `tx`
 * propagated to every repository call. The `outerTx` seam (test path) runs
 * the flow inside a SAVEPOINT per `withTransaction`.
 */

import { UserRepository, WalletRepository } from "@/backend/db/repo";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, ForbiddenError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type { DBTransaction, WalletViewType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * The v1 ledger surface cap (R-301): the newest 50 rows, newest first.
 * Full pagination is a recorded forward item (F10).
 */
export const WALLET_LEDGER_PAGE_LIMIT = 50;

/**
 * The withdrawal amount shape (R-303): 1-7 integer digits, an optional
 * 1-2 digit fraction — the exact decimal-string grammar the platform fees
 * use. The cap matches the `wallet.balance` column capacity
 * (`decimal(10,2)`): an amount that could never fit a real balance is
 * rejected pre-DB with the precise invalid-amount message instead of a
 * generic overflow error.
 */
const WITHDRAWAL_AMOUNT_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;

/** Localized-error bundle type (the errorsTranslations namespace). */
type ErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

export namespace WalletService {
  /**
   * Validates a withdrawal amount (R-303, pre-DB, fail-closed). The value
   * must match the decimal-string grammar AND be strictly positive —
   * positivity is a "contains at least one nonzero digit" string check, so
   * no numeric parse ever touches a money value.
   *
   * @returns The TRIMMED amount (the value carried onward verbatim).
   */
  function assertValidWithdrawalAmount(rawAmount: string, t: ErrorsTranslations): string {
    const trimmed = rawAmount.trim();
    if (!WITHDRAWAL_AMOUNT_PATTERN.test(trimmed) || !/[1-9]/.test(trimmed)) {
      logger.logDomainError("Withdrawal denied: amount failed the pre-DB validation matrix", {
        code: "WALLET_INVALID_AMOUNT",
        entity: "wallet",
        entityId: 0,
      });
      throw new ValidationError("WALLET_INVALID_AMOUNT", t.walletInvalidAmount);
    }
    return trimmed;
  }

  /**
   * Re-asserts the actor's governance state at the service boundary
   * (defense in depth over the GraphQL role gate — the DB row is the
   * authority, never the token). Deleted/blocked/suspended callers are
   * denied with the typed `ForbiddenError`. Mirrors
   * `SessionLifecycleService`'s governance re-check idiom.
   */
  async function assertActorGovernanceClean(
    actorUserId: number,
    t: ErrorsTranslations,
    tx?: DBTransaction
  ): Promise<void> {
    const actor = await UserRepository.findById(actorUserId, tx);
    if (!actor || actor.isDeleted || actor.isBlocked || actor.suspended) {
      logger.logDomainError("Wallet action denied: caller account is governed", {
        code: "FORBIDDEN",
        entity: "wallet",
        entityId: actorUserId,
      });
      throw new ForbiddenError(t.forbidden);
    }
  }

  /**
   * Assembles the canonical wallet view (the ensured wallet row + its
   * newest-first ledger page) on the caller's transaction.
   */
  async function assembleWalletView(teacherId: number, tx?: DBTransaction): Promise<WalletViewType> {
    const wallet = await WalletRepository.ensureWalletOnce(teacherId, tx);
    const transactions = await WalletRepository.listRecentTransactions(wallet.id, WALLET_LEDGER_PAGE_LIMIT, tx);
    return { wallet, transactions };
  }

  /**
   * R-301 — the caller's own wallet: the ensured row plus the newest-first
   * ledger page (50-row cap). Zero lookup arguments — the wallet address
   * is derived EXCLUSIVELY from the verified context user id (the teacher
   * PK shares the users PK), so there is no caller-supplied lookup surface
   * of any kind (BOLA-proof by construction).
   *
   * The read is a plain consistency-preserving composition (ensure + two
   * reads on one transaction); it is deliberately NOT a historical
   * snapshot — a wallet the actor is concurrently paying out from renders
   * its current honest state.
   *
   * @param callerUserId  The acting teacher's id (context-resolved
   *     server-side; shared PK with the users table).
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction. When provided (test path),
   *     the flow runs inside a SAVEPOINT on it; production callers omit it
   *     and the service opens its own transaction.
   */
  export async function getMyWallet(
    callerUserId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<WalletViewType> {
    const t = getServerTranslations(locale).errorsTranslations;

    return withTransaction(outerTx, async tx => {
      // Governance re-check — the acting teacher must be governance-clean.
      await assertActorGovernanceClean(callerUserId, t, tx);
      return assembleWalletView(callerUserId, tx);
    });
  }

  /**
   * R-302 — requests a payout of `amount` from the caller's own wallet:
   * ONE `pending` `withdrawal` ledger row plus a GUARDED balance debit,
   * atomically, inside ONE transaction.
   *
   * The amount is validated pre-DB (R-303 matrix: decimal-string grammar +
   * strictly positive). The funds guard lives in the guarded UPDATE's
   * predicate (`balance >= amount`); a zero-row miss rolls the flow back —
   * the already-inserted pending ledger row dies with the transaction, so
   * a denied request commits ZERO rows — and surfaces the localized
   * `WALLET_INSUFFICIENT_FUNDS` conflict carrying the existing
   * `insufficientBalance` copy. The DB-side `wallet_balance_check >= 0`
   * CHECK is the concurrent-overdraw backstop behind the predicate.
   *
   * Each request is a NEW financial instruction (two identical requests
   * are two payouts — honestly); request-level idempotency keying is a
   * recorded forward item (F11).
   *
   * @param callerUserId  The acting teacher's id (context-resolved
   *     server-side; shared PK with the users table).
   * @param rawAmount  The requested amount as a decimal string (validated
   *     and trimmed here; carried onward verbatim).
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction. When provided (test path),
   *     the flow runs inside a SAVEPOINT on it; production callers omit it
   *     and the service opens its own transaction.
   * @returns The UPDATED wallet view (post-debit balance + the refreshed
   *     ledger page) so the client converges its cache without a refetch.
   */
  export async function requestWithdrawal(
    callerUserId: number,
    rawAmount: string,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<WalletViewType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB validation FIRST — a malformed amount never reaches SQL.
    const amount = assertValidWithdrawalAmount(rawAmount, t);

    return withTransaction(outerTx, async tx => {
      // Governance re-check — the acting teacher must be governance-clean.
      await assertActorGovernanceClean(callerUserId, t, tx);

      // The wallet row must exist before the ledger insert (FK). The
      // ensure is idempotent (ON CONFLICT DO NOTHING).
      const wallet = await WalletRepository.ensureWalletOnce(callerUserId, tx);

      const ledger = await WalletRepository.debitForWithdrawalOnce(
        {
          walletId: wallet.id,
          amount,
          description: "Withdrawal request (pending payout)",
        },
        tx
      );
      if (ledger === null) {
        // Zero-row guarded miss — insufficient funds. The pending ledger
        // row this flow inserted rolls back with the transaction (the
        // throw propagates out of the withTransaction scope): a denied
        // request commits zero rows.
        logger.logDomainError("Withdrawal denied: insufficient wallet balance", {
          code: "WALLET_INSUFFICIENT_FUNDS",
          entity: "wallet",
          entityId: wallet.id,
        });
        throw new ConflictError("WALLET_INSUFFICIENT_FUNDS", t.insufficientBalance);
      }

      return assembleWalletView(callerUserId, tx);
    });
  }
}
