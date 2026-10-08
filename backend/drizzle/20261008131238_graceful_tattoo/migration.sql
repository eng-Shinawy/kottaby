ALTER TABLE "teacher" ADD COLUMN IF NOT EXISTS "was_online_before_lock" boolean;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "gender" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "gender";--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gender') THEN
        CREATE TYPE "gender" AS ENUM('male', 'female');
    END IF;
END $$;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "gender" SET DATA TYPE "gender" USING "gender"::"gender";