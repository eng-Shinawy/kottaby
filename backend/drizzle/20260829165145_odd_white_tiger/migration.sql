ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "balance_trial" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "trial_granted_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "students" ADD CONSTRAINT "students_balance_trial_check" CHECK ("balance_trial" >= 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;