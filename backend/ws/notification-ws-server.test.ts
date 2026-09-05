/**
 * `backend/ws/notification-ws-server.ts` — notification WS sidecar suite.
 *
 * Coverage map (tasks.md 2.8.TE tiers; ephemeral-port harness + native
 * `WebSocket` clients — NO Playwright at this tier; every test boots its own
 * server on 127.0.0.1:0 and shuts it down in cleanup):
 *  - Config: env-seam defaults (1.5-registered WS keys via the cached
 *    snapshot + resetEnvironmentCache invalidation), override precedence,
 *    and the pinned close-code vocabulary + cap constants.
 *  - Tier 1: valid cookie handshake → connected → push received; two-user
 *    routing isolation (one pushed, other provably silent); multi-socket
 *    fan-out to one user's socket set.
 *  - Tier 2: malformed bus payload dropped with the socket loop intact
 *    (through a REAL RedisPubSubTransport over an in-memory bus client);
 *    egress payload allowlist (smuggled runtime properties never reach the
 *    wire); graceful shutdown `1001` observed on the wire + clean client
 *    close; shutdown idempotency; a handshake completing INSIDE the shutdown
 *    drain window policy-closes `1001` without registering.
 *  - Tier 3: missed-pong ×2 termination (dead peer via a minimal raw-TCP
 *    client that never pongs — spec-compliant clients auto-pong, so
 *    non-responsiveness must be simulated below the client API) with a live
 *    native peer surviving the same window; reconnect flicker ×6 ending
 *    with exactly-one live connection.
 *  - Tier 4: missing/tampered/expired token → `4401`; bad + missing Origin →
 *    rejected pre-upgrade; query-string token attempt → `4401`; bucket
 *    exhaustion → `4429` (then refill recovery); global cap → `1013`;
 *    per-user cap → oldest evicted `4009`; inbound application frames
 *    under the 4 KiB cap ignored with the loop intact; a frame OVER the cap
 *    dropped by the runtime (that socket closes, siblings unaffected);
 *    registry bounds across churn; non-WebSocket requests → 426.
 *
 * Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/ws/notification-ws-server.test.ts`
 */
import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { connect } from "node:net";
import { SignJWT } from "jose";
import { signAccessToken } from "@/backend/lib/auth/jwt";
import { getEnv, resetEnvironmentCache } from "@/backend/lib/env";
import {
  InProcessTransport,
  NOTIFICATIONS_FANOUT_CHANNEL,
  type NotificationFanoutSubscriptionSource,
  type RedisFanoutClient,
  RedisPubSubTransport,
} from "@/backend/services/notifications/realtime";
import type { RealtimeNotificationPayload } from "@/backend/types";
import {
  NOTIFICATION_WS_CLOSE_CODES,
  type NotificationWsServerConfigOverrides,
  type NotificationWsServerHandle,
  resolveNotificationWsServerConfig,
  startNotificationWsServer,
  WS_HANDSHAKE_BUCKET_CAPACITY,
  WS_MAX_INBOUND_FRAME_BYTES,
  WS_MISSED_PONG_LIMIT,
  WS_PING_INTERVAL_MS,
} from "@/backend/ws";

// ─── Constants + fixtures ────────────────────────────────────────────────────

const ALLOWED_ORIGIN = "http://localhost:3000";
const EVIL_ORIGIN = "https://evil.example";

const CONFIG_ENV_KEYS = [
  "WS_PORT",
  "WS_HOST",
  "WS_ALLOWED_ORIGINS",
  "WS_MAX_CONNECTIONS",
  "WS_MAX_CONNECTIONS_PER_USER",
] as const;
const originalConfigEnv: Record<string, string | undefined> = {};
for (const key of CONFIG_ENV_KEYS) {
  originalConfigEnv[key] = process.env[key];
}

function restoreConfigEnv(): void {
  for (const key of CONFIG_ENV_KEYS) {
    const value = originalConfigEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetEnvironmentCache();
}

function clearConfigEnv(): void {
  for (const key of CONFIG_ENV_KEYS) {
    delete process.env[key];
  }
  resetEnvironmentCache();
}

function makePayload(id: number): RealtimeNotificationPayload {
  return {
    v: 1,
    kind: "notification",
    data: {
      id,
      type: "payment_confirmation",
      title: "Payment received",
      body: null,
      relatedEntityType: "invoice",
      relatedEntityId: 77,
      createdAt: new Date("2026-08-29T10:00:00.000Z"),
    },
  };
}

const EXPECTED_FRAME_JSON = {
  v: 1,
  kind: "notification",
  data: {
    id: 101,
    type: "payment_confirmation",
    title: "Payment received",
    body: null,
    relatedEntityType: "invoice",
    relatedEntityId: 77,
    createdAt: "2026-08-29T10:00:00.000Z",
  },
};

// ─── Token fixtures (the auth-test convention: real signAccessToken minting) ─

async function mintAccessToken(userId: number): Promise<string> {
  return signAccessToken({ userId, role: "student" });
}

/** Derives the same dev-fallback access secret as `backend/lib/auth/jwt`. */
async function deriveTestAccessSecret(): Promise<Uint8Array> {
  const base = getEnv("DATABASE_ENCRYPTION_KEY") ?? "dev-only-insecure-fallback-secret";
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${base}:access`));
  return new Uint8Array(digest);
}

/** Mints a structurally-valid token that expired 60s ago (same claims/issuer). */
async function mintExpiredAccessToken(userId: number): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: "student", type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuer("draft-academy")
    .setIssuedAt(nowSeconds - 3600)
    .setExpirationTime(nowSeconds - 60)
    .sign(await deriveTestAccessSecret());
}

/** Flips trailing characters so the signature can never verify. */
function tamperToken(token: string): string {
  // base64url is pure ASCII — code-unit splitting is lossless here.
  const suffix = token.slice(-4);
  const flipped = suffix
    .split("")
    .map(ch => (ch === "A" ? "B" : "A"))
    .join("");
  return `${token.slice(0, -4)}${flipped}`;
}

// ─── Server harness (ephemeral port; every boot tracked + shut down) ─────────

interface TestServerBase {
  readonly handle: NotificationWsServerHandle;
  readonly url: string;
  readonly host: string;
  readonly port: number;
}

interface TestServer extends TestServerBase {
  readonly transport: InProcessTransport;
}

const liveServers: Array<{ readonly handle: NotificationWsServerHandle }> = [];

async function bootServerWithSource(
  subscriptionSource: NotificationFanoutSubscriptionSource,
  configOverrides?: NotificationWsServerConfigOverrides
): Promise<TestServerBase> {
  const handle = await startNotificationWsServer({
    subscriptionSource,
    config: {
      port: 0,
      host: "127.0.0.1",
      // Generous throttle so multi-connection tests never trip it implicitly;
      // the dedicated 4429 test shrinks these deliberately.
      handshakeBucketCapacity: 500,
      handshakeBucketRefillIntervalMs: 1,
      shutdownDrainTimeoutMs: 120,
      ...configOverrides,
    },
  });
  liveServers.push({ handle });
  return { handle, url: handle.url, host: handle.host, port: handle.port };
}

async function bootServer(configOverrides?: NotificationWsServerConfigOverrides): Promise<TestServer> {
  const transport = new InProcessTransport();
  const base = await bootServerWithSource(transport, configOverrides);
  return { ...base, transport };
}

afterEach(async () => {
  const servers = liveServers.splice(0);
  // Sequential (index-recursive) shutdown: one listener at a time stops, so
  // port teardown is fully drained before the next — no parallel stop races.
  const shutdownEach = async (index: number): Promise<void> => {
    if (index >= servers.length) {
      return;
    }
    await servers[index].handle.shutdown();
    await shutdownEach(index + 1);
  };
  await shutdownEach(0);
});

// ─── Native-client helpers ───────────────────────────────────────────────────

/**
 * Bun's extended WebSocket constructor — the runtime accepts an options
 * object (`{ headers }`) as the second argument (the standard API has only
 * `protocols`), but with `lib.dom` loaded the global's TYPE resolves to the
 * DOM constructor, masking the Bun overload. This type-guard bridge (the
 * repo-sanctioned unknown→typed pattern; no `as` assertions) recovers the
 * extended constructor at the type level while the runtime check keeps it
 * honest.
 */
type BunWebSocketConstructor = new (url: string | URL, options?: Bun.WebSocketOptions) => WebSocket;

function isBunWebSocketConstructor(value: unknown): value is BunWebSocketConstructor {
  return typeof value === "function";
}

function resolveBunWebSocketConstructor(): BunWebSocketConstructor {
  const candidate: unknown = WebSocket;
  if (isBunWebSocketConstructor(candidate)) {
    return candidate;
  }
  throw new Error("Bun WebSocket constructor unavailable");
}

const createSocket = resolveBunWebSocketConstructor();

function connectClient(url: string, token: string | null, origin: string = ALLOWED_ORIGIN): WebSocket {
  const headers: Record<string, string> = { origin };
  if (token !== null) {
    headers.cookie = `access_token=${token}`;
  }
  return new createSocket(url, { headers });
}

function connectClientWithQuery(
  url: string,
  query: string,
  token: string | null,
  origin: string = ALLOWED_ORIGIN
): WebSocket {
  const headers: Record<string, string> = { origin };
  if (token !== null) {
    headers.cookie = `access_token=${token}`;
  }
  return new createSocket(`${url}/?${query}`, { headers });
}

function waitForOpen(ws: WebSocket, timeoutMs = 3_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for client open")), timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("client errored before open"));
    });
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      reject(new Error("client closed before open"));
    });
  });
}

function nextCloseCode(ws: WebSocket, timeoutMs = 3_000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for client close")), timeoutMs);
    ws.addEventListener("close", event => {
      clearTimeout(timer);
      resolve({ code: event.code, reason: event.reason });
    });
  });
}

function nextMessage(ws: WebSocket, timeoutMs = 3_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for client message")), timeoutMs);
    ws.addEventListener("message", event => {
      clearTimeout(timer);
      resolve(String(event.data));
    });
  });
}

/** Collects every inbound client message (for provable-silence assertions). */
function collectMessages(ws: WebSocket): string[] {
  const messages: string[] = [];
  ws.addEventListener("message", event => {
    messages.push(String(event.data));
  });
  return messages;
}

async function waitForCondition(description: string, predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Index-recursive poll (no await-in-loop): check, then yield, then recurse.
  const poll = async (): Promise<void> => {
    if (predicate()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timeout waiting for: ${description}`);
    }
    await new Promise(resolve => setTimeout(resolve, 25));
    await poll();
  };
  await poll();
}

/** Closes a client cleanly (no-op when already gone) and awaits the close. */
async function closeClientQuietly(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) {
    ws.close(1000, "test done");
  }
  await waitForCondition("client socket fully closed", () => ws.readyState === WebSocket.CLOSED);
}

// ─── Raw-TCP WS client (dead-peer simulation + wire-level close-frame read) ──

interface RawWsClient {
  /** Resolves when the TCP connection ends (peer terminated / closed). */
  readonly closed: Promise<void>;
  /** The parsed wire close frame, once received (`null` until then). */
  closeFrame(): { code: number; reason: string } | null;
  destroy(): void;
}

/**
 * Minimal raw WebSocket peer: performs the HTTP upgrade by hand and then
 * deliberately NEVER responds to pings (a spec-compliant client must pong —
 * non-responsiveness can only be simulated below the client API). Also reads
 * the server's close frame off the wire (Bun's native client surfaces 1001
 * as 1000, so the wire bytes are the ground truth for shutdown assertions).
 */
function connectRawPeer(host: string, port: number, token: string): RawWsClient {
  const key = randomBytes(16).toString("base64");
  let buffer = Buffer.alloc(0);
  let upgradeEnd = -1;
  let frame: { code: number; reason: string } | null = null;
  let resolveClosed: (() => void) | null = null;
  const closed = new Promise<void>(resolve => {
    resolveClosed = resolve;
  });
  const socket = connect({ host, port }, () => {
    socket.write(
      [
        "GET /ws HTTP/1.1",
        `Host: ${host}:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        `Origin: ${ALLOWED_ORIGIN}`,
        `Cookie: access_token=${token}`,
        "",
        "",
      ].join("\r\n")
    );
  });
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (upgradeEnd === -1) {
      upgradeEnd = buffer.indexOf("\r\n\r\n");
      if (upgradeEnd === -1) {
        return; // response headers still incomplete
      }
      // Header terminator found in THIS chunk — its remainder may already
      // carry frames (a policy-closed handshake's close frame is written
      // back-to-back with the 101 response and coalesces into the same
      // segment), so fall through to the scan instead of returning.
    }
    // Scan the frame region only: a close frame is opcode 0x8 (server frames
    // are unmasked), first payload bytes are the 2-byte close code.
    const closeAt = buffer.indexOf(0x88, upgradeEnd + 4);
    if (closeAt !== -1 && closeAt + 2 < buffer.length && frame === null) {
      const length = buffer[closeAt + 1] & 0x7f;
      if (length >= 2 && closeAt + 2 + length <= buffer.length) {
        frame = {
          code: buffer.readUInt16BE(closeAt + 2),
          reason: buffer.subarray(closeAt + 4, closeAt + 2 + length).toString("utf8"),
        };
      }
    }
  });
  socket.on("close", () => resolveClosed?.());
  socket.on("error", () => resolveClosed?.());
  return {
    closed,
    closeFrame: () => frame,
    destroy: () => socket.destroy(),
  };
}

// ─── In-memory bus client (Redis adapter driven without a server) ────────────

class InMemoryBusClient implements RedisFanoutClient {
  private readonly listeners: Array<(message: string) => void> = [];

  publish(): Promise<unknown> {
    return Promise.resolve(1);
  }

  subscribe(channel: string, onMessage: (message: string) => void): Promise<unknown> {
    expect(channel).toBe(NOTIFICATIONS_FANOUT_CHANNEL);
    this.listeners.push(onMessage);
    return Promise.resolve(1);
  }

  unsubscribe(): Promise<unknown> {
    return Promise.resolve(1);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  emit(message: string): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}

// ─── Config resolution (unit tier — no server boot) ──────────────────────────

describe("resolveNotificationWsServerConfig — env seam + overrides", () => {
  afterEach(restoreConfigEnv);

  test("env-seam defaults: cleared WS keys resolve to the registered defaults + cadence constants", () => {
    clearConfigEnv();

    const config = resolveNotificationWsServerConfig();

    expect(config.port).toBe(3101);
    expect(config.host).toBe("127.0.0.1");
    expect(config.allowedOrigins).toEqual([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3001",
    ]);
    expect(config.maxConnections).toBe(1000);
    expect(config.maxConnectionsPerUser).toBe(5);
    expect(config.pingIntervalMs).toBe(30_000);
    expect(config.missedPongLimit).toBe(2);
  });

  test("explicit overrides win over env values; unoverridden fields keep the env-seam value", () => {
    clearConfigEnv();
    process.env.WS_PORT = "4321";
    process.env.WS_MAX_CONNECTIONS_PER_USER = "3";
    resetEnvironmentCache();

    const config = resolveNotificationWsServerConfig({ port: 0, maxConnections: 7 });

    expect(config.port).toBe(0);
    expect(config.maxConnections).toBe(7);
    expect(config.maxConnectionsPerUser).toBe(3);
    expect(config.host).toBe("127.0.0.1");
  });

  test("close-code vocabulary + bounded-state cap constants are pinned exactly", () => {
    expect(NOTIFICATION_WS_CLOSE_CODES).toEqual({
      unauthenticated: 4401,
      throttled: 4429,
      superseded: 4009,
      overloaded: 1013,
      shutdown: 1001,
    });
    expect(WS_PING_INTERVAL_MS).toBe(30_000);
    expect(WS_MISSED_PONG_LIMIT).toBe(2);
    expect(WS_HANDSHAKE_BUCKET_CAPACITY).toBe(5);
    expect(WS_MAX_INBOUND_FRAME_BYTES).toBe(4096);
  });
});

// ─── Tier 1 — valid handshake & routing ──────────────────────────────────────

describe("Tier 1 — valid cookie handshake, push delivery, routing isolation", () => {
  test("valid cookie handshake connects and receives the RealtimeNotificationPayload frame", async () => {
    const server = await bootServer();
    const token = await mintAccessToken(41);
    const client = connectClient(server.url, token);

    await waitForOpen(client);
    expect(server.handle.connectionCount).toBe(1);
    expect(server.handle.connectionCountForUser(41)).toBe(1);

    await server.transport.publishFanout([41], makePayload(101));
    const received = JSON.parse(await nextMessage(client));

    expect(received).toEqual(EXPECTED_FRAME_JSON);
    await closeClientQuietly(client);
    await waitForCondition("registry drains after client close", () => server.handle.connectionCount === 0);
  });

  test("two-user routing isolation: the pushed user receives, the other stays provably silent", async () => {
    const server = await bootServer();
    const tokenA = await mintAccessToken(51);
    const tokenB = await mintAccessToken(52);
    const clientA = connectClient(server.url, tokenA);
    const clientB = connectClient(server.url, tokenB);
    // Listeners attach BEFORE any await: a socket opened while its sibling is
    // still being awaited must not have its open event consumed unseen.
    await Promise.all([waitForOpen(clientA), waitForOpen(clientB)]);

    const messagesB = collectMessages(clientB);
    await server.transport.publishFanout([51], makePayload(101));
    const receivedA = JSON.parse(await nextMessage(clientA));

    expect(receivedA).toEqual(EXPECTED_FRAME_JSON);
    // Provably silent: a bounded silence window with zero inbound frames.
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(messagesB).toHaveLength(0);

    // Both addressed → both receive (batch fan-out carries the full list).
    await server.transport.publishFanout([51, 52], makePayload(101));
    await Promise.all([nextMessage(clientA), nextMessage(clientB)]);
    await closeClientQuietly(clientA);
    await closeClientQuietly(clientB);
  });

  test("one user with multiple sockets: every live socket in the recipient set receives the frame", async () => {
    const server = await bootServer();
    const token = await mintAccessToken(61);
    const first = connectClient(server.url, token);
    const second = connectClient(server.url, token);
    // Both listeners attach before either is awaited (open-event race guard).
    await Promise.all([waitForOpen(first), waitForOpen(second)]);
    expect(server.handle.connectionCountForUser(61)).toBe(2);

    await server.transport.publishFanout([61], makePayload(101));
    const frames = await Promise.all([nextMessage(first), nextMessage(second)]);
    const frameOne = JSON.parse(frames[0]);
    const frameTwo = JSON.parse(frames[1]);

    expect(frameOne).toEqual(EXPECTED_FRAME_JSON);
    expect(frameTwo).toEqual(EXPECTED_FRAME_JSON);
    await closeClientQuietly(first);
    await closeClientQuietly(second);
  });
});

// ─── Tier 2 — bus integrity & graceful shutdown ──────────────────────────────

describe("Tier 2 — malformed bus payloads, egress allowlist, graceful shutdown", () => {
  test("malformed bus messages are dropped; the next valid envelope still routes to the socket", async () => {
    const bus = new InMemoryBusClient();
    const server = await bootServerWithSource(new RedisPubSubTransport(bus));
    const token = await mintAccessToken(71);
    const client = connectClient(server.url, token);
    await waitForOpen(client);
    const messages = collectMessages(client);

    bus.emit("{not valid json at all");
    bus.emit(JSON.stringify({ userIds: "nope", payload: makePayload(101) }));
    bus.emit(JSON.stringify({ userIds: [71], payload: { v: 2, kind: "notification", data: null } }));
    await new Promise(resolve => setTimeout(resolve, 250));

    expect(messages).toHaveLength(0);

    const envelope = { userIds: [71], payload: makePayload(101) };
    bus.emit(JSON.stringify(envelope));
    const received = JSON.parse(await nextMessage(client));

    expect(received).toEqual(EXPECTED_FRAME_JSON);
    await closeClientQuietly(client);
  });

  test("egress allowlist: runtime-smuggled payload properties never reach the outbound frame", async () => {
    const server = await bootServer();
    const token = await mintAccessToken(81);
    const client = connectClient(server.url, token);
    await waitForOpen(client);

    const smuggled = Object.assign(makePayload(101), { smuggled: "secret", userId: 999 });
    await server.transport.publishFanout([81], smuggled);
    const received = JSON.parse(await nextMessage(client));

    expect(Object.keys(received)).toEqual(["v", "kind", "data"]);
    expect(Object.keys(received.data)).toEqual([
      "id",
      "type",
      "title",
      "body",
      "relatedEntityType",
      "relatedEntityId",
      "createdAt",
    ]);
    expect(Object.hasOwn(received, "smuggled")).toBe(false);
    expect(Object.hasOwn(received, "userId")).toBe(false);
    expect(JSON.stringify(received).includes("secret")).toBe(false);
    await closeClientQuietly(client);
  });

  test("graceful shutdown closes sockets with 1001 on the wire and stops the listener; idempotent", async () => {
    const server = await bootServer();
    const token = await mintAccessToken(91);
    const raw = connectRawPeer(server.host, server.port, token);
    const native = connectClient(server.url, token);
    await waitForOpen(native);
    await waitForCondition("both peers registered", () => server.handle.connectionCount === 2);
    await new Promise(resolve => setTimeout(resolve, 150)); // raw peer finishes its upgrade

    // Attach the close listeners BEFORE initiating shutdown — the events fire
    // concurrently with the shutdown sequence.
    const nativeClosePromise = nextCloseCode(native);
    await server.handle.shutdown();

    // Wire-level truth (Bun's native client normalizes 1001 → 1000):
    await raw.closed;
    expect(raw.closeFrame()).toEqual({ code: 1001, reason: "server shutting down" });
    const nativeClose = await nativeClosePromise;
    expect(nativeClose.reason).toBe("server shutting down");
    expect(nativeClose.code).not.toBe(1006);
    expect(server.handle.connectionCount).toBe(0);

    // Idempotent: a second shutdown resolves without throwing.
    await server.handle.shutdown();

    // The listener is gone: a fresh handshake can no longer open (the native
    // client surfaces the refused connection as an abnormal close).
    const refused = connectClient(server.url, token);
    const refusedClose = await nextCloseCode(refused, 2_000);
    expect(refusedClose.code).toBe(1006);
    raw.destroy();
  });

  test("a handshake completing inside the shutdown drain window policy-closes 1001 and never registers", async () => {
    // Wide-enough drain window (production floor is 500ms) so the mid-drain
    // handshake deterministically lands inside it (the harness's 120ms
    // default would race machine scheduling).
    const server = await bootServer({ shutdownDrainTimeoutMs: 600 });
    const token = await mintAccessToken(131);

    // Begin shutdown WITHOUT awaiting: `shuttingDown` flips synchronously and
    // the registry sweep + clear run immediately, while the listener keeps
    // accepting upgrades through the whole drain window.
    const shutdownPromise = server.handle.shutdown();
    await new Promise(resolve => setTimeout(resolve, 50));

    // The mid-drain handshake (valid origin + cookie + token): without the
    // post-verify re-check its registration would land AFTER registry.clear()
    // — a stranded socket that never sees the `1001` sweep (only the forced
    // stop's abrupt teardown, with NO close frame on the wire).
    const raw = connectRawPeer(server.host, server.port, token);
    await raw.closed;
    expect(raw.closeFrame()).toEqual({ code: 1001, reason: "server shutting down" });

    // The drain-window handshake never registered into the drained registry.
    expect(server.handle.connectionCount).toBe(0);
    expect(server.handle.connectionCountForUser(131)).toBe(0);

    await shutdownPromise;
    raw.destroy();
  });
});

// ─── Tier 3 — liveness & reconnect flicker ───────────────────────────────────

describe("Tier 3 — missed-pong termination and reconnect flicker", () => {
  test("a peer that misses 2 consecutive pongs is terminated; a ponging peer survives the same window", async () => {
    const server = await bootServer({ pingIntervalMs: 100 });
    const token = await mintAccessToken(111);
    const dead = connectRawPeer(server.host, server.port, token);
    const alive = connectClient(server.url, token);
    await waitForOpen(alive);
    await waitForCondition("both peers registered", () => server.handle.connectionCount === 2);
    await new Promise(resolve => setTimeout(resolve, 150)); // raw peer finishes its upgrade

    // 3+ ping ticks pass: dead peer never pongs → terminated; alive peer auto-pongs.
    await dead.closed;
    await waitForCondition("registry down to the ponging peer only", () => server.handle.connectionCount === 1);
    expect(alive.readyState).toBe(WebSocket.OPEN);

    // The survivor still receives pushes (the loop was never disturbed).
    await server.transport.publishFanout([111], makePayload(101));
    const received = JSON.parse(await nextMessage(alive));
    expect(received).toEqual(EXPECTED_FRAME_JSON);
    await closeClientQuietly(alive);
    dead.destroy();
  });

  test("reconnect flicker ×6 ends with exactly one live connection that receives the next push", async () => {
    const server = await bootServer();
    const token = await mintAccessToken(121);

    // Index-recursive flicker: each attempt fully connects and drains before
    // the next — the churn sequence is the scenario under test (a reconnect
    // flicker storm must end with exactly one live connection).
    const flickerOnce = async (attempt: number): Promise<void> => {
      if (attempt >= 6) {
        return;
      }
      const flicker = connectClient(server.url, token);
      await waitForOpen(flicker);
      await closeClientQuietly(flicker);
      await waitForCondition("registry drains between flickers", () => server.handle.connectionCount === 0);
      await flickerOnce(attempt + 1);
    };
    await flickerOnce(0);

    const finalClient = connectClient(server.url, token);
    await waitForOpen(finalClient);

    expect(server.handle.connectionCount).toBe(1);
    expect(server.handle.connectionCountForUser(121)).toBe(1);

    await server.transport.publishFanout([121], makePayload(101));
    const received = JSON.parse(await nextMessage(finalClient));
    expect(received).toEqual(EXPECTED_FRAME_JSON);
    await closeClientQuietly(finalClient);
    await waitForCondition("registry drains after final close", () => server.handle.connectionCount === 0);
  });
});

// ─── Tier 4 — handshake hardening ────────────────────────────────────────────

describe("Tier 4 — auth failures, origin rejection, throttle, caps, inbound discipline", () => {
  test("missing access_token cookie → policy close 4401", async () => {
    const server = await bootServer();
    const client = connectClient(server.url, null);

    const close = await nextCloseCode(client);
    expect(close.code).toBe(4401);
    expect(server.handle.connectionCount).toBe(0);
  });

  test("tampered token → policy close 4401", async () => {
    const server = await bootServer();
    const token = tamperToken(await mintAccessToken(131));
    const client = connectClient(server.url, token);

    const close = await nextCloseCode(client);

    expect(close.code).toBe(4401);
    expect(server.handle.connectionCount).toBe(0);
  });

  test("expired token → policy close 4401", async () => {
    const server = await bootServer();
    const token = await mintExpiredAccessToken(141);
    const client = connectClient(server.url, token);

    const close = await nextCloseCode(client);

    expect(close.code).toBe(4401);
    expect(server.handle.connectionCount).toBe(0);
  });

  test("non-allowlisted Origin is rejected before upgrade (CSWSH defense)", async () => {
    const server = await bootServer();
    const token = await mintAccessToken(151);
    const client = connectClient(server.url, token, EVIL_ORIGIN);

    // Never upgraded: the native client errors on the non-101 response.
    let opened = false;
    client.addEventListener("open", () => {
      opened = true;
    });
    const close = await nextCloseCode(client);

    expect(opened).toBe(false);
    expect(close.code).toBe(1002);
    expect(server.handle.connectionCount).toBe(0);
  });

  test("missing Origin header is rejected (fail-closed allowlist)", async () => {
    const server = await bootServer();
    const token = await mintAccessToken(152);
    const client = new createSocket(server.url, { headers: { cookie: `access_token=${token}` } });

    let opened = false;
    client.addEventListener("open", () => {
      opened = true;
    });
    const close = await nextCloseCode(client);

    expect(opened).toBe(false);
    expect(close.code).toBe(1002);
    expect(server.handle.connectionCount).toBe(0);
  });

  test("query-string tokens are never honored — a valid token in the URL still closes 4401 without a cookie", async () => {
    const server = await bootServer();
    const token = await mintAccessToken(161);
    const client = connectClientWithQuery(server.url, `access_token=${token}&token=${token}`, null);

    const close = await nextCloseCode(client);

    expect(close.code).toBe(4401);
    expect(server.handle.connectionCount).toBe(0);
  });

  test("handshake bucket exhaustion → 4429; the bucket refills over time and accepts again", async () => {
    const server = await bootServer({ handshakeBucketCapacity: 2, handshakeBucketRefillIntervalMs: 150 });
    const token = await mintAccessToken(171);

    const first = connectClient(server.url, token);
    const second = connectClient(server.url, token);
    // Both listeners attach before either is awaited (open-event race guard).
    await Promise.all([waitForOpen(first), waitForOpen(second)]);

    const third = connectClient(server.url, token);
    const throttled = await nextCloseCode(third);
    expect(throttled.code).toBe(4429);
    expect(server.handle.connectionCount).toBe(2);

    // Refill: after the refill interval the same origin's IP has tokens again.
    await new Promise(resolve => setTimeout(resolve, 400));
    const fourth = connectClient(server.url, token);
    await waitForOpen(fourth);
    expect(server.handle.connectionCount).toBe(3);
    await closeClientQuietly(first);
    await closeClientQuietly(second);
    await closeClientQuietly(fourth);
  });

  test("global cap overflow → the new socket closes 1013 and the registry stays at the cap", async () => {
    const server = await bootServer({ maxConnections: 2 });
    const token = await mintAccessToken(181);
    const first = connectClient(server.url, token);
    const second = connectClient(server.url, token);
    // Both listeners attach before either is awaited (open-event race guard).
    await Promise.all([waitForOpen(first), waitForOpen(second)]);

    const third = connectClient(server.url, token);
    const overloaded = await nextCloseCode(third);

    expect(overloaded.code).toBe(1013);
    expect(server.handle.connectionCount).toBe(2);
    expect(first.readyState).toBe(WebSocket.OPEN);
    expect(second.readyState).toBe(WebSocket.OPEN);
    await closeClientQuietly(first);
    await closeClientQuietly(second);
  });

  test("per-user cap overflow → the OLDEST connection is evicted with 4009; newest stay live", async () => {
    const server = await bootServer({ maxConnectionsPerUser: 2 });
    const token = await mintAccessToken(191);
    const oldest = connectClient(server.url, token);
    await waitForOpen(oldest);
    const middle = connectClient(server.url, token);
    await waitForOpen(middle);

    // Eviction listeners attach BEFORE the triggering connect+open is awaited:
    // the server closes the OLDEST socket while processing the newest upgrade,
    // so that close event can fire during the waitForOpen await.
    const newest = connectClient(server.url, token);
    const newestOpen = waitForOpen(newest);
    const evictionPromise = nextCloseCode(oldest);
    await newestOpen;
    const eviction = await evictionPromise;

    expect(eviction.code).toBe(4009);
    expect(server.handle.connectionCount).toBe(2);
    expect(server.handle.connectionCountForUser(191)).toBe(2);
    expect(middle.readyState).toBe(WebSocket.OPEN);
    expect(newest.readyState).toBe(WebSocket.OPEN);

    // The evicted slot is usable again: a fourth connection is accepted.
    const fourth = connectClient(server.url, token);
    const fourthOpen = waitForOpen(fourth);
    const secondEvictionPromise = nextCloseCode(middle);
    await fourthOpen;
    const secondEviction = await secondEvictionPromise;
    expect(secondEviction.code).toBe(4009);
    expect(server.handle.connectionCountForUser(191)).toBe(2);
    await closeClientQuietly(newest);
    await closeClientQuietly(fourth);
  });

  test("inbound application frames within the cap are ignored; the push loop stays intact", async () => {
    const server = await bootServer();
    const token = await mintAccessToken(201);
    const client = connectClient(server.url, token);
    await waitForOpen(client);

    client.send("hello");
    client.send(JSON.stringify({ v: 1, kind: "bogus" }));
    // The largest legal application frame: exactly at the 4 KiB inbound cap.
    client.send("x".repeat(WS_MAX_INBOUND_FRAME_BYTES));
    await new Promise(resolve => setTimeout(resolve, 300));

    expect(client.readyState).toBe(WebSocket.OPEN);
    expect(server.handle.connectionCount).toBe(1);

    await server.transport.publishFanout([201], makePayload(101));
    const received = JSON.parse(await nextMessage(client));
    expect(received).toEqual(EXPECTED_FRAME_JSON);
    await closeClientQuietly(client);
  });

  test("an inbound frame OVER the cap is dropped by the runtime: that socket closes and drains, a sibling's push loop stays intact", async () => {
    const server = await bootServer();
    const tokenOffending = await mintAccessToken(202);
    const tokenSibling = await mintAccessToken(203);
    const offending = connectClient(server.url, tokenOffending);
    const sibling = connectClient(server.url, tokenSibling);
    await Promise.all([waitForOpen(offending), waitForOpen(sibling)]);
    expect(server.handle.connectionCount).toBe(2);

    // One byte over the 4 KiB cap: the runtime drops the message and closes
    // ONLY the offending socket (the app-owned `message` handler ignores
    // every application frame — the cap is the runtime's own defense).
    offending.send(`x${"x".repeat(WS_MAX_INBOUND_FRAME_BYTES)}`);
    await nextCloseCode(offending);

    await waitForCondition("oversized sender drains from the registry", () => server.handle.connectionCount === 1);
    expect(server.handle.connectionCountForUser(202)).toBe(0);
    expect(sibling.readyState).toBe(WebSocket.OPEN);

    // The sibling's push loop is unaffected by the drop.
    await server.transport.publishFanout([203], makePayload(101));
    const received = JSON.parse(await nextMessage(sibling));
    expect(received).toEqual(EXPECTED_FRAME_JSON);
    await closeClientQuietly(sibling);
  });

  test("registry bounds hold across churn: counts track opens/closes exactly and drain to zero", async () => {
    const server = await bootServer();
    const tokenA = await mintAccessToken(211);
    const tokenB = await mintAccessToken(212);
    const clients: WebSocket[] = [];
    for (let index = 0; index < 3; index += 1) {
      clients.push(connectClient(server.url, tokenA));
      clients.push(connectClient(server.url, tokenB));
    }
    // Open-event race guard: every listener attaches (via waitForOpen) before
    // the first await — a socket that opens while an earlier sibling is still
    // pending would otherwise have its open event consumed unseen and time out.
    await Promise.all(clients.map(client => waitForOpen(client)));

    expect(server.handle.connectionCount).toBe(6);
    expect(server.handle.connectionCountForUser(211)).toBe(3);
    expect(server.handle.connectionCountForUser(212)).toBe(3);

    const closeEach = async (index: number): Promise<void> => {
      if (index >= clients.length) {
        return;
      }
      await closeClientQuietly(clients[index]);
      await closeEach(index + 1);
    };
    await closeEach(0);
    await waitForCondition("registry fully drained", () => server.handle.connectionCount === 0);
  });

  test("non-WebSocket HTTP requests receive 426 Upgrade Required", async () => {
    const server = await bootServer();

    const response = await fetch(`http://${server.host}:${server.port}/`);

    expect(response.status).toBe(426);
  });
});
