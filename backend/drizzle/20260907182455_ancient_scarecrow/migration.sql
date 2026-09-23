DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_credit_lane') THEN
        CREATE TYPE "subscription_credit_lane" AS ENUM('hifz', 'tajweed', 'reviews');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'payment_gateway' AND e.enumlabel = 'mock'
    ) THEN
        ALTER TYPE "payment_gateway" ADD VALUE 'mock';
    END IF;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_purchase_idempotency" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subscription_purchase_idempotency_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"idempotency_key" varchar(128) NOT NULL CONSTRAINT "subscription_purchase_idempotency_key_unique" UNIQUE,
	"user_id" integer NOT NULL,
	"subscription_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "balance_lane" "subscription_credit_lane";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_purchase_idempotency_user_id_idx" ON "subscription_purchase_idempotency" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_payment_reference_unique" ON "subscriptions" ("payment_reference") WHERE "payment_reference" IS NOT NULL;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "subscription_purchase_idempotency" ADD CONSTRAINT "subscription_purchase_idempotency_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "subscription_purchase_idempotency" ADD CONSTRAINT "subscription_purchase_idempotency_etBNqRc9DVFK_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;