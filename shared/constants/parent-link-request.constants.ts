/**
 * Parent-child link request expiry sizing constants.
 *
 * A parent→child link request lives for a fixed window: the requesting
 * service stamps `expiresAt` as `createdAt + PARENT_LINK_REQUEST_MS` when the
 * request row is created, and every later interaction evaluates liveness with
 * a strict `expiresAt > now` comparison (a request landing exactly ON
 * `expiresAt` is already expired). Single source of truth for the window
 * length — backend services, expiry-related copy, and test fixtures all
 * derive from these values instead of repeating the arithmetic.
 *
 * Shared-layer isolation: this module imports nothing from @/backend, @/frontend,
 * or @/app. It is safe to import from any layer.
 */

/** The link-request opportunity window in whole days. */
export const PARENT_LINK_REQUEST_TTL_DAYS = 7;

/** The link-request opportunity window in milliseconds (`TTL_DAYS × 86_400_000`). */
export const PARENT_LINK_REQUEST_MS = PARENT_LINK_REQUEST_TTL_DAYS * 86_400_000;
