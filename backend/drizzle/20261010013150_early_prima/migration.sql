CREATE INDEX IF NOT EXISTS "subscription_purchase_idempotency_subscription_id_idx" ON "subscription_purchase_idempotency" ("subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_request_idempotency_session_id_idx" ON "session_request_idempotency" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcasts_sent_by_id_idx" ON "broadcasts" ("sent_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcasts_stopped_by_id_idx" ON "broadcasts" ("stopped_by_id");