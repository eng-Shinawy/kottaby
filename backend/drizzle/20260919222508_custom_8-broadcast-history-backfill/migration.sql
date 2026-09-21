-- Source: 8-broadcast-history-backfill.sql
-- =============================================================================
-- 8-broadcast-history-backfill.sql
-- -----------------------------------------------------------------------------
-- Purpose: One-time, data-only backfill of the `broadcasts` header table
--          (backend/db/schema/notifications/broadcasts.ts) from pre-existing
--          broadcast sends that were recorded only as `notifications` rows
--          plus a `notification_broadcast` audit row (no first-class entity
--          existed when they were sent).
--
-- Join key: Postgres `now()` returns transaction-start time, so the audit row
--          and ALL notification rows of one send share the exact same
--          `created_at`. Header metadata (audience snapshot, sender, count)
--          is recovered from the matching audit row's `details` JSON — no
--          message-text reconstruction.
--
-- STEP 1 — one header per historical send-group
--   (title, body, created_at) of `system_broadcast` rows still unlinked
--   (`related_entity_id IS NULL`), with a matching audit row of the same
--   `created_at` and `recipientCount`. INNER JOIN semantics: a group with NO
--   matching audit row is SKIPPED — never headered with an invented actor
--   (`sent_by_id` is NOT NULL, so a LEFT join would abort the migration).
--   Audience snapshot: missing `role`/`country`/`planId` JSON keys insert
--   NULL; an unrecognized `scope` value is CASE-guarded to NULL so the
--   `broadcast_audience_type` pgEnum cast can never fail. Unlinked groups
--   whose rows have NULL bodies are skipped too — the send path only ever
--   writes non-empty bodies, and `broadcasts.body` is NOT NULL.
--   A DISTINCT ON lowest-id audit row picks THE audit row of the send.
--
-- STEP 2 — link each group's rows to its header
--   (title equality + `body IS NOT DISTINCT FROM` + `created_at` equality).
--
-- Idempotency guard: both steps are predicated on
--   `related_entity_id IS NULL`. After STEP 2 links the rows, a re-run finds
--   zero groups and zero unlinked rows — a no-op. Sends created after the
--   feature ship already-linked (`relatedEntityType = 'broadcast'` +
--   `relatedEntityId`), so the guard never touches them. The migration never
--   writes `audit_logs` (historical send audit rows keep `entityId` null).
--
-- Accepted risk: two identical sends (same title+body) committed in the same
--   microsecond merge into ONE header with the union recipient count —
--   possible only for a true double-commit racing the transaction clock.
-- =============================================================================

-- STEP 1: one header per historical send-group with a matching audit row.
WITH groups AS (
  SELECT title, body, created_at, count(*) AS recipients
  FROM notifications
  WHERE type = 'system_broadcast'
    AND related_entity_id IS NULL
    AND body IS NOT NULL
  GROUP BY title, body, created_at
)
INSERT INTO broadcasts (title, body, audience_type, audience_role,
                        audience_country, audience_plan_id, status,
                        recipient_count, sent_by_id, sent_at, idempotency_key)
SELECT g.title, g.body,
       (CASE WHEN audit.d ->> 'scope' IN ('all', 'role', 'country', 'plan')
             THEN audit.d ->> 'scope' END)::broadcast_audience_type,
       (CASE WHEN audit.d ->> 'role' IN ('admin', 'teacher', 'student', 'parent')
             THEN audit.d ->> 'role' END)::user_role, audit.d ->> 'country',
       (audit.d ->> 'planId')::int,
       'active', g.recipients, audit.actor_id, g.created_at, NULL
FROM groups g
INNER JOIN LATERAL (
  SELECT actor_id, details::jsonb AS d
  FROM audit_logs
  WHERE entity_type = 'notification_broadcast'
    AND created_at = g.created_at
    AND (details::json ->> 'recipientCount')::int = g.recipients
  ORDER BY id ASC
  LIMIT 1
) audit ON true;--> statement-breakpoint
-- STEP 2: link each group's rows to its header.
UPDATE notifications n
SET related_entity_type = 'broadcast', related_entity_id = b.id
FROM broadcasts b
WHERE n.type = 'system_broadcast'
  AND n.related_entity_id IS NULL
  AND n.title = b.title
  AND n.body IS NOT DISTINCT FROM b.body
  AND n.created_at = b.sent_at;--> statement-breakpoint

