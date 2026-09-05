/**
 * `InProcessTransport` — unit suite (the only transport legal in
 * tests/harnesses).
 *
 * Coverage map:
 *  - Tier 1 (round-trip): a registered tap receives the publish verbatim;
 *    multiple taps receive every publish in registration order;
 *    unsubscribe stops delivery without affecting remaining taps; taps can
 *    re-register after unsubscribing.
 *  - Tier 2 (empty fan-out): an empty recipient list resolves without
 *    delivering anything to anyone.
 *  - Publish-failure surfacing: a throwing tap rejects the publish so the
 *    publisher (the engine) learns immediately — the in-process analogue of
 *    a bus outage rejecting a publish.
 *
 * Pure in-memory tier — NO network, NO Redis, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts <path>`.
 */
import { describe, expect, test } from "bun:test";
import { InProcessTransport } from "@/backend/services/notifications/realtime/in-process-transport";
import type { RealtimeNotificationPayload } from "@/backend/types";

function makePayload(): RealtimeNotificationPayload {
  return {
    v: 1,
    kind: "notification",
    data: {
      id: 7,
      type: "system_broadcast",
      title: "Scheduled maintenance",
      body: null,
      relatedEntityType: null,
      relatedEntityId: null,
      createdAt: new Date("2026-08-29T09:30:00.000Z"),
    },
  };
}

interface Receipt {
  readonly userIds: readonly number[];
  readonly payload: RealtimeNotificationPayload;
}

/** Captures every envelope a tap observes, in observation order. */
function makeTape(): {
  receipts: Receipt[];
  listener: (userIds: readonly number[], payload: RealtimeNotificationPayload) => void;
} {
  const receipts: Receipt[] = [];
  return {
    receipts,
    listener: (userIds, payload) => {
      receipts.push({ userIds, payload });
    },
  };
}

/** Repo-canonical error-capture helper (no `.rejects` assertions). */
async function catchError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return null;
}

describe("InProcessTransport — Tier 1: publish/subscribe round-trip", () => {
  test("a registered tap receives the publish verbatim", async () => {
    const transport = new InProcessTransport();
    const tape = makeTape();
    await transport.subscribeFanout(tape.listener);

    const payload = makePayload();
    await transport.publishFanout([1, 2, 3], payload);

    expect(tape.receipts).toHaveLength(1);
    expect(tape.receipts[0]?.userIds).toEqual([1, 2, 3]);
    expect(tape.receipts[0]?.payload).toEqual(payload);
  });

  test("multiple taps receive every publish in registration order", async () => {
    const transport = new InProcessTransport();
    const order: string[] = [];
    const first = makeTape();
    const second = makeTape();
    await transport.subscribeFanout((userIds, payload) => {
      order.push("first");
      first.listener(userIds, payload);
    });
    await transport.subscribeFanout((userIds, payload) => {
      order.push("second");
      second.listener(userIds, payload);
    });

    await transport.publishFanout([10], makePayload());
    await transport.publishFanout([20], makePayload());

    expect(order).toEqual(["first", "second", "first", "second"]);
    expect(first.receipts).toHaveLength(2);
    expect(second.receipts).toHaveLength(2);
  });

  test("unsubscribe stops delivery; remaining taps stay live", async () => {
    const transport = new InProcessTransport();
    const first = makeTape();
    const second = makeTape();
    const firstSubscription = await transport.subscribeFanout(first.listener);
    await transport.subscribeFanout(second.listener);

    await firstSubscription.unsubscribe();
    await transport.publishFanout([99], makePayload());

    expect(first.receipts).toHaveLength(0);
    expect(second.receipts).toHaveLength(1);
  });

  test("unsubscribe is idempotent and taps can re-register afterwards", async () => {
    const transport = new InProcessTransport();
    const tape = makeTape();
    const subscription = await transport.subscribeFanout(tape.listener);

    await subscription.unsubscribe();
    await subscription.unsubscribe();

    await transport.publishFanout([4], makePayload());
    expect(tape.receipts).toHaveLength(0);

    await transport.subscribeFanout(tape.listener);
    await transport.publishFanout([5], makePayload());
    expect(tape.receipts).toHaveLength(1);
  });
});

describe("InProcessTransport — Tier 2: empty fan-out", () => {
  test("an empty recipient list resolves without tapping any listener", async () => {
    const transport = new InProcessTransport();
    const tape = makeTape();
    await transport.subscribeFanout(tape.listener);

    await transport.publishFanout([], makePayload());

    expect(tape.receipts).toHaveLength(0);
  });
});

describe("InProcessTransport — publish-failure surfacing", () => {
  test("a throwing tap rejects the publish with the listener's error", async () => {
    const transport = new InProcessTransport();
    await transport.subscribeFanout(() => {
      throw new Error("tap exploded");
    });

    const error = await catchError(() => transport.publishFanout([8], makePayload()));

    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.message).toBe("tap exploded");
    }
  });
});
