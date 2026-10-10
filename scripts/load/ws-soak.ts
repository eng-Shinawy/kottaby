#!/usr/bin/env bun

/**
 * Notification sidecar soak driver — the row 6.3 probe CLI.
 *
 * Opens `--sockets` authenticated WebSocket connections against the
 * notification sidecar for a `--duration-s` window and asserts a stable
 * hold: every socket must complete the REAL handshake (origin allowlist
 * → per-IP token bucket → `access_token` cookie → JWT verification →
 * per-user/global cap registration) and stay open for the whole window.
 * Zero mid-window closes are tolerated — the sidecar's own policy (close
 * after `WS_MISSED_PONG_LIMIT = 2` unanswered pings) never fires against
 * a spec-compliant client, so ANY mid-window close code is an unexplained
 * drop and fails the soak.
 *
 * Opening is PACED like a spec-compliant client: the sidecar's per-IP
 * handshake token bucket rejects single-IP bursts with a policy close
 * `4429` right after the upgrade, so sockets open SEQUENTIALLY, a `4429`
 * waits one refill interval (plus margin) and retries the same socket
 * (bounded attempts). Only sockets that survive a post-open settle grace
 * enter the hold window — the soak never bypasses the bucket.
 *
 * Authentication is HONEST: tokens are signed with the platform's real
 * `signAccessToken` for real user rows read from the database (round-robin,
 * never more per user than the configured per-user cap), then presented as
 * the `access_token` cookie exactly like the browser client. The sidecar
 * verifies each one through its production pipeline — there is no bypass.
 *
 * Usage:
 *   bun run scripts/load/ws-soak.ts --url ws://127.0.0.1:3101 \
 *     [--sockets 100] [--duration-s 60] [--origin http://localhost:3000] [--out <path>]
 *
 * Exit codes: 0 = every socket opened and held for the full window;
 * 1 = usage error, cap violation, missing users, or any unexplained drop.
 */

import {
  NOTIFICATION_WS_CLOSE_CODES,
  WS_HANDSHAKE_BUCKET_REFILL_INTERVAL_MS,
} from "@/backend/ws/notification-ws-server-constants";
import { applyEnvFile } from "@/scripts/dbActions/envFile";
import { createBunWebSocket } from "@/scripts/lib/bun-websocket";
import { writeLoadArtifact } from "@/scripts/load/lib/artifact";
import { type LoadArgSpec, parseLoadCliArgs } from "@/scripts/load/lib/cli";

const ARGS: readonly LoadArgSpec[] = [
  { name: "url", kind: "string", required: true, help: "Sidecar WebSocket URL (explicit — never autodetected)" },
  { name: "sockets", kind: "number", default: 100, help: "Concurrent authenticated sockets" },
  { name: "duration-s", kind: "number", default: 60, help: "Soak window in seconds" },
  {
    name: "origin",
    kind: "string",
    default: "http://localhost:3000",
    help: "Origin header for the handshake allowlist check",
  },
  { name: "out", kind: "string", help: "Explicit artifact output path (default: scratch/load/<stamp>.json)" },
];

/** One socket's observed lifecycle. */
interface SoakOutcome {
  readonly socketIndex: number;
  readonly userId: number;
  opened: boolean;
  midWindowCloseCode: number | null;
  openFailureCode: number | null;
}

/** Sidecar policy close codes — the only codes a healthy soak may name. */
const EXPECTED_CLOSE_CODES: ReadonlySet<number> = new Set([1000]);

/**
 * Post-open settle grace: policy closes (`4429` throttled, `4401`
 * unauthenticated, …) land within milliseconds of the upgrade, so a
 * socket only counts as established once it survives this grace.
 */
const POST_OPEN_SETTLE_MS = 250;

/** Margin added to the refill interval so a throttled retry finds a token. */
const HANDSHAKE_RETRY_MARGIN_MS = 300;

/** Bounded retries for one throttled handshake before declaring an open failure. */
const MAX_HANDSHAKE_ATTEMPTS = 3;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Cap checks + real signed tokens for real users (round-robin, cap-respecting). */
async function planSoak(
  db: Awaited<typeof import("@/backend/db")>["db"],
  sockets: number
): Promise<{
  readonly config: { readonly wsMaxConnections: number; readonly wsMaxConnectionsPerUser: number };
  readonly tokens: readonly { socketIndex: number; userId: number; token: string }[];
}> {
  const { sql } = await import("drizzle-orm");
  const { getEnvironmentConfig } = await import("@/backend/lib/env");
  const { signAccessToken } = await import("@/backend/lib/auth/jwt");

  const config = getEnvironmentConfig();
  if (sockets > config.wsMaxConnections) {
    throw new Error(
      `--sockets ${sockets} exceeds the sidecar global cap (WS_MAX_CONNECTIONS=${config.wsMaxConnections}); raise the cap on the sidecar or lower --sockets`
    );
  }
  const usersNeeded = Math.ceil(sockets / config.wsMaxConnectionsPerUser);
  const usersResult = await db.execute<{ id: number; role: string }>(sql`
    SELECT id, role FROM users ORDER BY id LIMIT ${usersNeeded}`);
  if (usersResult.rows.length < usersNeeded) {
    throw new Error(
      `need ${usersNeeded} distinct users (per-user cap ${config.wsMaxConnectionsPerUser}) but the database has only ${usersResult.rows.length}`
    );
  }

  const tokens = await Promise.all(
    Array.from({ length: sockets }, (_, index) => {
      const user = usersResult.rows.at(index % usersResult.rows.length);
      if (user === undefined) {
        throw new Error("user round-robin underflow");
      }
      return signAccessToken({ userId: user.id, role: user.role }).then(token => ({
        socketIndex: index,
        userId: user.id,
        token,
      }));
    })
  );
  return { config, tokens };
}

/** One honest handshake attempt: `established` = opened AND survived the grace. */
interface HandshakeAttempt {
  readonly established: boolean;
  readonly closeCode: number | null;
  readonly socket: WebSocket | null;
}

/** Attempts one handshake; resolves once the socket settles (or survives the grace). */
function attemptHandshake(url: string, origin: string, token: string): Promise<HandshakeAttempt> {
  const socket = new createBunWebSocket(url, { headers: { origin, cookie: `access_token=${token}` } });
  return new Promise<HandshakeAttempt>(resolve => {
    const finish = (established: boolean, closeCode: number | null): void => {
      resolve({ established, closeCode, socket });
    };
    socket.addEventListener("open", () => {
      setTimeout(() => finish(true, null), POST_OPEN_SETTLE_MS);
    });
    socket.addEventListener("close", (event: CloseEvent) => finish(false, event.code));
    socket.addEventListener("error", () => finish(false, null));
  });
}

/**
 * Opens sockets SEQUENTIALLY at the handshake bucket's compliant-client
 * rate (burst 5, then ~1 per refill interval from one driver IP): a `4429`
 * attempt waits one refill interval and retries the same socket (bounded);
 * any other unsettled attempt is a hard open failure. Established sockets
 * get a mid-window close watcher and join the hold window.
 */
async function openPacedSockets(
  url: string,
  origin: string,
  tokens: readonly { socketIndex: number; userId: number; token: string }[],
  outcomes: readonly SoakOutcome[],
  socketsByIndex: Map<number, WebSocket>
): Promise<void> {
  const openOne = async (index: number, attempt: number): Promise<void> => {
    const entry = tokens.at(index);
    const outcome = outcomes.at(index);
    if (entry === undefined || outcome === undefined) {
      return;
    }
    const result = await attemptHandshake(url, origin, entry.token);
    const throttled = result.closeCode === NOTIFICATION_WS_CLOSE_CODES.throttled;
    if (result.established && result.socket !== null) {
      outcome.opened = true;
      socketsByIndex.set(entry.socketIndex, result.socket);
      result.socket.addEventListener("close", (event: CloseEvent) => {
        outcome.midWindowCloseCode = event.code;
      });
      await openOne(index + 1, 0);
      return;
    }
    if (throttled && attempt + 1 < MAX_HANDSHAKE_ATTEMPTS) {
      await sleep(WS_HANDSHAKE_BUCKET_REFILL_INTERVAL_MS + HANDSHAKE_RETRY_MARGIN_MS);
      await openOne(index, attempt + 1);
      return;
    }
    outcome.openFailureCode = result.closeCode ?? -1;
    await openOne(index + 1, 0);
  };
  await openOne(0, 0);
}

async function main(): Promise<number> {
  const args = parseLoadCliArgs("ws-soak.ts", ARGS);
  if (args === null) {
    return 1;
  }
  const url = args.string("url");
  const sockets = args.number("sockets") ?? 100;
  const durationSeconds = args.number("duration-s") ?? 60;
  const origin = args.string("origin") ?? "http://localhost:3000";
  if (url === undefined || !/^wss?:\/\//.test(url)) {
    console.error("[ws-soak] --url must be an explicit ws(s):// sidecar URL");
    return 1;
  }

  applyEnvFile(".env");
  const { db, closePool } = await import("@/backend/db");

  let plan: Awaited<ReturnType<typeof planSoak>>;
  try {
    plan = await planSoak(db, sockets);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ws-soak] FAIL — ${message}`);
    await closePool();
    return 1;
  }

  const outcomes: SoakOutcome[] = plan.tokens.map(({ socketIndex, userId }) => ({
    socketIndex,
    userId,
    opened: false,
    midWindowCloseCode: null,
    openFailureCode: null,
  }));
  const socketsByIndex = new Map<number, WebSocket>();
  await openPacedSockets(url, origin, plan.tokens, outcomes, socketsByIndex);
  const openedCount = outcomes.filter(outcome => outcome.opened).length;
  console.log(`[ws-soak] ${openedCount}/${sockets} sockets completed the handshake`);

  console.log(`[ws-soak] holding the window for ${durationSeconds}s…`);
  await sleep(durationSeconds * 1000);

  const verdict = await finishSoak(outcomes, socketsByIndex, {
    url,
    sockets,
    durationSeconds,
    perUserCap: plan.config.wsMaxConnectionsPerUser,
    openedCount,
    explicitOut: args.string("out"),
  });
  await closePool();
  return verdict;
}

/** Reports the soak outcome, writes the artifact, returns the exit code. */
async function finishSoak(
  outcomes: readonly SoakOutcome[],
  socketsByIndex: ReadonlyMap<number, WebSocket>,
  report: {
    readonly url: string;
    readonly sockets: number;
    readonly durationSeconds: number;
    readonly perUserCap: number;
    readonly openedCount: number;
    readonly explicitOut: string | undefined;
  }
): Promise<number> {
  // Let a close frame racing the window boundary land before the snapshot.
  await sleep(500);
  const midWindowCloses = outcomes.filter(outcome => outcome.midWindowCloseCode !== null);
  const openFailures = outcomes.filter(outcome => !outcome.opened);
  for (const outcome of openFailures) {
    console.log(`[ws-soak] open-failure: socket ${outcome.socketIndex} code=${outcome.openFailureCode}`);
  }
  for (const outcome of midWindowCloses) {
    const code = outcome.midWindowCloseCode;
    const expected = code !== null && EXPECTED_CLOSE_CODES.has(code);
    console.log(
      `[ws-soak] mid-window close: socket ${outcome.socketIndex} code=${code}${expected ? " (expected)" : " (UNEXPLAINED DROP)"}`
    );
  }
  const heldCount = outcomes.filter(outcome => outcome.opened && outcome.midWindowCloseCode === null).length;
  const closeCodeCounts: Record<string, number> = {};
  for (const outcome of midWindowCloses) {
    const code = String(outcome.midWindowCloseCode);
    closeCodeCounts[code] = (closeCodeCounts[code] ?? 0) + 1;
  }
  const unexplainedDrops = midWindowCloses.filter(
    outcome => outcome.midWindowCloseCode === null || !EXPECTED_CLOSE_CODES.has(outcome.midWindowCloseCode)
  ).length;

  // Graceful teardown AFTER the snapshot — the driver's own closes must
  // never be misread as mid-window drops.
  for (const socket of socketsByIndex.values()) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1000);
    }
  }
  await sleep(500);

  const payload = {
    tool: "ws-soak",
    url: report.url.replace(/^wss?:\/\//, "<scheme>://"),
    sockets: report.sockets,
    durationSeconds: report.durationSeconds,
    perUserCap: report.perUserCap,
    openedCount: report.openedCount,
    heldCount,
    openFailures: openFailures.length,
    unexplainedDrops,
    midWindowCloseCodes: closeCodeCounts,
  };
  const artifact = report.explicitOut ?? writeLoadArtifact("ws-soak", payload);
  console.log(`[ws-soak] artifact: ${artifact}`);

  if (openFailures.length > 0 || unexplainedDrops > 0 || heldCount !== report.sockets) {
    console.error(
      `[ws-soak] FAIL — ${heldCount}/${report.sockets} held; ${openFailures.length} open failures; ${unexplainedDrops} unexplained mid-window drops (zero tolerated)`
    );
    return 1;
  }
  console.log(
    `[ws-soak] PASS — ${report.sockets}/${report.sockets} sockets held for the full ${report.durationSeconds}s window`
  );
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    console.error("[ws-soak] FAILED:", error);
    process.exit(1);
  });
