"use client";

import { type ApolloLink, CombinedGraphQLErrors } from "@apollo/client";
import { logger } from "@/frontend/lib/logger";
import {
  extractWireFieldErrors,
  type GraphQLErrorAction,
  type GraphQLErrorContextKind,
  mapGraphQLErrorByCode,
  normalizeGraphQLErrorCode,
} from "@/frontend/providers/apollo/error-link.map";
import { AUTH_RECOVERY_TRIGGER_CODES, AUTH_REDIRECT_CALLER } from "@/frontend/providers/apollo/utils/auth-recovery";

// ---------------------------------------------------------------------------
// GraphQL error surface dispatch
//
// Registration seam mirroring `registerAuthRecovery` (`./auth-recovery`): a
// UI host (toasts / PermissionDeniedFallback sections) registers ONE listener
// and receives typed {@link GraphQLErrorAction}s produced by the pure mapping
// in `error-link.map.ts`. With no listener registered the dispatcher is a
// no-op, so today's behavior is preserved exactly.
// ---------------------------------------------------------------------------

export type GraphQLErrorActionMeta = {
  readonly operationName: string;
  readonly contextKind: GraphQLErrorContextKind;
};

export type GraphQLErrorActionListener = (action: GraphQLErrorAction, meta: GraphQLErrorActionMeta) => void;

let graphQLErrorActionListener: GraphQLErrorActionListener | null = null;

export function registerGraphQLErrorActionListener(listener: GraphQLErrorActionListener): void {
  graphQLErrorActionListener = listener;
}

export function unregisterGraphQLErrorActionListener(): void {
  graphQLErrorActionListener = null;
}

/** Same self-surfacing operations `handleAuthError` exempts from redirects. */
const SELF_SURFACED_OPERATION_NAMES = new Set(["login", "demoLogin", "refreshToken"]);

/** Mirrors the mutation-detection predicate used by ApolloLink.split in AppApolloProvider. */
function inferContextKind(query: ApolloLink.Operation["query"]): GraphQLErrorContextKind {
  const isMutation = query.definitions.some(
    definition => definition.kind === "OperationDefinition" && definition.operation === "mutation"
  );
  return isMutation ? "mutation" : "query";
}

function logErrorSurfaceEvent(message: string, payload: Record<string, unknown> = {}): void {
  try {
    logger.info({ caller: AUTH_REDIRECT_CALLER }, "[ErrorSurface]", message, payload);
  } catch {
    // defensive: never let logging break error routing
  }
}

/**
 * Maps ONE wire error item through the pure code→behavior mapping table, or
 * returns `null` when the item carries no string code, belongs to the auth-
 * recovery rows (display ownership stays with handleAuthError), or has no
 * mapping row.
 */
function toMappedSurfaceAction(
  item: CombinedGraphQLErrors["errors"][number],
  contextKind: GraphQLErrorContextKind
): GraphQLErrorAction | null {
  const rawCode = item.extensions?.code;
  if (typeof rawCode !== "string") return null;

  const normalizedCode = normalizeGraphQLErrorCode(rawCode);
  if (AUTH_RECOVERY_TRIGGER_CODES.has(normalizedCode)) return null;

  return mapGraphQLErrorByCode(normalizedCode, {
    contextKind,
    hasForm: false,
    fields: extractWireFieldErrors(item.extensions?.fields),
    requestId: typeof item.extensions?.requestId === "string" ? item.extensions.requestId : undefined,
  });
}

// ---------------------------------------------------------------------------
// `redirectTo` consumer — the seam side of the pure map's redirect payloads.
//
// `GraphQLErrorAction.redirectTo` is DESCRIBED by the pure mapping
// (`error-link.map.ts`) and EXECUTED here — the same ownership split as the
// `auth-recovery` row (described in the map, driven by `./auth-recovery`).
// Today only the `PASSWORD_CHANGE_REQUIRED` row carries the payload (the
// forced-reset page, single-sourced via `CHANGE_PASSWORD_PAGE_PATH`): when a
// mid-session gate denial reaches a flagged user, the SSR `withPageAuth`
// fence cannot fire again without a full reload and the `DashboardLayout`
// mirror reads a session snapshot that login/`me` populated — so THIS is the
// client navigation path that lands them on the one page they can act on.
// ---------------------------------------------------------------------------

/**
 * Dedupes repeat navigations when several gated operations fail in one burst
 * (mirrors `isRedirectingToLogin` in `./auth-recovery`): the target is
 * honored ONCE per browser session; later denials keep surfacing their
 * localized copy but never re-navigate.
 */
let hasHonoredRedirectTarget = false;

/**
 * Honors ONE mapped action's `redirectTo` payload. At most once per session,
 * and never while the page is already sitting on the target (loop guard —
 * `changeMyPassword` itself is gate-exempt server-side, but a denial
 * surfacing on `/change-password` must not navigate onto itself). The
 * navigation uses the same mechanism the UNAUTHENTICATED recovery uses
 * (`window.location.href` — the link layer has no React tree access).
 */
function honorActionRedirectTo(action: GraphQLErrorAction, meta: GraphQLErrorActionMeta): void {
  const target = action.redirectTo;
  if (typeof target !== "string" || target.length === 0) return;

  if (hasHonoredRedirectTarget) {
    logErrorSurfaceEvent("redirectTo suppressed — honored once already this session", {
      operationName: meta.operationName,
      to: target,
    });
    return;
  }

  const pathname = globalThis.window.location.pathname;
  // Loop guard — a target that always begins with "/" (the route-constant
  // convention) also matches via endsWith on any localized prefix.
  if (pathname === target || pathname.endsWith(target)) {
    logErrorSurfaceEvent("redirectTo suppressed — already on the target page", {
      operationName: meta.operationName,
      pathname,
      to: target,
    });
    return;
  }

  hasHonoredRedirectTarget = true;
  logErrorSurfaceEvent("redirectTo: navigating to the mapped target", {
    operationName: meta.operationName,
    from: pathname,
    to: target,
  });
  globalThis.window.location.href = target;
}

/**
 * Maps each GraphQL error item through the pure mapping table and publishes
 * the resulting actions to the registered surface listener.
 *
 *  - Auth rows (`UNAUTHENTICATED`/`UNAUTHORIZED`) are skipped here — display
 *    ownership belongs exclusively to the deduped token-refresh path in
 *    `./auth-recovery`, which already handles stay-on-page vs
 *    redirect-to-login.
 *  - Operations whose callers self-surface failures (`login`, `demoLogin`,
 *    `refreshToken`) are exempt to avoid double-reporting in forms.
 *  - The link layer cannot observe React form state, so `hasForm` is always
 *    `false` here; VALIDATION actions still carry their `fieldErrors` pairs
 *    so form-bound consumers can convert them into `setError(field, …)` calls
 *    instead of toasting the fallback copy.
 *  - A mapped action's `redirectTo` payload (today: the
 *    `PASSWORD_CHANGE_REQUIRED` forced-reset page) is honored HERE, after
 *    the surface publish — once per session, loop-guarded (see
 *    {@link honorActionRedirectTo}).
 */
export function dispatchMappedGraphQLErrorActions(
  error: unknown,
  operation: Pick<ApolloLink.Operation, "operationName" | "query">
): void {
  if (
    !CombinedGraphQLErrors.is(error) ||
    typeof globalThis.window === "undefined" ||
    // Skip only where sign-in forms self-surface their failures (double-
    // toast avoidance). The redirect-exemption predicate must NOT double as
    // the dispatch gate: gating on `isPublicAuthExemptPath` here would
    // invert the guard into "publish on public pages only", silently
    // disabling every mapped surface action (toasts /
    // PermissionDeniedFallback) across the whole authenticated app
    // (dashboard/profile/…). The dispatch gate stays login-only.
    globalThis.window.location.pathname.endsWith("/login") ||
    SELF_SURFACED_OPERATION_NAMES.has(operation.operationName ?? "") ||
    graphQLErrorActionListener === null
  ) {
    return;
  }

  const contextKind = inferContextKind(operation.query);
  const meta: GraphQLErrorActionMeta = { operationName: operation.operationName ?? "", contextKind };
  let publishedCount = 0;
  // Correlation ids ride the logger (dev/support channel) — they never render
  // on the surface (see `GraphQLErrorToastItem`).
  const correlationRequestIds: string[] = [];

  for (const item of error.errors) {
    const action = toMappedSurfaceAction(item, contextKind);
    if (action === null) continue; // auth row / no mapping row → behavior unchanged

    if (typeof action.correlationRequestId === "string") correlationRequestIds.push(action.correlationRequestId);

    try {
      graphQLErrorActionListener(action, meta);
      publishedCount += 1;
    } catch (listenerError) {
      logErrorSurfaceEvent("surface listener threw", {
        operationName: meta.operationName,
        code: action.messageKey,
        errorName: listenerError instanceof Error ? listenerError.name : "unknown",
      });
    }

    // The row's `redirectTo` payload is honored HERE — the established seam
    // consumer — AFTER the surface publish so the localized copy gets first
    // crack (navigation itself is asynchronous). A listener failure never
    // blocks the navigation: the denial is real regardless of UI health.
    honorActionRedirectTo(action, meta);
  }

  if (publishedCount > 0) {
    logErrorSurfaceEvent("mapped GraphQL errors surfaced", {
      operationName: meta.operationName,
      contextKind,
      publishedCount,
      totalItems: error.errors.length,
      ...(correlationRequestIds.length > 0 ? { correlationRequestIds } : {}),
    });
  }
}
