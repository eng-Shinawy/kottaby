-- Source: 12-teacher-matching-columns.sql
-- =============================================================================
-- 12-teacher-matching-columns.sql
-- -----------------------------------------------------------------------------
-- Purpose: Schema-sync counterpart for the teacher matching storage columns —
--          nullable `teacher.recitations` + `teacher.languages` varchar(255)
--          JSON-array columns (fail-closed parsed on read; e.g.
--          `["hafs_an_asim","warsh_an_nafi"]` and `["english","french"]`), and
--          the `session_teacher_id_status_idx` composite index on
--          `session(teacher_id, status)` that backs the matcher's in-session
--          exclusion predicate (`NOT EXISTS` a started session for the
--          teacher).
--
-- Why a migration: the columns/index exist in the committed drizzle schema
--          (`backend/db/schema/teachers/teacher.ts`,
--          `backend/db/schema/classes/session.ts`); without this file the
--          migrate path (fresh CI databases, production deploys) produces a
--          schema missing them while the push path creates them — a
--          push/migrate drift. This file restores parity.
--
-- Idempotent: safe to replay (IF NOT EXISTS guards on both statements).
-- =============================================================================

ALTER TABLE "teacher" ADD COLUMN IF NOT EXISTS "recitations" varchar(255);--> statement-breakpoint
ALTER TABLE "teacher" ADD COLUMN IF NOT EXISTS "languages" varchar(255);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_teacher_id_status_idx"
  ON "session" USING btree ("teacher_id", "status");--> statement-breakpoint

