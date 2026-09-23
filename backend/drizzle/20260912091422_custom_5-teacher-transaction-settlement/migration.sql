-- Source: 5-teacher-transaction-settlement.sql
-- =============================================================================
-- 5-teacher-transaction-settlement.sql
-- -----------------------------------------------------------------------------
-- Purpose: Amend the teacher_transaction UPDATE guard so withdrawal
--          settlement is the single permitted exception to the immutable
--          wallet ledger. A pending withdrawal row may move to `completed`
--          or `failed` (the payout outcome), and NOTHING else:
--
--            * OLD.status must be 'pending' — a settled withdrawal
--              (completed or failed) is final and can never be re-opened or
--              re-settled.
--            * NEW.type must be 'withdrawal' — only withdrawal rows carry a
--              payout outcome; earning and bonus rows have no lifecycle and
--              stay frozen in every direction.
--            * NEW.status must be 'completed' or 'failed' — no-op rewrites
--              (pending -> pending) are rejected.
--            * The financial/identity columns (wallet_id, session_id,
--              description, amount, type, created_at) must be unchanged —
--              the correction-ban is preserved as a column freeze, so a
--              settlement can never redirect funds, rewrite an amount, or
--              relabel the row. `updated_at` is the one legitimate change:
--              it moves with the settlement via the column's onUpdate.
--
--          Every other UPDATE raises an exception. DELETE remains blocked by
--          prevent_teacher_transaction_delete (3-immutability-triggers.sql),
--          which this file does not touch.
--
-- Mechanics: The BEFORE UPDATE trigger on teacher_transaction
--            (prevent_teacher_transaction_update_trigger) already exists and
--            executes this function; replacing the function re-arms the
--            guard in place, so no trigger DDL is needed here. On a fresh
--            database 3-immutability-triggers.sql seeds the strict
--            block-everything guard first, then this file amends it (custom
--            SQL files apply in alphabetical order), so both fresh and
--            existing databases converge on the amended guard.
--
-- Idempotency: CREATE OR REPLACE FUNCTION — safe to re-run any number of
--              times. NO CONCURRENTLY (per docs/DATABASE_MIGRATIONS.md —
--              Drizzle's migrator is always transactional).
--
-- Dialect:    PostgreSQL. SQLite parity lives in
--             5-teacher-transaction-settlement-sqlite.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- teacher_transaction — wallet ledger with one guarded settlement exception
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_teacher_transaction_update()
RETURNS trigger AS $$
BEGIN
    -- IS NOT DISTINCT FROM is the NULL-safe equality: session_id is
    -- nullable, so a plain `=` would silently allow NULL swaps in either
    -- direction on the ledger row's FROZEN earning link.
    IF OLD.status = 'pending'
       AND NEW.type = 'withdrawal'
       AND NEW.status IN ('completed', 'failed')
       AND NEW.wallet_id IS NOT DISTINCT FROM OLD.wallet_id
       AND NEW.session_id IS NOT DISTINCT FROM OLD.session_id
       AND NEW.description IS NOT DISTINCT FROM OLD.description
       AND NEW.amount IS NOT DISTINCT FROM OLD.amount
       AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'teacher_transaction is immutable — UPDATE is permitted only to settle a pending withdrawal to completed or failed with all columns unchanged';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

