-- =============================================================================
-- 10-applicant-outcome-notification.sql
-- -----------------------------------------------------------------------------
-- Purpose: Extend the `notification_type` pgEnum with the cooldown plan's
--          applicant-lifecycle notification kind — `applicant_outcome`
--          (the result notice an applicant receives when an admin override
--          certifies / rejects them or grants a re-evaluation, including the
--          cooldown window copy). The value ships in the drizzle schema
--          (`backend/db/schema/enums.ts`); this migration is its committed
--          schema-sync counterpart so the migrate path (fresh CI databases)
--          carries the same enum space the push path does.
--
-- Idempotent: safe to replay (ADD VALUE inside the guard-then-notify
--   DO-block — the same pattern the dispute-types migration uses).
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type' AND e.enumlabel = 'applicant_outcome'
  ) THEN
    ALTER TYPE notification_type ADD VALUE 'applicant_outcome' AFTER 'session_dispute_resolved';
  END IF;
END $$;
