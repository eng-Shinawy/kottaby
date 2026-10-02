-- =============================================================================
-- 9-rubric-weakness-area.sql
-- -----------------------------------------------------------------------------
-- Purpose: The DEV2-007 rubric delta's committed schema-sync counterpart —
--          the `rubric_weakness_area` pgEnum plus the evaluations table's
--          nullable `weakness_area` column. Both ship in the drizzle schema
--          (`backend/db/schema/enums.ts` + `backend/db/schema/teachers/
--          evaluations.ts`); this migration is what makes the MIGRATE path
--          (fresh CI databases, ordered rebuilds) carry the same shape the
--          push path does. Without it, every drizzle query selecting the
--          evaluations row fails on the missing column.
--
-- Additive-only: a new enum type + one nullable column on `evaluations` —
--   no FK, no tenancy surface, no backfill (existing rows read NULL).
--
-- Idempotent: safe to replay (type guarded by pg_type existence, the
--   column by ADD COLUMN IF NOT EXISTS — the same guarded shape the
--   notification-dispute-types migration uses).
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rubric_weakness_area') THEN
    CREATE TYPE "rubric_weakness_area" AS ENUM ('tajweed', 'hifz');
  END IF;
END
$$;

ALTER TABLE "evaluations" ADD COLUMN IF NOT EXISTS "weakness_area" "rubric_weakness_area";
