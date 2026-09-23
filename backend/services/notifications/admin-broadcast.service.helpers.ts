/**
 * Shared runtime seam of the admin broadcast surface — the constants and the
 * rejection primitive BOTH halves of the service build on (the send
 * composition core in `admin-broadcast.service.ts`, the read/stop lifecycle
 * module in `admin-broadcast-lifecycle.service.ts`, and the pre-DB audience
 * guards in `admin-broadcast.guards.ts`), mirroring the sibling-helpers
 * layout of the notification engine (`notification-engine.helpers.ts`).
 */

import { ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";

/**
 * The audit entity label for every accepted broadcast lifecycle action (the
 * send's Create row, the stop's Suspend row). A broadcast has no single
 * backing row type, so the pair (`entityType` = this label, `entityId` = the
 * `broadcasts` header id) is what names one in the audit trail.
 */
export const AUDIT_ENTITY_TYPE = "notification_broadcast";

/**
 * The related-entity type linking every emitted notification row to its
 * `broadcasts` header row — the polymorphic pair the engine's emit carries
 * and the retraction/stats reads scope by.
 */
export const BROADCAST_RELATED_ENTITY_TYPE = "broadcast";

/**
 * One bounded diagnostic + localized rejection for the broadcast surface's
 * expected `ValidationError` codes. The message is server-side diagnostics
 * only (codes and bounds — no copy text, no recipient data); the localized
 * user-facing string rides the thrown error.
 */
export function rejectBroadcast(locale: string, code: string, diagnostic: string, localizedMessage: string): never {
  logger.logDomainError(diagnostic, { code, entity: "notifications", locale });
  throw new ValidationError(code, localizedMessage);
}
