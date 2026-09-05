/**
 * `fanout-transport.ts` port module — structural conformance suite.
 *
 * Pins the port contracts to their intended implementors:
 *  - `NotificationFanoutTransport` is publish-only, so the journey layer's
 *    `SpiedFanoutTransport` (a pure publish recorder) satisfies it without
 *    modification — the structural promise the journey harness was built on.
 *  - Both real adapters satisfy the publish port AND the symmetric
 *    subscription source port, driven through port-typed references only.
 *
 * Pure structural tier — NO network, NO Redis, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts <path>`.
 */
import { describe, expect, test } from "bun:test";
import type {
  NotificationFanoutSubscriptionSource,
  NotificationFanoutTransport,
} from "@/backend/services/notifications/realtime/fanout-transport";
import { InProcessTransport } from "@/backend/services/notifications/realtime/in-process-transport";
import {
  type RedisFanoutClient,
  RedisPubSubTransport,
} from "@/backend/services/notifications/realtime/redis-pubsub-transport";
import type { RealtimeNotificationPayload } from "@/backend/types";
import { SpiedFanoutTransport } from "@/test/workflows/helpers/spied-transport";

function makePayload(): RealtimeNotificationPayload {
  return {
    v: 1,
    kind: "notification",
    data: {
      id: 42,
      type: "session_request",
      title: "New session request",
      body: "A student requested a session.",
      relatedEntityType: "session",
      relatedEntityId: 4242,
      createdAt: new Date("2026-08-29T12:00:00.000Z"),
    },
  };
}

/** Redis client double that swallows every command (structure-only pinning). */
const inertRedisClient: RedisFanoutClient = {
  publish: () => Promise.resolve(1),
  subscribe: () => Promise.resolve(1),
  unsubscribe: () => Promise.resolve(1),
  close: () => Promise.resolve(),
};

describe("NotificationFanoutTransport port — structural conformance", () => {
  test("the journey layer's SpiedFanoutTransport satisfies the publish port untouched", async () => {
    const spy = new SpiedFanoutTransport();
    // Compile-time pin: the spy assigns to the port with zero modification.
    const transport: NotificationFanoutTransport = spy;
    const payload = makePayload();

    await transport.publishFanout([7, 11], payload);

    expect(spy.publishCount).toBe(1);
    expect(spy.lastCall?.userIds).toEqual([7, 11]);
    expect(spy.lastCall?.payload).toEqual(payload);
  });

  test("InProcessTransport satisfies the publish port and the subscription source port", async () => {
    const instance = new InProcessTransport();
    const transport: NotificationFanoutTransport = instance;
    const subscriptionSource: NotificationFanoutSubscriptionSource = instance;
    const received: Array<readonly number[]> = [];

    const subscription = await subscriptionSource.subscribeFanout(userIds => {
      received.push(userIds);
    });
    await transport.publishFanout([3], makePayload());
    await subscription.unsubscribe();

    expect(received).toEqual([[3]]);
  });

  test("RedisPubSubTransport satisfies the publish port and the subscription source port", async () => {
    const instance = new RedisPubSubTransport(inertRedisClient);
    const transport: NotificationFanoutTransport = instance;
    const subscriptionSource: NotificationFanoutSubscriptionSource = instance;

    await transport.publishFanout([5], makePayload());
    const subscription = await subscriptionSource.subscribeFanout(() => {});
    await subscription.unsubscribe();

    expect(subscription).toBeDefined();
  });
});
