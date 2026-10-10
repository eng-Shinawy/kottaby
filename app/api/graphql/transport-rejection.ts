/**
 * Transport-tier rejection builder for the `/api/graphql` gateway. This
 * module owns the EXHAUSTIVE kind→wire mapping and the guarded rejection
 * envelope builder; the route only composes it. Every transport failure
 * kind maps to its wire pairing — HTTP status, transport-tier error code,
 * and `Allow: POST` presence — plus the localized-message key; the
 * builder resolves the request locale once and selects the message from
 * the compile-time i18n `errors` namespace per kind (request-shape
 * failures localize through `badRequest`, access-refusals through
 * `forbidden`).
 *
 * The `@/backend/graphql/gqlContextFactory` specifier string MUST stay
 * verbatim: the pipeline-order suite's `mock.module` registry shadows this
 * exact specifier (`extractLocale`) when the route graph is imported there.
 */

import { type NextRequest, NextResponse } from "next/server";
import { extractLocale } from "@/backend/graphql/gqlContextFactory";
import { resolveRequestId } from "@/backend/lib/api";
import type { TransportErrorKind } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

// ─── Transport tier — guarded rejection mapping ─────────────────────────────

/**
 * Kind→wire mapping for transport-guard failures:
 *
 *  - `METHOD_NOT_ALLOWED`        → HTTP **405** + `Allow: POST`, code `BAD_REQUEST`;
 *  - `UNSUPPORTED_CONTENT_TYPE`  → HTTP **400**, code `BAD_REQUEST`;
 *  - `PAYLOAD_TOO_LARGE`         → HTTP **413**, code `PAYLOAD_TOO_LARGE`;
 *  - `MALFORMED_JSON`            → HTTP **400**, code `GRAPHQL_PARSE_FAILED`
 *    (both unparsable bodies and mid-read stream deaths ride this same
 *    kind→code row);
 *  - `CROSS_ORIGIN_REJECTED`  → HTTP **403**, code `FORBIDDEN` (localized
 *    `forbidden` — an origin denial is an access refusal, not a
 *    request-shape error);
 *  - `BATCH_OPERATION_LIMIT`  → HTTP **400**, code `BATCH_OPERATION_LIMIT`
 *    (an over-cap operation array is a malformed request shape).
 *
 * Rejection BODIES keep the GraphQL-over-HTTP transport shape
 * `{errors:[{message, extensions:{code,requestId}}]}` — the documented
 * exemption row in docs/graphql/error-handling-contract.md §envelopes. They
 * are NEVER converted to the REST envelope on this route (canonical doc row:
 * `/api/graphql` stays transport-local).
 */
interface TransportWireSpec {
  readonly status: 400 | 403 | 405 | 413;
  /** Transport-tier code — not a domain taxonomy code. */
  readonly code: "BAD_REQUEST" | "GRAPHQL_PARSE_FAILED" | "PAYLOAD_TOO_LARGE" | "FORBIDDEN" | "BATCH_OPERATION_LIMIT";
  /** RFC 9110 — a 405 MUST identify the methods the resource supports. */
  readonly allowPost: boolean;
  /** `errorsTranslations` key the localized message is drawn from. */
  readonly messageKey: "badRequest" | "forbidden";
}

/** THE single kind→wire mapping site (frozen; exhaustive over the union). */
const TRANSPORT_WIRE_MAP: Record<TransportErrorKind, TransportWireSpec> = {
  METHOD_NOT_ALLOWED: { status: 405, code: "BAD_REQUEST", allowPost: true, messageKey: "badRequest" },
  UNSUPPORTED_CONTENT_TYPE: { status: 400, code: "BAD_REQUEST", allowPost: false, messageKey: "badRequest" },
  PAYLOAD_TOO_LARGE: { status: 413, code: "PAYLOAD_TOO_LARGE", allowPost: false, messageKey: "badRequest" },
  MALFORMED_JSON: { status: 400, code: "GRAPHQL_PARSE_FAILED", allowPost: false, messageKey: "badRequest" },
  CROSS_ORIGIN_REJECTED: { status: 403, code: "FORBIDDEN", allowPost: false, messageKey: "forbidden" },
  BATCH_OPERATION_LIMIT: { status: 400, code: "BATCH_OPERATION_LIMIT", allowPost: false, messageKey: "badRequest" },
};

/**
 * Builds the guarded rejection response for one transport failure: the
 * machine kind is mapped through {@link TRANSPORT_WIRE_MAP}, correlation is
 * resolved ONCE via the shared `resolveRequestId(request.headers)` (identical
 * pure function the context factory composes — mirrored ids by construction),
 * and the message localizes through the compile-time i18n `errors` namespace
 * of the request locale (per-kind key: `badRequest` for request-shape
 * failures, `forbidden` for cross-origin rejections).
 *
 * ZERO resolvers, ZERO engine, ZERO context construction happen here — the
 * caller returns this response immediately.
 */
export function transportRejectionResponse(kind: TransportErrorKind, request: NextRequest): NextResponse {
  const spec = TRANSPORT_WIRE_MAP[kind];
  const { errorsTranslations } = getServerTranslations(extractLocale(request));
  const localizedMessage = errorsTranslations[spec.messageKey];
  const requestId = resolveRequestId(request.headers);
  return NextResponse.json(
    { errors: [{ message: localizedMessage, extensions: { code: spec.code, requestId } }] },
    {
      status: spec.status,
      headers: spec.allowPost ? { Allow: "POST" } : undefined,
    }
  );
}
