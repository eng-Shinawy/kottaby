CREATE TABLE "session_request_idempotency" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "session_request_idempotency_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"idempotency_key" varchar(128) NOT NULL CONSTRAINT "session_request_idempotency_key_unique" UNIQUE,
	"user_id" integer NOT NULL,
	"session_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "held_balance_lane" varchar(20);--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "cancel_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "dispute_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "disputed_at" timestamp;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "resolution_note" varchar(500);--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_request_idempotency_user_id_idx" ON "session_request_idempotency" ("user_id");--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "session_request_idempotency" ADD CONSTRAINT "session_request_idempotency_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "session_request_idempotency" ADD CONSTRAINT "session_request_idempotency_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;