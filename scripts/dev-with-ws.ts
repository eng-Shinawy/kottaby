import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "@/backend/lib/logger";

type BunSubprocess = ReturnType<typeof Bun.spawn>;

const BUN_BIN = join(homedir(), ".bun", "bin", "bun");
// No explicit -p: Next auto-increments when 3000 is occupied (the default
// WS origin allowlist covers 3000 AND 3001), mirroring the plain `dev` script.
const DEV_SERVER_ARGS = ["next", "dev", "--turbopack"];
const WS_SIDECAR_ARGS = ["run", "scripts/start-notification-ws.ts"];

function killChild(child: BunSubprocess | null): void {
  if (child?.pid === undefined) return;
  try {
    process.kill(child.pid, "SIGTERM");
  } catch {
    // already dead — ignore
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    logger.error("dev-with-ws: refusing to launch in production environment.");
    process.exit(1);
  }

  logger.info("dev-with-ws: launching dev server + notification WS sidecar...");
  let shuttingDown = false;
  const devChild = Bun.spawn([BUN_BIN, "x", ...DEV_SERVER_ARGS], {
    cwd: process.cwd(),
    stdio: ["inherit", "inherit", "inherit"],
    env: process.env,
  });
  const wsChild = Bun.spawn([BUN_BIN, ...WS_SIDECAR_ARGS], {
    cwd: process.cwd(),
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, WS_HOST: "localhost" },
    onExit: () => {
      // The sidecar exiting while the dev server still runs means the
      // realtime push lane is down — the 120s polling floor remains, so the
      // dev server keeps running; the sidecar's own log above explains why.
      if (!shuttingDown) {
        logger.warn("dev-with-ws: notification WS sidecar exited — realtime push is down, the polling floor remains.");
      }
    },
  });

  const teardown = (signal: NodeJS.Signals): void => {
    shuttingDown = true;
    killChild(devChild);
    killChild(wsChild);
    if (signal === "SIGINT") {
      process.exit(0);
    }
    if (signal === "SIGTERM") {
      process.exit(128 + 15);
    }
    process.exit(128);
  };
  process.on("SIGINT", teardown);
  process.on("SIGTERM", teardown);

  const exitCode = await devChild.exited;
  shuttingDown = true;
  killChild(wsChild);
  process.exit(exitCode);
}

main().catch((err: unknown) => {
  logger.error("dev-with-ws: unexpected error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
