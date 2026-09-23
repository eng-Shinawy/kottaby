-- =============================================================================
-- 5-teacher-transaction-settlement-sqlite.sql
-- -----------------------------------------------------------------------------
-- SQLite parity for 5-teacher-transaction-settlement.sql per
-- docs/SQLITE_LOCAL_DEV.md. Amends the teacher_transaction UPDATE guard so
-- withdrawal settlement (pending withdrawal -> completed | failed) is the
-- single permitted exception to the immutable wallet ledger; only withdrawal
-- rows settle (OLD.type must be 'withdrawal') and all financial/identity
-- columns (wallet_id, session_id, description, amount, type, created_at)
-- stay frozen — `updated_at` legitimately changes with the settlement and is
-- excluded from the freeze. Every other UPDATE aborts.
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
-- The DELETE guard (prevent_teacher_transaction_delete_trigger) is unchanged
-- and continues to block all deletes.
--
-- Dialect:    SQLite (libsql). PostgreSQL version lives in
--             5-teacher-transaction-settlement.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- teacher_transaction — wallet ledger with one guarded settlement exception
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS prevent_teacher_transaction_update_trigger;

CREATE TRIGGER prevent_teacher_transaction_update_trigger
    BEFORE UPDATE ON teacher_transaction
BEGIN
    -- Abort unless the ONLY change is the guarded settlement move.
    -- `IS` is SQLite's NULL-safe equality (session_id is nullable).
    SELECT RAISE(ABORT, 'teacher_transaction is immutable — UPDATE is permitted only to settle a pending withdrawal to completed or failed with all columns unchanged')
    WHERE NOT (
        OLD.status = 'pending'
        AND OLD.type = 'withdrawal'
        AND NEW.type = 'withdrawal'
        AND NEW.type IS OLD.type
        AND NEW.status IN ('completed', 'failed')
        AND NEW.wallet_id IS OLD.wallet_id
        AND NEW.session_id IS OLD.session_id
        AND NEW.description IS OLD.description
        AND NEW.amount IS OLD.amount
        AND NEW.created_at IS OLD.created_at
    );
END;
