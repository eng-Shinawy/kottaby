-- Enable the pg_trgm extension for faster LIKE/ILIKE searches
-- Drizzle doesn't create extensions automatically, so we need to do it manually
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
-- Create helper function to check if timezone name is valid
CREATE OR REPLACE FUNCTION is_valid_timezone(tz TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF tz = 'Asia/Jerusalem' THEN
        RETURN FALSE;
    END IF;
    RETURN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = tz);
END;
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint

