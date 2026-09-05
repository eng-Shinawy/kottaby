/**
 * Error masking & log-redaction — GraphQL boundary finalizer module.
 *
 * Pure boundary utilities: deterministic given their inputs and the
 * process environment, side-effect-free EXCEPT the single boundary log call
 * emitted per classified error by {@link finalizeGraphqlErrors}. No DB
 * reads/writes, no cache access, no network calls, and no direct output
 * streams — logging goes exclusively through `@/backend/lib/logger`.
 *
 * Responsibilities:
 *  - {@link isDomainError}        — instance guard over the DomainError hierarchy.
 *  - {@link maskInternalError}    — builds the localized INTERNAL_SERVER_ERROR
 *    masking item (`MaskedInternalGraphQLError`), usable directly inside
 *    `errors[]`, preserving `path`/`locations` and carrying dev-only
 *    diagnostics outside PROD configuration.
 *  - {@link redactLogContext}     — bounded, pattern-based credential redaction
 *    for structured log-context bags.
 *  - {@link finalizeGraphqlErrors} — per-error classification at the boundary:
 *    DomainError ⇒ pass-through (localized message + code preserved verbatim,
 *    taxonomy-family normalization delegated to downstream status layers,
 *    `ctx.requestId` attached, `fields` mapped only when present); everything
 *    else ⇒ masked item plus exactly one correlated `logger.error`.
 *
 * Classification rules:
 *  - ONE-HOP domain resolution locally (`originalError` / `cause` — a single
 *    unwrap step, never a recursive walk). Deeper traversal exists only by
 *    REUSING the cycle-guarded walker shipped in `backend/lib/errors.ts`
 *    ({@link translateDbError}). This module deliberately introduces
 *    NO second cause-walker.
 *  - ENVELOPE HOP: Apollo Server ≥5 normalizes execution errors
 *    through `GraphQLError.toJSON()`, so items reaching `willSendResponse` are
 *    PLAIN objects — no `Error` identity, no `originalError`. To keep the
 *    single response-time classifier possible, the route's `formatError` hook
 *    attaches the RAW thrown value to each formatted item under the exported
 *    {@link attachRawErrorHop} key ({@link RAW_ERROR_HOP} — NON-enumerable,
 *    therefore invisible to JSON serialization AND wire validation). Probes
 *    inspect the wire item, that envelope hop, and one structural unwrap of
 *    each (bounded — never a chain walk).
 *  - PROTOCOL-PRESET PASS-THROUGH: failures generated BEFORE
 *    resolution (parse / GraphQL-validation / persisted-query misses) carry
 *    Apollo's preset `extensions.code` values and protocol-authored messages
 *    that can never embed server internals. Masking them would collapse
 *    legitimate client mistakes into fake infrastructure outages, so those
 *    items pass through AS-IS (only `extensions.requestId` attached).
 *    Resolver-thrown errors NEVER match this rule — their codes are masked or
 *    passed through by Hops A/B above.
 *  - Legacy alias handling: producers emitting `RATE_LIMIT_EXCEEDED`
 *    cross UNCHANGED — message and code pass through verbatim. Any
 *    STATUS/category derivation composes the taxonomy module elsewhere
 *    (`normalizeErrorCode("RATE_LIMIT_EXCEEDED") → "RATE_LIMITED"` → 429 row).
 *  - Localization ONLY via `getServerTranslations(locale)` from
 *    `@/shared/locale/server-graphql` (repo ground-truth accessor shape — see
 *    `app/api/graphql/route.ts` usage), resolving
 *    `.errorsTranslations.internalServerError` / `.conflict`. Never response
 *    string literals in this module.
 *
 * @see docs/graphql/domain-error-extensions-code.md
 */

export * from "./error-masking-item";
export * from "./error-masking-readers";
export * from "./error-masking-redaction";
