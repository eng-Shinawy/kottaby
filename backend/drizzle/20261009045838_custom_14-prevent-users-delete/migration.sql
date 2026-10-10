-- Source: 14-prevent-users-delete.sql
-- =============================================================================
-- 14-prevent-users-delete.sql
-- -----------------------------------------------------------------------------
-- Purpose: Database-tier backstop against hard-deleting a governed user.
--          All user deactivation is governance soft delete (is_deleted /
--          deleted_at); the application layer has zero hard-delete paths
--          (corpus-proven), but a raw `DELETE FROM users` previously
--          succeeded for any user without restrict-FK dependents (child
--          profile tables CASCADE). This trigger closes that hole at the
--          same tier as the immutability triggers.
--
-- Pattern: BEFORE DELETE row-level trigger that RAISEs EXCEPTION. The
--          guard is GUC-gated: it is ARMED whenever the custom setting
--          `kottaby.users_delete_guard` is unset or holds any value other
--          than 'off' (the production default — no opt-out is configured
--          anywhere in production). Test paths that hard-delete fixture
--          users in teardown pin the opt-out connection-time on the DB
--          client (pg Pool startup options packet / PGlite session pin),
--          so no test helper is edited.
--
-- Idempotency: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS +
--              CREATE TRIGGER. Safe to re-run any number of times (the
--              auto-bundler may re-apply a modified file).
--
-- Dialect:    PostgreSQL.
-- =============================================================================

CREATE OR REPLACE FUNCTION prevent_users_delete()
RETURNS trigger AS $$
BEGIN
    IF coalesce(current_setting('kottaby.users_delete_guard', true), '') <> 'off' THEN
        RAISE EXCEPTION 'users is not hard-deletable — use governance soft delete';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS prevent_users_delete_trigger ON users;--> statement-breakpoint
CREATE TRIGGER prevent_users_delete_trigger
    BEFORE DELETE ON users
    FOR EACH ROW
    EXECUTE FUNCTION prevent_users_delete();--> statement-breakpoint

