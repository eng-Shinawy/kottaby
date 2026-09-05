/**
 * Canonical handshake-code format — the single source of truth for the
 * student handshake-code shape consumed by every layer (backend validation
 * and lookup, frontend format copy, and test locks).
 *
 * A handshake code is an opaque capability reference: the `KSB-` prefix
 * followed by exactly 8 uppercase hexadecimal characters `[0-9A-F]`
 * (e.g. `KSB-ABCD1234`). Codes are generated at student registration from
 * UUID-derived entropy and stored uniquely in `students.handshake_code`;
 * they are never rewritten after creation.
 *
 * This module is dependency-free by design: it imports NOTHING, so any layer
 * can reason about code shape without pulling cross-layer dependencies.
 */

/**
 * The canonical handshake-code prefix for validation and normalization
 * consumers — the constant to compose with when constructing, checking, or
 * teaching the code shape. The registration generator independently emits
 * the same `KSB-` prefix from its own embedded literal; the parity between
 * the two (every generated code satisfying `HANDSHAKE_CODE_PATTERN`) is
 * cross-referenced by the test locks rather than enforced by a shared import.
 */
export const HANDSHAKE_CODE_PREFIX = "KSB-";

/**
 * Canonical handshake-code shape: `KSB-` + exactly 8 uppercase hex chars.
 *
 * Anchored (`^…$`) with a single bounded fixed quantifier `{8}` and no
 * alternation or nested quantifiers, so matching is linear-time on any
 * input — no catastrophic-backtracking (ReDoS) surface.
 */
export const HANDSHAKE_CODE_PATTERN = /^KSB-[0-9A-F]{8}$/;

/**
 * Type guard: `true` iff `value` is a string matching the canonical
 * handshake-code shape EXACTLY — case-sensitive, with no surrounding
 * whitespace. Near-misses (wrong prefix, wrong length, lowercase hex,
 * padded input) return `false`.
 *
 * When accepting user input, fold case and whitespace first with
 * {@link normalizeHandshakeCode}, then validate the normalized value.
 */
export function isHandshakeCode(value: unknown): value is string {
  return typeof value === "string" && HANDSHAKE_CODE_PATTERN.test(value);
}

/**
 * Canonical input acceptance: trim surrounding whitespace, then fold case to
 * the generation casing (uppercase). Validation ALWAYS runs against the
 * normalized value — never against the raw input.
 */
export function normalizeHandshakeCode(value: string): string {
  return value.trim().toUpperCase();
}
