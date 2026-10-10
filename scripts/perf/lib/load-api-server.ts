/**
 * Server lifecycle for the API load harness: resolves the GraphQL endpoint,
 * probes readiness the way the test runner does (HEAD /api/graphql → 204),
 * and boots the harness's own test server on port 3066 — production mode
 * when TEST_SERVER_MODE=production, development mode otherwise — with the
 * test-server env (TEST_SERVER=1 + IS_DEMO=true, the operative limiter
 * bypass). The spawned server never becomes an orphan: SIGINT/SIGTERM kill
 * it, and every stop() path escalates TERM → 5s grace → KILL.
 */

import { type ApiServerHandle, LoadApiRefusalError } from "@/scripts/perf/lib/load-api-io";

/** The port the harness boots its own server on (the test runner's default). */
export const BOOT_PORT = 3066;
/** Health-wait budget for a harness-booted server (mirrors the test runner). */
const BOOT_READY_TIMEOUT_MS = 180_000;
/** Health-verify budget for an external --base-url server. */
const EXTERNAL_READY_TIMEOUT_MS = 15_000;
const HEALTH_POLL_INTERVAL_MS = 500;
/** One readiness probe's own timeout, so a hung accept cannot stall the wait loop. */
const HEAD_PROBE_TIMEOUT_MS = 1_500;

/** Resolves the GraphQL endpoint on a server root (trailing slashes tolerated). */
export function graphqlEndpoint(baseUrl: string): string {
  let root = baseUrl;
  while (root.endsWith("/")) {
    root = root.slice(0, -1);
  }
  return `${root}/api/graphql`;
}

/** Probes server readiness the way the test runner does: HEAD /api/graphql → 204. */
async function pollServerReady(baseUrl: string, deadlineMs: number): Promise<boolean> {
  while (Date.now() < deadlineMs) {
    try {
      const response = await fetch(graphqlEndpoint(baseUrl), {
        method: "HEAD",
        signal: AbortSignal.timeout(HEAD_PROBE_TIMEOUT_MS),
      });
      if (response.status === 204) {
        return true;
      }
    } catch {
      // Server not ready yet.
    }
    await new Promise(resolve => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}

/** Parent env with DB vars dropped so the spawned server's env file is the sole DB source. */
function buildServerEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.DATABASE_URL;
  delete env.DB_FILE_NAME;
  delete env.DB_PROVIDER;
  delete env.DB_CONNECTION_MODE;
  return env;
}

/** Spawns the test server with the runner's boot env; guarantees no orphan on signals. */
function spawnTestServer(mode: "production" | "development"): { stop(): Promise<void>; diedUnexpectedly(): boolean } {
  const envFile = process.env.TEST_ENV_FILE ?? ".env.test";
  const args =
    mode === "production"
      ? ["--env-file=" + envFile, "run", "next", "start", "-p", String(BOOT_PORT), "-H", "0.0.0.0"]
      : ["--env-file=" + envFile, "run", "next", "dev", "--turbopack", "-p", String(BOOT_PORT), "-H", "0.0.0.0"];
  const proc = Bun.spawn({
    cmd: [process.execPath, ...args],
    cwd: process.cwd(),
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...buildServerEnv(),
      NODE_ENV: mode === "production" ? "production" : "development",
      NEXT_DIST_DIR: mode === "production" ? ".next-test-prod" : ".next-test-dev",
      IS_DEMO: "true",
      TEST_SERVER: "1",
      PORT: String(BOOT_PORT),
      GRAPHQL_TEST_PORT: String(BOOT_PORT),
      TEST_SERVER_PORT: String(BOOT_PORT),
      DISABLE_RATE_LIMITING: "true",
    },
  });
  let stopped = false;
  let died = false;
  void (async () => {
    await proc.exited;
    if (!stopped) {
      died = true;
    }
  })();
  const kill = (): void => {
    if (!stopped && proc.exitCode === null) {
      proc.kill("SIGTERM");
    }
  };
  process.once("SIGINT", () => {
    kill();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    kill();
    process.exit(143);
  });
  return {
    stop: async () => {
      stopped = true;
      if (proc.exitCode !== null) {
        return;
      }
      proc.kill("SIGTERM");
      const timeout = new Promise<number>(resolve => setTimeout(() => resolve(-1), 5000));
      const exitCode = await Promise.race([proc.exited, timeout]);
      if (exitCode === -1 && proc.exitCode === null) {
        proc.kill("SIGKILL");
        await proc.exited;
      }
    },
    diedUnexpectedly: () => died,
  };
}

/** Boots the harness's own server, or health-verifies an external --base-url server. */
export async function ensureServerHandle(
  baseUrl: string | null,
  mode: "production" | "development"
): Promise<ApiServerHandle> {
  if (baseUrl !== null) {
    const deadline = Date.now() + EXTERNAL_READY_TIMEOUT_MS;
    if (!(await pollServerReady(baseUrl, deadline))) {
      throw new LoadApiRefusalError(
        `the server at ${baseUrl} is not ready (HEAD /api/graphql did not answer 204 within ${EXTERNAL_READY_TIMEOUT_MS / 1000}s) — start it with the test-server env or drop --base-url to let the harness boot one`
      );
    }
    return { baseUrl, spawned: false, stop: async () => {}, diedUnexpectedly: () => false };
  }
  const probe = await fetch(graphqlEndpoint(`http://127.0.0.1:${BOOT_PORT}`), {
    method: "HEAD",
    signal: AbortSignal.timeout(HEAD_PROBE_TIMEOUT_MS),
  }).then(
    () => true,
    () => false
  );
  if (probe) {
    throw new LoadApiRefusalError(
      `something is already listening on port ${BOOT_PORT} — pass --base-url to reuse it or free the port`
    );
  }
  const handle = spawnTestServer(mode);
  const deadline = Date.now() + BOOT_READY_TIMEOUT_MS;
  const bootUrl = `http://127.0.0.1:${BOOT_PORT}`;
  if (!(await pollServerReady(bootUrl, deadline))) {
    await handle.stop();
    throw new LoadApiRefusalError(
      `the harness-booted ${mode} server did not become ready within ${BOOT_READY_TIMEOUT_MS / 1000}s ` +
        "(production mode needs `bun run build:test` first; check the port is free and .env.test is valid)"
    );
  }
  return {
    baseUrl: bootUrl,
    spawned: true,
    stop: () => handle.stop(),
    diedUnexpectedly: () => handle.diedUnexpectedly(),
  };
}
