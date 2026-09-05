/**
 * `IoredisFanoutClient` — unit suite for the default Redis client adapter's
 * process-safety posture.
 *
 * Coverage map:
 *  - Construction never dials (`lazyConnect`): building a client against an
 *    unreachable endpoint and closing it completes immediately — no error
 *    event, no hang, no crash of the host process.
 *  - Outage posture: a publish against an unreachable endpoint rejects
 *    cleanly (fast, typed rejection — the caller degrades; the process
 *    survives).
 *  - Release semantics: `close()` always resolves — including on a client
 *    whose connection was refused mid-outage (QUIT with a force-close
 *    fallback) — so the socket can never keep the host process alive.
 *
 * The endpoint used is a loopback port with nothing listening
 * (`127.0.0.1:1`) — no third-party provider and no real channel is ever
 * contacted; the connection is refused by the OS instantly. The
 * happy-path round-trip over a LIVE server lives in
 * `test/integration/redis/redis-fanout-transport.integration.test.ts` behind
 * a reachability gate.
 *
 * Runs via the mandated runner: `bun run test/scripts/run-test.ts <path>`.
 */
import { describe, expect, test } from "bun:test";
import { IoredisFanoutClient } from "@/backend/services/notifications/realtime/ioredis-fanout-client";
import { NOTIFICATIONS_FANOUT_CHANNEL } from "@/backend/services/notifications/realtime/redis-pubsub-transport";

/** Loopback endpoint with nothing listening — instant connection refusal. */
const UNREACHABLE_REDIS_URL = "redis://127.0.0.1:1";

/** Aggressive no-retry posture so outage cases reject deterministically fast. */
const NO_RETRY_OPTIONS = { retryStrategy: () => null, connectTimeout: 250 } as const;

/** Upper bound for "completes without hanging" assertions (ms). */
const NO_HANG_BOUND_MS = 5000;

/** Repo-canonical error-capture helper (no `.rejects` assertions). */
async function catchError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return null;
}

describe("IoredisFanoutClient", () => {
  test("construction never dials — a never-commanded client closes immediately", async () => {
    const startedAt = Date.now();
    const client = new IoredisFanoutClient(UNREACHABLE_REDIS_URL, NO_RETRY_OPTIONS);

    // No command was issued, so nothing connected, errored, or hung.
    await client.close();

    expect(Date.now() - startedAt).toBeLessThan(NO_HANG_BOUND_MS);
  });

  test("publish against an unreachable endpoint rejects cleanly (fast-fail outage posture)", async () => {
    const client = new IoredisFanoutClient(UNREACHABLE_REDIS_URL, NO_RETRY_OPTIONS);

    const error = await catchError(() => client.publish(NOTIFICATIONS_FANOUT_CHANNEL, "{}"));

    expect(error).toBeInstanceOf(Error);
    await client.close();
  });

  test("close() stays safe and quick on a client whose connection was refused mid-outage", async () => {
    const startedAt = Date.now();
    const client = new IoredisFanoutClient(UNREACHABLE_REDIS_URL, NO_RETRY_OPTIONS);
    await catchError(() => client.publish(NOTIFICATIONS_FANOUT_CHANNEL, "{}"));

    // The second close exercises the QUIT-fails → force-disconnect fallback
    // arm; both must resolve so the socket can never linger.
    await client.close();
    await client.close();

    expect(Date.now() - startedAt).toBeLessThan(NO_HANG_BOUND_MS);
  });
});
