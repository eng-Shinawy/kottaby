-- =============================================================================
-- 4-student-payments-status-transition.sql
-- -----------------------------------------------------------------------------
-- Purpose: Amend the student_payments UPDATE guard so the payment status
--          lifecycle is the single permitted exception to the immutable
--          payment ledger (INV-PAY2). A payment row may move from `pending`
--          to `paid` or `failed` (the gateway outcome), and NOTHING else:
--
--            * OLD.status must be 'pending' — a decided payment (paid,
--              failed, refunded) is final and can never be re-opened or
--              re-decided.
--            * NEW.status must be 'paid' or 'failed' — no-op rewrites
--              (pending -> pending) and lifecycle skips (pending ->
--              refunded) are rejected.
--            * The financial/identity columns (student_id, subscription_id,
--              amount, currency, payment_gateway, created_at) must be
--              unchanged — the correction-ban is preserved as a column
--              freeze, so a decision can never redirect a payment to another
--              student, subscription, gateway, or amount.
--
--          Every other UPDATE raises an exception. DELETE remains blocked by
--          prevent_student_payments_delete (3-immutability-triggers.sql),
--          which this file does not touch.
--
-- Mechanics: The BEFORE UPDATE trigger on student_payments
--            (prevent_student_payments_update_trigger) already exists and
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
--             4-student-payments-status-transition-sqlite.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- student_payments — payment ledger with one guarded status exception
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_student_payments_update()
RETURNS trigger AS $$
BEGIN
    -- IS NOT DISTINCT FROM is the NULL-safe equality: subscription_id is
    -- the ledger row's FROZEN identity — deleting a subscription that still
    -- has ledger rows raises THIS guard (the FK's set-null action would have
    -- to UPDATE those rows and is therefore unreachable for ledger rows),
    -- and a plain `=` would silently allow NULL swaps in either direction.
    IF OLD.status = 'pending'
       AND NEW.status IN ('paid', 'failed')
       AND NEW.student_id IS NOT DISTINCT FROM OLD.student_id
       AND NEW.subscription_id IS NOT DISTINCT FROM OLD.subscription_id
       AND NEW.amount IS NOT DISTINCT FROM OLD.amount
       AND NEW.currency IS NOT DISTINCT FROM OLD.currency
       AND NEW.payment_gateway IS NOT DISTINCT FROM OLD.payment_gateway
       AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'student_payments is immutable — UPDATE is permitted only to transition a pending payment to paid or failed with all financial columns unchanged';
END;
$$ LANGUAGE plpgsql;
