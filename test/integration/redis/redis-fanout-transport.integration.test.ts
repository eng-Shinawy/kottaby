/**
 * Redis fan-out transport — live provider smoke (local Redis via the
 * registered `REDIS_URL` seam).
 *
 * Gating mechanism: a TCP reachability probe of the configured `REDIS_URL`
 * runs at module load (top-level await); when Redis is unreachable — or no
 * URL is configured — the whole suite skips via `describe.skipIf`, matching
 * the integration-tier convention that provider smokes skip cleanly when
 * their provider is not available. No new env keys are introduced: the probe
 * reads the registered `getRedisUrl()` seam only.
 *
 * One test per file (provider-smoke scope): the full adapter pair —
 * `IoredisFanoutClient` + `RedisPubSubTransport` — round-trips one envelope
 * over the live channel.
 */

import { describe, expect, test } from "bun:test";
import net from "node:net";
import { getRedisUrl } from "@/backend/lib/env";
import { IoredisFanoutClient } from "@/backend/services/notifications/realtime/ioredis-fanout-client";
import { RedisPubSubTransport } from "@/backend/services/notifications/realtime/redis-pubsub-transport";
import type { RealtimeNotificationPayload } from "@/backend/types";

/** TCP reachability probe of a redis:// URL (no commands, no data sent). */
function probeRedisReachable(url: string, timeoutMs = 500): Promise<boolean> {
  return new Promise(resolve => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    const port = Number.parseInt(parsed.port, 10) || 6379;
    const host = parsed.hostname || "127.0.0.1";
    const socket = net.createConnection({ host, port });
    const finish = (reachable: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function makePayload(): RealtimeNotificationPayload {
  return {
    v: 1,
    kind: "notification",
    data: {
      // Unique per run (epoch ms) — with a SHARED Redis database, unrelated
      // envelopes can cross this subscription on the same channel; the
      // receipt filter below keys on this identity.
      id: Date.now(),
      type: "evaluation_result",
      title: "Evaluation published",
      body: "Your evaluation is ready to view.",
      relatedEntityType: "evaluation",
      relatedEntityId: 3141,
      createdAt: new Date("2026-08-29T11:00:00.000Z"),
    },
  };
}

interface Receipt {
  readonly userIds: readonly number[];
  readonly payload: RealtimeNotificationPayload;
}

/** Recursive poll (the documented no-await-in-loop shape for sequential waits). */
async function waitForReceipt(receipts: Receipt[], deadline: number): Promise<void> {
  if (receipts.length > 0 || Date.now() >= deadline) {
    return;
  }
  await Bun.sleep(25);
  await waitForReceipt(receipts, deadline);
}

const redisUrl = getRedisUrl();
const redisReachable = redisUrl !== undefined && (await probeRedisReachable(redisUrl));

describe.skipIf(!redisReachable)("RedisPubSubTransport + IoredisFanoutClient @live-redis", () => {
  test("publish → subscribe round-trips one envelope over the live channel", async () => {
    if (redisUrl === undefined) {
      throw new Error("unreachable: this suite is gated on a configured REDIS_URL");
    }

    const client = new IoredisFanoutClient(redisUrl);
    const transport = new RedisPubSubTransport(client);
    const receipts: Receipt[] = [];
    let subscription: Awaited<ReturnType<typeof transport.subscribeFanout>> | undefined;
    const payload = makePayload();
    try {
      subscription = await transport.subscribeFanout((userIds, received) => {
        // Shared-Redis guard: record ONLY this run's envelope (keyed on the
        // unique payload id) so unrelated channel traffic cannot satisfy
        // waitForReceipt or pollute the length/payload assertions.
        if (received.data.id === payload.data.id) {
          receipts.push({ userIds, payload: received });
        }
      });

      await transport.publishFanout([314], payload);
      await waitForReceipt(receipts, Date.now() + 5000);

      expect(receipts).toHaveLength(1);
      expect(receipts[0]?.userIds).toEqual([314]);
      expect(receipts[0]?.payload).toEqual(payload);
    } finally {
      // Release Redis resources on EVERY path (subscribe/publish/poll/assert
      // failures) — an open subscription or client would keep the worker
      // alive until the CI timeout. client.close() must run even when
      // unsubscribe() itself fails.
      try {
        await subscription?.unsubscribe();
      } finally {
        await client.close();
      }
    }
  });
});
