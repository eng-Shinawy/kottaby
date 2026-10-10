/**
 * Same-origin gate for cookie-authenticated GraphQL POSTs (CSRF defense).
 *
 * Threat model: the gateway authenticates browser sessions with cookies, so
 * a page on ANY other origin can make the victim's browser fire a POST to
 * `/api/graphql` carrying the victim's ambient credentials. Modern browsers
 * attach `Origin` to all cross-site POSTs and `Sec-Fetch-Site` to every
 * fetch, and neither header is forgeable from page script — so together
 * they form a trustworthy browser-origin signal. Non-browser clients
 * (server-to-server Bearer-token callers, CLI tools) send NEITHER header and
 * cannot be CSRF principals at all.
 *
 * Decision ladder (pure header evaluation — identity-blind and
 * pre-authorization: no context, no session, no permission state is read):
 *
 *  1. `Origin` PRESENT:
 *     - equal to the request's own origin → pass (the honest same-origin
 *       browser case);
 *     - a `space-z.ai` / `*.space-z.ai` preview-panel origin → pass
 *       (sanctioned tooling; validated by URL parsing so look-alike hosts
 *       such as `space-z.ai.attacker.com` fail closed);
 *     - an origin in the WebSocket handshake allowlist → pass (sanctioned
 *       browser clients already trusted for the credentialed WS channel);
 *     - anything else → reject (including the literal string `null`, an
 *       empty value, malformed URLs, and same-host port variants — an origin
 *       is scheme+host+port, and a different port is a different origin).
 *  2. `Origin` ABSENT (every non-browser client, and browsers on same-origin
 *     fetches in some configurations): the request can only be
 *     browser-driven if `Sec-Fetch-Site` says so — `same-origin` or `none`
 *     pass, an absent `Sec-Fetch-Site` passes (non-browser clients), and
 *     any cross-site verdict (`cross-site`, `same-site`) rejects.
 *
 * The failure arm carries the machine kind ONLY — the raw header value never
 * crosses the result boundary; localization and envelope shaping happen
 * downstream in the route.
 */

import type { NextRequest } from "next/server";
import { isAllowedSpaceZOrigin } from "@/app/api/graphql/space-z-cors";
import { getWebSocketAllowedOrigins } from "@/backend/lib/env";

/**
 * Result contract for the same-origin POST gate. Mirrors the transport
 * guards' result-union discipline: narrowing on `ok`, failure arm carries
 * only the machine kind.
 */
export type OriginGuardResult =
  | {
      /** Discriminant — request origin is trusted; the pipeline may proceed. */
      readonly ok: true;
    }
  | {
      /** Discriminant — request origin is not trusted; the route must short-circuit. */
      readonly ok: false;
      /** Machine-readable rejection kind (wire-mapped to HTTP 403 by the route). */
      readonly kind: "CROSS_ORIGIN_REJECTED";
    };

/**
 * Evaluates whether a GraphQL POST is same-origin (or carries an explicitly
 * allow-listed origin). Pure function of the request headers — no I/O, no
 * mutable module state, safe under concurrent invocation.
 */
export function assertGraphqlPostOrigin(request: NextRequest): OriginGuardResult {
  const origin = request.headers.get("origin");

  if (origin === null) {
    const secFetchSite = request.headers.get("sec-fetch-site");
    if (secFetchSite === null || secFetchSite === "same-origin" || secFetchSite === "none") {
      return { ok: true };
    }
    return { ok: false, kind: "CROSS_ORIGIN_REJECTED" };
  }

  if (origin === request.nextUrl.origin) {
    return { ok: true };
  }
  if (isAllowedSpaceZOrigin(origin)) {
    return { ok: true };
  }
  if (getWebSocketAllowedOrigins().includes(origin)) {
    return { ok: true };
  }
  return { ok: false, kind: "CROSS_ORIGIN_REJECTED" };
}
