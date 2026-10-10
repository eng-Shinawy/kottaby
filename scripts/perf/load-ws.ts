/**
 * WebSocket stability harness (`perf:load-ws`).
 *
 * Holds `--connections` authenticated connections to the notification
 * sidecar (cookie handshake + allowlisted Origin), ramps them honoring the
 * sidecar's handshake token bucket, observes a liveness-checked stability
 * window, proves 100% fan-out delivery within the latency budget by
 * publishing guard-valid envelopes through the Redis bus the sidecar
 * subscribes to, and closes everything down with a client-observable
 * zero-residue check. Dropped connections are recorded, never retried.
 *
 * Safety contract, in order:
 *  1. The destructive-target guard runs FIRST (exit 2 on any non-test
 *     database target) — the harness writes no rows, but the guard keeps the
 *     perf-tool posture uniform.
 *  2. Environment refusals (in-process transport, missing REDIS_URL),
 *     seed-manifest refusals, and session-minting refusals happen before any
 *     run directory exists.
 *  3. When nothing listens on the WS port the harness boots the sidecar
 *     itself (torn down on every exit path, including signals) — an already
 *     listening sidecar is reused.
 *
 * Exit codes: 0 = verdict PASS · 1 = verdict FAIL / runtime failure ·
 * 2 = usage refusal / guard refusal / configuration refusal.
 */

import { join } from "node:path";
import {
  getNotificationFanoutTransport,
  getRedisUrl,
  getWebSocketAllowedOrigins,
  getWebSocketHost,
  getWebSocketMaxConnectionsPerUser,
  getWebSocketPort,
} from "@/backend/lib/env";
import { createBunWebSocket } from "@/scripts/lib/bun-websocket";
import { mintSessionCookie } from "@/scripts/perf/lib/auth-mint";
import { listSeedManifestEntries, PERF_LOGS_ROOT } from "@/scripts/perf/lib/cleanup-manifest";
import { assertTestDatabaseTarget } from "@/scripts/perf/lib/db-target-guard";
import {
  isLoadWsCliUsageError,
  isLoadWsHelpRequest,
  LOAD_WS_HELP_TEXT,
  LOAD_WS_RUN_ID_PATTERN,
  parseLoadWsCli,
} from "@/scripts/perf/lib/load-ws-cli";
import { LoadWsRefusalError, type WsHarnessSocket, type WsLoadEnv, type WsLoadIo } from "@/scripts/perf/lib/load-ws-io";
import { runLoadWs } from "@/scripts/perf/lib/load-ws-run";
import { createHarnessReportSeam } from "@/scripts/perf/lib/report-seam";

const SCRIPT_LABEL = "perf:load-ws";
const EXIT_USAGE = 2;
const EXIT_RUNTIME = 1;
const SIDECAR_SCRIPT = join(import.meta.dir, "..", "start-notification-ws.ts");
const TOOL_ID = "load-ws";

class BunWsHarnessSocket implements WsHarnessSocket {
  private readonly listeners = {
    open: [] as Array<() => void>,
    close: [] as Array<(code: number, reason: string) => void>,
    message: [] as Array<(data: string) => void>,
  };

  constructor(private readonly socket: WebSocket) {
    this.socket.addEventListener("open", () => {
      for (const handler of this.listeners.open) {
        handler();
      }
    });
    this.socket.addEventListener("close", event => {
      for (const handler of this.listeners.close) {
        handler(event.code, event.reason);
      }
    });
    this.socket.addEventListener("message", event => {
      for (const handler of this.listeners.message) {
        handler(String(event.data));
      }
    });
  }

  addOpenListener(handler: () => void): void {
    this.listeners.open.push(handler);
  }

  addCloseListener(handler: (code: number, reason: string) => void): void {
    this.listeners.close.push(handler);
  }

  addMessageListener(handler: (data: string) => void): void {
    this.listeners.message.push(handler);
  }

  isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  close(code: number, reason: string): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(code, reason);
    }
  }
}

/** Runtime guard over a parsed manifest body (never a blind cast). */
interface WsManifestShape {
  readonly runId: string;
  readonly completedAt: unknown;
  readonly identities: { readonly wsIdentityEmails: readonly unknown[] };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWsIdentitiesManifest(value: unknown): value is WsManifestShape {
  if (!isPlainRecord(value) || typeof value.runId !== "string") {
    return false;
  }
  const identities: unknown = value.identities;
  return isPlainRecord(identities) && Array.isArray(identities.wsIdentityEmails);
}

/** Selects the newest completed seed manifest (or the newest for `--run`); refusals are actionable. */
export function selectWsManifest(
  runId: string | null,
  logsRoot: string = PERF_LOGS_ROOT
): { runId: string; wsIdentityEmails: readonly string[] } {
  const entries = listSeedManifestEntries(logsRoot);
  const candidates =
    runId === null
      ? entries
      : entries.filter(
          entry => entry.readError === null && isWsIdentitiesManifest(entry.body) && entry.body.runId === runId
        );
  if (runId !== null && candidates.length === 0) {
    throw new LoadWsRefusalError(`no seed manifest found for run "${runId}" under logs/perf — run perf:seed first`);
  }
  for (const entry of candidates) {
    if (entry.readError !== null || !isWsIdentitiesManifest(entry.body)) {
      if (runId === null) {
        continue;
      }
      throw new LoadWsRefusalError(
        `the seed manifest at ${entry.manifestPath} could not be read — fix or remove it, or select another run with --run`
      );
    }
    if (entry.body.completedAt === null) {
      if (runId === null) {
        continue;
      }
      throw new LoadWsRefusalError(
        `the seed manifest at ${entry.manifestPath} is from an incomplete seed run (no completion timestamp)`
      );
    }
    const emails = entry.body.identities.wsIdentityEmails.filter(
      (email: unknown): email is string => typeof email === "string" && email.length > 0
    );
    if (!LOAD_WS_RUN_ID_PATTERN.test(entry.body.runId)) {
      continue;
    }
    return { runId: entry.body.runId, wsIdentityEmails: emails };
  }
  throw new LoadWsRefusalError(
    runId === null
      ? "no completed seed manifest found under logs/perf — run perf:seed first (or select one with --run)"
      : `no completed seed manifest found for run "${runId}" under logs/perf`
  );
}

/** Probes whether anything is listening on the WS port (any HTTP response means yes). */
async function probeSidecarListening(wsUrl: string): Promise<boolean> {
  const httpUrl = wsUrl.replace(/^ws/, "http");
  try {
    await fetch(httpUrl, { method: "GET", signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

/** Spawns the sidecar entry with the harness-resolved config; guarantees no orphan on signals. */
function spawnSidecar(): { stop(): Promise<void> } {
  const proc = Bun.spawn({
    cmd: [process.execPath, SIDECAR_SCRIPT],
    cwd: process.cwd(),
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      WS_HOST: getWebSocketHost(),
      WS_PORT: String(getWebSocketPort()),
      WS_ALLOWED_ORIGINS: getWebSocketAllowedOrigins().join(","),
      REDIS_URL: getRedisUrl() ?? "",
      NOTIFICATION_FANOUT_TRANSPORT: "redis",
    },
  });
  let disposed = false;
  const killSidecar = (): void => {
    if (!disposed && proc.exitCode === null) {
      proc.kill("SIGTERM");
    }
  };
  process.once("SIGINT", () => {
    killSidecar();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    killSidecar();
    process.exit(143);
  });
  return {
    stop: async () => {
      disposed = true;
      if (proc.exitCode !== null) {
        return;
      }
      proc.kill("SIGTERM");
      const graceMs = 5000;
      const timeout = new Promise<number>(resolve => setTimeout(() => resolve(-1), graceMs));
      const exitCode = await Promise.race([proc.exited, timeout]);
      if (exitCode === -1 && proc.exitCode === null) {
        proc.kill("SIGKILL");
        await proc.exited;
      }
    },
  };
}

/** Wires the real io seams: env-seam reads, guard, manifest scan, minting, sockets, Redis, reports. */
function createRealIo(): WsLoadIo {
  const reportSeam = createHarnessReportSeam(TOOL_ID);
  let publisher: { publish(channel: string, message: string): Promise<unknown>; close(): Promise<void> } | null = null;
  const ensurePublisher = async () => {
    if (publisher === null) {
      const { IoredisFanoutClient } = await import("@/backend/services/notifications/realtime/ioredis-fanout-client");
      const redisUrl = getRedisUrl();
      if (redisUrl === undefined) {
        throw new Error("REDIS_URL is not configured");
      }
      publisher = new IoredisFanoutClient(redisUrl);
    }
    return publisher;
  };
  return {
    log: message => console.log(message),
    now: () => Date.now(),
    sleep: async ms => {
      await new Promise(resolve => setTimeout(resolve, ms));
    },
    env: (): WsLoadEnv => ({
      databaseUrl: process.env.DATABASE_URL ?? "",
      wsUrl: `ws://${getWebSocketHost()}:${getWebSocketPort()}`,
      origin: getWebSocketAllowedOrigins()[0] ?? "",
      perUserCap: getWebSocketMaxConnectionsPerUser(),
      redisUrl: getRedisUrl(),
      transport: getNotificationFanoutTransport(),
    }),
    assertTarget: (databaseUrl, opts) => assertTestDatabaseTarget(databaseUrl, opts),
    selectManifest: runId => selectWsManifest(runId),
    mintSession: async (baseUrl, email, password) => {
      const session = await mintSessionCookie(baseUrl, email, password);
      return { userId: session.userId, cookieHeader: session.cookieHeader };
    },
    openWebSocket: (url, headers) => new BunWsHarnessSocket(new createBunWebSocket(url, { headers })),
    publishFanout: async (channel, wire) => {
      const client = await ensurePublisher();
      await client.publish(channel, wire);
    },
    closePublisher: async () => {
      const client = publisher;
      publisher = null;
      if (client !== null) {
        await client.close();
      }
    },
    probeSidecarUp: async () => probeSidecarListening(`ws://${getWebSocketHost()}:${getWebSocketPort()}`),
    startSidecar: async () => spawnSidecar(),
    openReport: reportSeam.openReport,
    writeReport: reportSeam.writeReport,
    emitVerdict: reportSeam.emitVerdict,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (isLoadWsHelpRequest(argv)) {
    console.log(LOAD_WS_HELP_TEXT);
    return;
  }
  const parsed = parseLoadWsCli(argv, { perUserCap: getWebSocketMaxConnectionsPerUser() });
  if (isLoadWsCliUsageError(parsed)) {
    console.error(parsed.message);
    process.exit(EXIT_USAGE);
  }
  try {
    const outcome = await runLoadWs(parsed, createRealIo());
    process.exit(outcome.passed ? 0 : EXIT_RUNTIME);
  } catch (error) {
    if (error instanceof LoadWsRefusalError) {
      console.error(`${SCRIPT_LABEL}: ${error.message}`);
      process.exit(EXIT_USAGE);
    }
    console.error(`${SCRIPT_LABEL}: run failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(EXIT_RUNTIME);
  }
}

if (import.meta.main) {
  void main();
}
