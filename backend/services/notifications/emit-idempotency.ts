/**
 * Emit idempotency claim machinery — best-effort dedupe, FAIL-OPEN (documented
 * deviation D5 from `docs/IDEMPOTENCY.md`'s fail-closed posture for
 * booking-class mutations).
 *
 * Notification emission is OUTSIDE that doc's mandated key set, and blocking a
 * domain event (session completion, payment confirmation) on cache health
 * would be a correctness failure far worse than a recoverable duplicate inbox
 * row. Every cache interaction here therefore degrades to "proceed with the
 * write + ONE structured warn" — never to a thrown error.
 *
 * The claim port is INJECTED per call (the engine's options seam); there is NO
 * module-level cache state and NO default adapter. Redis-flavored adapters map
 * 1:1 onto the port (`SET NX EX` / `SET EX` / `GET`); until one ships, keyed
 * emits simply run fail-open with a warn.
 *
 * Claim key recipe (the raw key is NEVER stored — only its SHA-256 digest):
 * `notif:emit:<sha256("<sorted recipient ids joined by ,>:<type>:<key>")>`.
 * Recipient order is normalized by sorting, so replaying the same cohort in a
 * different order still hits the same claim; a DIFFERENT cohort under the same
 * key is a different emission and claims separately.
 */
import { createHash } from "node:crypto";
import { isNotificationType, type NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { logger } from "@/backend/lib/logger";
import { isPositiveSafeInt } from "@/backend/services/notifications/emit-validation";
import type { NotificationDeliveryReceipt, NotificationReturnType } from "@/backend/types";

/** Claim window: 24h, matching `docs/IDEMPOTENCY.md`'s idempotency-key TTL. */
export const NOTIFICATION_EMIT_CLAIM_TTL_SECONDS = 86_400;

/**
 * Injected idempotency-claim cache port (SET-NX-EX semantics).
 *
 *  - `claim(key, ttlSeconds)` — atomic SET NX EX. `true` = this caller WON the
 *    claim (proceed with the write); `false` = the key is already held
 *    (duplicate emission attempt).
 *  - `store(key, value, ttlSeconds)` — plain SET-with-TTL overwrite; the
 *    engine attaches the serialized delivery receipt AFTER its insert commits.
 *  - `get(key)` — returns the stored value for an already-claimed key, or
 *    `null`.
 *
 * Value semantics are REQUIRED: `notifications` has no idempotency-key column
 * (zero schema drift), so REQ-016's "duplicate → return the PRIOR receipt" is
 * satisfiable only by a value-carrying claim cache.
 */
export interface NotificationIdempotencyClaimCache {
  claim(key: string, ttlSeconds: number): Promise<boolean>;
  store(key: string, value: string, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<string | null>;
}

/** Outcome of one pre-insert claim attempt. */
export type EmitClaimOutcome =
  | { readonly status: "claimed" }
  | { readonly status: "duplicate"; readonly receipt: NotificationDeliveryReceipt }
  | { readonly status: "unavailable" };

/**
 * Builds the hashed claim key for one emission identity.
 *
 * The recipient ids are sorted (order-insensitive dedupe) and joined with
 * commas; the digest input is `<ids>:<type>:<idempotencyKey>`. Only the
 * SHA-256 hex digest ever leaves this function — the raw key is never stored
 * or logged.
 */
export function buildEmitClaimKey(userIds: readonly number[], type: NotificationType, idempotencyKey: string): string {
  const recipients = [...userIds].toSorted((a, b) => a - b).join(",");
  const identity = `${recipients}:${type}:${idempotencyKey}`;
  return `notif:emit:${createHash("sha256").update(identity).digest("hex")}`;
}

/**
 * Attempts the pre-insert duplicate claim.
 *
 *  - claim WON → `claimed` (proceed with the write).
 *  - claim held + readable prior receipt → `duplicate` with the revived
 *    receipt (the engine returns it WITHOUT inserting or publishing).
 *  - claim held but nothing replayable is stored (first emission still in
 *    flight, or a crashed emitter that claimed but never stored) → `unavailable`
 *    — fail open with a warn so the domain event is never blocked.
 *  - any cache error → `unavailable` — fail open with a warn (deviation D5).
 */
export async function attemptEmitClaim(
  cache: NotificationIdempotencyClaimCache,
  key: string
): Promise<EmitClaimOutcome> {
  try {
    const claimed = await cache.claim(key, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);
    if (!claimed) {
      const stored = await cache.get(key);
      const receipt = stored === null ? null : parseStoredEmitReceipt(stored);
      if (receipt === null) {
        warnIdempotencyDegraded("claim held, but no replayable receipt was readable");
        return { status: "unavailable" };
      }
      return { status: "duplicate", receipt };
    }
    return { status: "claimed" };
  } catch (error) {
    warnIdempotencyDegraded("claim cache error", errorNameOf(error));
    return { status: "unavailable" };
  }
}

/**
 * Attaches the completed delivery receipt to the claim key AFTER the insert's
 * transaction has committed (a receipt stored pre-commit could outlive a
 * rolled-back emission and ghost future replays). Failures degrade to one
 * structured warn — the receipt simply stops being replayable.
 */
export async function storeEmitReceiptQuietly(
  cache: NotificationIdempotencyClaimCache,
  key: string,
  receipt: NotificationDeliveryReceipt
): Promise<void> {
  try {
    await cache.store(key, serializeEmitReceipt(receipt), NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);
  } catch (error) {
    warnIdempotencyDegraded("receipt store error", errorNameOf(error));
  }
}

/** Warns that a keyed emit ran with NO claim cache injected (fail-open). */
export function warnEmitIdempotencyUnavailable(): void {
  logger.logDomainError("Notification emit idempotency unavailable (no claim cache injected); proceeding fail-open", {
    code: "NOTIFICATION_IDEMPOTENCY_DEGRADED",
    entity: "notifications",
  });
}

/** Serializes a receipt for cache storage (`createdAt` Dates become ISO strings). */
export function serializeEmitReceipt(receipt: NotificationDeliveryReceipt): string {
  return JSON.stringify(receipt);
}

/**
 * Parses + revives a stored receipt. Returns `null` for ANY structural
 * deviation (unparseable JSON, wrong envelope shape, empty arrays — a real
 * emission always carries at least one row — bad field types, unknown enum
 * member, non-temporal `createdAt`) — the caller treats that as fail-open,
 * never as a crash.
 */
export function parseStoredEmitReceipt(stored: string): NotificationDeliveryReceipt | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("notifications" in parsed) ||
    !("recipientUserIds" in parsed)
  ) {
    return null;
  }
  const notificationsValue: unknown = parsed.notifications;
  const recipientUserIdsValue: unknown = parsed.recipientUserIds;
  if (!Array.isArray(notificationsValue) || !Array.isArray(recipientUserIdsValue)) {
    return null;
  }
  // A real emission always carries at least one row and one recipient — an
  // empty stored receipt is corrupt, not replayable.
  if (notificationsValue.length === 0 || recipientUserIdsValue.length === 0) {
    return null;
  }
  const rows: NotificationReturnType[] = [];
  for (const candidate of notificationsValue) {
    const row = parseStoredNotificationRow(candidate);
    if (row === null) {
      return null;
    }
    rows.push(row);
  }
  const recipientUserIds: number[] = [];
  for (const candidate of recipientUserIdsValue) {
    if (!isPositiveSafeInt(candidate)) {
      return null;
    }
    recipientUserIds.push(candidate);
  }
  return { notifications: rows, recipientUserIds };
}

/** Field-by-field revive of one stored row (never a spread — BOPLA mapping). */
function parseStoredNotificationRow(candidate: unknown): NotificationReturnType | null {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("id" in candidate) ||
    !("userId" in candidate) ||
    !("type" in candidate) ||
    !("title" in candidate) ||
    !("body" in candidate) ||
    !("isRead" in candidate) ||
    !("relatedEntityType" in candidate) ||
    !("relatedEntityId" in candidate) ||
    !("createdAt" in candidate)
  ) {
    return null;
  }
  const { id, userId, type, title, body, isRead, relatedEntityType, relatedEntityId, createdAt } = candidate;
  if (!isPositiveSafeInt(id) || !isPositiveSafeInt(userId)) {
    return null;
  }
  if (!isNotificationType(type)) {
    return null;
  }
  if (typeof title !== "string") {
    return null;
  }
  if (body !== null && typeof body !== "string") {
    return null;
  }
  if (typeof isRead !== "boolean") {
    return null;
  }
  if (relatedEntityType !== null && typeof relatedEntityType !== "string") {
    return null;
  }
  if (relatedEntityId !== null && !isPositiveSafeInt(relatedEntityId)) {
    return null;
  }
  if (typeof createdAt !== "string") {
    return null;
  }
  const revivedCreatedAt = new Date(createdAt);
  if (Number.isNaN(revivedCreatedAt.getTime())) {
    return null;
  }
  return {
    id,
    userId,
    type,
    title,
    body,
    isRead,
    relatedEntityType,
    relatedEntityId,
    createdAt: revivedCreatedAt,
  };
}

/** One structured warn per degraded occurrence — ids/codes only, no copy, no keys. */
function warnIdempotencyDegraded(detail: string, errorName: string = "none"): void {
  logger.logDomainError(`Notification emit idempotency degraded (${detail}); proceeding fail-open`, {
    code: "NOTIFICATION_IDEMPOTENCY_DEGRADED",
    entity: "notifications",
    errorName,
  });
}

function errorNameOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
