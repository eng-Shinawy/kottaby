CREATE TABLE IF NOT EXISTS "parent_link_requests" (
        "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "parent_link_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
        "parent_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "status" "link_status" DEFAULT 'pending'::"link_status" NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "expires_at" timestamp NOT NULL,
        "responded_at" timestamp,
        "reminder_sent_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parent_link_requests_parent_id_idx" ON "parent_link_requests" ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parent_link_requests_student_id_idx" ON "parent_link_requests" ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "parent_link_requests_pending_pair_unique" ON "parent_link_requests" ("parent_id","student_id") WHERE "status" = 'pending';--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "parent_link_requests" ADD CONSTRAINT "parent_link_requests_parent_id_users_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "parent_link_requests" ADD CONSTRAINT "parent_link_requests_student_id_students_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;