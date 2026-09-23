-- =============================================================================
-- 4-student-payments-status-transition-sqlite.sql
-- -----------------------------------------------------------------------------
-- SQLite parity for 4-student-payments-status-transition.sql per
-- docs/SQLITE_LOCAL_DEV.md. Amends the student_payments UPDATE guard so the
-- payment status lifecycle (pending -> paid | failed) is the single permitted
-- exception to the immutable payment ledger; all financial/identity columns
-- (student_id, subscription_id, amount, currency, payment_gateway,
-- created_at) stay frozen. Every other UPDATE aborts.
--
-- SQLite has no server-side stored functions, so the guard lives directly in
-- the trigger body (see 3-immutability-triggers-sqlite.sql). The strict
-- block-everything trigger must therefore be REPLACED here — `CREATE TRIGGER
-- IF NOT EXISTS` would silently keep the old version — hence DROP TRIGGER IF
-- EXISTS + CREATE TRIGGER.
--
-- Idempotency: DROP TRIGGER IF EXISTS + CREATE TRIGGER. Safe to re-run any
--              number of times. Pure SQLite — NO PostgreSQL dependencies
--              (no plpgsql, no CREATE FUNCTION, no EXECUTE FUNCTION).
--
-- The DELETE guard (prevent_student_payments_delete_trigger) is unchanged
-- and continues to block all deletes.
--
-- Dialect:    SQLite (libsql). PostgreSQL version lives in
--             4-student-payments-status-transition.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- student_payments — payment ledger with one guarded status exception
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS prevent_student_payments_update_trigger;

CREATE TRIGGER prevent_student_payments_update_trigger
    BEFORE UPDATE ON student_payments
BEGIN
    -- Abort unless the ONLY change is the guarded status lifecycle move.
    -- `IS` is SQLite's NULL-safe equality (subscription_id is nullable).
    SELECT RAISE(ABORT, 'student_payments is immutable — UPDATE is permitted only to transition a pending payment to paid or failed with all financial columns unchanged')
    WHERE NOT (
        OLD.status = 'pending'
        AND NEW.status IN ('paid', 'failed')
        AND NEW.student_id IS OLD.student_id
        AND NEW.subscription_id IS OLD.subscription_id
        AND NEW.amount IS OLD.amount
        AND NEW.currency IS OLD.currency
        AND NEW.payment_gateway IS OLD.payment_gateway
        AND NEW.created_at IS OLD.created_at
    );
END;
