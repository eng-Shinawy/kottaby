/**
 * Error-masking redaction engine — bounded, pattern-based credential
 * redaction for structured log-context bags.
 *
 * Pure transformation: no logging, no localization, no environment reads.
 * Traversal bounds and credential vocabulary live here so the engine stays
 * decoupled from every provider module (recognition is string-pattern based).
 */

import {
  capRenderedText,
  isRecordValue,
  OPAQUE_RENDER_BUDGET,
  readIndex,
  readProperty,
} from "@/backend/lib/errors/error-masking/error-masking-readers";

/**
 * Marker written over every credential-shaped value during redaction.
 * Exported so log reviewers and paired tests share one literal.
 */
export const REDACTED_VALUE_MARKER = "[REDACTED]";

/** Replaces context sub-trees exceeding {@link REDACTION_MAX_DEPTH}. */
export const REDACTION_DEPTH_LIMIT_MARKER = "[DEPTH_LIMITED]";

/** Appended to arrays truncated at {@link REDACTION_MAX_ITEMS}. */
export const REDACTION_ITEMS_LIMIT_MARKER = "[ITEMS_LIMITED]";

/** Used when a property GETTER throws while the redactor walks a hostile node. */
const INACCESSIBLE_VALUE_MARKER = "[INACCESSIBLE]";

/**
 * Hard traversal bounds for {@link redactLogContext}: input is never
 * walked unbounded — deeper objects collapse to the depth marker and longer
 * arrays are truncated with an explicit marker entry.
 */
export const REDACTION_MAX_DEPTH = 6;
export const REDACTION_MAX_ITEMS = 64;

/**
 * Credential-shaped key words matched as WHOLE word segments after splitting
 * camelCase / snake_case / kebab-case / dotted key names into lowercase parts.
 * A key is sensitive when ANY segment equals one of these words — covering the
 * required provider shapes WITHOUT importing provider modules:
 *
 *  - auth tokens:            `accessToken`, `refresh_token`, `x-auth-token`
 *  - passwords:              `password`, `passwordHash`, `client_pwd`
 *  - secrets:                `secretAnswer`, `client_secret`, `waSigningSecret`
 *  - encryption/API keys:    `encryptionKey`, `apiKey`, `whatsappEncryptKey`
 *  - authorization/bearer:   `authorizationHeader`, `proxyBearerToken`
 *  - meeting-provider tokens:`zoomAccessToken`, `zoomRefreshToken`,
 *                            `googleMeetOAuthToken`, `meetSdkSignature`… every
 *                            `*token*`/`*secret*` shape across providers
 *  - WhatsApp credentials:   `whatsappAccessToken`, `whatsappVerifyToken`,
 *                            `whatsappAppSecret`, `waEncryptionKey`
 *
 * Whole-word matching deliberately avoids over-redaction traps: unrelated
 * keys like `authorId`, `monkeyPatchedBytes`, or `tokenizeCount` survive
 * because their segments never equal a listed word.
 */
const SENSITIVE_KEY_WORDS: ReadonlySet<string> = new Set([
  "token",
  "password",
  "passwd",
  "pwd",
  "secret",
  "key",
  "authorization",
  "bearer",
  "auth",
  "credential",
]);

/** Values shaped like Authorization headers are redacted regardless of key. */
const BEARER_VALUE_PATTERN = /^bearer\s+\S+/iu;

// ─── Credential-shape detection (pure string-pattern machinery) ─────────────

/** Splits a key name into lowercase word segments across common schemes. */
function keyWordSegments(keyName: string): readonly string[] {
  const camelSpaced = keyName.replace(/([a-z0-9])([A-Z])/gu, "$1 $2");
  const acronymSpaced = camelSpaced.replace(/([A-Z])([A-Z][a-z])/gu, "$1 $2");
  return acronymSpaced
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(segment => segment.length > 0);
}

function isSensitiveKeyName(keyName: string): boolean {
  if (SENSITIVE_KEY_WORDS.has(keyName.toLowerCase())) {
    return true;
  }
  return keyWordSegments(keyName).some(segment => SENSITIVE_KEY_WORDS.has(segment));
}

// ─── Bounded redaction engine ────────────────────────────────────────────────────

/** Rebuilds an array under the item cap, recursing per element defensively. */
function redactArrayItems(items: readonly unknown[], depth: number): readonly unknown[] {
  const boundedItems: unknown[] = [];
  const keptCount = Math.min(items.length, REDACTION_MAX_ITEMS);
  for (let index = 0; index < keptCount; index += 1) {
    const outcome = readIndex(items, index);
    boundedItems.push(outcome.ok ? redactNode(outcome.value, depth + 1) : INACCESSIBLE_VALUE_MARKER);
  }
  if (items.length > REDACTION_MAX_ITEMS) {
    boundedItems.push(REDACTION_ITEMS_LIMIT_MARKER);
  }
  return boundedItems;
}

/**
 * Rebuilds one record node: own enumerable keys only, `Object.defineProperty`
 * writes (so hostile `__proto__`/`constructor` OWN keys cannot trigger setters
 * or pollute prototypes), and sensitive subtrees replaced ENTIRELY BEFORE any
 * child value is read (their getters are never invoked).
 */
function redactRecordEntries(source: Record<string, unknown>, depth: number): Record<string, unknown> {
  const rebuiltNode: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    let renderedChild: unknown;
    if (isSensitiveKeyName(key)) {
      renderedChild = REDACTED_VALUE_MARKER;
    } else {
      const outcome = readProperty(source, key);
      renderedChild = outcome.ok ? redactNode(outcome.value, depth + 1) : INACCESSIBLE_VALUE_MARKER;
    }
    Object.defineProperty(rebuiltNode, key, {
      value: renderedChild,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return rebuiltNode;
}

/**
 * Walks a value with hard bounds: traversal depth is capped at
 * {@link REDACTION_MAX_DEPTH} and arrays at {@link REDACTION_MAX_ITEMS} —
 * input is NEVER walked unbounded.
 */
function redactNode(value: unknown, depth: number): unknown {
  if (depth > REDACTION_MAX_DEPTH) {
    return REDACTION_DEPTH_LIMIT_MARKER;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return BEARER_VALUE_PATTERN.test(value) ? REDACTED_VALUE_MARKER : value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "symbol" || typeof value === "function") {
    return capRenderedText(String(value), OPAQUE_RENDER_BUDGET);
  }
  if (Array.isArray(value)) {
    return redactArrayItems(value, depth);
  }
  if (isRecordValue(value)) {
    return redactRecordEntries(value, depth);
  }
  return value;
}

/**
 * Redacts credential-shaped material from a structured log-context bag.
 *
 * Pure, bounded transformation:
 *  - key names are reduced to word segments and matched against the
 *    credential vocabulary ({@link SENSITIVE_KEY_WORDS}); sensitive subtrees
 *    are replaced ENTIRELY by `{@link REDACTED_VALUE_MARKER}` BEFORE their
 *    values are ever read;
 *  - string VALUES shaped like `Authorization: Bearer …` headers are redacted
 *    regardless of key name;
 *  - traversal depth ≤ {@link REDACTION_MAX_DEPTH}, array length ≤
 *    {@link REDACTION_MAX_ITEMS}, both surfaced with explicit markers;
 *  - prototype chains are immune (own enumerable keys only; hostile
 *    `__proto__` / `constructor` own keys are inert copies).
 *
 * No provider module is imported — recognition is string-pattern based.
 */
export function redactLogContext(contextBag: Record<string, unknown>): Record<string, unknown> {
  const redactedRoot = redactNode(contextBag, 0);
  return isRecordValue(redactedRoot) ? redactedRoot : {};
}
