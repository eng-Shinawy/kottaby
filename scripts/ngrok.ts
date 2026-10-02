#!/usr/bin/env bun
/**
 * Ngrok tunnel launcher for local Paymob webhook development (`bun run ngrok`).
 *
 * Starts an ngrok HTTP tunnel forwarding to the local Next.js dev server,
 * using the reserved domain + authtoken from the project `.env` (the same
 * keys the in-app callback-channel factory reads: `NGROK_AUTHTOKEN`,
 * `NGROK_DOMAIN`, `NGROK_PORT`), and prints the exact callback URL the
 * Paymob intention / dashboard needs.
 *
 * The dev server also warms this tunnel itself (root `instrumentation.ts`
 * resolves the ngrok channel at boot when both keys are set), so this
 * script is the manual path: start the tunnel before the server, or run it
 * standalone for Paymob dashboard webhook testing. If the dev server
 * already holds the reserved domain, ngrok answers ERR_NGROK_334 — stop
 * the other tunnel first (the script maps that error to a targeted hint).
 *
 * Usage:
 *   bun run ngrok                    # reads .env, port from NGROK_PORT ?? 3000
 *   bun run ngrok --port 3000        # custom local port
 *   bun run ngrok --domain my-domain.ngrok-free.app
 *   bun run ngrok --authtoken <token>
 *   bun run ngrok --env-file .env.local
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

/** Local route surfaces the printed panel names. */
const WEBHOOK_PATH = "/api/payments/webhook";
const RESULT_PATH = "/student/checkout/result";
const HEALTH_PATH = "/api/health";
const INSPECT_ADDR = "http://127.0.0.1:4040";

// ── Colors for CLI Output ───────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

function log(msg: string): void {
  console.log(msg);
}

function logError(msg: string): void {
  console.error(`${RED}${msg}${RESET}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── CLI options ─────────────────────────────────────────────────────────────

interface CliOptions {
  port: number;
  domain: string | null;
  authtoken: string | null;
  envFile: string;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let envFile = ".env";
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === "--env-file" && typeof next === "string") {
      envFile = next;
    }
  }

  const envPath = resolve(process.cwd(), envFile);
  if (existsSync(envPath)) {
    loadEnv({ path: envPath, quiet: true });
  }

  const options: CliOptions = {
    port: parsePositiveInt(process.env.NGROK_PORT, 3000),
    domain: process.env.NGROK_DOMAIN?.trim() ?? null,
    authtoken: process.env.NGROK_AUTHTOKEN?.trim() ?? null,
    envFile,
  };

  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if ((argv[i] === "--port" || argv[i] === "-p") && typeof next === "string") {
      options.port = parsePositiveInt(next, options.port);
      i++;
    } else if (argv[i] === "--domain" && typeof next === "string") {
      options.domain = next.trim();
      i++;
    } else if (argv[i] === "--authtoken" && typeof next === "string") {
      options.authtoken = next.trim();
      i++;
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  log(`
${BOLD}Kottaby Ngrok Development Tunnel${RESET}

Starts an ngrok HTTP tunnel to the local dev server for Paymob webhook testing.
Credentials come from the project .env (NGROK_AUTHTOKEN / NGROK_DOMAIN / NGROK_PORT).

${BOLD}Usage:${RESET}
  bun run ngrok [options]

${BOLD}Options:${RESET}
  -p, --port <number>       Local port to forward to (default: NGROK_PORT ?? 3000)
  --domain <domain>         Reserved ngrok domain (default: NGROK_DOMAIN)
  --authtoken <token>       Ngrok authtoken (default: NGROK_AUTHTOKEN)
  --env-file <file>         Environment file to read (default: .env)
  -h, --help                Show this help message

${BOLD}Examples:${RESET}
  bun run ngrok                                  # tunnel from .env credentials
  bun run ngrok --port 3000                      # forward to a custom port
  bun run ngrok --domain my-app.ngrok-free.app   # explicit reserved domain
`);
}

// ── Health check for the dev server ─────────────────────────────────────────

async function probeLocalDevServer(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}${HEALTH_PATH}`, {
      method: "GET",
      signal: AbortSignal.timeout(1000),
    });
    return res.status !== 0;
  } catch {
    return false;
  }
}

// ── Extract error message from an ngrok log record ──────────────────────────

function extractErrorMessage(record: Record<string, unknown>): string {
  if (typeof record.err === "string") return record.err;
  if (typeof record.msg === "string") return record.msg;
  if (isRecord(record.err)) return JSON.stringify(record.err);
  return "";
}

// ── Main execution ──────────────────────────────────────────────────────────

/** Stream parser state shared by the stdout/stderr readers. */
interface TunnelMonitor {
  readonly child: ReturnType<typeof spawn>;
  reportTunnel: (url: string) => Promise<void>;
  buffer: string;
}

function reportTunnelOnline(url: string, port: number, serverRunning: boolean): void {
  log("\n" + "═".repeat(70));
  log(`${BOLD}${GREEN}  NGROK TUNNEL ONLINE${RESET}`);
  log("═".repeat(70));
  log(`  ${BOLD}Forwarding:${RESET}      ${CYAN}${url}${RESET}  ->  http://localhost:${port}`);
  log(`  ${BOLD}Web Inspection:${RESET}  ${INSPECT_ADDR}`);
  log("─".repeat(70));
  log(`  ${BOLD}Paymob Webhook Settings:${RESET}`);
  log(`  • ${BOLD}Callback URL:${RESET}    ${GREEN}${url}${WEBHOOK_PATH}${RESET}`);
  log(`  • ${BOLD}Result redirect:${RESET} ${url}${RESULT_PATH}`);
  log("═".repeat(70));

  if (!serverRunning) {
    log(
      `\n${YELLOW}${BOLD}[NOTICE]${RESET} Local dev server not responding on http://localhost:${port}${HEALTH_PATH}.`
    );
    log(`         Start it in another terminal:`);
    log(`         ${CYAN}bun run dev${RESET}\n`);
  } else {
    log(`\n${GREEN}✓ Local dev server detected on port ${port}.${RESET}`);
    log(`${GRAY}  The dev server adopts this tunnel automatically (callback-channel probe-first reuse).${RESET}\n`);
  }

  log(`${GRAY}Press Ctrl+C to stop the tunnel.${RESET}\n`);
}

function handleNgrokError(message: string): void {
  if (message.includes("ERR_NGROK_334") || message.includes("already online")) {
    logError("\n[Ngrok Error] The requested domain is already online in another session.");
    log(`The dev server's in-app callback channel may already hold it (started via ${CYAN}bun run dev${RESET}).`);
    log(`Stop that tunnel (restart the dev server) or run this script before it.\n`);
  } else if (message.includes("ERR_NGROK_320") || message.includes("reserved for another account")) {
    logError("\n[Ngrok Error] The domain is reserved for a different ngrok account.");
    log(`Check NGROK_AUTHTOKEN in .env matches the account owning NGROK_DOMAIN.\n`);
  } else {
    logError(`[Ngrok Error] ${message}`);
  }
}

function handleLogLine(monitor: TunnelMonitor, line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isRecord(parsed)) return;

    if (parsed.msg === "started tunnel" && typeof parsed.url === "string") {
      void monitor.reportTunnel(parsed.url);
    }

    if (parsed.lvl === "eror" || parsed.lvl === "crit") {
      handleNgrokError(extractErrorMessage(parsed));
    }
  } catch {
    if (trimmed.startsWith("ERROR:") || trimmed.startsWith("FATA")) {
      logError(trimmed);
    }
  }
}

async function readStream(monitor: TunnelMonitor, stream: NodeJS.ReadableStream): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    monitor.buffer += decoder.decode(bytes, { stream: true });
    const lines = monitor.buffer.split("\n");
    monitor.buffer = lines.pop() ?? "";
    for (const line of lines) {
      handleLogLine(monitor, line);
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!options.domain) {
    logError("Error: no ngrok domain configured.");
    log("\nSet NGROK_DOMAIN (and NGROK_AUTHTOKEN) in .env, or pass --domain explicitly:");
    log(`  ${CYAN}bun run ngrok --domain your-app.ngrok-free.app${RESET}\n`);
    process.exit(1);
  }

  const domain = options.domain.startsWith("http") ? options.domain : `https://${options.domain}`;

  const ngrokArgs = ["ngrok", "http", String(options.port), "--url", domain, "--log", "stdout", "--log-format", "json"];

  log(`${GRAY}Starting ngrok tunnel for port ${options.port}${RESET}`);
  log(`${GRAY}  env file: ${options.envFile}${RESET}`);
  log(`${GRAY}  authtoken: ${options.authtoken ? "(from credentials)" : "none (agent config / free URL)"}${RESET}`);

  const child = spawn(ngrokArgs[0] ?? "ngrok", ngrokArgs.slice(1), {
    env: options.authtoken ? { ...process.env, NGROK_AUTHTOKEN: options.authtoken } : { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let hasReported = false;
  const monitor: TunnelMonitor = {
    child,
    reportTunnel: async url => {
      if (hasReported) return;
      hasReported = true;
      reportTunnelOnline(url, options.port, await probeLocalDevServer(options.port));
    },
    buffer: "",
  };

  const cleanup = (): void => {
    try {
      child.kill();
    } catch {
      // already dead
    }
  };

  process.on("SIGINT", () => {
    log(`\n${YELLOW}Stopping ngrok tunnel...${RESET}`);
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  void readStream(monitor, child.stdout).catch(() => {
    // stream closed
  });
  void readStream(monitor, child.stderr).catch(() => {
    // stream closed
  });

  const exitCode = await new Promise<number>(resolveExit => {
    child.on("exit", code => resolveExit(code ?? 1));
  });
  if (exitCode !== 0 && !hasReported) {
    process.exit(exitCode);
  }
}

await main();
