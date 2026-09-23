-- =============================================================================
-- 5-student-payments-provider-transaction.sql
-- -----------------------------------------------------------------------------
-- Purpose: Give the immutable student_payments ledger an auditable link to the
--          payment provider's own records, WITHOUT weakening the immutability
--          record (INV-PAY2). Two changes, layered onto
--          4-student-payments-status-transition.sql:
--
--            1. A new nullable column `provider_transaction_id varchar(64)`
--               holds the gateway's transaction identifier once a payment is
--               decided. It is NULL for every pending (undecided) payment.
--            2. The `prevent_student_payments_update()` guard is re-armed so
--               that within the EXISTING guarded `pending → paid | failed`
--               transition the provider transaction reference may be written
--               exactly once, and only from NULL to a value. An
--               already-recorded reference can never be overwritten
--               (value → value) or erased (value → NULL), and outside the
--               guarded transition the column is frozen like every other
--               financial/identity column. All other columns stay frozen —
--               the same column freeze as migration 4, widened by this one
--               set-once allowance.
--
-- Mechanics: The BEFORE UPDATE trigger on student_payments
--            (prevent_student_payments_update_trigger) already exists and
--            executes this function; replacing the function re-arms the
--            guard in place, so no trigger DDL is needed here. On a fresh
--            database 3-immutability-triggers.sql seeds the strict
--            block-everything guard, then 4-...-status-transition.sql and
--            this file amend it in alphabetical order, so both fresh and
--            existing databases converge on the same guard.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION — safe
--              to re-run any number of times. NO CONCURRENTLY (per
--              docs/DATABASE_MIGRATIONS.md — Drizzle's migrator is always
--              transactional).
--
-- Dialect:    PostgreSQL. SQLite parity lives in
--             5-student-payments-provider-transaction-sqlite.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- student_payments — provider transaction reference column (nullable)
-- -----------------------------------------------------------------------------
ALTER TABLE student_payments
    ADD COLUMN IF NOT EXISTS provider_transaction_id varchar(64);


-- -----------------------------------------------------------------------------
-- student_payments — payment ledger with one guarded status exception and a
-- set-once provider transaction reference
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_student_payments_update()
RETURNS trigger AS $$
BEGIN
    -- IS NOT DISTINCT FROM is the NULL-safe equality: subscription_id is
    -- the ledger row's FROZEN identity — deleting a subscription that still
    -- has ledger rows raises THIS guard (the FK's set-null action would have
    -- to UPDATE those rows and is therefore unreachable for ledger rows),
    -- and a plain `=` would silently allow NULL swaps in either direction.
    --
    -- provider_transaction_id allowance: `OLD.provider_transaction_id IS NOT
    -- DISTINCT FROM NEW.provider_transaction_id OR OLD.provider_transaction_id
    -- IS NULL` admits exactly (a) the column untouched and (b) a write from
    -- NULL to a value. An overwrite (value → different value) and an erasure
    -- (value → NULL) both fail both disjuncts and fall through to the RAISE.
    -- Because the whole branch also requires OLD.status = 'pending' and
    -- NEW.status IN ('paid', 'failed'), the reference can only ever be
    -- recorded inside the guarded status decision itself.
    IF OLD.status = 'pending'
       AND NEW.status IN ('paid', 'failed')
       AND NEW.student_id IS NOT DISTINCT FROM OLD.student_id
       AND NEW.subscription_id IS NOT DISTINCT FROM OLD.subscription_id
       AND NEW.amount IS NOT DISTINCT FROM OLD.amount
       AND NEW.currency IS NOT DISTINCT FROM OLD.currency
       AND NEW.payment_gateway IS NOT DISTINCT FROM OLD.payment_gateway
       AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
       AND (
           NEW.provider_transaction_id IS NOT DISTINCT FROM OLD.provider_transaction_id
           OR OLD.provider_transaction_id IS NULL
       )
    THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'student_payments is immutable — UPDATE is permitted only to transition a pending payment to paid or failed with all financial columns unchanged (the provider transaction reference may be recorded once, from null, inside that transition)';
END;
$$ LANGUAGE plpgsql;
