/**
 * Paired suite for the frontend error-link mapping + wiring.
 *
 * WHAT THIS LOCKS
 *   1. The PURE `mapGraphQLErrorByCode` branch table (every mapping row,
 *      including the legacy `RATE_LIMIT_EXCEEDED` alias folded into the
 *      frontend table, and the strict "branch on extensions.code ONLY"
 *      posture).
 *   2. The `routeApolloLinkError` integration seam in `utils.ts`: the
 *      deduped token-refresh double-path (refresh-once → stay-on-page;
 *      refresh-failure → logout/login redirect), the mapped-action surface
 *      dispatch (with auth-row and self-surfaced-operation exclusions), and
 *      the network-error connectivity branch.
 *
 * FIXTURES
 *   Errors are authored as genuine Apollo Client v4 `CombinedGraphQLErrors`
 *   containers — exactly what the HTTP link builds (`{ errors: [...] }
 *   FormattedExecutionResult`) — mirroring
 *   `frontend/graphql/test/warnings/warning-surfacing.test.ts`.
 *
 * i18n ADAPTATION NOTE: the component-tier `readTranslation(handle, locale)`
 *   / `TestWrapper` / `translation-preload.ts` scaffold is ABSENT from the
 *   tree (the static/component UI test tier was removed; only the Paymob
 *   checkout E2E remains under `test/ui/`), so this unit-tier suite
 *   resolves every expected user-facing string through `getDefaultTranslations()`
 *   (`shared/locale/server.ts` — the same MessagesSchema the namespace handles
 *   wrap) and probes AR parity by direct namespace-object access. No copy
 *   string is hardcoded; fixture field texts are technical test data,
 *   never rendered UI copy.
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 *   frontend/providers/apollo/error-link.map.test.ts — pure unit tier, no
 *   server boot, no DB.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { CombinedGraphQLErrors } from "@apollo/client";
import { parse } from "graphql";
import { CHANGE_PASSWORD_PAGE_PATH } from "@/frontend/lib/auth/changePasswordRoute";
import { buildLoginHref } from "@/frontend/lib/safeRedirect";
import {
  extractWireFieldErrors,
  type GraphQLErrorAction,
  type GraphQLErrorMappingContext,
  isWireFieldErrorEntry,
  LEGACY_ERROR_CODE_ALIASES,
  mapGraphQLErrorByCode,
  normalizeGraphQLErrorCode,
} from "@/frontend/providers/apollo/error-link.map";
import {
  dispatchMappedGraphQLErrorActions,
  registerAuthRecovery,
  registerGraphQLErrorActionListener,
  routeApolloLinkError,
  unregisterAuthRecovery,
  unregisterGraphQLErrorActionListener,
} from "@/frontend/providers/apollo/utils";
import { getDefaultTranslations, loadAllTranslations } from "@/shared/locale/server";

// ---------------------------------------------------------------------------
// Translation-backed expectations (never hardcoded copy)

const labels = getDefaultTranslations().errorsTranslations;
const arLabels = loadAllTranslations("ar").errorsTranslations;

/** Resolves the exact user-visible copy a published action will surface. */
const shownCopyOf = (action: GraphQLErrorAction): string => labels[action.messageKey];

/** Expect-wrapped mapping call — narrows `null` WITHOUT an unsafe cast. */
function mapped(code: string, context: GraphQLErrorMappingContext): GraphQLErrorAction {
  const action = mapGraphQLErrorByCode(code, context);
  if (action === null) {
    // Assertion first (bun prints the diff), then an explicit throw so the
    // success path narrows without any type assertion.
    expect(action).not.toBeNull();
    throw new Error("expected a non-null mapping");
  }
  return action;
}

// ---------------------------------------------------------------------------
// Fixture builders

type FixtureItem = { readonly message: string; readonly extensions?: Record<string, unknown> };

/** Builds the genuine Apollo v4 container from wire-shaped error items. */
function combinedError(items: readonly FixtureItem[]): CombinedGraphQLErrors {
  return new CombinedGraphQLErrors({
    errors: items.map(item => ({
      message: item.message,
      ...(item.extensions === undefined ? {} : { extensions: item.extensions }),
    })),
  });
}

const FIELD_PAIRS = [
  { field: "email", code: "EMAIL_INVALID", message: "Enter a valid email address." },
  { field: "password.confirm", code: "PASSWORD_MISMATCH", message: "Passwords must match." },
] as const;

const QUERY_DOCUMENT = parse("query CurrentViewerQuery { viewer { id } }");
const MUTATION_DOCUMENT = parse("mutation PingMutation { __typename }");

const queryContext: GraphQLErrorMappingContext = { contextKind: "query", hasForm: false };
const mutationContext: GraphQLErrorMappingContext = { contextKind: "mutation", hasForm: false };

/** Minimal Operation-like stand-in matching what ErrorLink hands consumers. */
function operationLike(
  query: typeof QUERY_DOCUMENT,
  operationName = "CurrentViewerQuery"
): { operationName: string; query: typeof QUERY_DOCUMENT } {
  return { operationName, query };
}

/** Drains the fire-and-forget async auth machinery inside routeApolloLinkError. */
async function flushAsyncRouting(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await Promise.resolve();
}

type GlobalWithWindow = { window?: unknown };
const globalScope = globalThis as GlobalWithWindow;

let installedFakeWindow = false;
let preexistingWindowPresent = false;
const preexistingWindowValue = globalScope.window;

/** Reads the faked (or real) window href without unsafe assumptions or casts. */
function currentHref(): string {
  if (!Object.hasOwn(globalThis, "window")) return "";
  return globalThis.window.location.href;
}

/** Installs a capturing listener; returns arrays filled by the dispatcher. */
function recordActions(): { actions: GraphQLErrorAction[]; operationNames: string[] } {
  const actions: GraphQLErrorAction[] = [];
  const operationNames: string[] = [];
  registerGraphQLErrorActionListener((action, meta) => {
    actions.push(action);
    operationNames.push(meta.operationName);
  });
  return { actions, operationNames };
}

// ---------------------------------------------------------------------------
// globalThis.window fake (link behavior branches on browser presence)

function installWindow(pathname = "/dashboard", search = ""): void {
  preexistingWindowPresent = Object.hasOwn(globalThis, "window");
  globalScope.window = { location: { pathname, search, href: `${pathname}${search}` } };
  installedFakeWindow = true;
}

afterEach(() => {
  if (!installedFakeWindow) return;
  if (preexistingWindowPresent) {
    globalScope.window = preexistingWindowValue;
  } else {
    delete globalScope.window;
  }
  installedFakeWindow = false;
});

// ===========================================================================
describe("mapGraphQLErrorByCode — pure branch table", () => {
  test("row UNAUTHORIZED → auth-recovery with localized unauthorized copy", () => {
    const action = mapped("UNAUTHORIZED", queryContext);
    expect(action.kind).toBe("auth-recovery");
    expect(action.retryable).toBe(false);
    expect(shownCopyOf(action)).toBe(labels.unauthorized);
    // i18n parity probe (direct namespace access; scaffold absent — see header).
    expect(arLabels.unauthorized.length).toBeGreaterThan(0);
  });

  test("legacy UNAUTHENTICATED literal intentionally retires at the PURE map (owned upstream)", () => {
    // The deduped-refresh TRIGGER list still honors it; the mapping receives
    // canonical codes only, so anything unknown maps to null (dispatcher skip).
    expect(mapGraphQLErrorByCode("UNAUTHENTICATED", queryContext)).toBeNull();
  });

  test("row FORBIDDEN → permission-fallback in query context", () => {
    const action = mapped("FORBIDDEN", queryContext);
    expect(action.kind).toBe("permission-fallback");
    expect(shownCopyOf(action)).toBe(labels.forbidden);
    expect(action.tone).toBe("error");
  });

  test("row FORBIDDEN → localized toast in mutation context", () => {
    const action = mapped("FORBIDDEN", mutationContext);
    expect(action.kind).toBe("toast");
    expect(shownCopyOf(action)).toBe(labels.forbidden);
  });

  test("row PASSWORD_CHANGE_REQUIRED → permission-fallback + redirectTo (query context)", () => {
    const action = mapped("PASSWORD_CHANGE_REQUIRED", queryContext);
    expect(action.kind).toBe("permission-fallback");
    expect(shownCopyOf(action)).toBe(labels.passwordChangeRequired);
    expect(action.redirectTo).toBe(CHANGE_PASSWORD_PAGE_PATH);
  });

  test("row PASSWORD_CHANGE_REQUIRED → localized toast + redirectTo (mutation context)", () => {
    const action = mapped("PASSWORD_CHANGE_REQUIRED", mutationContext);
    expect(action.kind).toBe("toast");
    expect(shownCopyOf(action)).toBe(labels.passwordChangeRequired);
    expect(action.redirectTo).toBe(CHANGE_PASSWORD_PAGE_PATH);
  });

  test("no other mapping row carries a redirectTo payload", () => {
    // One representative per remaining row family — the redirect payload is
    // exclusively the PASSWORD_CHANGE_REQUIRED row's.
    for (const code of ["VALIDATION", "NOT_FOUND", "CONFLICT", "RATE_LIMITED", "INTERNAL_SERVER_ERROR"]) {
      expect(mapped(code, queryContext).redirectTo).toBeUndefined();
    }
  });

  test("row VALIDATION + form + fields[] → form-fields setError pairs verbatim", () => {
    const action = mapped("VALIDATION", { contextKind: "mutation", hasForm: true, fields: FIELD_PAIRS });
    expect(action.kind).toBe("form-fields");
    expect(shownCopyOf(action)).toBe(labels.validation);
    expect(action.fieldErrors).toEqual(FIELD_PAIRS);
    expect(action.fieldErrors?.map(pair => pair.field)).toEqual(["email", "password.confirm"]);
  });

  test("row VALIDATION without form context → toast fallback that still carries pairs", () => {
    const action = mapped("VALIDATION", { contextKind: "mutation", hasForm: false, fields: FIELD_PAIRS });
    expect(action.kind).toBe("toast");
    expect(shownCopyOf(action)).toBe(labels.validation);
    expect(action.fieldErrors).toEqual(FIELD_PAIRS);
  });

  test("row VALIDATION without fields (even with a form) → bare toast fallback", () => {
    const action = mapped("VALIDATION", { contextKind: "mutation", hasForm: true });
    expect(action.kind).toBe("toast");
    expect(action.fieldErrors).toBeUndefined();
    expect(shownCopyOf(action)).toBe(labels.validation);
  });

  test("row NOT_FOUND family → localized not-found inline notice", () => {
    for (const code of ["NOT_FOUND", "USER_NOT_FOUND", "LESSON_HOME_WORK_NOT_FOUND"]) {
      const action = mapped(code, queryContext);
      expect(action.kind).toBe("notice");
      expect(action.noticeKind).toBe("not-found");
      expect(shownCopyOf(action)).toBe(labels.notFound);
    }
  });

  test("row CONFLICT → conflict inline notice", () => {
    const action = mapped("CONFLICT", mutationContext);
    expect(action.kind).toBe("notice");
    expect(action.noticeKind).toBe("conflict");
    expect(shownCopyOf(action)).toBe(labels.conflict);
    expect(action.tone).toBe("error");
  });

  test("row EVALUATION_SESSION_NOT_COMPLETED → gate-reject notice with its own denial copy", () => {
    const action = mapped("EVALUATION_SESSION_NOT_COMPLETED", mutationContext);
    expect(action.kind).toBe("notice");
    expect(action.noticeKind).toBe("conflict");
    expect(shownCopyOf(action)).toBe(labels.evaluationSessionNotCompleted);
    expect(action.tone).toBe("error");
    expect(action.retryable).toBe(false);
  });

  test("row EVALUATION_ALREADY_SUBMITTED → write-once rejection as neutral info notice", () => {
    const action = mapped("EVALUATION_ALREADY_SUBMITTED", mutationContext);
    expect(action.kind).toBe("notice");
    expect(action.noticeKind).toBe("conflict");
    expect(shownCopyOf(action)).toBe(labels.evaluationAlreadySubmitted);
    // The rating EXISTS — the outcome equals what the caller asked for, so
    // the surface tone is informational, never an error treatment.
    expect(action.tone).toBe("info");
    expect(action.retryable).toBe(false);
    // The success-equivalent flag stays exclusive to DUPLICATE_REQUEST
    // (idempotent-replay semantics — not the same contract).
    expect(action.duplicateSuccessEquivalent).toBeUndefined();
  });

  test("row RUBRIC_SCORE_INVALID → localized toast with its own denial copy", () => {
    const action = mapped("RUBRIC_SCORE_INVALID", mutationContext);
    expect(action.kind).toBe("toast");
    expect(shownCopyOf(action)).toBe(labels.rubricScoreInvalid);
    expect(action.tone).toBe("error");
    expect(action.retryable).toBe(false);
    // Rubric rows are custom codes, never VALIDATION — no field pairs ride along.
    expect(action.fieldErrors).toBeUndefined();
    expect(arLabels.rubricScoreInvalid.length).toBeGreaterThan(0);
  });

  test("row RUBRIC_NOTES_REQUIRED → localized toast with its own denial copy", () => {
    const action = mapped("RUBRIC_NOTES_REQUIRED", mutationContext);
    expect(action.kind).toBe("toast");
    expect(shownCopyOf(action)).toBe(labels.rubricNotesRequired);
    expect(action.tone).toBe("error");
    expect(action.retryable).toBe(false);
    expect(action.fieldErrors).toBeUndefined();
    expect(arLabels.rubricNotesRequired.length).toBeGreaterThan(0);
  });

  test("row RUBRIC_WEAKNESS_REQUIRED → localized toast with its own denial copy", () => {
    const action = mapped("RUBRIC_WEAKNESS_REQUIRED", mutationContext);
    expect(action.kind).toBe("toast");
    expect(shownCopyOf(action)).toBe(labels.rubricWeaknessRequired);
    expect(action.tone).toBe("error");
    expect(action.retryable).toBe(false);
    expect(action.fieldErrors).toBeUndefined();
    expect(arLabels.rubricWeaknessRequired.length).toBeGreaterThan(0);
  });

  test("row RUBRIC_WEAKNESS_NOT_ALLOWED → localized toast with its own denial copy", () => {
    const action = mapped("RUBRIC_WEAKNESS_NOT_ALLOWED", mutationContext);
    expect(action.kind).toBe("toast");
    expect(shownCopyOf(action)).toBe(labels.rubricWeaknessNotAllowed);
    expect(action.tone).toBe("error");
    expect(action.retryable).toBe(false);
    expect(action.fieldErrors).toBeUndefined();
    expect(arLabels.rubricWeaknessNotAllowed.length).toBeGreaterThan(0);
  });

  test("row RUBRIC_WEAKNESS_INVALID → localized toast with its own denial copy", () => {
    const action = mapped("RUBRIC_WEAKNESS_INVALID", mutationContext);
    expect(action.kind).toBe("toast");
    expect(shownCopyOf(action)).toBe(labels.rubricWeaknessInvalid);
    expect(action.tone).toBe("error");
    expect(action.retryable).toBe(false);
    expect(action.fieldErrors).toBeUndefined();
    expect(arLabels.rubricWeaknessInvalid.length).toBeGreaterThan(0);
  });

  test("row RUBRIC_SESSION_NOT_COMPLETED → conflict notice with its own denial copy", () => {
    const action = mapped("RUBRIC_SESSION_NOT_COMPLETED", mutationContext);
    expect(action.kind).toBe("notice");
    expect(action.noticeKind).toBe("conflict");
    expect(shownCopyOf(action)).toBe(labels.rubricSessionNotCompleted);
    expect(action.tone).toBe("error");
    expect(action.retryable).toBe(false);
    expect(action.duplicateSuccessEquivalent).toBeUndefined();
    expect(arLabels.rubricSessionNotCompleted.length).toBeGreaterThan(0);
  });

  test("row APPLICANT_ALREADY_FINALIZED → conflict notice with its own denial copy", () => {
    const action = mapped("APPLICANT_ALREADY_FINALIZED", mutationContext);
    expect(action.kind).toBe("notice");
    expect(action.noticeKind).toBe("conflict");
    expect(shownCopyOf(action)).toBe(labels.applicantAlreadyFinalized);
    expect(action.tone).toBe("error");
    expect(action.retryable).toBe(false);
    expect(action.duplicateSuccessEquivalent).toBeUndefined();
    expect(arLabels.applicantAlreadyFinalized.length).toBeGreaterThan(0);
  });

  test("row TEACHER_NOT_CERTIFIED → localized toast with its own caller-state denial copy", () => {
    // The caller's certification state is a caller-side validation denial —
    // toast treatment (error tone, non-retryable), never a section fallback.
    const action = mapped("TEACHER_NOT_CERTIFIED", mutationContext);
    expect(action.kind).toBe("toast");
    expect(shownCopyOf(action)).toBe(labels.teacherNotCertified);
    expect(action.tone).toBe("error");
    expect(action.retryable).toBe(false);
    expect(action.fieldErrors).toBeUndefined();
    expect(arLabels.teacherNotCertified.length).toBeGreaterThan(0);
  });

  test("row APPLICANT_NOT_IN_EVALUATION → conflict notice with its own denial copy", () => {
    const action = mapped("APPLICANT_NOT_IN_EVALUATION", mutationContext);
    expect(action.kind).toBe("notice");
    expect(action.noticeKind).toBe("conflict");
    expect(shownCopyOf(action)).toBe(labels.applicantNotInEvaluation);
    expect(action.tone).toBe("error");
    expect(action.retryable).toBe(false);
    expect(action.duplicateSuccessEquivalent).toBeUndefined();
    expect(arLabels.applicantNotInEvaluation.length).toBeGreaterThan(0);
  });

  test("row APPLICANT_STATUS_CORRUPT → localized toast with its own integrity-denial copy", () => {
    // The read arm's fail-closed integrity denial (a missing applicant row
    // or a foreign stored status) — toast treatment with the row's OWN
    // copy, never the generic validation fallback; the producing surface is
    // the caller's own-submission READ, so the query context is faithful.
    const action = mapped("APPLICANT_STATUS_CORRUPT", queryContext);
    expect(action.kind).toBe("toast");
    expect(shownCopyOf(action)).toBe(labels.applicantStatusCorrupt);
    expect(action.tone).toBe("error");
    expect(action.retryable).toBe(false);
    expect(action.fieldErrors).toBeUndefined();
    expect(action.duplicateSuccessEquivalent).toBeUndefined();
    expect(arLabels.applicantStatusCorrupt.length).toBeGreaterThan(0);
  });

  test("row DUPLICATE_REQUEST → success-equivalent idempotent notice (docs/IDEMPOTENCY.md §3)", () => {
    const action = mapped("DUPLICATE_REQUEST", mutationContext);
    expect(action.kind).toBe("notice");
    expect(action.noticeKind).toBe("duplicate-request");
    expect(shownCopyOf(action)).toBe(labels.duplicateRequest);
    expect(action.duplicateSuccessEquivalent).toBe(true);
    expect(action.tone).toBe("info");
  });

  test("row RATE_LIMITED → retry-later notice with NO thresholds/counters surfaced", () => {
    const action = mapped("RATE_LIMITED", queryContext);
    expect(action.kind).toBe("notice");
    expect(action.noticeKind).toBe("retry-later");
    expect(shownCopyOf(action)).toBe(labels.rateLimitExceeded);
    expect(action.retryable).toBe(true);
    // Nondisclosure discipline: the action shape itself stays
    // counter/threshold/window free.
    expect("attempts" in action).toBe(false);
    expect("retryAfterSeconds" in action).toBe(false);
    expect(action.fieldErrors).toBeUndefined();
  });

  test("legacy RATE_LIMIT_EXCEEDED alias folds onto the RATE_LIMITED row", () => {
    expect(normalizeGraphQLErrorCode("RATE_LIMIT_EXCEEDED")).toBe("RATE_LIMITED");
    expect(LEGACY_ERROR_CODE_ALIASES.RATE_LIMIT_EXCEEDED).toBe("RATE_LIMITED");
    const viaLegacy = mapped("RATE_LIMIT_EXCEEDED", queryContext);
    const viaCanonical = mapped("RATE_LIMITED", queryContext);
    expect(viaLegacy).toEqual(viaCanonical);
    expect(viaLegacy.noticeKind).toBe("retry-later");
  });

  test("row SERVICE_UNAVAILABLE → retryable manual-retry notice", () => {
    const action = mapped("SERVICE_UNAVAILABLE", queryContext);
    expect(action.kind).toBe("notice");
    expect(action.noticeKind).toBe("retryable-service-unavailable");
    expect(shownCopyOf(action)).toBe(labels.serviceUnavailable);
    expect(action.retryable).toBe(true);
  });

  test("row masked INTERNAL_SERVER_ERROR → generic toast + requestId correlation guidance", () => {
    const action = mapped("INTERNAL_SERVER_ERROR", { ...queryContext, requestId: "req-1234-abcd" });
    expect(action.kind).toBe("toast");
    expect(shownCopyOf(action)).toBe(labels.internalServerError);
    expect(action.requestIdCorrelationGuidance).toBe(true);
    expect(action.correlationRequestId).toBe("req-1234-abcd");
  });

  test("requestId correlation attaches to non-masked rows too", () => {
    const action = mapped("FORBIDDEN", { ...mutationContext, requestId: "req-echo-42" });
    expect(action.correlationRequestId).toBe("req-echo-42");
  });

  test("codes with no mapping row return null (behavior left untouched)", () => {
    for (const code of ["BAD_REQUEST", "GRAPHQL_PARSE_FAILED", "PAYLOAD_TOO_LARGE", "", "unauthorized_x"]) {
      expect(mapGraphQLErrorByCode(code, queryContext)).toBeNull();
    }
  });
});

// ===========================================================================
describe("wire-shape guards", () => {
  test("isWireFieldErrorEntry accepts only complete {field,code,message} entries", () => {
    expect(isWireFieldErrorEntry({ field: "email", code: "EMAIL_INVALID", message: "bad" })).toBe(true);
    expect(isWireFieldErrorEntry({ field: "email", code: "EMAIL_INVALID" })).toBe(false);
    expect(isWireFieldErrorEntry({ field: "email", code: "EMAIL_INVALID", message: 7 })).toBe(false);
    expect(isWireFieldErrorEntry(null)).toBe(false);
    expect(isWireFieldErrorEntry("email")).toBe(false);
  });

  test("extractWireFieldErrors filters malformed entries and drops empty results", () => {
    expect(extractWireFieldErrors(undefined)).toBeUndefined();
    expect(extractWireFieldErrors("not-an-array")).toBeUndefined();
    expect(extractWireFieldErrors([{ nope: true }, 42])).toBeUndefined();
    expect(extractWireFieldErrors([...FIELD_PAIRS, { broken: true }])).toEqual(FIELD_PAIRS);
  });
});

// ===========================================================================
describe("dispatchMappedGraphQLErrorActions — surface seam integration", () => {
  test("publishes mapped actions with inferred query/mutation contextKind", () => {
    installWindow("/dashboard");
    const recording = recordActions();

    dispatchMappedGraphQLErrorActions(
      combinedError([{ message: "denied", extensions: { code: "FORBIDDEN" } }]),
      operationLike(QUERY_DOCUMENT)
    );
    dispatchMappedGraphQLErrorActions(
      combinedError([{ message: "conflict", extensions: { code: "CONFLICT" } }]),
      operationLike(MUTATION_DOCUMENT, "PingMutation")
    );

    expect(recording.actions.map(action => action.kind)).toEqual(["permission-fallback", "notice"]);
    expect(recording.actions[1]?.noticeKind).toBe("conflict");
    expect(recording.operationNames).toEqual(["CurrentViewerQuery", "PingMutation"]);
    unregisterGraphQLErrorActionListener();
  });

  test("auth-row items NEVER reach the surface listener (deduped refresh owns display)", () => {
    installWindow("/dashboard");
    const recording = recordActions();
    let refreshCalls = 0;
    registerAuthRecovery({
      refresh: () => {
        refreshCalls += 1;
        return Promise.resolve(null);
      },
      reFetch: () => undefined,
    });

    try {
      // Dispatcher-only call: the mapping/seam never triggers recovery itself.
      dispatchMappedGraphQLErrorActions(
        combinedError([
          { message: "gone", extensions: { code: "UNAUTHORIZED", requestId: "req-a1" } },
          { message: "legacy", extensions: { code: "UNAUTHENTICATED" } },
        ]),
        operationLike(QUERY_DOCUMENT)
      );
      expect(refreshCalls).toBe(0); // recovery ignition lives in routeApolloLinkError, not here
    } finally {
      unregisterAuthRecovery();
      unregisterGraphQLErrorActionListener();
    }
    expect(recording.actions).toHaveLength(0);
  });

  test("self-surfaced operations (login/demoLogin/refreshToken) are exempt from toasts", () => {
    installWindow("/dashboard");
    const recording = recordActions();
    dispatchMappedGraphQLErrorActions(
      combinedError([{ message: "bad credentials", extensions: { code: "CONFLICT" } }]),
      operationLike(MUTATION_DOCUMENT, "login")
    );
    expect(recording.actions).toHaveLength(0);
    unregisterGraphQLErrorActionListener();
  });

  test("masked 500 requestId flows from extensions into correlationRequestId", () => {
    installWindow("/dashboard");
    const recording = recordActions();
    dispatchMappedGraphQLErrorActions(
      combinedError([
        { message: "masked!", extensions: { code: "INTERNAL_SERVER_ERROR", requestId: "req-correlate-9" } },
      ]),
      operationLike(QUERY_DOCUMENT)
    );
    expect(recording.actions[0]?.messageKey).toBe("internalServerError");
    expect(recording.actions[0]?.correlationRequestId).toBe("req-correlate-9");
    expect(recording.actions[0]?.requestIdCorrelationGuidance).toBe(true);
    unregisterGraphQLErrorActionListener();
  });

  test("VALIDATION published at link scope is toast-with-pairs (hasForm=false; forms adopt locally)", () => {
    installWindow("/dashboard");
    const recording = recordActions();
    dispatchMappedGraphQLErrorActions(
      combinedError([{ message: "invalid", extensions: { code: "VALIDATION", fields: [...FIELD_PAIRS] } }]),
      operationLike(MUTATION_DOCUMENT, "RegisterUser")
    );
    const validationAction = recording.actions[0];
    expect(validationAction?.kind).toBe("toast");
    expect(validationAction?.fieldErrors).toEqual(FIELD_PAIRS);
    expect(validationAction && shownCopyOf(validationAction)).toBe(labels.validation);
    unregisterGraphQLErrorActionListener();
  });

  test("transport-preset carriers and headerless items publish nothing", () => {
    installWindow("/dashboard");
    const recording = recordActions();
    dispatchMappedGraphQLErrorActions(
      combinedError([
        { message: "Syntax error", extensions: { code: "GRAPHQL_PARSE_FAILED" } },
        { message: "no code here" },
        { message: "payload", extensions: { code: "PAYLOAD_TOO_LARGE" } },
      ]),
      operationLike(QUERY_DOCUMENT)
    );
    expect(recording.actions).toHaveLength(0);
    unregisterGraphQLErrorActionListener();
  });

  test("a throwing listener never breaks routing of remaining items", () => {
    installWindow("/dashboard");
    let listenerInvocations = 0;
    registerGraphQLErrorActionListener(() => {
      listenerInvocations += 1;
      throw new Error("surface boom");
    });
    expect(() =>
      dispatchMappedGraphQLErrorActions(
        combinedError([
          { message: "first", extensions: { code: "CONFLICT" } },
          { message: "second", extensions: { code: "SERVICE_UNAVAILABLE" } },
        ]),
        operationLike(QUERY_DOCUMENT)
      )
    ).not.toThrow();
    expect(listenerInvocations).toBe(2);
    unregisterGraphQLErrorActionListener();
  });

  test("headless environment (no window) keeps the dispatcher inert", () => {
    const recording = recordActions();
    dispatchMappedGraphQLErrorActions(
      combinedError([{ message: "conflict", extensions: { code: "CONFLICT" } }]),
      operationLike(QUERY_DOCUMENT)
    );
    expect(recording.actions).toHaveLength(0);
    unregisterGraphQLErrorActionListener();
  });

  test("PASSWORD_CHANGE_REQUIRED honors redirectTo — loop-guarded, once per session", () => {
    // 1) Already sitting on the forced-reset page: the copy publishes, but
    //    the loop guard suppresses the navigation (no self-redirect).
    installWindow(CHANGE_PASSWORD_PAGE_PATH);
    const recording = recordActions();
    const gatedContainer = () =>
      combinedError([{ message: "gated", extensions: { code: "PASSWORD_CHANGE_REQUIRED" } }]);

    dispatchMappedGraphQLErrorActions(gatedContainer(), operationLike(MUTATION_DOCUMENT, "CreateSession"));
    expect(recording.actions.map(action => action.messageKey)).toEqual(["passwordChangeRequired"]);
    expect(currentHref()).toBe(CHANGE_PASSWORD_PAGE_PATH);

    // 2) Elsewhere in the app: the FIRST gated denial navigates to the
    //    single-sourced forced-reset page (the mid-session navigation path).
    globalScope.window = { location: { pathname: "/dashboard", search: "", href: "/dashboard" } };
    dispatchMappedGraphQLErrorActions(gatedContainer(), operationLike(QUERY_DOCUMENT));
    expect(currentHref()).toBe(CHANGE_PASSWORD_PAGE_PATH);

    // 3) A later gated denial (another operation, another page) still
    //    publishes its copy but NEVER re-navigates — honored once/session
    //    (the /profile fake stays put; the earlier navigation is not repeated).
    globalScope.window = { location: { pathname: "/profile", search: "", href: "/profile" } };
    dispatchMappedGraphQLErrorActions(gatedContainer(), operationLike(MUTATION_DOCUMENT, "ToggleAvailability"));
    expect(currentHref()).toBe("/profile");
    expect(recording.actions).toHaveLength(3);
    unregisterGraphQLErrorActionListener();
  });
});

// ===========================================================================
describe("routeApolloLinkError — preserved deduped token-refresh double-path", () => {
  const connectivityDeps = {
    getConnected: () => true,
    setConnected: (_v: boolean) => undefined,
    notifyDisconnected: () => undefined,
  };

  const unauthorizedContainer = () =>
    combinedError([{ message: "expired", extensions: { code: "UNAUTHORIZED", requestId: "req-auth-7" } }]);

  test("transport-layer LinkError handling stays wired verbatim (connectivity branch)", () => {
    installWindow("/dashboard");
    let disconnectedNotified = false;
    let connectedValue = true;
    routeApolloLinkError(
      {
        getConnected: () => connectedValue,
        setConnected: value => {
          connectedValue = value;
        },
        notifyDisconnected: () => {
          disconnectedNotified = true;
        },
      },
      new TypeError("Failed to fetch"),
      operationLike(QUERY_DOCUMENT)
    );
    expect(disconnectedNotified).toBe(true);
    expect(connectedValue).toBe(false);

    // Non-CombinedGraphQLErrors values also stay invisible to the surface seam.
    const recording = recordActions();
    dispatchMappedGraphQLErrorActions(new TypeError("Failed to fetch"), operationLike(QUERY_DOCUMENT));
    expect(recording.actions).toHaveLength(0);
    unregisterGraphQLErrorActionListener();
  });

  test("path 1 — one deduped refreshToken, stay on page, active queries re-fetched", async () => {
    installWindow("/dashboard");
    let refreshCalls = 0;
    let refetchCalls = 0;
    let releaseRefresh: ((token: string | null) => void) | undefined;
    const refreshPromise = new Promise<string | null>(resolve => {
      releaseRefresh = resolve;
    });
    registerAuthRecovery({
      refresh: () => {
        refreshCalls += 1;
        return refreshPromise;
      },
      reFetch: () => {
        refetchCalls += 1;
      },
    });

    const beforeHref = currentHref();
    // Two simultaneous UNAUTHORIZED responses arrive while refresh is pending…
    routeApolloLinkError(connectivityDeps, unauthorizedContainer(), operationLike(QUERY_DOCUMENT));
    routeApolloLinkError(connectivityDeps, unauthorizedContainer(), operationLike(QUERY_DOCUMENT));
    // …so BOTH share ONE refreshToken mutation.
    expect(refreshCalls).toBe(1);

    releaseRefresh?.("fresh-access-token");
    await flushAsyncRouting();

    expect(refetchCalls).toBeGreaterThanOrEqual(1);
    expect(currentHref()).toBe(beforeHref); // stayed on page

    unregisterAuthRecovery();
  });

  test("path 2 — failed refresh redirects to /login exactly once; duplicates suppressed", async () => {
    installWindow("/dashboard", "?tab=sessions");
    let refreshCalls = 0;
    registerAuthRecovery({
      refresh: () => {
        refreshCalls += 1;
        return Promise.resolve(null); // refresh definitively fails
      },
      reFetch: () => undefined,
    });

    const currentUrl = "/dashboard?tab=sessions";
    const expectedTarget = buildLoginHref(currentUrl);
    expect(expectedTarget.startsWith("/login")).toBe(true);

    routeApolloLinkError(connectivityDeps, unauthorizedContainer(), operationLike(QUERY_DOCUMENT));
    await flushAsyncRouting();
    expect(currentHref()).toBe(expectedTarget);

    // A trailing duplicate is suppressed by the in-flight-redirect guard and
    // must NOT mint yet another refreshToken mutation.
    const callsAfterFirstRedirect = refreshCalls;
    routeApolloLinkError(connectivityDeps, unauthorizedContainer(), operationLike(QUERY_DOCUMENT));
    await flushAsyncRouting();
    expect(refreshCalls).toBe(callsAfterFirstRedirect);
    expect(currentHref()).toBe(expectedTarget);

    unregisterAuthRecovery();
  });
});
