/**
 * Error-masking item builder & boundary finalizer — builds the localized
 * masked internal-error item ({@link maskInternalError}) and classifies each
 * `errors[]` element at the serialization boundary
 * ({@link finalizeGraphqlErrors}):
 * DomainError ⇒ pass-through (localized message + code preserved verbatim,
 * taxonomy-family normalization delegated to downstream status layers,
 * `ctx.requestId` attached, `fields` mapped only when present); everything
 * else ⇒ masked item plus exactly one correlated `logger.error`.
 *
 * Classification rules:
 *  - ONE-HOP domain resolution locally (`originalError` / `cause` — a single
 *    unwrap step, never a recursive walk). Deeper traversal exists only by
 *    REUSING the cycle-guarded walker shipped in `backend/lib/errors.ts`
 *    ({@link translateDbError}). This module deliberately introduces
 *    NO second cause-walker.
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

import { env } from "node:process";
import { DomainError, translateDbError, ValidationError } from "@/backend/lib/errors";
import {
  boundaryProbes,
  capRenderedText,
  extractLocations,
  extractResponsePath,
  firstStructuralHop,
  type GraphQLLocationShape,
  type GraphQLResponsePath,
  isRecordValue,
  OPAQUE_RENDER_BUDGET,
  readNonEmptyString,
  readProtocolPresetCode,
  readRawErrorHop,
  readWireExtensions,
  readWireProperty,
} from "@/backend/lib/errors/error-masking/error-masking-readers";
import { redactLogContext } from "@/backend/lib/errors/error-masking/error-masking-redaction";
import { logger } from "@/backend/lib/logger";
import type { ApiFieldErrorType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Larger character budget for DEV-only stack snapshots (first frames only). */
const DEV_STACK_BUDGET = 1536;

// ─── Public types ────────────────────────────────────────────────────────────

/** Options accepted by {@link maskInternalError}. */
export interface MaskedInternalErrorOptions {
  /** Request locale; resolves exclusively through server translations. */
  readonly locale: string;
  /**
   * Correlation id copied verbatim into `extensions.requestId` when defined.
   * Treated as opaque — never trimmed, mutated, or reflected.
   */
  readonly requestId?: string;
  /**
   * Response path of the failing error, copied verbatim onto the masked item
   * so consumers keep positional fidelity.
   */
  readonly path?: GraphQLResponsePath;
  /** Document locations of the failing error, copied when provided. */
  readonly locations?: readonly GraphQLLocationShape[];
  /**
   * Original throwable observed by the boundary. Under non-production
   * configuration ONLY, a compact whitelisted diagnostic snapshot
   * (`name` / capped `message` / capped leading `stack`) rides inside
   * `extensions.debug`; PRODUCTION masked bodies carry strictly
   * message/code/requestId/path(/locations) — zero stack frames, SQL text,
   * parameter values, env names/values, file paths, or hash-shaped material.
   */
  readonly diagnosticSubject?: unknown;
  /**
   * BOUNDARY-mode switch: when `false`, the dev-only `extensions.debug`
   * snapshot is suppressed in EVERY environment — rebuilt `errors[]` never
   * echo throwable material to the wire; the correlated redacted
   * `logger.error` stays the single diagnostic surface. Omitted/`true` keeps
   * the default non-production behavior.
   */
  readonly includeDiagnostics?: boolean;
}

/** Whitelisted DEV-only diagnostic snapshot embedded under `extensions.debug`. */
type DomainDiagnosticSnapshot = {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
};

/** Client-facing extensions payload of a masked internal error. */
type MaskedInternalGraphQLErrorExtensions = {
  readonly code: "INTERNAL_SERVER_ERROR";
  readonly requestId?: string;
  readonly debug?: DomainDiagnosticSnapshot;
};

/**
 * Client-facing masked internal-error item — fully serialized-safe,
 * usable directly as an element of `errors[]` or wrapped by the REST
 * envelope layer.
 */
type MaskedInternalGraphQLError = {
  /** Fully localized generic message (`errorsTranslations.internalServerError`). */
  readonly message: string;
  /** Immutable extensions payload built by explicit property mapping. */
  readonly extensions: MaskedInternalGraphQLErrorExtensions;
  /** Preserved response path (present only when input provided it). */
  readonly path?: GraphQLResponsePath;
  /** Preserved document locations (present only when input provided them). */
  readonly locations?: readonly GraphQLLocationShape[];
};

/** Context handed to the finalizer by the request pipeline. */
export interface ErrorFinalizationContext {
  /** Request locale used for every localization decision. */
  readonly locale: string;
  /** Correlation id attached to EVERY finalized error's extensions. */
  readonly requestId?: string;
  /** Operation name from the request — correlation metadata for the log line. */
  readonly operationName?: string;
}

/**
 * Structural view of a GraphQL execution result accepted by
 * {@link finalizeGraphqlErrors}. Additional result members (`data`,
 * `extensions`, batch entries, …) are preserved BY REFERENCE through a
 * shallow result copy — only `errors` is ever rebuilt.
 */
export interface GraphqlExecutionResultLike {
  readonly errors?: readonly unknown[];
}

/** Classified formatting outcome produced for a single error element. */
type FormattedBoundaryError = {
  readonly message: string;
  readonly path?: GraphQLResponsePath;
  readonly locations?: readonly GraphQLLocationShape[];
  readonly extensions: Record<string, unknown>;
};

// ─── Internal-error masking ──────────────────────────────────────────────────

function isProductionRuntime(): boolean {
  return env.NODE_ENV === "production";
}

/**
 * Whitelisted compact diagnostic snapshot for non-production configurations.
 * Only `name` / capped `message` / capped leading `stack` are captured —
 * arbitrary own properties of thrown values are NEVER echoed (BOPLA posture).
 */
function snapshotDiagnostic(subject: unknown): DomainDiagnosticSnapshot | undefined {
  if (subject instanceof Error) {
    const cappedStack = subject.stack === undefined ? undefined : capRenderedText(subject.stack, DEV_STACK_BUDGET);
    return {
      name: subject.name,
      message: capRenderedText(subject.message, OPAQUE_RENDER_BUDGET),
      ...(cappedStack === undefined ? {} : { stack: cappedStack }),
    };
  }
  if (subject === null || subject === undefined) {
    return { name: String(subject), message: "" };
  }
  if (typeof subject === "object") {
    return {
      name: "object",
      message: capRenderedText(`keys=${JSON.stringify(Object.keys(subject))}`, OPAQUE_RENDER_BUDGET),
    };
  }
  if (typeof subject === "string") {
    return { name: "string", message: capRenderedText(subject, OPAQUE_RENDER_BUDGET) };
  }
  if (typeof subject === "number" || typeof subject === "boolean" || typeof subject === "bigint") {
    return { name: typeof subject, message: capRenderedText(subject.toString(), OPAQUE_RENDER_BUDGET) };
  }
  if (typeof subject === "symbol") {
    return { name: "symbol", message: capRenderedText(subject.description ?? "symbol", OPAQUE_RENDER_BUDGET) };
  }
  if (typeof subject === "function") {
    return {
      name: "function",
      message: capRenderedText(readNonEmptyString(subject.name) ?? "anonymous", OPAQUE_RENDER_BUDGET),
    };
  }
  return { name: "object", message: "keys=[]" };
}

/**
 * Builds the localized masked internal-error item.
 *
 * Deterministic given (locale, requestId, path, locations, environment):
 *  - `message` resolves through server translations ONLY — the generic
 *    `errorsTranslations.internalServerError` string (zero literals);
 *  - `extensions.code` is exactly `INTERNAL_SERVER_ERROR`;
 *  - `requestId` attaches verbatim when defined;
 *  - `path`/`locations` pass through verbatim;
 *  - `extensions.debug` appears ONLY under non-production configuration AND
 *    when `includeDiagnostics !== false`, containing solely the whitelisted
 *    diagnostic snapshot (see {@link snapshotDiagnostic}); PROD bodies stay
 *    lean for the leak scan.
 *
 * `includeDiagnostics: false` is the BOUNDARY-mode switch:
 * rebuilt `errors[]` NEVER echo throwable material to any environment — the
 * correlated redacted `logger.error` line is the one diagnostic surface.
 */
export function maskInternalError(options: MaskedInternalErrorOptions): MaskedInternalGraphQLError {
  const localizedMessage = getServerTranslations(options.locale).errorsTranslations.internalServerError;
  const diagnostics =
    !isProductionRuntime() && options.includeDiagnostics !== false
      ? snapshotDiagnostic(options.diagnosticSubject)
      : undefined;

  return {
    message: localizedMessage,
    extensions: {
      code: "INTERNAL_SERVER_ERROR",
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      ...(diagnostics === undefined ? {} : { debug: diagnostics }),
    },
    ...(options.path === undefined ? {} : { path: options.path }),
    ...(options.locations === undefined ? {} : { locations: options.locations }),
  };
}

// ─── Boundary classification helpers ────────────────────────────────────────

/** Guard: value is an instance of the shipped DomainError hierarchy. */
export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

/**
 * Presence-preserving `fields` mapping: ONLY ValidationErrors contribute
 * payloads, and the producer-whitelisted array reference is mirrored
 * immutably — `undefined` stays ABSENT, a deliberate EMPTY array survives
 * AS-IS, entries are never null and never re-echoed (they were explicitly
 * property-mapped at construction time).
 */
function extractFieldsPayload(error: DomainError): readonly ApiFieldErrorType[] | undefined {
  if (!(error instanceof ValidationError)) {
    return undefined;
  }
  return error.fields;
}

/**
 * Rebuilds extensions by explicit property assembly: producer extras survive
 * (server-authored at construction time — clients cannot inject extensions),
 * `code` passes through verbatim (legacy `RATE_LIMIT_EXCEEDED` and custom
 * domain codes remain legal transport values), and the two boundary-owned
 * keys attach conditionally.
 */
function buildDomainPassThroughExtensions(source: DomainError, requestId: string | undefined): Record<string, unknown> {
  const sourceExtensions: Record<string, unknown> = isRecordValue(source.extensions) ? source.extensions : {};
  const code = readNonEmptyString(source.code) ?? readNonEmptyString(sourceExtensions.code);
  const fieldsPayload = extractFieldsPayload(source);

  return {
    ...sourceExtensions,
    code: code ?? "INTERNAL_SERVER_ERROR",
    ...(requestId === undefined ? {} : { requestId }),
    ...(fieldsPayload === undefined ? {} : { fields: fieldsPayload }),
  };
}

/** The single boundary log call emitted for classified business rejections. */
function observeDomainRejection(error: DomainError, ctx: ErrorFinalizationContext): void {
  logger.logDomainError(`Domain rejection observed at boundary (${error.name})`, {
    code: error.code,
    ...(ctx.operationName === undefined ? {} : { operationName: ctx.operationName }),
    ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
  });
}

/** Primitive-kind tag improving `throw "x"` / `throw 42` log forensics. */
function describeThrownKind(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

/**
 * Redacted correlated context for the masked-path `logger.error` call. Built
 * by explicit key mapping (NO spread of the throwable — no client input is
 * echoed); the
 * error itself contributes only whitelisted scalars, and the whole bag goes
 * through {@link redactLogContext} so bearer-shaped strings cannot ride along.
 */
function buildUnexpectedErrorLogContext(candidate: unknown, ctx: ErrorFinalizationContext): Record<string, unknown> {
  const errorName = candidate instanceof Error ? candidate.name : describeThrownKind(candidate);
  const errorMessage =
    candidate instanceof Error
      ? capRenderedText(candidate.message, OPAQUE_RENDER_BUDGET)
      : describeThrownKind(candidate);

  return redactLogContext({
    requestId: ctx.requestId,
    operationName: ctx.operationName,
    errorName,
    errorMessage,
    errorKind: describeThrownKind(candidate),
  });
}

/**
 * Formats one classified DomainError as a pass-through boundary item:
 * localized message preserved, `code` preserved verbatim (alias-aware
 * consumers normalize separately), transport `path`/`locations` taken from
 * the carrier when present, `requestId` attached into extensions.
 */
function formatDomainPassThrough(
  source: DomainError,
  carrier: unknown,
  ctx: ErrorFinalizationContext
): FormattedBoundaryError {
  return {
    message: source.message,
    path: extractResponsePath(carrier) ?? extractResponsePath(source),
    locations: extractLocations(carrier) ?? extractLocations(source),
    extensions: buildDomainPassThroughExtensions(source, ctx.requestId),
  };
}

/**
 * Builds the localized masked boundary item for anything non-domain.
 *
 * `path`/`locations` always read from the WIRE carrier (the item the client
 * would have received). Diagnostics are SUPPRESSED at this boundary — rebuilt
 * items carry zero throwable material in any environment
 * (`includeDiagnostics: false`); the redacted correlated log line is the one
 * diagnostic surface and still receives the real throwable's whitelisted
 * scalars when the envelope hop holds it.
 */
function formatMaskedItem(
  carrier: unknown,
  ctx: ErrorFinalizationContext,
  diagnosticSubject?: unknown
): FormattedBoundaryError {
  return maskInternalError({
    locale: ctx.locale,
    ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
    path: extractResponsePath(carrier),
    locations: extractLocations(carrier),
    diagnosticSubject: diagnosticSubject ?? carrier,
    includeDiagnostics: false,
  });
}

/** Logs-and-formats one element of `result.errors`. */
function classifyBoundaryErrorElement(candidate: unknown, ctx: ErrorFinalizationContext): FormattedBoundaryError {
  // Hop A — DomainError pass-through. Probes are bounded: the wire
  // item, its envelope hop, and one structural unwrap of each. Carrier stays
  // the WIRE item so `path`/`locations` come from the transport metadata.
  for (const probe of boundaryProbes(candidate)) {
    if (isDomainError(probe)) {
      observeDomainRejection(probe, ctx);
      return formatDomainPassThrough(probe, candidate, ctx);
    }
  }

  // Hop B — delegate deep cause-chain inspection to the EXISTING
  // cycle-guarded traversal (23505 / SQLite UNIQUE → localized CONFLICT).
  // Candidates prefer REAL throwables (envelope hop first) because translated
  // chains live on Error instances, not on the formatted wire object.
  // Identity return (`===`) proves "not translated" cheaply and purely.
  const conflictMessage = getServerTranslations(ctx.locale).errorsTranslations.conflict;
  for (const dbCandidate of boundaryProbes(candidate)) {
    const translatedCandidate = translateDbError(dbCandidate, conflictMessage);
    if (translatedCandidate !== dbCandidate && isDomainError(translatedCandidate)) {
      observeDomainRejection(translatedCandidate, ctx);
      return formatDomainPassThrough(translatedCandidate, candidate, ctx);
    }
  }

  // Hop B2 — Apollo preset protocol failures (parse / validation / APQ / …):
  // messages are protocol-authored and can never embed server internals, so
  // they pass through AS-IS with only the correlation id attached. Resolver-
  // thrown values never reach this branch (their codes are NOT preset strings).
  if (readProtocolPresetCode(candidate) !== null) {
    // enrichError may have appended extensions.stacktrace in DEV — boundary-
    // rebuilt items NEVER echo throwable material; strip that one key while
    // preserving every protocol-authored extension verbatim.
    const { stacktrace: _strippedStacktrace, ...protocolExtensions } = readWireExtensions(candidate) ?? {};
    return {
      message: readNonEmptyString(readWireProperty(candidate, "message")) ?? "GraphQL request failed",
      path: extractResponsePath(candidate),
      locations: extractLocations(candidate),
      extensions: {
        ...protocolExtensions,
        ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
      },
    };
  }

  // Hop C — everything else is masked behind the generic localized failure,
  // with exactly one redacted correlated `logger.error` per element. The real
  // throwable (envelope hop / its structural unwrap) feeds ONLY diagnostics —
  // `path`/`locations` always come from the wire carrier.
  const rawHop = readRawErrorHop(candidate);
  const deepFromRaw = rawHop !== undefined ? firstStructuralHop(rawHop) : undefined;
  const diagnosticSubject = [rawHop, deepFromRaw].find(probe => probe instanceof Error || isRecordValue(probe));
  logger.error(
    "Unhandled non-domain error masked at GraphQL boundary",
    buildUnexpectedErrorLogContext(diagnosticSubject ?? candidate, ctx)
  );
  return formatMaskedItem(candidate, ctx, diagnosticSubject);
}

/**
 * Finalizes a GraphQL execution result at the serialization boundary.
 *
 * Per-error behavior:
 *  - DomainError elements (directly or via ONE `originalError`/`cause` hop)
 *    pass through with localized `message`, `code` (legacy aliases INCLUDED,
 *    verbatim), preserved `path`/`locations`, `ctx.requestId` attached, and
 *    ValidationError `fields` mapped only when the property is present;
 *    each such rejection is OBSERVED via `logger.logDomainError` — which
 *    honors logger conventions (debug under TEST_SERVER=1, warn otherwise);
 *  - non-domain DB unique-violations still surface as localized CONFLICT
 *    DomainErrors through the reused `translateDbError` traversal;
 *  - everything ELSE is replaced by the {@link maskInternalError} item and
 *    logged exactly once via `logger.error` with a redacted context bag
 *    containing `requestId`, `operationName`, and whitelisted error scalars.
 *
 * Results without errors return IDENTICAL references (zero-op purity anchor);
 * otherwise only the `errors` array is rebuilt — every other result member
 * (`data`, `extensions`, …) is preserved by reference.
 */
export function finalizeGraphqlErrors(
  result: GraphqlExecutionResultLike,
  ctx: ErrorFinalizationContext
): GraphqlExecutionResultLike {
  if (!isRecordValue(result)) {
    return result;
  }
  const existingErrors = result.errors;
  if (!Array.isArray(existingErrors) || existingErrors.length === 0) {
    return result;
  }
  return {
    ...result,
    errors: existingErrors.map(element => classifyBoundaryErrorElement(element, ctx)),
  };
}
