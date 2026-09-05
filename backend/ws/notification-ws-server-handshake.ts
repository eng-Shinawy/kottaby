/**
 * Notification WebSocket sidecar handshake pipeline. FIXED order (never
 * reorder — Origin first as the CSWSH defense):
 *   1. Origin allowlist (`WS_ALLOWED_ORIGINS`; missing or non-allowlisted →
 *      HTTP 403, the socket is never upgraded).
 *   2. Per-IP handshake token bucket (exhausted → policy close `4429`).
 *   3. `access_token` httpOnly cookie read (the ONLY identity source; query
 *      strings and every other header are never read — tokens in URLs leak
 *      into logs).
 *   4. `verifyAccessToken` (null on ANY failure → policy close `4401`);
 *      post-await re-check — shutdown begun mid-verify → policy close `1001`.
 *   5. `userId` from the verified token's `sub` claim (positive-int coerce).
 *   6. Upgrade; registration + cap enforcement happen atomically in open().
 */
import { randomUUID } from "node:crypto";
import { AUTH_COOKIE_NAMES, parseCookies } from "@/backend/lib/auth/cookies";
import { verifyAccessToken } from "@/backend/lib/auth/jwt";
import { logger } from "@/backend/lib/logger";
import { NOTIFICATION_WS_CLOSE_CODES } from "@/backend/ws/notification-ws-server-constants";
import type { NotificationWsRuntimeState, NotificationWsSocketData } from "@/backend/ws/notification-ws-server-state";
import type { NotificationWsHandshakeThrottle } from "@/backend/ws/notification-ws-server-throttle";

/** Dependencies the handshake pipeline needs from the booting server. */
export interface NotificationWsHandshakeContext {
  readonly allowedOrigins: ReadonlySet<string>;
  readonly throttle: NotificationWsHandshakeThrottle;
  readonly state: NotificationWsRuntimeState;
}

/** Socket data for a handshake that completed the pipeline but must policy-close. */
function rejectedSocket(reason: string, code: number): NotificationWsSocketData {
  return { connId: randomUUID(), userId: null, reject: { code, reason } };
}

/**
 * Upgrades a policy-rejected handshake: the socket completes the HTTP upgrade
 * and `open()` policy-closes it with `code`/`reason` (so the client observes
 * the close code on the wire). The plain HTTP `fallback` applies only when
 * the listener already refuses upgrades.
 */
function upgradeRejectedHandshake(
  request: Request,
  server: Bun.Server<NotificationWsSocketData>,
  reason: string,
  code: number,
  fallback: Response
): Response | undefined {
  return server.upgrade(request, { data: rejectedSocket(reason, code) }) ? undefined : fallback;
}

/** Runs the fixed-order handshake pipeline; upgrades or rejects the request. */
export async function handleNotificationWsHandshake(
  request: Request,
  server: Bun.Server<NotificationWsSocketData>,
  context: NotificationWsHandshakeContext
): Promise<Response | undefined> {
  const upgradeHeader = request.headers.get("upgrade");
  if (upgradeHeader?.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 426 });
  }

  // (1) Origin allowlist FIRST — the CSWSH defense. A missing or
  // non-allowlisted origin is rejected before the socket is ever
  // upgraded (fail-closed; no identity material is read).
  const origin = request.headers.get("origin");
  if (origin === null || !context.allowedOrigins.has(origin.trim().toLowerCase())) {
    logger.logDomainError("Notification WS handshake rejected", {
      code: "NOTIFICATION_WS_HANDSHAKE_REJECTED",
      entity: "notifications",
      reason: "origin",
    });
    return new Response("Forbidden", { status: 403 });
  }

  // (2) Per-IP handshake token bucket — fail-closed throttle (`4429`).
  const peer = server.requestIP(request);
  const ipKey = peer?.address ?? "unknown";
  if (!context.throttle.tryAcquire(ipKey)) {
    return upgradeRejectedHandshake(
      request,
      server,
      "throttled",
      NOTIFICATION_WS_CLOSE_CODES.throttled,
      new Response("Too Many Requests", { status: 429 })
    );
  }

  // (3) `access_token` httpOnly cookie — the ONLY identity source.
  const cookieHeader = request.headers.get("cookie");
  const token = parseCookies(cookieHeader)[AUTH_COOKIE_NAMES.accessToken] ?? "";
  if (token === "") {
    return upgradeRejectedHandshake(
      request,
      server,
      "unauthenticated",
      NOTIFICATION_WS_CLOSE_CODES.unauthenticated,
      new Response("Unauthorized", { status: 401 })
    );
  }

  // (4) Verify (null on ANY failure — invalid signature, expired, wrong
  // issuer/type, malformed — fail-closed `4401`).
  const payload = await verifyAccessToken(token);
  if (payload === null) {
    return upgradeRejectedHandshake(
      request,
      server,
      "unauthenticated",
      NOTIFICATION_WS_CLOSE_CODES.unauthenticated,
      new Response("Unauthorized", { status: 401 })
    );
  }

  // (4b) Post-await shutdown re-check (Wave D R3 F1r3): the verify await
  // is a suspension point — shutdown may have swept + cleared the
  // registry while the token verified. Do NOT register a fresh
  // connection into a drained server: upgrade + policy-close `1001` so
  // the client still observes the graceful shutdown code (a plain 503
  // only when the listener already stopped accepting upgrades).
  if (context.state.shuttingDown) {
    return upgradeRejectedHandshake(
      request,
      server,
      "server shutting down",
      NOTIFICATION_WS_CLOSE_CODES.shutdown,
      new Response("Service Unavailable", { status: 503 })
    );
  }

  // (5) userId from the verified `sub` claim (positive-int coerce — the
  // verifier already derives it; the sidecar re-asserts the invariant).
  const userId = payload.userId;
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return upgradeRejectedHandshake(
      request,
      server,
      "unauthenticated",
      NOTIFICATION_WS_CLOSE_CODES.unauthenticated,
      new Response("Unauthorized", { status: 401 })
    );
  }

  // (6) Upgrade; registration + cap enforcement happen atomically in open().
  if (server.upgrade(request, { data: { connId: randomUUID(), userId, reject: null } })) {
    return undefined;
  }
  return new Response("Upgrade failed", { status: 400 });
}
