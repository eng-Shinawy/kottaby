/**
 * Frontend GraphQL error-mapping contract — pure code → behavior table.
 *
 * This module is a PURE mapping function over GraphQL `extensions.code`
 * values (never branch on HTTP status for GraphQL errors):
 *
 *  - No React, no hooks, no DOM reads, no network, no side effects.
 *  - Every user-visible string is a TRANSLATION HANDLE (`keyof ErrorsLabels`)
 *    resolved by consumers via `useAppTranslation(Errors)[action.messageKey]`.
 *    Server `message` text is NEVER propagated for masked or
 *    security-sensitive errors; localized copy comes exclusively from the
 *    `errors.errors` translation namespace.
 *  - The branch table also honors the legacy `RATE_LIMIT_EXCEEDED` alias
 *    (folded onto the `RATE_LIMITED` row) so stale/proxied producers keep
 *    mapping correctly.
 *
 * Integration point: `createErrorLinkHandler` in `frontend/providers/apollo/
 * utils.ts` normalizes each GraphQL error item's code through
 * {@link normalizeGraphQLErrorCode}, extracts `extensions.fields[]` /
 * `extensions.requestId`, calls {@link mapGraphQLErrorByCode}, and publishes
 * returned actions to the registered surface listener. The UNAUTHORIZED row's
 * refresh-once-then-logout behavior stays owned by the EXISTING deduped token
 * -refresh path in utils.ts (`registerAuthRecovery` / `getNewAccessToken`) —
 * this module only DESCRIBES that row so callers route consistently.
 */

import { CHANGE_PASSWORD_PAGE_PATH } from "@/frontend/lib/auth/changePasswordRoute";
import type { ErrorMessageKey } from "@/shared/locale/types/errors";

/**
 * Structural mirror of the boundary's wire shape for ONE
 * `extensions.fields[]` entry (`ApiFieldErrorType` in
 * `backend/types/errors/api-error.types.ts`).
 *
 * Duplicated locally on purpose: `.dependency-cruiser.js` rule
 * `frontend-no-backend-deps` (severity error) forbids ANY backend import from
 * `frontend/**`, even type-only ones (`fieldError.ts` mirrors the entry
 * identically). KEEP THE THREE FIELDS IN SYNC with the canonical contract.
 */
export interface WireFieldError {
  /** RHF-consumable form path, e.g. `"email"`, `"homeWork.currentGrade"`. */
  readonly field: string;
  /** Machine-readable field code, SCREAMING_SNAKE_CASE, e.g. `"EMAIL_INVALID"`. */
  readonly code: string;
  /** Fully localized user-facing message (the only string ever echoed). */
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Legacy producer compatibility

/**
 * Mirror of the server-side taxonomy alias rule
 * (`LEGACY_ERROR_CODE_ALIASES` in `backend/lib/errors/error-code-taxonomy.ts`,
 * documented in `docs/graphql/domain-error-extensions-code.md` §extending the
 * taxonomy). The boundary finalizer already emits canonical codes today; this
 * local mirror keeps the client map correct against stale/proxied producers.
 */
export const LEGACY_ERROR_CODE_ALIASES: Readonly<Record<string, string>> = {
  RATE_LIMIT_EXCEEDED: "RATE_LIMITED",
};

/** Resolves the canonical taxonomy code for any transported code. */
export function normalizeGraphQLErrorCode(rawCode: string): string {
  return LEGACY_ERROR_CODE_ALIASES[rawCode] ?? rawCode;
}

/**
 * `{ENTITY}_NOT_FOUND` family detector (canonical generic `NOT_FOUND` plus
 * entity-scoped derivations such as `USER_NOT_FOUND` per
 * `docs/graphql/domain-error-extensions-code.md`).
 */
export function isNotFoundErrorFamily(rawCode: string): boolean {
  return rawCode === "NOT_FOUND" || rawCode.endsWith("_NOT_FOUND");
}

/**
 * Runtime shape check for one `extensions.fields[]` entry (`{field, code,
 * message}` all strings). Property guards instead of casts, per the oxlint
 * no-unsafe-type-assertion guidance.
 */
export function isWireFieldErrorEntry(value: unknown): value is WireFieldError {
  if (typeof value !== "object" || value === null) return false;
  // Assertion-free property reads: enumerate entries and look keys up by value.
  const entries = Object.entries(value);
  const readProperty = (key: string): unknown => entries.find(([entryKey]) => entryKey === key)?.[1];
  return (
    typeof readProperty("field") === "string" &&
    typeof readProperty("code") === "string" &&
    typeof readProperty("message") === "string"
  );
}

/**
 * Narrowing guard over the wire shape of `extensions.fields[]`
 * ({@link WireFieldError} entries — canonical contract lives in
 * `backend/types/errors/api-error.types.ts`). Returns `undefined` when
 * absent/malformed so partial producers degrade to the toast fallback rather
 * than crashing.
 */
export function extractWireFieldErrors(value: unknown): readonly WireFieldError[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const fieldErrors = value.filter(isWireFieldErrorEntry);
  return fieldErrors.length > 0 ? fieldErrors : undefined;
}

// ---------------------------------------------------------------------------
// Mapping contract

/** Which Apollo operation channel produced the failing response. */
export type GraphQLErrorContextKind = "query" | "mutation";

/**
 * Caller-side facts the pure mapping consults besides the code itself
 * (operation channel, whether a React Hook Form context can receive
 * field-level errors, and the whitelisted `extensions` payloads).
 */
export interface GraphQLErrorMappingContext {
  /** Query context favors section fallbacks; mutations favor toasts. */
  readonly contextKind: GraphQLErrorContextKind;
  /**
   * Whether a form context exists to receive `setError(field, …)` pairs.
   * The ErrorLink dispatcher cannot see React state and therefore always
   * passes `false`; VALIDATION field entries are still carried on the action
   * so form-bound consumers can convert a `kind: "toast"` VALIDATION action
   * into field errors locally (documented in utils.ts).
   */
  readonly hasForm: boolean;
  /** `extensions.fields[]` narrowed via {@link extractWireFieldErrors}. */
  readonly fields?: readonly WireFieldError[];
  /** `extensions.requestId` correlation id when present. */
  readonly requestId?: string;
}

/** Coarse UI behavior bucket selected by the mapping table. */
type GraphQLErrorActionKind =
  /** UNAUTHORIZED family — deduped token-refresh-then-login (owned by utils.ts). */
  | "auth-recovery"
  /** FORBIDDEN in query context — render PermissionDeniedFallback section. */
  | "permission-fallback"
  /** Localized toast (mutation FORBIDDEN, masked INTERNAL_SERVER_ERROR, …). */
  | "toast"
  /** Field-level `setError(field, { message })` pairs into an active form. */
  | "form-fields"
  /** Inline notice — not-found/conflict/duplicate/retryable surfaces. */
  | "notice";

/** Inline-notice subtype for {@link GraphQLErrorAction.noticeKind}. */
type GraphQLErrorNoticeKind =
  | "not-found"
  | "conflict"
  | "duplicate-request"
  | "retry-later"
  | "retryable-service-unavailable";

/** MUI-severity-compatible copy tone consumed by the UI surfaces. */
type GraphQLErrorActionTone = "error" | "warning" | "info";

/**
 * The exact action descriptor the errorLink publishes for one failed GraphQL
 * operation. Deterministic given `(code, context)` — safe to snapshot-test.
 */
export interface GraphQLErrorAction {
  readonly kind: GraphQLErrorActionKind;
  /**
   * Translation HANDLE into the `errors.errors` namespace. Consumers render
   * `useAppTranslation(Errors)[messageKey]` — never the server `message`.
   *
   * The handle is restricted to the leaf-string keys of {@link ErrorsLabels}.
   * Grouped sub-blocks (e.g. the `adminUsers` nesting) carry their own
   * property paths and are surfaced through dedicated consumer surfaces,
   * never through this transport mapper, so they are excluded from the
   * renderable handle union.
   */
  readonly messageKey: ErrorMessageKey;
  readonly tone: GraphQLErrorActionTone;
  /** A manual-retry affordance may be offered (RATE_LIMITED/SERVICE_UNAVAILABLE). */
  readonly retryable: boolean;
  /** Required for {@link GraphQLErrorActionKind.notice}. */
  readonly noticeKind?: GraphQLErrorNoticeKind;
  /** RHF-consumable pairs from `extensions.fields[]` (VALIDATION rows). */
  readonly fieldErrors?: readonly WireFieldError[];
  /** Fallback key ALSO present so form-less contexts can toast (VALIDATION). */
  readonly correlationRequestId?: string;
  /**
   * Masked INTERNAL_SERVER_ERROR guidance flag: surfaces show
   * "include the correlation id when reporting" guidance using
   * {@link GraphQLErrorAction.correlationRequestId}.
   */
  readonly requestIdCorrelationGuidance?: true;
  /**
   * DUPLICATE_REQUEST marks idempotent replay UX (docs/IDEMPOTENCY.md §3):
   * treated as success-equivalent, presented neutrally — NOT as a failure.
   */
  readonly duplicateSuccessEquivalent?: true;
  /**
   * Client redirect target for rows whose resolution is a navigation —
   * `PASSWORD_CHANGE_REQUIRED` carries the forced-reset page. The map stays
   * PURE: it only DESCRIBES the target; executing the navigation belongs to
   * the seam consumer (`dispatchMappedGraphQLErrorActions` in
   * `frontend/providers/apollo/utils/error-surface.ts` honors the payload
   * ONCE per session — window-level navigation guarded against re-firing
   * and against landing on the target itself; the same ownership split as
   * the `auth-recovery` row, whose redirect the deduped refresh path owns).
   * The payload keeps the target single-sourced so no consumer re-spells
   * the path.
   */
  readonly redirectTo?: string;
}

// ---------------------------------------------------------------------------
// The branch table — row resolvers

/** Action shape before the optional correlation id is attached. */
type BaseGraphQLErrorAction = Omit<GraphQLErrorAction, "correlationRequestId">;

/** Copies `context.requestId` onto an action when the wire provided one. */
function withCorrelation(context: GraphQLErrorMappingContext, action: BaseGraphQLErrorAction): GraphQLErrorAction {
  return context.requestId === undefined ? action : { ...action, correlationRequestId: context.requestId };
}

/** Row 1 — auth recovery (behavior owned by the deduped refresh path in utils.ts). */
function mapAuthRow(code: string, context: GraphQLErrorMappingContext): GraphQLErrorAction | null {
  if (code !== "UNAUTHORIZED") return null;
  return withCorrelation(context, {
    kind: "auth-recovery",
    messageKey: "unauthorized",
    tone: "error",
    retryable: false,
  });
}

/**
 * Row 2 — FORBIDDEN: section fallback for queries, localized toast for
 * mutations. The generic `forbidden` copy is reused — no per-domain
 * toast is minted for any single FORBIDDEN producer.
 *
 * Certification-gate posture: the availability service denies
 * `ForbiddenError`/403 when a teacher whose `isApproved` flag is not
 * strictly `true` attempts to toggle Available. The dashboard card
 * pre-empts the denial client-side (the Available CTA stays disabled
 * until certification clears); the server 403 surfaces here only when
 * a stale client or a race evades the pre-empt, so the generic toast
 * is the defense-in-depth backstop — never the primary surface.
 */
function mapPermissionRow(code: string, context: GraphQLErrorMappingContext): GraphQLErrorAction | null {
  if (code !== "FORBIDDEN") return null;
  return context.contextKind === "query"
    ? withCorrelation(context, {
        kind: "permission-fallback",
        messageKey: "forbidden",
        tone: "error",
        retryable: false,
      })
    : withCorrelation(context, {
        kind: "toast",
        messageKey: "forbidden",
        tone: "error",
        retryable: false,
      });
}

/**
 * PASSWORD_CHANGE_REQUIRED row: the forced-reset operation-gate denial
 * (`backend/graphql/passwordChangeGate.ts` — a flagged caller invoked a root
 * field outside the exemption allowlist). Mirrors the FORBIDDEN surface
 * pairing (section fallback for queries, localized toast for mutations) with
 * the row's OWN `errors`-namespace copy — never the generic `forbidden` text
 * — so a mid-session gate denial is never silent. The action also carries
 * `redirectTo` (see {@link GraphQLErrorAction.redirectTo}) describing the
 * established client redirect to the forced-reset page, which the surface
 * seam consumer honors once per session.
 */
function mapPasswordChangeRow(code: string, context: GraphQLErrorMappingContext): GraphQLErrorAction | null {
  if (code !== "PASSWORD_CHANGE_REQUIRED") return null;
  return withCorrelation(context, {
    kind: context.contextKind === "query" ? "permission-fallback" : "toast",
    messageKey: "passwordChangeRequired",
    tone: "error",
    retryable: false,
    redirectTo: CHANGE_PASSWORD_PAGE_PATH,
  });
}

/**
 * Row 3 — VALIDATION / custom field codes: `setError(field, { message })`
 * pairs from `extensions.fields[]` when a form context exists, else the
 * localized toast fallback (pairs still attached for form-bound consumers).
 */
function mapValidationRow(code: string, context: GraphQLErrorMappingContext): GraphQLErrorAction | null {
  if (code !== "VALIDATION") return null;
  const fields = context.fields;
  if (fields !== undefined && fields.length > 0 && context.hasForm) {
    return withCorrelation(context, {
      kind: "form-fields",
      messageKey: "validation",
      tone: "error",
      retryable: false,
      fieldErrors: fields,
    });
  }
  const toastFallback: BaseGraphQLErrorAction = {
    kind: "toast",
    messageKey: "validation",
    tone: "error",
    retryable: false,
  };
  return withCorrelation(context, fields === undefined ? toastFallback : { ...toastFallback, fieldErrors: fields });
}

/**
 * Inline notice rows — not-found family, conflict, the teacher-
 * rating gate + write-once rejections (both domain-conflict denials with
 * their OWN localized copy), duplicate-replay (success-equivalent per
 * docs/IDEMPOTENCY.md §3), rate-limited retry-later, and service-
 * unavailable manual retry. RATE_LIMITED deliberately copies NO
 * thresholds/counters/rate-window metadata onto the action.
 */
function mapInlineNoticeRow(code: string, context: GraphQLErrorMappingContext): GraphQLErrorAction | null {
  if (isNotFoundErrorFamily(code)) {
    return withCorrelation(context, {
      kind: "notice",
      noticeKind: "not-found",
      messageKey: "notFound",
      tone: "warning",
      retryable: false,
    });
  }
  if (code === "CONFLICT") {
    return withCorrelation(context, {
      kind: "notice",
      noticeKind: "conflict",
      messageKey: "conflict",
      tone: "error",
      retryable: false,
    });
  }
  if (code === "EVALUATION_SESSION_NOT_COMPLETED") {
    // Teacher-rating gate rejection — the row's OWN localized denial copy
    // (not the generic conflict copy), non-retryable until the handshake
    // completes.
    return withCorrelation(context, {
      kind: "notice",
      noticeKind: "conflict",
      messageKey: "evaluationSessionNotCompleted",
      tone: "error",
      retryable: false,
    });
  }
  if (code === "EVALUATION_ALREADY_SUBMITTED") {
    // Teacher-rating write-once rejection — the rating EXISTS, so the
    // outcome is what the caller asked for: neutral info tone (never an
    // error treatment); consumers mark the row rated.
    return withCorrelation(context, {
      kind: "notice",
      noticeKind: "conflict",
      messageKey: "evaluationAlreadySubmitted",
      tone: "info",
      retryable: false,
    });
  }
  if (code === "DUPLICATE_REQUEST") {
    return withCorrelation(context, {
      kind: "notice",
      noticeKind: "duplicate-request",
      messageKey: "duplicateRequest",
      tone: "info",
      retryable: false,
      duplicateSuccessEquivalent: true,
    });
  }
  if (code === "RATE_LIMITED") {
    return withCorrelation(context, {
      kind: "notice",
      noticeKind: "retry-later",
      messageKey: "rateLimitExceeded",
      tone: "warning",
      retryable: true,
    });
  }
  if (code === "SERVICE_UNAVAILABLE") {
    return withCorrelation(context, {
      kind: "notice",
      noticeKind: "retryable-service-unavailable",
      messageKey: "serviceUnavailable",
      tone: "warning",
      retryable: true,
    });
  }
  return null;
}

/**
 * Rubric-evaluation caller-state VALIDATION toasts — the five pre-DB
 * payload denials, the submitter's certification re-check
 * (`TEACHER_NOT_CERTIFIED`, a caller-STATE validation), and the read arm's
 * fail-closed integrity denial (`APPLICANT_STATUS_CORRUPT` — a missing
 * applicant row or a foreign stored status is never interpreted loosely)
 * each surface their OWN `errors`-namespace copy as a localized toast
 * (never the generic `validation` copy).
 */
const RUBRIC_VALIDATION_TOAST_ROWS: Readonly<Record<string, ErrorMessageKey | undefined>> = {
  RUBRIC_SCORE_INVALID: "rubricScoreInvalid",
  RUBRIC_NOTES_REQUIRED: "rubricNotesRequired",
  RUBRIC_WEAKNESS_REQUIRED: "rubricWeaknessRequired",
  RUBRIC_WEAKNESS_NOT_ALLOWED: "rubricWeaknessNotAllowed",
  RUBRIC_WEAKNESS_INVALID: "rubricWeaknessInvalid",
  TEACHER_NOT_CERTIFIED: "teacherNotCertified",
  APPLICANT_STATUS_CORRUPT: "applicantStatusCorrupt",
};

/**
 * Rubric-evaluation CONFLICT denials — state denials carrying their OWN
 * localized copy as conflict notices, the same treatment as the
 * teacher-rating gate row above: the applicant-status gates
 * (`APPLICANT_NOT_IN_EVALUATION`, `APPLICANT_ALREADY_FINALIZED`) and the
 * incomplete-session gate.
 */
const RUBRIC_CONFLICT_NOTICE_ROWS: Readonly<Record<string, ErrorMessageKey | undefined>> = {
  RUBRIC_SESSION_NOT_COMPLETED: "rubricSessionNotCompleted",
  APPLICANT_NOT_IN_EVALUATION: "applicantNotInEvaluation",
  APPLICANT_ALREADY_FINALIZED: "applicantAlreadyFinalized",
};

/**
 * Rubric-evaluation submission rows — the five pre-DB validation denials,
 * the caller-state certification denial, and the read arm's fail-closed
 * integrity denial resolve as localized toasts, the three state-conflict
 * denials as conflict notices. Every denial keeps its dedicated copy; no
 * threshold, score, or identifier rides the action.
 */
function mapRubricEvaluationRow(code: string, context: GraphQLErrorMappingContext): GraphQLErrorAction | null {
  const validationMessageKey = RUBRIC_VALIDATION_TOAST_ROWS[code];
  if (validationMessageKey !== undefined) {
    return withCorrelation(context, {
      kind: "toast",
      messageKey: validationMessageKey,
      tone: "error",
      retryable: false,
    });
  }
  const conflictMessageKey = RUBRIC_CONFLICT_NOTICE_ROWS[code];
  if (conflictMessageKey !== undefined) {
    return withCorrelation(context, {
      kind: "notice",
      noticeKind: "conflict",
      messageKey: conflictMessageKey,
      tone: "error",
      retryable: false,
    });
  }
  return null;
}

/**
 * Final row — masked INTERNAL_SERVER_ERROR: generic localized copy + correlation
 * guidance ONLY; the masked wire message must never reach users.
 */
function mapMaskedInternalRow(code: string, context: GraphQLErrorMappingContext): GraphQLErrorAction | null {
  if (code !== "INTERNAL_SERVER_ERROR") return null;
  return withCorrelation(context, {
    kind: "toast",
    messageKey: "internalServerError",
    tone: "error",
    retryable: false,
    requestIdCorrelationGuidance: true,
  });
}

/**
 * Availability-toggle CONFLICT denial — the in-session lock gate
 * surfaces its OWN localized copy as a conflict notice. The dashboard
 * card pre-emptively disables the Available CTA while a started session
 * is in flight; this row is the server-side defense-in-depth backstop
 * for the case where a concurrent toggle lands during the session-start
 * window. Mirrors the rubric-evaluation conflict-notice idiom (one
 * const, one resolver) — no identifier from the denial is surfaced;
 * the message handle is the leaf-string key `teacherInActiveSession`.
 */
const AVAILABILITY_CONFLICT_NOTICE_ROWS: Readonly<Record<string, ErrorMessageKey | undefined>> = {
  TEACHER_IN_ACTIVE_SESSION: "teacherInActiveSession",
};

/**
 * Availability-toggle submission row — the in-session conflict denial
 * resolves as a localized conflict notice with its OWN copy. No
 * threshold, session id, or identifier rides the action.
 */
function mapAvailabilityRow(code: string, context: GraphQLErrorMappingContext): GraphQLErrorAction | null {
  const conflictMessageKey = AVAILABILITY_CONFLICT_NOTICE_ROWS[code];
  if (conflictMessageKey !== undefined) {
    return withCorrelation(context, {
      kind: "notice",
      noticeKind: "conflict",
      messageKey: conflictMessageKey,
      tone: "error",
      retryable: false,
    });
  }
  return null;
}

/**
 * Mapping entry point — one row per extensions.code family.
 *
 * | Normalized code                              | Context            | Action |
 * |----------------------------------------------|--------------------|--------|
 * | UNAUTHORIZED (+legacy UNAUTHENTICATED, utils.ts trigger only) | any | auth-recovery (deduped refresh → logout/login on failure) |
 * | FORBIDDEN                                    | query              | permission-fallback (`forbidden`) |
 * | FORBIDDEN                                    | mutation           | toast (`forbidden`) |
 * | PASSWORD_CHANGE_REQUIRED                     | query              | permission-fallback (`passwordChangeRequired`) + `redirectTo` forced-reset page |
 * | PASSWORD_CHANGE_REQUIRED                     | mutation           | toast (`passwordChangeRequired`) + `redirectTo` forced-reset page |
 * | VALIDATION                                   | form + fields[]    | form-fields — `setError(field, { message })` per pair |
 * | VALIDATION                                   | otherwise          | toast (`validation`); pairs still attached for form-bound consumers |
 * | NOT_FOUND / `{ENTITY}_NOT_FOUND`             | any                | notice not-found (`notFound`) |
 * | CONFLICT                                     | any                | notice conflict (`conflict`) |
 * | EVALUATION_SESSION_NOT_COMPLETED             | any                | notice conflict (`evaluationSessionNotCompleted`) |
 * | EVALUATION_ALREADY_SUBMITTED                 | any                | notice conflict, info tone (`evaluationAlreadySubmitted`) — consumers mark the row rated |
 * | RUBRIC_SCORE_INVALID                         | any                | toast (`rubricScoreInvalid`) |
 * | RUBRIC_NOTES_REQUIRED                        | any                | toast (`rubricNotesRequired`) |
 * | RUBRIC_WEAKNESS_REQUIRED                     | any                | toast (`rubricWeaknessRequired`) |
 * | RUBRIC_WEAKNESS_NOT_ALLOWED                  | any                | toast (`rubricWeaknessNotAllowed`) |
 * | RUBRIC_WEAKNESS_INVALID                      | any                | toast (`rubricWeaknessInvalid`) |
 * | RUBRIC_SESSION_NOT_COMPLETED                 | any                | notice conflict (`rubricSessionNotCompleted`) |
 * | APPLICANT_ALREADY_FINALIZED                  | any                | notice conflict (`applicantAlreadyFinalized`) |
 * | TEACHER_NOT_CERTIFIED                        | any                | toast (`teacherNotCertified`) — caller-state validation denial |
 * | APPLICANT_NOT_IN_EVALUATION                  | any                | notice conflict (`applicantNotInEvaluation`) |
 * | APPLICANT_STATUS_CORRUPT                     | any                | toast (`applicantStatusCorrupt`) — fail-closed read-path integrity denial |
 * | TEACHER_IN_ACTIVE_SESSION                    | any                | notice conflict (`teacherInActiveSession`) — in-session availability-gate backstop |
 * | DUPLICATE_REQUEST                            | any                | notice duplicate-request (`duplicateRequest`, success-equivalent) |
 * | RATE_LIMITED (+legacy RATE_LIMIT_EXCEEDED)   | any                | notice retry-later (`rateLimitExceeded`) — thresholds/counters NEVER surfaced |
 * | SERVICE_UNAVAILABLE                          | any                | notice retryable-service-unavailable (`serviceUnavailable`) |
 * | INTERNAL_SERVER_ERROR (masked)               | any                | toast (`internalServerError`) + requestId correlation guidance |
 * | anything else                                | any                | `null` — caller keeps pre-existing behavior |
 *
 * `BAD_REQUEST` and transport-preset carriers (GRAPHQL_PARSE_FAILED,
 * PAYLOAD_TOO_LARGE…) intentionally fall through to `null`: the mapping
 * defines no row for them and surfacing would double-report transport
 * diagnostics.
 *
 * Dispatches through the per-row resolvers in canonical taxonomy order and
 * returns `null` when no row applies so callers keep their existing behavior.
 */
export function mapGraphQLErrorByCode(rawCode: string, context: GraphQLErrorMappingContext): GraphQLErrorAction | null {
  const code = normalizeGraphQLErrorCode(rawCode);
  return (
    mapAuthRow(code, context) ??
    mapPermissionRow(code, context) ??
    mapPasswordChangeRow(code, context) ??
    mapValidationRow(code, context) ??
    mapInlineNoticeRow(code, context) ??
    mapRubricEvaluationRow(code, context) ??
    mapAvailabilityRow(code, context) ??
    mapMaskedInternalRow(code, context)
  );
}
