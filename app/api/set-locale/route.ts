/**
 * Locale-switch API routes (`/api/set-locale`) using the shared API envelope.
 *
 * Envelope decision (an explicit adopt-or-exempt call per surface):
 *
 *  - **POST — ADOPTED.** Every JSON response uses the shared envelope:
 *    success `{ data, requestId }` via `apiSuccessResponse`, errors
 *    `{ error: { code, message, requestId } }` via `apiErrorResponse` with
 *    statuses derived EXCLUSIVELY through the error-code taxonomy map (no
 *    numeric error-status literals in this file). The correlation id is
 *    resolved ONCE per request through `resolveRequestId` (single mint
 *    source) and echoed on both envelope shapes.
 *  - **GET full-navigation switch — FORMALLY EXEMPT success body.** Success is
 *    a redirect (`Set-Cookie` + `Location`) so the browser lands on the next
 *    document with the cookie already applied; a JSON envelope cannot coexist
 *    with full-document navigation semantics. GET *error* branches stay fully
 *    enveloped.
 *  - **Future webhook routes** (e.g. WhatsApp provider verification GET /
 *    POST ack-reply-200 contracts) follow the same formal exemption policy —
 *    exempt provider-ack bodies while keeping correlated requests/logs.
 *
 * Canonical documentation path for the error-code/envelope contract and its
 * exemptions: `docs/graphql/domain-error-extensions-code.md`.
 *
 * Security posture preserved verbatim: intentionally public endpoint (locale
 * preference only), same-origin/allow-list origin gating unchanged,
 * open-redirect guard unchanged, cookie flags unchanged.
 */

import { type NextRequest, NextResponse } from "next/server";
import { ALLOWED_ORIGINS, resolveSafeOrigin, safeRedirectPath } from "@/app/api/set-locale/safe-redirect";
import { apiErrorResponse, apiSuccessResponse, resolveRequestId } from "@/backend/lib/api";
import { getEnvironmentConfig } from "@/backend/lib/env";
import { DomainError, ForbiddenError } from "@/backend/lib/errors";
import { type AppLocale, isAppLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const envConfig = getEnvironmentConfig();

const LOCALE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year

const LOCALE_COOKIE_NAME = "NEXT_LOCALE";
const LOCALE_COOKIE_PATH = "/";
const SET_COOKIE_HEADER = "set-cookie";

/**
 * Request-hygiene bound for the POST body — the transport-tier size cap.
 *
 * A locale payload is a tiny JSON object (`{ "locale": "en" }`); anything
 * beyond this budget is payload-bomb abuse, not a legitimate switch. Enforced
 * at TWO checkpoints (the dual-checkpoint mirror of
 * `backend/lib/gateway/transport-guard.ts`): the declared `content-length`
 * header BEFORE the stream is touched, then the drained text length (catches
 * lying small declared headers). TRANSPORT-tier constant — deliberately NOT a
 * domain taxonomy row.
 */
const MAX_SET_LOCALE_BODY_BYTES = 4_096;

/**
 * Canonical BAD_REQUEST carrier for client-contract violations. The HTTP
 * status is NOT declared here — `apiErrorResponse` derives it exclusively
 * from the error-code taxonomy map (`BAD_REQUEST` row).
 */
function badRequestError(message: string): DomainError {
  return new DomainError("BAD_REQUEST", message);
}

/** Structure accepted by the POST handler after narrowing. */
type SetLocaleBody = {
  readonly locale: AppLocale;
};

function isSetLocaleBody(value: unknown): value is SetLocaleBody {
  if (!value || typeof value !== "object" || !("locale" in value)) {
    return false;
  }
  const localeCandidate: unknown = value.locale;
  return typeof localeCandidate === "string" && isAppLocale(localeCandidate);
}

/**
 * Single source of the NEXT_LOCALE cookie wire format — attribute set is
 * byte-equivalent to the previous `NextResponse.cookies.set(...)` flags:
 * non-httpOnly so the cookie jar stays consistent across first-visit
 * defaults and explicit switch (this route); `Secure` only in production,
 * with the same plain-HTTP opt-out as the auth cookies
 * (`AUTH_COOKIE_SECURE=false` — HTTPS prod unchanged; the flag can only
 * DISABLE Secure, never force it on).
 * `locale` is whitelist-validated through {@link isAppLocale} before reaching
 * this builder — no unvalidated input can enter the Set-Cookie header.
 */
function nextLocaleSetCookieValue(locale: AppLocale): string {
  const attributes = [
    `${LOCALE_COOKIE_NAME}=${locale}`,
    `Path=${LOCALE_COOKIE_PATH}`,
    `Max-Age=${LOCALE_MAX_AGE}`,
    "SameSite=Lax",
  ];
  if (envConfig.nodeEnv === "production" && process.env.AUTH_COOKIE_SECURE !== "false") {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

/**
 * Applies the locale cookie to ANY response shape (the GET redirect and the
 * POST success envelope alike) without coupling either branch to a distinct
 * serialization path.
 */
function withLocaleCookie<T extends Response>(response: T, locale: AppLocale): T {
  response.headers.append(SET_COOKIE_HEADER, nextLocaleSetCookieValue(locale));
  return response;
}

function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const sameOrigin = request.nextUrl.origin;
  // Same-origin fetch always sends Origin; also allow Sec-Fetch-Site: same-origin when Origin is absent.
  if (origin && (origin === sameOrigin || ALLOWED_ORIGINS.has(origin))) {
    return true;
  }
  if (!origin && request.headers.get("sec-fetch-site") === "same-origin") {
    return true;
  }
  return false;
}

/**
 * Full-navigation locale switch: sets NEXT_LOCALE then redirects.
 * Prefer this over fetch + location.reload() so the cookie is applied on the
 * same response that loads the next document.
 */
function resolveLocaleFromRequest(request: NextRequest): string {
  return request.headers.get("accept-language")?.split(",")[0]?.split("-")[0] ?? "ar";
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = resolveRequestId(request.headers);
  const acceptLanguageLocale = resolveLocaleFromRequest(request);
  const tErrors = getServerTranslations(acceptLanguageLocale).errorsTranslations;

  try {
    const localeParam = request.nextUrl.searchParams.get("locale");
    if (!localeParam || !isAppLocale(localeParam)) {
      return apiErrorResponse(badRequestError(tErrors.invalidLocale), {
        locale: acceptLanguageLocale,
        requestId,
      });
    }

    const redirectPath = safeRedirectPath(request.nextUrl.searchParams.get("redirect"));
    const origin = resolveSafeOrigin(request);
    const response = NextResponse.redirect(new URL(redirectPath, origin));
    return withLocaleCookie(response, localeParam);
  } catch (error) {
    // Defense-in-depth parity with POST: an unexpected assembly fault must
    // still surface as the masked correlated envelope instead of an
    // unwrapped framework crash page.
    return apiErrorResponse(error, { locale: acceptLanguageLocale, requestId });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = resolveRequestId(request.headers);
  const acceptLanguageLocale = resolveLocaleFromRequest(request);
  const tErrors = getServerTranslations(acceptLanguageLocale).errorsTranslations;

  try {
    if (!isAllowedOrigin(request)) {
      return apiErrorResponse(new ForbiddenError(tErrors.invalidOrigin), {
        locale: acceptLanguageLocale,
        requestId,
      });
    }

    // Security Note: This endpoint is intentionally public.
    // Locale updates do not expose sensitive data or actions.
    // Session-independent cookie (NEXT_LOCALE) is used for locale preference.

    // Size checkpoint 1 — declared length (BEFORE the body stream is
    // touched). Live declared-length predicate mirroring the transport tier:
    // a missing/garbage header (`Number("")`-safe `?? "0"` + isFinite
    // pre-check) falls through to the drained-length checkpoint below
    // instead of rejecting.
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SET_LOCALE_BODY_BYTES) {
      return apiErrorResponse(badRequestError(tErrors.badRequest), {
        locale: acceptLanguageLocale,
        requestId,
      });
    }

    // Bounded drain: the stream is read exactly once, then measured
    // against the same cap (checkpoint 2 below).
    const rawBody = await request.text();

    // Size checkpoint 2 — drained length catches lying small declared
    // headers; the cap is unconditional (size wins over content).
    if (rawBody.length > MAX_SET_LOCALE_BODY_BYTES) {
      return apiErrorResponse(badRequestError(tErrors.badRequest), {
        locale: acceptLanguageLocale,
        requestId,
      });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch (parseError) {
      if (parseError instanceof SyntaxError) {
        // Malformed client JSON is a transport-class client fault → localized
        // HTTP-level BAD_REQUEST envelope BEFORE any domain handling (mirrors
        // the GraphQL preflight posture in app/api/graphql/route.ts).
        // Non-syntax read faults (dying stream / infra) fall through to the
        // single masked boundary hop below instead of lying about the class.
        return apiErrorResponse(badRequestError(tErrors.badRequest), {
          locale: acceptLanguageLocale,
          requestId,
        });
      }
      throw parseError;
    }

    if (!isSetLocaleBody(body)) {
      return apiErrorResponse(badRequestError(tErrors.invalidLocale), {
        locale: acceptLanguageLocale,
        requestId,
      });
    }

    const response = apiSuccessResponse({ locale: body.locale }, { requestId });
    return withLocaleCookie(response, body.locale);
  } catch (error) {
    // Masked INTERNAL_SERVER_ERROR hop: localized generic message,
    // `error.requestId` in the body, exactly one correlated redacted
    // logger.error carrying the SAME requestId.
    return apiErrorResponse(error, { locale: acceptLanguageLocale, requestId });
  }
}
