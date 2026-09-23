DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'broadcast_audience_type') THEN
        CREATE TYPE "broadcast_audience_type" AS ENUM('all', 'role', 'country', 'plan');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'broadcast_status') THEN
        CREATE TYPE "broadcast_status" AS ENUM('active', 'stopped');
    END IF;
END $$;--> statement-breakpoint
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
CREATE TABLE IF NOT EXISTS "broadcasts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "broadcasts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"audience_type" "broadcast_audience_type",
	"audience_role" "user_role",
	"audience_country" varchar(100),
	"audience_plan_id" integer,
	"status" "broadcast_status" DEFAULT 'active'::"broadcast_status" NOT NULL,
	"recipient_count" integer NOT NULL,
	"sent_by_id" integer NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"stopped_by_id" integer,
	"stopped_at" timestamp,
	"idempotency_key" varchar
);--> statement-breakpoint
ALTER TABLE "student_payments" ADD COLUMN IF NOT EXISTS "provider_transaction_id" varchar(64);--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "resolution_outcome" "dispute_resolution";--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_session_evaluator_unique" UNIQUE("session_id","evaluator_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "broadcasts_idempotency_key_uidx" ON "broadcasts" ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcasts_sent_at_idx" ON "broadcasts" ("sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcasts_status_idx" ON "broadcasts" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_related_entity_type_entity_id_idx" ON "notifications" ("related_entity_type","related_entity_id");--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_sent_by_id_users_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_stopped_by_id_users_id_fkey" FOREIGN KEY ("stopped_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
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