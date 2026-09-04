-- Source: 3-immutability-triggers.sql
-- =============================================================================
-- 3-immutability-triggers.sql
-- -----------------------------------------------------------------------------
-- Purpose: Enforce append-only semantics on the 3 immutable tables
--          (INV-W6, INV-PAY2, FR-10.5). Rows in these tables must NEVER be
--          UPDATEd or DELETEd after insertion; corrections are made via
--          compensating rows only.
--
--            * audit_logs          — admin audit trail (A.5; append-only)
--            * student_payments    — student payment ledger (INV-PAY2)
--            * teacher_transaction — teacher wallet ledger (INV-W6)
--
-- Pattern: BEFORE UPDATE / BEFORE DELETE row-level triggers that RAISE
--          EXCEPTION, blocking the mutation. Insertions are unaffected.
--
-- Idempotency: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS +
--              CREATE TRIGGER for every trigger. Safe to re-run any number
--              of times. NO CONCURRENTLY (per docs/DATABASE_MIGRATIONS.md —
--              Drizzle's migrator is always transactional).
--
-- Dialect:    PostgreSQL. SQLite parity lives in
--             3-immutability-triggers-sqlite.sql (see docs/SQLITE_LOCAL_DEV.md).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- audit_logs — immutable admin audit trail (A.5)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_audit_logs_update()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is immutable — UPDATE is not permitted';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_audit_logs_delete()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is immutable — DELETE is not permitted';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS prevent_audit_logs_update_trigger ON audit_logs;--> statement-breakpoint
CREATE TRIGGER prevent_audit_logs_update_trigger
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_logs_update();--> statement-breakpoint
DROP TRIGGER IF EXISTS prevent_audit_logs_delete_trigger ON audit_logs;--> statement-breakpoint
CREATE TRIGGER prevent_audit_logs_delete_trigger
    BEFORE DELETE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_logs_delete();--> statement-breakpoint
-- -----------------------------------------------------------------------------
-- student_payments — immutable student payment ledger (INV-PAY2)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_student_payments_update()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'student_payments is immutable — UPDATE is not permitted';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_student_payments_delete()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'student_payments is immutable — DELETE is not permitted';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS prevent_student_payments_update_trigger ON student_payments;--> statement-breakpoint
CREATE TRIGGER prevent_student_payments_update_trigger
    BEFORE UPDATE ON student_payments
    FOR EACH ROW
    EXECUTE FUNCTION prevent_student_payments_update();--> statement-breakpoint
DROP TRIGGER IF EXISTS prevent_student_payments_delete_trigger ON student_payments;--> statement-breakpoint
CREATE TRIGGER prevent_student_payments_delete_trigger
    BEFORE DELETE ON student_payments
    FOR EACH ROW
    EXECUTE FUNCTION prevent_student_payments_delete();--> statement-breakpoint
-- -----------------------------------------------------------------------------
-- teacher_transaction — immutable teacher wallet ledger (INV-W6)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_teacher_transaction_update()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'teacher_transaction is immutable — UPDATE is not permitted';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_teacher_transaction_delete()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'teacher_transaction is immutable — DELETE is not permitted';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS prevent_teacher_transaction_update_trigger ON teacher_transaction;--> statement-breakpoint
CREATE TRIGGER prevent_teacher_transaction_update_trigger
    BEFORE UPDATE ON teacher_transaction
    FOR EACH ROW
    EXECUTE FUNCTION prevent_teacher_transaction_update();--> statement-breakpoint
DROP TRIGGER IF EXISTS prevent_teacher_transaction_delete_trigger ON teacher_transaction;--> statement-breakpoint
CREATE TRIGGER prevent_teacher_transaction_delete_trigger
    BEFORE DELETE ON teacher_transaction
    FOR EACH ROW
    EXECUTE FUNCTION prevent_teacher_transaction_delete();--> statement-breakpoint

