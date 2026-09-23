-- Source: 5-session-columns-patch.sql
-- =============================================================================
-- 5-session-columns-patch.sql
-- -----------------------------------------------------------------------------
-- Purpose: Repair the `session` table on databases initialized BEFORE the
--          consolidated baseline migration (20260904084151_omniscient_karen_page).
--          That baseline defines `session` with `CREATE TABLE IF NOT EXISTS`,
--          which PostgreSQL silently SKIPS when the table already exists —
--          so the six columns added in PR #51 (held_balance_lane, the
--          cancel/dispute reason surface, and the resolution timestamps)
--          never reached pre-existing databases. Queries selecting those
--          columns then fail with:
--
--            ERROR: column "held_balance_lane" does not exist
--
-- Mechanics: Idempotent `ADD COLUMN IF NOT EXISTS` statements — safe on any
--          database state (fresh databases already have the columns from the
--          baseline; pre-existing ones get them here). Column types mirror
--          backend/db/schema/classes/session.ts exactly (all six are nullable
--          — no NOT NULL, no default).
-- =============================================================================

ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "held_balance_lane" varchar(20);--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "cancel_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "dispute_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "disputed_at" timestamp;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "resolution_note" varchar(500);--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp;--> statement-breakpoint

