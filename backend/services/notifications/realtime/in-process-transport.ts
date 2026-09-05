/**
 * InProcessTransport — direct in-memory fan-out tap.
 *
 * The only transport legal in tests/harnesses and usable in single-process
 * dev: every publish is delivered synchronously to the listeners registered
 * on THIS instance (no network, no serialization). Cross-process fan-out
 * needs the Redis adapter instead.
 *
 * State discipline: the listener registry is instance-scoped copy-on-write
 * storage bounded by explicit `subscribeFanout` registrations — this adapter
 * carries no module-level mutable state.
 */

import type {
  FanoutListener,
  FanoutSubscription,
  NotificationFanoutSubscriptionSource,
  NotificationFanoutTransport,
} from "@/backend/services/notifications/realtime/fanout-transport";
import type { RealtimeNotificationPayload } from "@/backend/types";

export class InProcessTransport implements NotificationFanoutTransport, NotificationFanoutSubscriptionSource {
  /** Registered listeners (copy-on-write; bounded by explicit registrations). */
  private listeners: readonly FanoutListener[] = [];

  /**
   * Delivers the payload synchronously to every registered listener, in
   * registration order. An empty recipient list is a no-op (nothing to fan
   * out — no delivery at all). A listener that throws rejects this promise so
   * the publisher learns immediately, mirroring how a bus outage surfaces on
   * the publish side.
   */
  async publishFanout(userIds: readonly number[], payload: RealtimeNotificationPayload): Promise<void> {
    if (userIds.length === 0) {
      return;
    }
    for (const listener of this.listeners) {
      listener(userIds, payload);
    }
  }

  /**
   * Registers a tap. The subscription takes effect immediately (the returned
   * promise is already resolved) and removes itself on `unsubscribe()`.
   */
  subscribeFanout(listener: FanoutListener): Promise<FanoutSubscription> {
    this.listeners = [...this.listeners, listener];
    let active = true;
    return Promise.resolve({
      unsubscribe: () => {
        if (active) {
          active = false;
          this.listeners = this.listeners.filter(registered => registered !== listener);
        }
        return Promise.resolve();
      },
    });
  }
}
