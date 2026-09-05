import { NotificationType } from "@/frontend/graphql/generated/gql/graphql";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";

/**
 * Pure helpers for `useNotificationRealtime` (see the hook module for the
 * full REQ lifecycle contract): sidecar URL resolution, the reconnect
 * backoff curve, the REQ-021 frame shape guard, and the payload-type mapping
 * tables shared by the Apollo cache merge and the toast label lookup.
 */

/** First reconnect delay before doubling (REQ-025: 1s base). */
const RECONNECT_BASE_DELAY_MS = 1000;

/** Backoff curve cap (REQ-025: 30s). */
const RECONNECT_MAX_DELAY_MS = 30000;

/** Jitter fraction applied around the curve value (±20%). */
const RECONNECT_JITTER_RATIO = 0.2;

/** Sidecar close codes that ABORT retrying (2.8 BINDING vocabulary). */
export const CLOSE_CODE_UNAUTHENTICATED = 4401;
export const CLOSE_CODE_SUPERSEDED = 4009;

/** Deterministic unmount close (REQ-067). */
export const CLOSE_CODE_NORMAL = 1000;

/** Bounded in-memory dedupe window for recently seen notification ids. */
export const RECENT_ID_LIMIT = 200;

/** Concurrent realtime toasts kept visible (matches GraphQLErrorSurfaceHost). */
export const MAX_CONCURRENT_TOASTS = 3;

/**
 * Dev/test default sidecar port — matches `WS_PORT`'s registered dev default
 * in `backend/lib/env.ts`. Deliberately distinct from the Next.js dev server
 * port range (3000/3001): deriving the socket URL from the app host with a
 * port shared by the dev server would send every handshake to the Next.js
 * HTTP server, which closes it before the upgrade (silent reconnect storm).
 * Production deploys override the full URL via `NEXT_PUBLIC_NOTIFICATION_WS_URL`
 * (D3 owns provisioning).
 */
const DEFAULT_NOTIFICATION_WS_PORT = 3101;

/**
 * Resolves the notification sidecar URL.
 *
 * 1. `NEXT_PUBLIC_NOTIFICATION_WS_URL` (inlined by Next.js) wins when set —
 *    production points it at the `wss://` edge that proxies the sidecar.
 * 2. Otherwise the URL is derived from the app origin's HOST with the
 *    sidecar's default dev port: cookies are scoped by host (ports never
 *    participate), so `ws://<app-host>:3101` keeps the httpOnly
 *    `access_token` cookie riding the handshake as a same-site request.
 */
export function resolveNotificationWsUrl(): string {
  const configured = process.env.NEXT_PUBLIC_NOTIFICATION_WS_URL;
  if (typeof configured === "string" && configured.trim() !== "") {
    return configured.trim();
  }
  if (typeof window === "undefined") {
    return `ws://127.0.0.1:${DEFAULT_NOTIFICATION_WS_PORT}`;
  }
  const { hostname, protocol } = window.location;
  if (hostname !== "") {
    const scheme = protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${hostname}:${DEFAULT_NOTIFICATION_WS_PORT}`;
  }
  return `ws://127.0.0.1:${DEFAULT_NOTIFICATION_WS_PORT}`;
}

/**
 * Reconnect delay for the given (zero-based) attempt with jitter.
 *
 * Pure and injectable-random so the curve (1s → 2s → 4s … cap 30s, ±20%
 * jitter) is deterministically unit-testable.
 */
export function getNotificationReconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, attempt), RECONNECT_MAX_DELAY_MS);
  const jitterSpan = base * RECONNECT_JITTER_RATIO;
  return Math.round(base + (random() * 2 - 1) * jitterSpan);
}

/**
 * `RealtimeNotificationPayload` wire frame — the frontend's structural view
 * of the REQ-021 envelope (the canonical type lives in `backend/types`,
 * which the frontend layer never imports). `id` arrives as the DB row id
 * (JSON number); `type` arrives as the BACKEND enum value (snake_case) —
 * both are reconciled before touching the Apollo cache, which keys
 * `Notification` rows by STRING ids and stores the GraphQL wire enum name.
 */
interface RealtimeNotificationFrameData {
  readonly id: number | string;
  readonly type: string;
  readonly title: string;
  readonly body: string | null;
  readonly relatedEntityType: string | null;
  readonly relatedEntityId: number | null;
  readonly createdAt: string;
}

interface RealtimeNotificationFrame {
  readonly v: 1;
  readonly kind: "notification";
  readonly data: RealtimeNotificationFrameData;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Runtime shape guard for the REQ-021 envelope — fail-closed on any
 * malformed frame (wrong version, foreign kind, missing/ill-typed field).
 */
export function isRealtimeNotificationFrame(value: unknown): value is RealtimeNotificationFrame {
  if (!isRecord(value) || value.v !== 1 || value.kind !== "notification") {
    return false;
  }
  const data = value.data;
  if (!isRecord(data)) {
    return false;
  }
  if (typeof data.id !== "number" && typeof data.id !== "string") {
    return false;
  }
  return (
    typeof data.type === "string" &&
    typeof data.title === "string" &&
    (typeof data.body === "string" || data.body === null) &&
    (typeof data.relatedEntityType === "string" || data.relatedEntityType === null) &&
    (typeof data.relatedEntityId === "number" || data.relatedEntityId === null) &&
    typeof data.createdAt === "string"
  );
}

/**
 * WS payload type (backend snake_case value) → codegen `NotificationType`
 * member (whose values ARE the GraphQL wire names the cache stores).
 * `undefined` models the runtime miss for an unknown payload type.
 */
export const PAYLOAD_TYPE_TO_CACHE_TYPE: Readonly<Record<string, NotificationType | undefined>> = {
  session_request: NotificationType.SessionRequest,
  session_completion: NotificationType.SessionCompletion,
  session_cancellation: NotificationType.SessionCancellation,
  parent_link_request: NotificationType.ParentLinkRequest,
  system_broadcast: NotificationType.SystemBroadcast,
  payment_confirmation: NotificationType.PaymentConfirmation,
  evaluation_result: NotificationType.EvaluationResult,
};

/**
 * WS payload type → localized display label accessor (enum-handle property
 * access on the `notifications` namespace — never call-by-key).
 * `undefined` models the runtime miss for an unknown payload type.
 */
export const PAYLOAD_TYPE_TO_LABEL: Readonly<Record<string, ((labels: NotificationsLabels) => string) | undefined>> = {
  session_request: labels => labels.typeSessionRequest,
  session_completion: labels => labels.typeSessionCompletion,
  session_cancellation: labels => labels.typeSessionCancellation,
  parent_link_request: labels => labels.typeParentLinkRequest,
  system_broadcast: labels => labels.typeSystemBroadcast,
  payment_confirmation: labels => labels.typePaymentConfirmation,
  evaluation_result: labels => labels.typeEvaluationResult,
};

/**
 * GraphQL wire enum name (what a cached `myNotifications` filter argument
 * stores) → WS payload type. Keeps list-variant filter matching in the
 * plain-string domain.
 */
export const GRAPHQL_TYPE_NAME_TO_PAYLOAD_TYPE: Readonly<Record<string, string>> = {
  SessionRequest: "session_request",
  SessionCompletion: "session_completion",
  SessionCancellation: "session_cancellation",
  ParentLinkRequest: "parent_link_request",
  SystemBroadcast: "system_broadcast",
  PaymentConfirmation: "payment_confirmation",
  EvaluationResult: "evaluation_result",
};
