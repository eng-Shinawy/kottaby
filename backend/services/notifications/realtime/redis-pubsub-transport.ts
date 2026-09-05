/**
 * RedisPubSubTransport — Redis pub/sub adapter for notification fan-out.
 *
 * Publishes one JSON envelope (`{ userIds, payload }`) per fan-out call on the
 * fixed channel `kottaby:notifications:fanout`; the subscribe side is the
 * symmetric counterpart used by the WebSocket sidecar. Every received message
 * passes a strict runtime shape guard BEFORE the listener is invoked —
 * malformed envelopes are dropped with a single structured warn and never
 * crash the subscription loop.
 *
 * The Redis client is an injected minimal port (`RedisFanoutClient`): the
 * adapter performs no client construction, holds no connection state, and
 * carries no module-level mutable state. Publish failures reject unchanged
 * (clean throw) so the engine can degrade to persisted-only delivery.
 */
import { isNotificationType } from "@/backend/enum/notifications";
import { logger } from "@/backend/lib/logger";
import type {
  FanoutListener,
  FanoutSubscription,
  NotificationFanoutSubscriptionSource,
  NotificationFanoutTransport,
} from "@/backend/services/notifications/realtime/fanout-transport";
import type { RealtimeNotificationPayload } from "@/backend/types";

/** Fixed pub/sub channel every fan-out envelope travels on. */
export const NOTIFICATIONS_FANOUT_CHANNEL = "kottaby:notifications:fanout";

/** The JSON envelope that crosses the bus. */
export interface FanoutEnvelope {
  readonly userIds: readonly number[];
  readonly payload: RealtimeNotificationPayload;
}

/**
 * Minimal injectable Redis client port (publish/subscribe commands only).
 *
 * Mirrors the adapter conventions of `backend/services/redis/README.md`: the
 * transport never constructs a client — callers inject one (the selection
 * factory builds the default ioredis-backed implementation).
 */
export interface RedisFanoutClient {
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(channel: string, onMessage: (message: string) => void): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  close(): Promise<void>;
}

export class RedisPubSubTransport implements NotificationFanoutTransport, NotificationFanoutSubscriptionSource {
  constructor(private readonly client: RedisFanoutClient) {}

  /**
   * Publishes the envelope on the fixed channel. An empty recipient list is a
   * no-op (nothing to fan out — no bus traffic). Client failures reject
   * unchanged: degradation is the engine's concern, never the transport's.
   */
  async publishFanout(userIds: readonly number[], payload: RealtimeNotificationPayload): Promise<void> {
    if (userIds.length === 0) {
      return;
    }
    const envelope: FanoutEnvelope = { userIds: [...userIds], payload: projectFanoutPayload(payload) };
    await this.client.publish(NOTIFICATIONS_FANOUT_CHANNEL, JSON.stringify(envelope));
  }

  /**
   * Subscribes the fixed channel on the injected client. Every message passes
   * {@link parseFanoutEnvelope} before the listener runs: malformed envelopes
   * are dropped with a structured warn; a throwing listener is logged and
   * dropped — the subscription loop never crashes either way.
   */
  async subscribeFanout(listener: FanoutListener): Promise<FanoutSubscription> {
    await this.client.subscribe(NOTIFICATIONS_FANOUT_CHANNEL, message => {
      const envelope = parseFanoutEnvelope(message);
      if (envelope === null) {
        logger.logDomainError("Realtime fan-out envelope dropped by the runtime shape guard", {
          code: "NOTIFICATION_FANOUT_ENVELOPE_INVALID",
          entity: "notifications",
        });
        return;
      }
      try {
        listener(envelope.userIds, envelope.payload);
      } catch (error) {
        logger.logDomainError("Realtime fan-out subscriber listener threw while delivering an envelope", {
          code: "NOTIFICATION_FANOUT_LISTENER_ERROR",
          entity: "notifications",
          errorName: error instanceof Error ? error.name : "unknown",
        });
      }
    });
    return {
      unsubscribe: async () => {
        await this.client.unsubscribe(NOTIFICATIONS_FANOUT_CHANNEL);
      },
    };
  }
}

/** Structural allowlist of the envelope's top-level keys. */
const ENVELOPE_KEYS: readonly string[] = ["userIds", "payload"];

/** Structural allowlist of the realtime payload's keys. */
const PAYLOAD_KEYS: readonly string[] = ["v", "kind", "data"];

/** Structural allowlist of the payload's data projection. */
const PAYLOAD_DATA_KEYS: readonly string[] = [
  "id",
  "type",
  "title",
  "body",
  "relatedEntityType",
  "relatedEntityId",
  "createdAt",
];

/**
 * Projects the payload onto the exact allowlisted field set so nothing beyond
 * the realtime contract can ever cross the bus — even if a caller smuggled
 * extra properties past the compile-time type.
 *
 * Exported for the WebSocket sidecar's egress path (2.8): the subscribe side
 * projects again before writing to a socket, so the allowlist holds on BOTH
 * bus mediums — including the in-process tap, which delivers objects without
 * serialization.
 */
export function projectFanoutPayload(payload: RealtimeNotificationPayload): RealtimeNotificationPayload {
  return {
    v: payload.v,
    kind: payload.kind,
    data: {
      id: payload.data.id,
      type: payload.data.type,
      title: payload.data.title,
      body: payload.data.body,
      relatedEntityType: payload.data.relatedEntityType,
      relatedEntityId: payload.data.relatedEntityId,
      createdAt: payload.data.createdAt,
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True only when `value` carries EXACTLY `keys` as its own properties. */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  if (Object.keys(value).length !== keys.length) {
    return false;
  }
  return keys.every(key => Object.hasOwn(value, key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Runtime shape guard for one raw bus message (the subscriber-side integrity
 * gate). Returns the typed envelope, or `null` for ANY malformed input —
 * non-JSON, wrong shape, extra or missing keys, non-positive ids, foreign
 * notification types, unparseable timestamps — so callers drop-and-warn
 * instead of crashing. Valid envelopes come back with `createdAt` revived to
 * a `Date`, matching the in-memory payload type exactly.
 */
export function parseFanoutEnvelope(message: string): FanoutEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || !hasExactKeys(parsed, ENVELOPE_KEYS)) {
    return null;
  }
  const { userIds, payload } = parsed;
  if (!Array.isArray(userIds)) {
    return null;
  }
  const recipientIds = userIds.filter(isPositiveSafeInteger);
  if (recipientIds.length === 0 || recipientIds.length !== userIds.length) {
    return null;
  }
  if (!isPlainObject(payload) || !hasExactKeys(payload, PAYLOAD_KEYS)) {
    return null;
  }
  const { v, kind, data } = payload;
  if (v !== 1 || kind !== "notification") {
    return null;
  }
  if (!isPlainObject(data) || !hasExactKeys(data, PAYLOAD_DATA_KEYS)) {
    return null;
  }
  if (!isPositiveSafeInteger(data.id) || !isNotificationType(data.type) || typeof data.title !== "string") {
    return null;
  }
  if (typeof data.body !== "string" && data.body !== null) {
    return null;
  }
  if (typeof data.relatedEntityType !== "string" && data.relatedEntityType !== null) {
    return null;
  }
  if (!isPositiveSafeInteger(data.relatedEntityId) && data.relatedEntityId !== null) {
    return null;
  }
  if (typeof data.createdAt !== "string" || Number.isNaN(Date.parse(data.createdAt))) {
    return null;
  }
  return {
    userIds: recipientIds,
    payload: {
      v: 1,
      kind: "notification",
      data: {
        id: data.id,
        type: data.type,
        title: data.title,
        body: data.body,
        relatedEntityType: data.relatedEntityType,
        relatedEntityId: data.relatedEntityId,
        createdAt: new Date(data.createdAt),
      },
    },
  };
}
