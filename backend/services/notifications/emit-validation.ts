/**
 * Emit-input validation guards — the notification engine's pre-DB fail-closed
 * gate.
 *
 * Every rule here runs BEFORE any database access (and before any idempotency
 * cache access): a rejected input can never produce rows, claims, or publishes.
 * All failures throw the localized generic `ValidationError` — the errors
 * namespace deliberately ships no emit-specific keys (generic `validation`
 * copy is reused per the shared locale errors-namespace policy).
 *
 * Rules (schema-faithful bounds):
 *  - `title` — non-empty after trimming, at most 255 characters
 *    (`notifications.title` is `varchar(255)`); stored VERBATIM (never
 *    trimmed, never mutated) — the emptiness check is validation, not
 *    transformation.
 *  - `body` — nullable free text; any string is accepted (no bound).
 *  - `type` — must satisfy the fail-closed `isNotificationType` enum guard.
 *  - `relatedEntityType` / `relatedEntityId` — both-or-neither co-presence;
 *    when present, the type is a non-empty string of at most 100 characters
 *    (`related_entity_type` is `varchar(100)`) and the id is a positive safe
 *    integer.
 *  - recipient ids — positive safe integers (ID-channel guard: never a
 *    `as number` narrowing); a batch must be non-empty and carry NO duplicate
 *    recipient ids (a duplicated cohort member would otherwise receive
 *    byte-identical sibling rows — a caller bug, rejected pre-DB).
 *  - `idempotencyKey` — optional; when supplied, non-empty after trimming and
 *    at most 128 characters.
 */
import { isNotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { ValidationError } from "@/backend/lib/errors";
import type { NotificationEmitBatchInput, NotificationEmitInput } from "@/backend/types";

/** `notifications.title` column bound (varchar(255)). */
const TITLE_MAX_LENGTH = 255;

/** `notifications.related_entity_type` column bound (varchar(100)). */
const RELATED_ENTITY_TYPE_MAX_LENGTH = 100;

/** Emitter-owned dedupe key bound (contract limit). */
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/**
 * ID-channel guard: a positive safe integer.
 *
 * Shared by every numeric identifier that crosses the emit surface (recipient
 * ids, related entity ids) and by the inbox surface's notification-id guard.
 * Never narrows through `as number` — non-numbers, non-integers, unsafe
 * magnitudes, and non-positive values all fail closed.
 */
export function isPositiveSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Throws the localized generic validation error. */
function fail(validationMessage: string): never {
  throw new ValidationError(validationMessage);
}

/**
 * Validates the copy fields shared by the single-recipient and batch emit
 * contracts (title, body, type, entity ref pairing, idempotency key).
 */
function validateSharedCopy(
  input: Pick<
    NotificationEmitInput,
    "type" | "title" | "body" | "relatedEntityType" | "relatedEntityId" | "idempotencyKey"
  >,
  validationMessage: string
): void {
  if (typeof input.title !== "string" || input.title.trim().length === 0 || input.title.length > TITLE_MAX_LENGTH) {
    fail(validationMessage);
  }
  if (input.body !== null && typeof input.body !== "string") {
    fail(validationMessage);
  }
  if (!isNotificationType(input.type)) {
    fail(validationMessage);
  }
  validateEntityRef(input.relatedEntityType, input.relatedEntityId, validationMessage);
  validateIdempotencyKey(input.idempotencyKey, validationMessage);
}

/**
 * Entity-ref co-presence: the polymorphic pointer is either fully absent
 * (both null) or fully present (non-empty bounded type string + positive
 * safe-int id). Half pairs are rejected.
 */
function validateEntityRef(
  relatedEntityType: string | null,
  relatedEntityId: number | null,
  validationMessage: string
): void {
  if ((relatedEntityType === null) !== (relatedEntityId === null)) {
    fail(validationMessage);
  }
  if (
    relatedEntityType !== null &&
    (relatedEntityType.trim().length === 0 || relatedEntityType.length > RELATED_ENTITY_TYPE_MAX_LENGTH)
  ) {
    fail(validationMessage);
  }
  if (relatedEntityId !== null && !isPositiveSafeInt(relatedEntityId)) {
    fail(validationMessage);
  }
}

/** Optional idempotency key: absent, or a non-empty string of at most 128 chars. */
function validateIdempotencyKey(idempotencyKey: string | undefined, validationMessage: string): void {
  if (
    idempotencyKey !== undefined &&
    (idempotencyKey.trim().length === 0 || idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH)
  ) {
    fail(validationMessage);
  }
}

/**
 * Validates the single-recipient emit contract: shared copy rules plus the
 * positive-safe-int recipient guard. Throws `ValidationError` on the FIRST
 * violated rule — before any DB or cache access.
 */
export function validateEmitInput(input: NotificationEmitInput, validationMessage: string): void {
  validateSharedCopy(input, validationMessage);
  if (!isPositiveSafeInt(input.userId)) {
    fail(validationMessage);
  }
}

/**
 * Validates the batch emit contract: shared copy rules plus the recipient-list
 * guards — non-empty, every member a positive safe integer, and no duplicate
 * recipient ids. Throws `ValidationError` on the FIRST violated rule — before
 * any DB or cache access.
 */
export function validateEmitBatchInput(input: NotificationEmitBatchInput, validationMessage: string): void {
  validateSharedCopy(input, validationMessage);
  if (input.userIds.length === 0) {
    fail(validationMessage);
  }
  const seenRecipientIds = new Set<number>();
  for (const userId of input.userIds) {
    if (!isPositiveSafeInt(userId) || seenRecipientIds.has(userId)) {
      fail(validationMessage);
    }
    seenRecipientIds.add(userId);
  }
}
