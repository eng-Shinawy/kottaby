-- =============================================================================
-- 5-student-payments-provider-transaction-sqlite.sql
-- -----------------------------------------------------------------------------
-- SQLite parity for 5-student-payments-provider-transaction.sql per
-- docs/SQLITE_LOCAL_DEV.md. Adds the nullable provider_transaction_id column
-- to the student_payments ledger, enforces the pending-insert invariant, and
-- re-arms the UPDATE guard so the provider transaction reference may be
-- written exactly once — only from NULL to a value, and only inside the
-- existing guarded status transition (pending -> paid | failed) with every
-- financial/identity column (student_id, subscription_id, amount, currency,
-- payment_gateway, created_at) unchanged. An already-recorded reference can
-- never be overwritten or erased, and outside the guarded transition the
-- column is frozen like every other column. Every other UPDATE aborts.
--
-- PENDING INSERT GUARD: the invariant holds at insertion too — a pending row
-- may never be created with a provider_transaction_id already set. The
-- reference is written only through the guarded pending -> paid | failed
-- decision, so no insert path can seed an audit link outside the trigger's
-- control. Decided rows keep the legacy behavior — reconciliation/backfill
-- paths create paid | failed rows that legitimately carry the gateway's
-- already-known transaction id. (The schema-level
-- student_payments_pending_provider_transaction_check CHECK arrives for
-- SQLite via drizzle-kit push from the shared Drizzle schema; this file adds
-- the BEFORE INSERT trigger parity for the PG-side trigger.)
--
-- SQLite has no server-side stored functions, so the guards live directly in
-- the trigger bodies (see 3-immutability-triggers-sqlite.sql). The strict
-- block-everything UPDATE trigger must therefore be REPLACED here — `CREATE
-- TRIGGER IF NOT EXISTS` would silently keep the old version — hence DROP
-- TRIGGER IF EXISTS + CREATE TRIGGER. The BEFORE INSERT trigger is new, so a
-- plain CREATE TRIGGER IF NOT EXISTS is idempotent for it.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS + CREATE TRIGGER IF NOT EXISTS (insert
--              guard) + DROP TRIGGER IF EXISTS + CREATE TRIGGER (update
--              guard). Safe to re-run any number of times. Pure SQLite — NO
--              PostgreSQL dependencies (no plpgsql, no CREATE FUNCTION, no
--              EXECUTE FUNCTION).
--
-- The DELETE guard (prevent_student_payments_delete_trigger) is unchanged
-- and continues to block all deletes.
--
-- Dialect:    SQLite (libsql). PostgreSQL version lives in
--             5-student-payments-provider-transaction.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- student_payments — provider transaction reference column (nullable)
-- -----------------------------------------------------------------------------
ALTER TABLE student_payments ADD COLUMN IF NOT EXISTS provider_transaction_id varchar(64);


-- -----------------------------------------------------------------------------
-- student_payments — BEFORE INSERT guard: a pending row starts undecided
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS prevent_pending_student_payments_insert_trigger
    BEFORE INSERT ON student_payments
BEGIN
    -- INV-PAY2, insert side: `provider_transaction_id` is NULL for every
    -- pending (undecided) payment. A pending row created with a reference
    -- would bypass the update guard's set-once allowance (which only admits
    -- NULL -> value inside the pending -> paid | failed transition), so the
    -- insert path must reject it up front. Decided rows keep the legacy
    -- behavior — reconciliation/backfill paths create paid | failed rows
    -- that legitimately carry the gateway's already-known transaction id.
    SELECT RAISE(ABORT, 'a pending student_payments row must be created with provider_transaction_id null — the gateway transaction reference may only be recorded inside the pending to paid or failed transition')
    WHERE NEW.status = 'pending'
      AND NEW.provider_transaction_id IS NOT NULL;
END;


-- -----------------------------------------------------------------------------
-- student_payments — payment ledger with one guarded status exception and a
-- set-once provider transaction reference
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS prevent_student_payments_update_trigger;

CREATE TRIGGER prevent_student_payments_update_trigger
    BEFORE UPDATE ON student_payments
BEGIN
    -- Abort unless the ONLY change is the guarded status lifecycle move
    -- (plus, optionally, the one-time provider transaction reference write).
    -- `IS` is SQLite's NULL-safe equality (subscription_id is nullable).
    -- The provider_transaction_id disjunct admits exactly (a) the column
    -- untouched and (b) a write from NULL to a value; an overwrite
    -- (value -> different value) and an erasure (value -> NULL) fail both
    -- arms and abort, and the status predicates keep the write confined to
    -- the guarded pending -> paid | failed decision.
    SELECT RAISE(ABORT, 'student_payments is immutable — UPDATE is permitted only to transition a pending payment to paid or failed with all financial columns unchanged (the provider transaction reference may be recorded once, from null, inside that transition)')
    WHERE NOT (
        OLD.status = 'pending'
        AND NEW.status IN ('paid', 'failed')
        AND NEW.student_id IS OLD.student_id
        AND NEW.subscription_id IS OLD.subscription_id
        AND NEW.amount IS OLD.amount
        AND NEW.currency IS OLD.currency
        AND NEW.payment_gateway IS OLD.payment_gateway
        AND NEW.created_at IS OLD.created_at
        AND (
            NEW.provider_transaction_id IS OLD.provider_transaction_id
            OR OLD.provider_transaction_id IS NULL
        )
    );
END;
