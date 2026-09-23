CREATE INDEX IF NOT EXISTS "subscriptions_active_end_date_idx" ON "subscriptions" ("end_date") WHERE "status" = 'active';--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "student_payments" DROP CONSTRAINT IF EXISTS "student_payments_amount_check", ADD CONSTRAINT "student_payments_amount_check" CHECK ("amount" > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "teacher_transaction" DROP CONSTRAINT IF EXISTS "teacher_transaction_amount_check", ADD CONSTRAINT "teacher_transaction_amount_check" CHECK ("amount" > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;