-- =============================================================================
-- 7-notification-dispute-types.sql
-- -----------------------------------------------------------------------------
-- Purpose: Extend the `notification_type` pgEnum with the dispute wave's two
--          notification kinds — `session_dispute_opened` (the filing
--          confirmation the counterparties receive) and
--          `session_dispute_resolved` (the arbitration-decision notice).
--          Both values ship in the drizzle schema
--          (`backend/db/schema/enums.ts`); this migration is their committed
--          schema-sync counterpart so the migrate path (fresh CI databases)
--          carries the same enum space the push path does.
--
-- Idempotent: safe to replay (ADD VALUE IF NOT EXISTS inside the
--   guard-then-notify DO-block — the same pattern the arbitration-reversal
--   transaction-type migration uses).
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type' AND e.enumlabel = 'session_dispute_opened'
  ) THEN
    ALTER TYPE notification_type ADD VALUE 'session_dispute_opened' AFTER 'evaluation_result';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type' AND e.enumlabel = 'session_dispute_resolved'
  ) THEN
    ALTER TYPE notification_type ADD VALUE 'session_dispute_resolved' AFTER 'session_dispute_opened';
  END IF;
END $$;
