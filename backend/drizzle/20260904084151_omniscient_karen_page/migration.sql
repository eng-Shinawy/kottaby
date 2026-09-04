DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_locale') THEN
        CREATE TYPE "app_locale" AS ENUM('ar', 'en');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_action_type') THEN
        CREATE TYPE "audit_action_type" AS ENUM('create', 'update', 'delete', 'override', 'adjust', 'suspend', 'reactivate');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gender') THEN
        CREATE TYPE "gender" AS ENUM('male', 'female', 'other');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'link_status') THEN
        CREATE TYPE "link_status" AS ENUM('pending', 'confirmed', 'rejected', 'expired');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
        CREATE TYPE "notification_type" AS ENUM('session_request', 'session_completion', 'session_cancellation', 'parent_link_request', 'system_broadcast', 'payment_confirmation', 'evaluation_result');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_gateway') THEN
        CREATE TYPE "payment_gateway" AS ENUM('stripe', 'paypal', 'paymob', 'fawry', 'offline_cash', 'bank_transfer', 'scholarship', 'other');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        CREATE TYPE "payment_status" AS ENUM('pending', 'paid', 'failed', 'refunded');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_intent') THEN
        CREATE TYPE "session_intent" AS ENUM('hifz', 'tajweed', 'evaluation');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
        CREATE TYPE "session_status" AS ENUM('scheduled', 'started', 'completed', 'cancelled', 'disputed');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_type') THEN
        CREATE TYPE "session_type" AS ENUM('student_session', 'teacher_evaluation', 're_evaluation');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
        CREATE TYPE "subscription_status" AS ENUM('active', 'pending', 'expired', 'cancelled', 'suspended');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'surah_juz_ref') THEN
        CREATE TYPE "surah_juz_ref" AS ENUM('surah_al_fatihah', 'surah_al_baqarah', 'surah_aal_imran', 'surah_an_nisa', 'surah_al_maidah', 'juz_1', 'juz_2', 'juz_3', 'juz_4', 'juz_5', 'juz_6', 'juz_7', 'juz_8', 'juz_9', 'juz_10', 'juz_11', 'juz_12', 'juz_13', 'juz_14', 'juz_15', 'juz_16', 'juz_17', 'juz_18', 'juz_19', 'juz_20', 'juz_21', 'juz_22', 'juz_23', 'juz_24', 'juz_25', 'juz_26', 'juz_27', 'juz_28', 'juz_29', 'juz_30');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'teacher_request_preference') THEN
        CREATE TYPE "teacher_request_preference" AS ENUM('queue', 'reject', 'offer_alternatives');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_status') THEN
        CREATE TYPE "transaction_status" AS ENUM('pending', 'completed', 'failed');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_type') THEN
        CREATE TYPE "transaction_type" AS ENUM('earning', 'withdrawal', 'bonus');
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE "user_role" AS ENUM('admin', 'teacher', 'student', 'parent');
    END IF;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"actor_id" integer NOT NULL,
	"action_type" "audit_action_type" NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" integer,
	"details" varchar(2000),
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "plans_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(255) NOT NULL,
	"session_count" integer NOT NULL,
	"price" numeric(10,2) NOT NULL,
	"currency" char(3) DEFAULT 'EGP' NOT NULL,
	"interval_days" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plans_session_count_check" CHECK ("session_count" > 0),
	CONSTRAINT "plans_price_check" CHECK ("price" >= 0),
	CONSTRAINT "plans_interval_days_check" CHECK ("interval_days" > 0)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "student_payments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "student_payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"student_id" integer NOT NULL,
	"subscription_id" integer,
	"amount" numeric(10,2) NOT NULL,
	"currency" char(3) DEFAULT 'EGP' NOT NULL,
	"payment_gateway" "payment_gateway" NOT NULL,
	"status" "payment_status" DEFAULT 'pending'::"payment_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "student_payments_amount_check" CHECK ("amount" >= 0)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "student_subscriptions" (
	"student_id" integer,
	"subscription_id" integer,
	"enrolled_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "student_subscriptions_pkey" PRIMARY KEY("student_id","subscription_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subscriptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"plan_id" integer NOT NULL,
	"status" "subscription_status" DEFAULT 'pending'::"subscription_status" NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"payment_method" "payment_gateway",
	"payment_reference" varchar(255),
	"payment_verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teacher_transaction" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "teacher_transaction_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"wallet_id" integer NOT NULL,
	"session_id" integer,
	"description" varchar(255),
	"amount" numeric(10,2) NOT NULL,
	"type" "transaction_type" NOT NULL,
	"status" "transaction_status" DEFAULT 'pending'::"transaction_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_transaction_amount_check" CHECK ("amount" >= 0)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wallet_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"teacher_id" integer NOT NULL CONSTRAINT "wallet_teacher_id_unique" UNIQUE,
	"balance" numeric(10,2) DEFAULT '0' NOT NULL,
	"total_earning" numeric(10,2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_balance_check" CHECK ("balance" >= 0),
	CONSTRAINT "wallet_total_earning_check" CHECK ("total_earning" >= 0)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "home_work" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "home_work_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" integer NOT NULL,
	"current_from_ayah" integer,
	"current_to_ayah" integer,
	"current_grade" integer,
	"current_surah_juz" "surah_juz_ref",
	"revision_from_ayah" integer,
	"revision_to_ayah" integer,
	"revision_grade" integer,
	"revision_surah_juz" "surah_juz_ref",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "home_work_current_grade_check" CHECK ("current_grade" >= 0 AND "current_grade" <= 100),
	CONSTRAINT "home_work_revision_grade_check" CHECK ("revision_grade" >= 0 AND "revision_grade" <= 100)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lessons" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lessons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"plan_id" integer,
	"title" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "progress" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "progress_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"student_id" integer NOT NULL,
	"lesson_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recitation" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recitation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" integer NOT NULL CONSTRAINT "recitation_session_id_unique" UNIQUE,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" integer NOT NULL,
	"teacher_notes" text,
	"student_rating_by_teacher" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reports_student_rating_by_teacher_check" CHECK ("student_rating_by_teacher" >= 0 AND "student_rating_by_teacher" <= 5)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "session_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"teacher_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"status" "session_status" DEFAULT 'scheduled'::"session_status" NOT NULL,
	"session_type" "session_type" DEFAULT 'student_session'::"session_type" NOT NULL,
	"intent" "session_intent",
	"fee" numeric(10,2),
	"fee_held" boolean DEFAULT false,
	"held_balance_lane" varchar(20),
	"started_at" timestamp,
	"ended_at" timestamp,
	"confirmed_by_student_at" timestamp,
	"confirmed_by_teacher_at" timestamp,
	"confirmation_deadline" timestamp,
	"cancel_reason" varchar(500),
	"dispute_reason" varchar(500),
	"disputed_at" timestamp,
	"resolution_note" varchar(500),
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session_request_idempotency" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "session_request_idempotency_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"idempotency_key" varchar(128) NOT NULL CONSTRAINT "session_request_idempotency_key_unique" UNIQUE,
	"user_id" integer NOT NULL,
	"session_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"is_read" boolean DEFAULT false,
	"related_entity_type" varchar(100),
	"related_entity_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
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
CREATE TABLE IF NOT EXISTS "parents" (
	"id" integer PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "students" (
	"id" integer PRIMARY KEY,
	"balance_hifz" integer DEFAULT 0,
	"balance_reviews" integer DEFAULT 0,
	"balance_tajweed" integer DEFAULT 0,
	"balance_trial" integer DEFAULT 0 NOT NULL,
	"trial_granted_at" timestamp,
	"primary_language" varchar(100),
	"another_language" varchar(100),
	"handshake_code" varchar(50) NOT NULL CONSTRAINT "students_handshake_code_unique" UNIQUE,
	"parent_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "students_balance_hifz_check" CHECK ("balance_hifz" >= 0),
	CONSTRAINT "students_balance_reviews_check" CHECK ("balance_reviews" >= 0),
	CONSTRAINT "students_balance_tajweed_check" CHECK ("balance_tajweed" >= 0),
	CONSTRAINT "students_balance_trial_check" CHECK ("balance_trial" >= 0)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "applicants" (
	"id" integer PRIMARY KEY,
	"verification_attempts" integer DEFAULT 0,
	"last_attempt_at" timestamp,
	"cooldown_until" timestamp,
	"status" varchar(50) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evaluations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "evaluations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"evaluated_id" integer NOT NULL,
	"evaluator_id" integer NOT NULL,
	"session_id" integer,
	"score" integer,
	"notes" text,
	"is_deleted" boolean DEFAULT false,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "evaluations_score_check" CHECK ("score" >= 0 AND "score" <= 100)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teacher" (
	"id" integer PRIMARY KEY,
	"is_approved" boolean DEFAULT false,
	"is_evaluator" boolean DEFAULT false,
	"average_rating" numeric(3,2),
	"is_online" boolean DEFAULT false,
	"subjects" varchar(255),
	"request_preference" "teacher_request_preference" DEFAULT 'queue'::"teacher_request_preference",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_average_rating_check" CHECK ("average_rating" >= 0 AND "average_rating" <= 5)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teacher_verification" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "teacher_verification_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"teacher_id" integer NOT NULL,
	"tajweed_level" varchar(50),
	"hifz_level" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin" (
	"id" integer PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"full_name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL CONSTRAINT "users_email_unique" UNIQUE,
	"phone" varchar(20),
	"password_hash" varchar(255) NOT NULL,
	"role" "user_role" NOT NULL,
	"date_of_birth" date,
	"gender" "gender",
	"country" varchar(100),
	"locale" "app_locale",
	"is_deleted" boolean DEFAULT false,
	"deleted_at" timestamp,
	"suspended" boolean DEFAULT false,
	"suspended_at" timestamp,
	"suspended_period_days" integer,
	"is_blocked" boolean DEFAULT false,
	"blocked_at" timestamp,
	"last_active_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_actor_id_idx" ON "audit_logs" ("actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_entity_type_entity_id_idx" ON "audit_logs" ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "student_payments_student_id_idx" ON "student_payments" ("student_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "student_payments_subscription_id_idx" ON "student_payments" ("subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "student_subscriptions_subscription_id_idx" ON "student_subscriptions" ("subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_user_id_idx" ON "subscriptions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_plan_id_idx" ON "subscriptions" ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teacher_transaction_wallet_id_idx" ON "teacher_transaction" ("wallet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teacher_transaction_session_id_idx" ON "teacher_transaction" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "home_work_session_id_idx" ON "home_work" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lessons_plan_id_idx" ON "lessons" ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "progress_student_id_idx" ON "progress" ("student_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "progress_lesson_id_idx" ON "progress" ("lesson_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recitation_session_id_idx" ON "recitation" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_session_id_idx" ON "reports" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_teacher_id_idx" ON "session" ("teacher_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_student_id_idx" ON "session" ("student_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_teacher_id_student_id_idx" ON "session" ("teacher_id","student_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_request_idempotency_user_id_idx" ON "session_request_idempotency" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_id_idx" ON "notifications" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_id_is_read_idx" ON "notifications" ("user_id","is_read");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parent_link_requests_parent_id_idx" ON "parent_link_requests" ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parent_link_requests_student_id_idx" ON "parent_link_requests" ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "parent_link_requests_pending_pair_unique" ON "parent_link_requests" ("parent_id","student_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "students_parent_id_idx" ON "students" ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evaluations_evaluated_id_idx" ON "evaluations" ("evaluated_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evaluations_evaluator_id_idx" ON "evaluations" ("evaluator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evaluations_session_id_idx" ON "evaluations" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teacher_verification_teacher_id_idx" ON "teacher_verification" ("teacher_id");--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "student_payments" ADD CONSTRAINT "student_payments_student_id_students_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "student_payments" ADD CONSTRAINT "student_payments_subscription_id_subscriptions_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "student_subscriptions" ADD CONSTRAINT "student_subscriptions_student_id_students_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "student_subscriptions" ADD CONSTRAINT "student_subscriptions_subscription_id_subscriptions_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "teacher_transaction" ADD CONSTRAINT "teacher_transaction_wallet_id_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "teacher_transaction" ADD CONSTRAINT "teacher_transaction_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "wallet" ADD CONSTRAINT "wallet_teacher_id_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teacher"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "home_work" ADD CONSTRAINT "home_work_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "lessons" ADD CONSTRAINT "lessons_plan_id_plans_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "progress" ADD CONSTRAINT "progress_student_id_students_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "progress" ADD CONSTRAINT "progress_lesson_id_lessons_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "recitation" ADD CONSTRAINT "recitation_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "reports" ADD CONSTRAINT "reports_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "session" ADD CONSTRAINT "session_teacher_id_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teacher"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "session" ADD CONSTRAINT "session_student_id_students_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "session_request_idempotency" ADD CONSTRAINT "session_request_idempotency_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "session_request_idempotency" ADD CONSTRAINT "session_request_idempotency_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "parent_link_requests" ADD CONSTRAINT "parent_link_requests_parent_id_users_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "parent_link_requests" ADD CONSTRAINT "parent_link_requests_student_id_students_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "parents" ADD CONSTRAINT "parents_id_users_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "students" ADD CONSTRAINT "students_id_users_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "students" ADD CONSTRAINT "students_parent_id_users_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "applicants" ADD CONSTRAINT "applicants_id_users_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_evaluated_id_users_id_fkey" FOREIGN KEY ("evaluated_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_evaluator_id_users_id_fkey" FOREIGN KEY ("evaluator_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "teacher" ADD CONSTRAINT "teacher_id_users_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "teacher_verification" ADD CONSTRAINT "teacher_verification_teacher_id_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teacher"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "admin" ADD CONSTRAINT "admin_id_users_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;