-- =============================================================================
-- 5-session-resolution-outcome.sql
-- -----------------------------------------------------------------------------
-- Purpose: Persist the FORMAL arbitration outcome on the session row
--          (`session.resolution_outcome`, pgEnum `dispute_resolution`) so
--          participants can read the exact decision (Refund vs
--          PartialRefund vs Cancel vs Complete vs Uphold) off the row —
--          `session.status` records only the outcome FAMILY (cancelled vs
--          completed) and the optional note is not guaranteed to exist.
--
-- Idempotent: safe to replay (IF NOT EXISTS / DO-block guards). The
-- backfill derives each resolved row's outcome from its newest
-- session-scoped `override` audit row (the arbitration contract row the
-- service writes transactionally), so no outcome is ever guessed.
-- =============================================================================

-- 1. The enum type (values are wire-identical to the GraphQL
--    `DisputeResolution` enum — see backend/enum/scheduling/dispute-resolution.enum.ts).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname = 'dispute_resolution' LIMIT 1) THEN
    CREATE TYPE "dispute_resolution" AS ENUM ('Cancel', 'Complete', 'Refund', 'PartialRefund', 'Uphold');
  END IF;
END
$$;

-- 2. The nullable column (NULL = never disputed, or resolved before this
--    migration shipped).
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "resolution_outcome" "dispute_resolution";

-- 3. Backfill from the audit trail (newest override row per session).
UPDATE "session"
SET "resolution_outcome" = (
  SELECT (al.details::jsonb ->> 'resolution')::"dispute_resolution"
  FROM "audit_logs" al
  WHERE al.entity_type = 'session'
    AND al.entity_id = "session".id
    AND al.action_type = 'override'
  ORDER BY al.created_at DESC
  LIMIT 1
)
WHERE "resolved_at" IS NOT NULL
  AND "resolution_outcome" IS NULL;
