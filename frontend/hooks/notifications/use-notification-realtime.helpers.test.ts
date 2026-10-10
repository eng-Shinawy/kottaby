/**
 * Pure-function pin over `use-notification-realtime.helpers` — the client
 * reconnect backoff schedule and retry-abort close-code vocabulary, locked
 * exactly as implemented (the pin records the shipped behavior; any change
 * to the curve or the codes must update this lock in the same change).
 *
 * WHAT THIS LOCKS (no DOM, no sockets, no timers — pure functions + consts):
 *   1. BACKOFF CURVE — `getNotificationReconnectDelay(attempt, random)` is
 *      exponential with a 1s base doubling per attempt, hard-capped at 30s,
 *      with ±20% jitter around the curve value. The random source is
 *      injectable, so the curve and the jitter bounds are pinned
 *      deterministically: `random() => 0.5` lands exactly on the curve value,
 *      `0` on the lower jitter edge, `1` on the upper edge.
 *   2. CLAMPING — negative attempts clamp to the first-delay (1s); the cap
 *      plateaus every attempt beyond the doubling that would exceed 30s
 *      (attempt 5 is 30s, not 32s).
 *   3. ROUNDING — fractional jitter offsets round to the nearest millisecond.
 *   4. RETRY-ABORT VOCABULARY — the sidecar's policy close codes that ABORT
 *      reconnect retrying (`CLOSE_CODE_UNAUTHENTICATED` 4401,
 *      `CLOSE_CODE_SUPERSEDED` 4009) and the deterministic unmount close
 *      (`CLOSE_CODE_NORMAL` 1000) are pinned and pairwise distinct: the
 *      socket session treats 4401/4009 as terminal (hand back to the
 *      auth-recovery surface / newer-tab ownership) and every other close
 *      backs off through the curve above.
 *
 * RUNS VIA: bun run test/scripts/run-test.ts
 * frontend/hooks/notifications/use-notification-realtime.helpers.test.ts
 */
import { describe, expect, test } from "bun:test";
import {
  CLOSE_CODE_NORMAL,
  CLOSE_CODE_SUPERSEDED,
  CLOSE_CODE_UNAUTHENTICATED,
  getNotificationReconnectDelay,
} from "@/frontend/hooks/notifications/use-notification-realtime.helpers";

/** Mid-draw random: lands exactly on the un-jittered curve value. */
const midRandom = (): number => 0.5;

/** Lower jitter-edge random: the curve value minus the full jitter span. */
const lowerEdgeRandom = (): number => 0;

/** Upper jitter-edge random: the curve value plus the full jitter span. */
const upperEdgeRandom = (): number => 1;

describe("getNotificationReconnectDelay — the shipped reconnect backoff schedule", () => {
  test("pins the exponential curve: 1s base, doubling per attempt, hard cap at 30s", () => {
    // 1s → 2s → 4s → 8s → 16s → cap: attempt 5 would double to 32s but is
    // hard-capped at 30s, and every later attempt plateaus there.
    const expected = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000];
    const actual = expected.map((_, attempt) => getNotificationReconnectDelay(attempt, midRandom));
    expect(actual).toEqual(expected);

    // The cap boundary is exact, not an approximation: attempt 4 stays under
    // it, attempt 5 IS the cap (never the raw doubled 32000).
    expect(getNotificationReconnectDelay(4, midRandom)).toBe(16000);
    expect(getNotificationReconnectDelay(5, midRandom)).toBe(30000);
    expect(getNotificationReconnectDelay(5, midRandom)).not.toBe(32000);
    expect(getNotificationReconnectDelay(60, midRandom)).toBe(30000);
  });

  test("negative attempts clamp to the first delay (1s), never a sub-second or negative delay", () => {
    expect(getNotificationReconnectDelay(-1, midRandom)).toBe(1000);
    expect(getNotificationReconnectDelay(-42, midRandom)).toBe(1000);
  });

  test("pins the ±20% jitter span around the curve value at both edges and mid-draw", () => {
    // Attempt 0 (base 1000, jitter span 200): 800 … 1200.
    expect(getNotificationReconnectDelay(0, lowerEdgeRandom)).toBe(800);
    expect(getNotificationReconnectDelay(0, midRandom)).toBe(1000);
    expect(getNotificationReconnectDelay(0, upperEdgeRandom)).toBe(1200);

    // Attempt 1 (base 2000, jitter span 400): 1600 … 2400.
    expect(getNotificationReconnectDelay(1, lowerEdgeRandom)).toBe(1600);
    expect(getNotificationReconnectDelay(1, upperEdgeRandom)).toBe(2400);

    // Jitter spans the CAPPED value too (base 30000, jitter span 6000):
    // 24000 … 36000 — the cap bounds the curve, not the jittered result.
    expect(getNotificationReconnectDelay(5, lowerEdgeRandom)).toBe(24000);
    expect(getNotificationReconnectDelay(5, upperEdgeRandom)).toBe(36000);
  });

  test("fractional jitter offsets round to the nearest millisecond", () => {
    // Attempt 1 (base 2000, span 400): draw 0.123 → offset (0.246 − 1) × 400
    // = −301.6 → 1698.4 → 1698.
    expect(getNotificationReconnectDelay(1, () => 0.123)).toBe(1698);
    // Attempt 0 (base 1000, span 200): draw 0.333 → offset (0.666 − 1) × 200
    // = −66.8 → 933.2 → 933.
    expect(getNotificationReconnectDelay(0, () => 0.333)).toBe(933);
  });

  test("the curve is non-decreasing for a fixed random draw and plateaus at the cap", () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(attempt => getNotificationReconnectDelay(attempt, midRandom));
    const strictlyIncreasingUntilCap = delays.slice(0, 5);
    const cappedTail = delays.slice(5);

    expect(new Set(strictlyIncreasingUntilCap).size).toBe(strictlyIncreasingUntilCap.length);
    expect(cappedTail.every(delay => delay === 30000)).toBe(true);
  });
});

describe("retry-abort close-code vocabulary — the shipped terminal-close semantics", () => {
  test("pins the sidecar's policy codes that abort reconnect retrying and the deterministic unmount close", () => {
    // The socket session's close handler aborts the retry loop for exactly
    // these two sidecar policy codes: 4401 hands re-authentication to the
    // auth-recovery surface; 4009 means a newer tab owns the socket.
    expect(CLOSE_CODE_UNAUTHENTICATED).toBe(4401);
    expect(CLOSE_CODE_SUPERSEDED).toBe(4009);
    // The deterministic unmount close the session itself sends on teardown.
    expect(CLOSE_CODE_NORMAL).toBe(1000);
  });

  test("the three codes are pairwise distinct — no code can collapse two semantics into one", () => {
    expect(CLOSE_CODE_UNAUTHENTICATED).not.toBe(CLOSE_CODE_SUPERSEDED);
    expect(CLOSE_CODE_UNAUTHENTICATED).not.toBe(CLOSE_CODE_NORMAL);
    expect(CLOSE_CODE_SUPERSEDED).not.toBe(CLOSE_CODE_NORMAL);
  });
});
