import { afterAll, beforeAll } from "bun:test";
import { join } from "node:path";
import { spawnSync } from "bun";
import { TEST_PORT } from "@/test/helpers/graphql-test-helpers";
import { killListenersOnPort } from "@/test/helpers/port-helpers";

/**
 * Server lifecycle for suites that boot a real `next dev` on TEST_PORT.
 *
 * Teardown discipline (the EADDRINUSE lesson): `next dev` spawns a CHILD
 * `next-server` process that owns the listen socket. Killing the `next dev`
 * parent alone leaves that child holding TEST_PORT, and the NEXT test
 * file's boot fails with EADDRINUSE. The server is therefore launched under
 * `setsid` (the child becomes a session+process-group leader) and teardown
 * signals the WHOLE GROUP (`kill -TERM -<pgid>`) — parent and every
 * descendant die together. `killListenersOnPort` stays as a belt-and-braces
 * sweep for environments where lsof resolves socket owners (some sandboxes
 * hide that mapping, so the group kill is the primary mechanism).
 */

let serverProcess: ReturnType<typeof Bun.spawn> | null = null;

async function pollOnce(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `_health` was retyped to `HealthCheck!`, so the former bare
      // `{ _health }` probe document fails validation (HTTP 400) and
      // `waitForServer` would never succeed. Probe a subfield instead.
      body: JSON.stringify({ query: "{ _health { status } }" }),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Recursive poller — avoids `await` inside a `while`/`for` loop (no-await-in-loop).
async function waitForServer(port: number, deadline: number): Promise<void> {
  if (Date.now() > deadline) {
    throw new Error(`Server on port ${port} did not start within the allotted time`);
  }
  if (await pollOnce(port)) return;
  await sleep(500);
  return waitForServer(port, deadline);
}

/** Signals the whole process group of the spawned server (`-<pgid>`). */
function killServerGroup(pid: number, signal: string): void {
  // `kill -<SIGNAME> -<pgid>` — the signal rides the DASHED form and the
  // negative pgid targets the whole group (parent + next-server child).
  spawnSync(["kill", `-${signal}`, `-${pid}`], { stdout: "ignore", stderr: "ignore" });
  // Fallback for the direct pid in case the group already vanished.
  spawnSync(["kill", `-${signal}`, String(pid)], { stdout: "ignore", stderr: "ignore" });
}

const POLL_DEADLINE_MS = 60_000;
const BEFORE_ALL_TIMEOUT_MS = 90_000;

export function setupTestServerLifecycle(): void {
  beforeAll(async () => {
    if (await pollOnce(TEST_PORT)) {
      return;
    }

    // Resolve the `next` CLI to an absolute path so no PATH lookup is needed
    // (sonarjs/no-os-command-from-path). `Bun.spawn` is used instead of
    // `node:child_process.spawn` for the same reason. `setsid` makes the
    // spawned `next` a session+group leader so teardown can signal the full
    // process tree (see the module doc). The next bin's shebang
    // (`#!/usr/bin/env node`) runs it under node, which honours NODE_OPTIONS
    // for the 2 GB heap cap.
    const nextBin = join(process.cwd(), "node_modules", ".bin", "next");
    serverProcess = Bun.spawn({
      cmd: ["setsid", nextBin, "dev", "--turbopack", "--port", String(TEST_PORT)],
      cwd: process.cwd(),
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "development",
        // Memory-capped test-server heap (4GB CI/sandbox boxes OOM-kill the
        // runner when turbopack's compile spike is allowed the full 2GB on
        // top of the bun test process; 1280MB boots clean and compile-stable).
        NODE_OPTIONS: "--max-old-space-size=1280",
      },
    });

    await waitForServer(TEST_PORT, Date.now() + POLL_DEADLINE_MS);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(() => {
    if (serverProcess) {
      // Group signal first (parent + next-server child die together), then
      // the escalated group kill — SIGTERM alone can leave turbopack's
      // child mid-compile; a surviving listener strands TEST_PORT.
      killServerGroup(serverProcess.pid, "TERM");
      killServerGroup(serverProcess.pid, "KILL");
      serverProcess = null;
    }
    // Belt-and-braces sweep: environments where lsof CAN resolve the port
    // owner get a guaranteed-free TEST_PORT even if a foreign process
    // (not our group) holds it. No-op where lsof cannot (guarded ports and
    // self-pids are excluded by the helper).
    killListenersOnPort(TEST_PORT);
  });
}
