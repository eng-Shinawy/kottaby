DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispute_resolution') THEN
        CREATE TYPE "dispute_resolution" AS ENUM('Cancel', 'Complete', 'Refund', 'PartialRefund', 'Uphold');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'notification_type' AND e.enumlabel = 'session_dispute_opened'
    ) THEN
        ALTER TYPE "notification_type" ADD VALUE 'session_dispute_opened';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'notification_type' AND e.enumlabel = 'session_dispute_resolved'
    ) THEN
        ALTER TYPE "notification_type" ADD VALUE 'session_dispute_resolved';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'transaction_type' AND e.enumlabel = 'arbitration_reversal'
    ) THEN
        ALTER TYPE "transaction_type" ADD VALUE 'arbitration_reversal';
    END IF;
END $$;--> statement-breakpoint
ALTER TABLE "session" DROP CONSTRAINT IF EXISTS "session_student_id_students_id_fkey";--> statement-breakpoint
ALTER TABLE "student_payments" ADD COLUMN IF NOT EXISTS "provider_transaction_id" varchar(64);--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "resolution_outcome" "dispute_resolution";--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_session_evaluator_unique" UNIQUE("session_id","evaluator_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "session" ADD CONSTRAINT "session_student_id_users_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "student_payments" ADD CONSTRAINT "student_payments_pending_provider_transaction_check" CHECK ("status" <> 'pending' OR "provider_transaction_id" IS NULL);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "student_payments" DROP CONSTRAINT IF EXISTS "student_payments_amount_check", ADD CONSTRAINT "student_payments_amount_check" CHECK ("amount" > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "teacher_transaction" DROP CONSTRAINT IF EXISTS "teacher_transaction_amount_check", ADD CONSTRAINT "teacher_transaction_amount_check" CHECK ("amount" > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;