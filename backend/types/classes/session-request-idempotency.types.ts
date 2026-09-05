import type { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";

export type SessionRequestIdempotencySelectType = typeof sessionRequestIdempotency.$inferSelect;
export type SessionRequestIdempotencyInsertType = typeof sessionRequestIdempotency.$inferInsert;
