/**
 * Transport-tier rejection builder for the `/api/graphql` gateway — extracted
 * verbatim from `app/api/graphql/route.ts` (oversized-file split). This module
 * owns the EXHAUSTIVE kind→wire mapping and the guarded rejection envelope
 * builder; the route only composes it. Behavior is unchanged from the
 * pre-extraction route.
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
 *    kind→code row).
 *
 * Rejection BODIES keep the GraphQL-over-HTTP transport shape
 * `{errors:[{message, extensions:{code,requestId}}]}` — the documented
 * exemption row in docs/graphql/error-handling-contract.md §envelopes. They
 * are NEVER converted to the REST envelope on this route (canonical doc row:
 * `/api/graphql` stays transport-local).
 */
interface TransportWireSpec {
  readonly status: 400 | 405 | 413;
  /** Transport-tier code — not a domain taxonomy code. */
  readonly code: "BAD_REQUEST" | "GRAPHQL_PARSE_FAILED" | "PAYLOAD_TOO_LARGE";
  /** RFC 9110 — a 405 MUST identify the methods the resource supports. */
  readonly allowPost: boolean;
}

/** THE single kind→wire mapping site (frozen; exhaustive over the union). */
const TRANSPORT_WIRE_MAP: Record<TransportErrorKind, TransportWireSpec> = {
  METHOD_NOT_ALLOWED: { status: 405, code: "BAD_REQUEST", allowPost: true },
  UNSUPPORTED_CONTENT_TYPE: { status: 400, code: "BAD_REQUEST", allowPost: false },
  PAYLOAD_TOO_LARGE: { status: 413, code: "PAYLOAD_TOO_LARGE", allowPost: false },
  MALFORMED_JSON: { status: 400, code: "GRAPHQL_PARSE_FAILED", allowPost: false },
};

/**
 * Builds the guarded rejection response for one transport failure: the
 * machine kind is mapped through {@link TRANSPORT_WIRE_MAP}, correlation is
 * resolved ONCE via the shared `resolveRequestId(request.headers)` (identical
 * pure function the context factory composes — mirrored ids by construction),
 * and the message localizes through the compile-time i18n `errors` namespace
 * of the request locale (the canonical `badRequest` key).
 *
 * ZERO resolvers, ZERO engine, ZERO context construction happen here — the
 * caller returns this response immediately.
 */
export function transportRejectionResponse(kind: TransportErrorKind, request: NextRequest): NextResponse {
  const spec = TRANSPORT_WIRE_MAP[kind];
  const localizedMessage = getServerTranslations(extractLocale(request)).errorsTranslations.badRequest;
  const requestId = resolveRequestId(request.headers);
  return NextResponse.json(
    { errors: [{ message: localizedMessage, extensions: { code: spec.code, requestId } }] },
    {
      status: spec.status,
      headers: spec.allowPost ? { Allow: "POST" } : undefined,
    }
  );
}
