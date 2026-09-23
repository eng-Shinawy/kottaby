-- Source: 6-transaction-type-arbitration-reversal.sql
-- =============================================================================
-- 6-transaction-type-arbitration-reversal.sql
-- -----------------------------------------------------------------------------
-- Purpose: Extend the `transaction_type` pgEnum with the `arbitration_reversal`
--          ledger vocabulary — the compensating `completed` ledger row the
--          arbitration flow writes when a consumed-escrow dispute is decided
--          against the teacher's earning (`WalletRepository.
--          debitForArbitrationOnce`). The value ships in the drizzle schema
--          (`backend/db/schema/enums.ts`); this migration is its committed
--          schema-sync counterpart so the migrate path (fresh CI databases)
--          carries the same enum space the push path does.
--
-- Idempotent: safe to replay (ADD VALUE IF NOT EXISTS). The guard-then-notify
--   DO-block pattern is required because PostgreSQL rejects
--   `ALTER TYPE ... ADD VALUE` inside a transaction block on older majors
--   and cannot USE the new value in the same transaction it was added in —
--   the conditional makes replays a no-op instead of an error.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'transaction_type' AND e.enumlabel = 'arbitration_reversal'
  ) THEN
    ALTER TYPE transaction_type ADD VALUE 'arbitration_reversal' AFTER 'bonus';
  END IF;
END $$;--> statement-breakpoint

