-- Pre-migration deduplication: collapse any pre-existing duplicate
-- (session_id, evaluator_id) rows so the UNIQUE constraint below can be created.
-- Keeps the earliest insert (lowest id) per pair — first evaluation wins.
-- Rows with NULL session_id are never duplicates (NULLs are distinct to UNIQUE).
DELETE FROM "evaluations" a
USING "evaluations" b
WHERE a."session_id" = b."session_id"
  AND a."evaluator_id" = b."evaluator_id"
  AND a."id" > b."id";--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_session_evaluator_unique" UNIQUE("session_id","evaluator_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;