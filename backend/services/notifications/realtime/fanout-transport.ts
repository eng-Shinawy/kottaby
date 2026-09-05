/**
 * Fan-out transport port — the seam between the notification engine and the
 * realtime delivery backplane.
 *
 * The engine persists the inbox row(s) first and only then publishes the
 * realtime payload through this port; whether the backplane is an in-process
 * tap or a Redis pub/sub bus is invisible to the engine. The publish port is
 * intentionally publish-only: spies and recording doubles that merely observe
 * publishes satisfy it structurally without modification (the journey
 * harness's `SpiedFanoutTransport` depends on exactly that).
 *
 * The subscriber side (the WebSocket sidecar's tap) is the symmetric
 * counterpart declared here as `NotificationFanoutSubscriptionSource`. It is
 * a SEPARATE interface on purpose — widening the publish port with subscribe
 * members would break publish-only implementors.
 */
import type { RealtimeNotificationPayload } from "@/backend/types";

/**
 * Publish-side port: fan one realtime notification payload out to a batch of
 * recipient user ids.
 *
 * Implementations MUST resolve on successful hand-off to the backplane and
 * reject when the backplane is unreachable — delivery degradation (log +
 * persisted-inbox-only) is the ENGINE's concern, never the transport's.
 */
export interface NotificationFanoutTransport {
  publishFanout(userIds: readonly number[], payload: RealtimeNotificationPayload): Promise<void>;
}

/**
 * Subscriber callback invoked for every fan-out envelope that survives the
 * transport's runtime shape guard. Receives the envelope's recipient ids and
 * the realtime payload.
 */
export type FanoutListener = (userIds: readonly number[], payload: RealtimeNotificationPayload) => void;

/** Handle for one registered fan-out subscription. */
export interface FanoutSubscription {
  /** Removes the subscription; safe to call more than once. */
  unsubscribe(): Promise<void>;
}

/**
 * Subscribe-side port: the WebSocket sidecar's symmetric counterpart to
 * {@link NotificationFanoutTransport}.
 *
 * Every envelope is validated by a runtime shape guard BEFORE the listener is
 * invoked; malformed envelopes are dropped with a structured warn and never
 * crash the subscription loop.
 */
export interface NotificationFanoutSubscriptionSource {
  subscribeFanout(listener: FanoutListener): Promise<FanoutSubscription>;
}
